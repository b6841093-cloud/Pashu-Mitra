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


def _split_origins(raw: str) -> list[str]:
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip()]


def allowed_origins() -> list[str]:
    """Origins allowed to open a cross-origin Socket.IO connection.

    This deployment deliberately keeps the allow-list explicit. For Vercel
    previews, add each required preview origin to ``SIH_ALLOWED_ORIGINS``; do
    not use a blanket ``*.vercel.app`` wildcard.
    """
    raw = (os.environ.get("SIH_ALLOWED_ORIGINS") or "").strip()
    origins = _split_origins(raw)
    # Local development defaults; harmless in production because the deployed
    # origins are always listed explicitly.
    for origin in ("http://localhost:5001", "http://127.0.0.1:5001", "http://localhost:8000"):
        if origin not in origins:
            origins.append(origin)
    return origins


def origin_allowed(origin: str | None) -> bool:
    if not origin:
        # Flask-SocketIO's test client and some non-browser clients send no
        # Origin header. Browser security is enforced by the explicit allow-list
        # below and by the browser's own same-origin rules.
        return True
    return origin.strip().rstrip("/") in allowed_origins()


def socket_public_url() -> str:
    """Absolute base URL the browser must use for the signaling connection."""
    explicit = (os.environ.get("SIH_PUBLIC_BACKEND_URL") or "").strip().rstrip("/")
    if explicit.startswith("https://") or explicit.startswith("http://"):
        return explicit
    return ""


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
        logger.info("socket rejected: origin %s is not in SIH_ALLOWED_ORIGINS", origin)
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
