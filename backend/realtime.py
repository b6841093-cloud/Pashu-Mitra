"""Authenticated real-time signaling for the web-calling feature.

Transport: Flask-SocketIO over WebSocket (``simple-websocket``), with the
Socket.IO polling fallback. One signaling technology for the whole feature.

Security model
--------------
* The handshake must present the same JWT the REST API uses
  (``auth: {token}``). The token is verified with the application's existing
  ``decode_token`` and the user is re-loaded from the database, so a
  caller-supplied user id/role is never trusted.
* Every socket joins only its own private room ``user:<id>``. Call events are
  emitted to a specific user's room, never to a broadcast channel.
* Every signaling message is authorized against the persisted call record
  (participants only, state machine respected) and written to
  ``web_call_signals`` before it is relayed, so a message cannot be lost if the
  receiver is served by a different worker and cannot be forged by a
  non-participant.
* Payloads are validated (kind allow-list + size limit) and rate limited.
* Tokens and signaling payloads are never logged.
"""
from __future__ import annotations

import logging
import os
import threading

from flask import request, session
from flask_socketio import SocketIO, emit, join_room

import webcalling

logger = logging.getLogger(__name__)

socketio = SocketIO(
    async_mode="threading",
    cors_allowed_origins=None,  # replaced by init_realtime from configuration
    logger=False,
    engineio_logger=False,
    # A signaling frame is a few KB; 64 KB matches MAX_SIGNAL_BYTES.
    max_http_buffer_size=webcalling.MAX_SIGNAL_BYTES,
    ping_interval=25,
    ping_timeout=60,
)

_decode_token = None
_get_db = None
_sweeper_started = False
_sweeper_lock = threading.Lock()


# Socket.IO's *browser* client concatenates the configured path straight onto
# the origin: ``"https://host" + path``. A path without a leading slash therefore
# produces ``https://hostsocket.io/`` — an unresolvable host — and the signaling
# socket never connects (measured 2026-10-05: the Engine.IO handshake request
# never reached the server, so no vet presence was ever registered and every
# farmer call ended as NO_LIVE_SESSION).
#
# The Python server is *tolerant*: Engine.IO normalizes its mount point, so
# ``socket.io`` and ``/socket.io`` are the same server route. That asymmetry is
# exactly why a one-sided value can ship unnoticed — the server is healthy while
# no browser can reach it. This module is the single source of truth for the
# path, and always hands out the canonical, browser-safe form.
DEFAULT_SOCKETIO_PATH = "/socket.io"


def socketio_path() -> str:
    """Canonical Socket.IO path for both the server and the browser client.

    ``SIH_SOCKETIO_PATH`` is accepted in any spelling (``socket.io``,
    ``/socket.io``, ``/socket.io/``); the result always starts with ``/``.
    """
    raw = (os.environ.get("SIH_SOCKETIO_PATH") or "").strip()
    if not raw:
        return DEFAULT_SOCKETIO_PATH
    normalized = "/" + raw.lstrip("/")
    normalized = normalized.rstrip("/")
    return normalized or DEFAULT_SOCKETIO_PATH


# --------------------------------------------------------------------------
# Browser origins allowed to open the signaling socket
# --------------------------------------------------------------------------
# The allow-list is ALWAYS explicit: one full origin per entry (scheme + host
# [+ port]). ``*`` and wildcard patterns are refused on purpose — a wildcard
# would let any site on the internet drive an authenticated vet's socket.
#
# Two sources feed the list, in this order:
#
#   1. ``SIH_ALLOWED_ORIGINS`` (alias: ``SIH_FRONTEND_ORIGINS``) —
#      comma-separated, the deployment's own configuration. Update it in the
#      Render dashboard whenever the portal origin really changes.
#   2. ``BUILTIN_ALLOWED_ORIGINS`` — the portal origins this product is
#      deployed on. Render applies blueprint (``render.yaml``) env vars only
#      when a service is created; an *existing* service keeps its old value
#      until somebody edits it in the dashboard. Without this built-in list a
#      new Vercel preview URL therefore fails with a silent origin rejection
#      and the farmer only sees "Signaling offline" (2026-10-05 and again
#      2026-10-06: the preview origin under test was never in the deployed
#      variable). These entries are public portal URLs, never secrets.
BUILTIN_ALLOWED_ORIGINS = (
    # Stable production portal (recommended single production origin).
    "https://pashu-mitra-smoky.vercel.app",
    # Current preview origin under test (2026-10-06).
    "https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app",
    # Earlier preview origin still referenced by the deployed service.
    "https://pashu-mitra-efyqsdomw-pashu-shield.vercel.app",
)

# Local development origins. Harmless in production: they can only be used by a
# browser that is already running on the developer's own machine.
LOCAL_DEV_ORIGINS = (
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


def _normalize_origin(raw: str | None) -> str:
    """Canonical form of one origin: trimmed, no trailing slash, lowercase.

    Browsers send the ``Origin`` header without a trailing slash and with a
    lowercase scheme/host, but a value pasted into a dashboard can arrive with
    either ("https://portal.example.com/", "Portal.example.com "). Normalizing
    both sides is what makes an operator's paste actually work.
    """
    value = (raw or "").strip().rstrip("/")
    return value.lower()


_wildcard_warned: set[str] = set()


def _split_origins(raw: str) -> list[str]:
    """Comma-separated origins -> normalized, de-duplicated, wildcard-free list."""
    out: list[str] = []
    for part in (raw or "").split(","):
        origin = _normalize_origin(part)
        if not origin:
            continue
        if "*" in origin:
            # Never accept a wildcard, and say so instead of silently ignoring
            # it (an operator who pastes "*" must see that it had no effect).
            # Warned once per distinct value: this function is called on every
            # health check and every handshake.
            if origin not in _wildcard_warned:
                _wildcard_warned.add(origin)
                logger.warning(
                    "SIH_ALLOWED_ORIGINS entry %r was ignored: wildcards are not allowed. "
                    "List each portal origin explicitly.", part.strip())
            continue
        if origin not in out:
            out.append(origin)
    return out


def allowed_origins_env() -> list[str]:
    """Origins configured through the environment (both variable names)."""
    raw_allowed = os.environ.get("SIH_ALLOWED_ORIGINS") or ""
    raw_frontend = os.environ.get("SIH_FRONTEND_ORIGINS") or ""
    return _split_origins(",".join(part for part in (raw_allowed, raw_frontend) if part.strip()))


def allowed_origins() -> list[str]:
    """Origins allowed to open a cross-origin Socket.IO connection.

    Merges the environment list with the built-in portal origins and the local
    development origins. Order is preserved (configured first), duplicates and
    trailing slashes are removed, and the result is always an explicit list.
    """
    origins: list[str] = []
    for origin in allowed_origins_env() + list(BUILTIN_ALLOWED_ORIGINS) + list(LOCAL_DEV_ORIGINS):
        normalized = _normalize_origin(origin)
        if normalized and normalized not in origins:
            origins.append(normalized)
    return origins


def origin_allowed(origin: str | None) -> bool:
    """Is this ``Origin`` header allowed to open the socket?

    Comparison is case-insensitive and trailing-slash insensitive, so a
    harmless formatting difference in an env var can never break signaling.
    """
    if not origin:
        # Flask-SocketIO's test client and some non-browser clients send no
        # Origin header. Browser security is enforced by the explicit allow-list
        # below and by the browser's own same-origin rules.
        return True
    return _normalize_origin(origin) in allowed_origins()


def origin_diagnostics() -> dict:
    """Secret-free summary of where the allow-list comes from.

    Reported by ``/api/health`` so a rejected handshake can be explained from
    outside the process: the origins are public portal URLs, and knowing which
    of them came from the environment (vs the built-in defaults) is the
    difference between "the variable was never updated" and "the browser is on
    a different origin than expected".
    """
    env_origins = allowed_origins_env()
    builtin = [_normalize_origin(o) for o in BUILTIN_ALLOWED_ORIGINS]
    effective = allowed_origins()
    return {
        "count": len(effective),
        "from_env": env_origins,
        "from_builtin": [o for o in builtin if o in effective],
        "env_configured": bool(env_origins),
        "wildcards_allowed": False,
    }


def socket_public_url() -> str:
    """Absolute base URL the browser must use for the signaling connection.

    Priority:

    1. ``SIH_PUBLIC_BACKEND_URL`` — the deployment's explicit answer.
    2. ``RENDER_EXTERNAL_URL`` — Render sets this automatically on every web
       service, so a split Vercel-frontend/Render-backend deployment gets the
       correct ``wss://<service>.onrender.com/socket.io`` endpoint even when
       nobody configured ``SIH_PUBLIC_BACKEND_URL``. Without this fallback the
       browser is told "same origin", tries ``<vercel-host>/socket.io`` and
       fails, because Vercel only proxies ``/api/*`` — the 2026-10-05
       "Signaling offline" class of failure.
    3. ``""`` — same origin (single-service deployment or local development).
    """
    for name in ("SIH_PUBLIC_BACKEND_URL", "RENDER_EXTERNAL_URL"):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value.startswith("https://") or value.startswith("http://"):
            return value
    return ""


def socket_public_url_source() -> str:
    """Which variable supplied :func:`socket_public_url` (``none`` = same origin)."""
    for name in ("SIH_PUBLIC_BACKEND_URL", "RENDER_EXTERNAL_URL"):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value.startswith("https://") or value.startswith("http://"):
            return name
    return "none"


def signaling_endpoint() -> str:
    """Full ``<base><path>`` URL a browser must open — empty for same origin."""
    base = socket_public_url()
    return (base + socketio_path()) if base else ""


def signaling_configured() -> bool:
    return bool(socket_public_url())


def worker_configuration_safe() -> bool:
    if (os.environ.get("SIH_REDIS_URL") or "").strip():
        return True
    workers = (os.environ.get("SIH_GUNICORN_WORKERS") or "").strip()
    if workers.isdigit():
        return int(workers) <= 1
    return True


def init_realtime(app, decode_token, get_db) -> SocketIO:
    """Wire the Socket.IO server into the Flask app (called once from app.py)."""
    global _decode_token, _get_db
    _decode_token = decode_token
    _get_db = get_db
    socketio.init_app(
        app,
        cors_allowed_origins=allowed_origins(),
        async_mode="threading",
        message_queue=(os.environ.get("SIH_REDIS_URL") or "").strip() or None,
        path=socketio_path(),
    )
    start_sweeper()
    return socketio


def _multi_worker_warning() -> None:
    if (os.environ.get("SIH_REDIS_URL") or "").strip():
        return
    workers = (os.environ.get("SIH_GUNICORN_WORKERS") or "").strip()
    if workers.isdigit() and int(workers) > 1:
        logger.warning(
            "Web calling runs with %s Gunicorn workers and no SIH_REDIS_URL. Socket.IO rooms "
            "are per-process, so a call event emitted by one worker will not reach a browser "
            "whose socket is held by another (measured: 0 of 6 incoming-call events delivered "
            "with two workers). Run ONE worker with a threaded worker class "
            "(--worker-class gthread --workers 1 --threads 100), or set SIH_REDIS_URL so "
            "events are shared. Signaling itself stays durable either way: it is persisted and "
            "the clients reconcile over REST.",
            workers,
        )


def start_sweeper() -> None:
    """Background ring-timeout / abandoned-call sweeper (idempotent, per process)."""
    global _sweeper_started
    if os.environ.get("SIH_WEBCALL_SWEEPER", "true").strip().lower() in {"0", "false", "no", "off"}:
        return
    with _sweeper_lock:
        if _sweeper_started:
            return
        _sweeper_started = True
        _multi_worker_warning()

        def _loop():
            import time
            interval = 2.0
            while True:
                time.sleep(interval)
                try:
                    conn = _get_db()
                    try:
                        expired = webcalling.expire_stale_calls(conn)
                        webcalling.sweep_presence(conn)
                        if expired:
                            logger.info("web calling: expired %s stale call(s)", expired)
                    finally:
                        conn.close()
                except Exception as exc:  # pragma: no cover - the sweeper must never die
                    logger.debug("web call sweeper error: %s", exc)

        threading.Thread(target=_loop, name="webcall-sweeper", daemon=True).start()


def emit_to_user(user_id: int, event: str, data: dict) -> None:
    """Emit to one authenticated user's private room."""
    if user_id is None:
        return
    socketio.emit(event, data, to=f"user:{int(user_id)}")


def emit_call_event(call_row, event: str, *, extra: dict | None = None, recipients: list[int] | None = None) -> None:
    """Emit a call lifecycle event to the participants (never to a broadcast room)."""
    if call_row is None:
        return
    payload = {
        "call_id": call_row["call_id"],
        "status": call_row["status"],
        "vet_id": call_row["vet_id"],
        "caller_id": call_row["caller_id"],
        "event": event,
    }
    if extra:
        payload.update(extra)
    targets = recipients if recipients is not None else webcalling.participant_ids(call_row)
    for uid in targets:
        emit_to_user(uid, "call:update", payload)


def _session_user():
    uid = session.get("uid")
    role = session.get("role")
    if not uid:
        return None
    return {"uid": int(uid), "role": role, "name": session.get("name")}


# --------------------------------------------------------------------------
# Connection handling
# --------------------------------------------------------------------------
@socketio.on("connect")
def _on_connect(auth):
    origin = request.headers.get("Origin")
    if not origin_allowed(origin):
        # The browser cannot be told *why* a CORS/handshake rejection happened
        # (that is the browser's security model), so the server log is the only
        # place the real reason is visible. Log the rejected origin next to the
        # effective allow-list — these are public portal URLs, never secrets.
        logger.warning(
            "socket rejected: origin %r is not in the signaling allow-list. "
            "Effective allowed_origins=%s (from_env=%s, builtin=%s). Add this origin to "
            "SIH_ALLOWED_ORIGINS (comma-separated, no wildcards) in the Render dashboard "
            "and redeploy, or serve the portal from one of the allowed origins.",
            origin, allowed_origins(), allowed_origins_env(),
            list(BUILTIN_ALLOWED_ORIGINS),
        )
        return False

    token = None
    if isinstance(auth, dict):
        token = auth.get("token")
    if not token:
        token = request.args.get("token")
    if not token:
        logger.info("socket rejected: no auth token presented")
        return False
    claims = _decode_token(token)
    if not claims:
        logger.info("socket rejected: invalid or expired token")
        return False

    conn = _get_db()
    try:
        user = conn.execute("SELECT id, role, full_name FROM users WHERE id=?", (claims["uid"],)).fetchone()
        if not user:
            logger.info("socket rejected: token subject no longer exists")
            return False
        if user["role"] != claims.get("role"):
            logger.info("socket rejected: token role does not match the account")
            return False

        session["uid"] = int(user["id"])
        session["role"] = user["role"]
        session["name"] = user["full_name"]
        join_room(f"user:{user['id']}")
        if user["role"] == "vet":
            join_room("role:vet")
            presence = webcalling.heartbeat(
                conn,
                user["id"],
                socket_sid=request.sid,
                client=(request.headers.get("User-Agent") or "")[:120],
            )
            emit("presence:ack", presence)
        emit("session:ready", {"user_id": user["id"], "role": user["role"], "socket_id": request.sid})

        # Reconcile an in-flight call for this user (page refresh, reconnect,
        # or a wake-up after the tab was backgrounded).
        row = webcalling.active_call_for(conn, user["id"], user["role"])
        if row:
            emit("call:update", {
                "call_id": row["call_id"],
                "status": row["status"],
                "vet_id": row["vet_id"],
                "caller_id": row["caller_id"],
                "event": "reconcile",
            })
    finally:
        conn.close()
    return True


@socketio.on("disconnect")
def _on_disconnect(reason=None):
    user = _session_user()
    if not user or user.get("role") != "vet":
        return
    conn = _get_db()
    try:
        dropped = webcalling.drop_presence(conn, user["uid"], socket_sid=request.sid)
        if dropped:
            emit("presence:ack", {"vet_id": user["uid"], "online": False, "presence": "OFFLINE"})
    except Exception as exc:  # pragma: no cover - never raise in a disconnect handler
        logger.debug("disconnect cleanup failed: %s", exc)
    finally:
        conn.close()


@socketio.on("presence:heartbeat")
def _on_heartbeat(data=None):
    user = _session_user()
    if not user or user.get("role") != "vet":
        return {"ok": False, "error": "presence_not_allowed"}
    conn = _get_db()
    try:
        state = webcalling.heartbeat(conn, user["uid"], socket_sid=request.sid,
                                     client=(request.headers.get("User-Agent") or "")[:120])
        active = webcalling.active_call_for(conn, user["uid"], "vet")
        state["active_call"] = (
            {"call_id": active["call_id"], "status": active["status"]} if active else None
        )
        return {"ok": True, **state}
    finally:
        conn.close()


@socketio.on("call:signal")
def _on_signal(data):
    """Relay one WebRTC signaling message to the other participant.

    The message is persisted first (durable path), then relayed (fast path).
    The receiver de-duplicates by ``id`` and can always backfill over
    ``GET /api/webcall/calls/<id>/signals`` — the two peers therefore converge
    even when they are served by different worker processes.
    """
    user = _session_user()
    if not user:
        return {"ok": False, "error": "unauthenticated"}
    data = data if isinstance(data, dict) else {}
    call_id = (data.get("call_id") or "").strip()
    kind = (data.get("kind") or "").strip()
    payload = data.get("payload")
    if not call_id or not kind:
        return {"ok": False, "error": "call_id_and_kind_required"}

    conn = _get_db()
    try:
        if webcalling.signal_rate_limited(conn, user["uid"]):
            return {"ok": False, "error": "rate_limited"}
        try:
            signal_id = webcalling.add_signal(conn, call_id, user, kind, payload)
        except webcalling.WebCallError as exc:
            return {"ok": False, "error": exc.code, "message": exc.message}
        row = webcalling._row(conn, call_id)
        peer = webcalling.peer_id(row, user["uid"])
        if peer:
            emit_to_user(peer, "call:signal", {
                "call_id": call_id,
                "id": signal_id,
                "from": "peer",
                "sender_id": int(user["uid"]),
                "kind": kind,
                "payload": payload,
            })
        return {"ok": True, "id": signal_id}
    finally:
        conn.close()


@socketio.on("call:mute")
def _on_mute(data):
    """Relay a local mute state change so the peer can show "muted" honestly."""
    user = _session_user()
    if not user:
        return {"ok": False, "error": "unauthenticated"}
    data = data if isinstance(data, dict) else {}
    call_id = (data.get("call_id") or "").strip()
    muted = bool(data.get("muted"))
    if not call_id:
        return {"ok": False, "error": "call_id_required"}
    conn = _get_db()
    try:
        row = webcalling._row(conn, call_id)
        try:
            webcalling.require_participant(conn, call_id, user)
        except webcalling.WebCallError as exc:
            return {"ok": False, "error": exc.code}
        peer = webcalling.peer_id(row, user["uid"])
        if peer:
            emit_to_user(peer, "call:mute", {"call_id": call_id, "sender_id": int(user["uid"]), "muted": muted})
        return {"ok": True}
    finally:
        conn.close()
