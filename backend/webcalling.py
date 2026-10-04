"""Real-time browser-to-browser veterinary calling (farmer <-> veterinarian).

This module owns the *server authority* for web calls:

* the call record and its finite state machine (validated server-side),
* routing of a call to an eligible, available, reachable veterinarian,
* presence leases with expiry (never a permanent in-memory "online" flag),
* durable WebRTC signaling records (offer/answer/ICE) so no signal is lost
  when the two peers are handled by different workers or a tab refreshes,
* authorization for every read and every state change.

It deliberately contains **no** WebRTC media code: audio flows peer-to-peer in
the browsers. This module never claims a call is connected — the ``connected``
state is only reachable through :func:`mark_connected`, which the client sends
after its ``RTCPeerConnection`` reports a live connection, and it is recorded
with the server's own timestamp.

Nothing here replaces or modifies the existing IVR/PSTN helpline
(``ivr_service.py`` / ``helpline_calls``): that is a separate, provider-backed
channel.
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
import threading
from datetime import datetime

from database import audit_log

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Constants and the state machine
# --------------------------------------------------------------------------
CALL_ID_PREFIX = "wc"
CALL_STATUSES = (
    "created", "ringing", "accepted", "connecting", "connected",
    "ended", "rejected", "cancelled", "missed", "busy", "failed", "expired",
)
ACTIVE_STATUSES = ("created", "ringing", "accepted", "connecting", "connected")
RINGING_STATUSES = ("ringing",)
TERMINAL_STATUSES = ("ended", "rejected", "cancelled", "missed", "busy", "failed", "expired")

# Enforced transitions. Any transition not listed here is rejected with 409 and
# the current state is returned, so two racing clients can never invent a state.
VALID_TRANSITIONS: dict[str, tuple[str, ...]] = {
    "created": ("ringing", "missed", "failed", "cancelled"),
    "ringing": ("accepted", "rejected", "cancelled", "expired", "missed", "failed"),
    "accepted": ("connecting", "connected", "ended", "failed", "cancelled"),
    "connecting": ("connected", "failed", "ended", "cancelled"),
    "connected": ("ended", "failed"),
}

# Reasons a farmer may give for calling (server-side allow-list, no free text
# routing: free text is stored as a note only).
CALL_REASONS = (
    "animal_sick",
    "emergency",
    "vaccination_advice",
    "follow_up",
    "other",
)

# Signaling kinds that may be relayed. Everything else is rejected.
SIGNAL_KINDS = ("offer", "answer", "ice", "ice_restart", "renegotiate", "media_state")
MAX_SIGNAL_BYTES = 64 * 1024
MAX_REASON_NOTE = 500
PRESENCE_LEASE_SECONDS = 60

DEFAULT_RING_TIMEOUT_SECONDS = 45
_MIN_RING_TIMEOUT, _MAX_RING_TIMEOUT = 10, 180

# Per-user server-side limits (authoritative, database-backed).
MAX_CALLS_PER_WINDOW = 8
CALL_WINDOW_MINUTES = 15
MAX_SIGNALS_PER_MINUTE = 150
SIGNAL_RETENTION_HOURS = 6

_ROUTING_POLICY = "district_language_load_v1"


class WebCallError(Exception):
    """A refused web-call operation. ``status_code`` is the HTTP status."""

    def __init__(self, message: str, status_code: int = 400, code: str = "invalid_request",
                 call: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.call = call


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.utcnow()


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _loads(value, default):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value or "")
    except (TypeError, ValueError):
        return default


def ring_timeout_seconds() -> int:
    try:
        value = int(os.environ.get("SIH_WEBCALL_RING_TIMEOUT_SECONDS", DEFAULT_RING_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        value = DEFAULT_RING_TIMEOUT_SECONDS
    return min(_MAX_RING_TIMEOUT, max(_MIN_RING_TIMEOUT, value))


def new_call_id() -> str:
    """Opaque, unguessable public identifier for a call."""
    return f"{CALL_ID_PREFIX}_{secrets.token_urlsafe(16)}"


def _row(conn, call_id: str):
    return conn.execute("SELECT * FROM web_calls WHERE call_id=?", (call_id,)).fetchone()


def _event(conn, call_id: str, event_type: str, actor=None, detail: dict | None = None) -> None:
    conn.execute(
        "INSERT INTO web_call_events (call_id, event_type, actor_id, actor_role, detail) VALUES (?,?,?,?,?)",
        (
            call_id,
            event_type,
            (actor or {}).get("uid") if isinstance(actor, dict) else None,
            (actor or {}).get("role") if isinstance(actor, dict) else None,
            json.dumps(detail, ensure_ascii=False) if detail else None,
        ),
    )


def _transition(conn, call_id: str, expected: tuple[str, ...], new_status: str,
                *, extra_sql: str = "", extra_params: tuple = ()) -> bool:
    """Atomic compare-and-set on the call status. Returns True when it applied.

    ``expected`` is checked in the WHERE clause, so the transition is decided by
    SQLite, not by a client-supplied value: two simultaneous answers cannot both
    succeed.
    """
    if new_status not in CALL_STATUSES:
        raise ValueError(f"unknown call status {new_status}")
    placeholders = ",".join("?" for _ in expected)
    # Parameter order follows the SQL text: SET values first (status + any extra
    # columns), then the WHERE clause (call_id + the accepted source states).
    params = [new_status, *extra_params, call_id, *expected]
    sql = (
        f"UPDATE web_calls SET status=?, updated_at=datetime('now'){extra_sql} "
        f"WHERE call_id=? AND status IN ({placeholders})"
    )
    cur = conn.execute(sql, params)
    return cur.rowcount == 1


# --------------------------------------------------------------------------
# Serialization (authorization-aware)
# --------------------------------------------------------------------------
def _participants(conn, call_row) -> dict:
    caller = conn.execute(
        "SELECT id, full_name, role, village, block, district, mobile, preferred_language FROM users WHERE id=?",
        (call_row["caller_id"],),
    ).fetchone()
    vet = None
    if call_row["vet_id"]:
        vet = conn.execute(
            "SELECT id, full_name, specialization, village, block, district FROM users WHERE id=?",
            (call_row["vet_id"],),
        ).fetchone()
    return {"caller": caller, "vet": vet}


def serialize_call(conn, call_row, viewer=None) -> dict:
    """Serialize a call for one viewer.

    Rules (never trust the client for any of this):
      * the farmer sees the veterinarian assigned to their own call,
      * the assigned veterinarian sees the caller's name, village and district,
      * the caller's phone number is exposed only to the assigned veterinarian
        while the call is not in a terminal state (the app already shows owner
        contact details to assigned staff on a case),
      * routing internals and notes are withheld from anyone who is not a
        participant or government oversight.
    """
    if call_row is None:
        return None
    data = dict(call_row)
    people = _participants(conn, call_row)
    caller, vet = people["caller"], people["vet"]
    viewer_id = (viewer or {}).get("uid")
    viewer_role = (viewer or {}).get("role")
    is_caller = viewer_id is not None and int(viewer_id) == int(call_row["caller_id"])
    is_vet = vet is not None and viewer_id is not None and int(viewer_id) == int(vet["id"])
    is_oversight = viewer_role == "govt"
    participant = is_caller or is_vet

    call_id = call_row["call_id"]
    signals_seen = None
    if participant:
        seen = conn.execute(
            "SELECT MAX(id) AS last_id FROM web_call_signals WHERE call_id=?", (call_id,)
        ).fetchone()
        signals_seen = seen["last_id"] if seen else None

    call = {
        "call_id": call_id,
        "status": call_row["status"],
        "active": call_row["status"] in ACTIVE_STATUSES,
        "channel": "web",  # distinguishes an in-app WebRTC call from a PSTN/IVR call
        "language": call_row["language"],
        "reason": call_row["reason"],
        "created_at": call_row["created_at"],
        "ringing_at": call_row["ringing_at"],
        "accepted_at": call_row["accepted_at"],
        "connected_at": call_row["connected_at"],
        "ended_at": call_row["ended_at"],
        "duration_seconds": call_row["duration_seconds"],
        "end_reason": call_row["end_reason"],
        "ring_timeout_seconds": call_row["ring_timeout_seconds"],
        "case_id": call_row["case_id"],
        "animal_id": call_row["animal_id"],
        "district": call_row["district"],
        "block": call_row["block"],
        "village": call_row["village"],
        "viewer_role": viewer_role if participant else None,
        "role_in_call": "caller" if is_caller else ("vet" if is_vet else ("observer" if is_oversight else None)),
        "caller": None,
        "vet": None,
        "case": None,
        "animal": None,
        "rules": {
            "ring_timeout_seconds": call_row["ring_timeout_seconds"],
            "routing_policy": _ROUTING_POLICY,
        },
    }

    if call_row["case_id"]:
        case = conn.execute("SELECT id, case_no, status FROM cases WHERE id=?", (call_row["case_id"],)).fetchone()
        call["case"] = dict(case) if case else None
    if call_row["animal_id"]:
        animal = conn.execute(
            "SELECT id, animal_code, animal_name, species FROM animals WHERE id=?", (call_row["animal_id"],)
        ).fetchone()
        call["animal"] = dict(animal) if animal else None

    if is_caller or is_vet or is_oversight:
        call["caller"] = {
            "id": caller["id"] if caller else None,
            "name": caller["full_name"] if caller else None,
            "village": caller["village"] if caller else None,
            "block": caller["block"] if caller else None,
            "district": caller["district"] if caller else None,
        }
        if vet:
            call["vet"] = {
                "id": vet["id"],
                "name": vet["full_name"],
                "specialization": vet["specialization"],
                "village": vet["village"],
                "block": vet["block"],
                "district": vet["district"],
            }

    if is_caller:
        # The farmer needs the identifier of their own call for reconciliation.
        call["reconcile_url"] = f"/api/webcall/calls/{call_id}"

    if is_vet and call_row["status"] not in TERMINAL_STATUSES and caller:
        # Only the assigned veterinarian, only while the call can still be
        # joined, and only as a fallback if the web call fails.
        call["caller"]["contact"] = caller["mobile"]

    if participant:
        if call_row["reason_note"]:
            call["reason_note"] = call_row["reason_note"]
        if signals_seen is not None:
            call["last_signal_id"] = signals_seen
    if is_oversight or participant:
        call["routing"] = {
            "policy": call_row["routing_policy"],
            "score": call_row["routing_score"],
            "reasons": _loads(call_row["routing_reasons"], []),
        }
    return call


# --------------------------------------------------------------------------
# Presence (liveness leases; explicit availability lives in vet_availability)
# --------------------------------------------------------------------------
def heartbeat(conn, vet_id: int, *, socket_sid: str | None = None, client: str | None = None) -> dict:
    """Renew a veterinarian's presence lease and return their effective state."""
    existing = conn.execute("SELECT * FROM vet_presence WHERE vet_id=?", (vet_id,)).fetchone()
    sids = set(_loads(existing["socket_sids"], [])) if existing else set()
    if socket_sid:
        sids.add(socket_sid)
    expires = _iso(_now().replace(microsecond=0) + _seconds(PRESENCE_LEASE_SECONDS))
    conn.execute(
        """
        INSERT INTO vet_presence (vet_id, lease_expires_at, last_heartbeat_at, socket_sids, client, updated_at)
        VALUES (?,?,datetime('now'),?,?,datetime('now'))
        ON CONFLICT(vet_id) DO UPDATE SET
            lease_expires_at=excluded.lease_expires_at,
            last_heartbeat_at=datetime('now'),
            socket_sids=excluded.socket_sids,
            client=COALESCE(excluded.client, vet_presence.client),
            updated_at=datetime('now')
        """,
        (vet_id, expires, json.dumps(sorted(sids)), (client or "")[:120]),
    )
    conn.commit()
    return presence_state(conn, vet_id)


def drop_presence(conn, vet_id: int, *, socket_sid: str | None = None) -> bool:
    """Remove one socket from the lease set; expire the lease when none remain."""
    row = conn.execute("SELECT * FROM vet_presence WHERE vet_id=?", (vet_id,)).fetchone()
    if not row:
        return False
    sids = set(_loads(row["socket_sids"], []))
    if socket_sid:
        sids.discard(socket_sid)
    if sids:
        conn.execute(
            "UPDATE vet_presence SET socket_sids=?, lease_expires_at=?, updated_at=datetime('now') WHERE vet_id=?",
            (json.dumps(sorted(sids)), _iso(_now().replace(microsecond=0) + _seconds(PRESENCE_LEASE_SECONDS)), vet_id),
        )
        conn.commit()
        return False
    conn.execute(
        "UPDATE vet_presence SET socket_sids='[]', lease_expires_at=?, updated_at=datetime('now') WHERE vet_id=?",
        (_iso(_now() - _seconds(5)), vet_id),
    )
    conn.commit()
    return True


def _seconds(count: int):
    from datetime import timedelta
    return timedelta(seconds=count)


def presence_state(conn, vet_id: int) -> dict:
    row = conn.execute(
        """
        SELECT p.*, u.full_name, u.district,
               COALESCE(a.status, 'OFFLINE') availability_status,
               COALESCE(a.supported_languages, '["en"]') supported_languages
        FROM vet_presence p
        JOIN users u ON u.id = p.vet_id
        LEFT JOIN vet_availability a ON a.vet_id = p.vet_id
        WHERE p.vet_id=?
        """,
        (vet_id,),
    ).fetchone()
    if not row:
        return {"vet_id": vet_id, "online": False, "presence": "OFFLINE", "availability": None}
    online = bool(row["lease_expires_at"]) and _parse(row["lease_expires_at"]) > _now()
    active = conn.execute(
        "SELECT call_id, status FROM web_calls WHERE vet_id=? AND status IN ('ringing','accepted','connecting','connected') "
        "ORDER BY id DESC LIMIT 1",
        (vet_id,),
    ).fetchone()
    return {
        "vet_id": vet_id,
        "online": online,
        "presence": "ONLINE" if online else "STALE",
        "availability": row["availability_status"],
        "supported_languages": _loads(row["supported_languages"], ["en"]),
        "last_heartbeat_at": row["last_heartbeat_at"],
        "lease_expires_at": row["lease_expires_at"],
        "active_call_id": active["call_id"] if active else None,
    }


def _parse(value: str | None):
    if not value:
        return _now() - _seconds(3600)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value[:19], fmt)
        except ValueError:
            continue
    return _now() - _seconds(3600)


def sweep_presence(conn) -> int:
    """Mark leases that have expired (housekeeping; reads never trust a stale lease)."""
    cur = conn.execute(
        "UPDATE vet_presence SET socket_sids='[]', updated_at=datetime('now') "
        "WHERE lease_expires_at IS NOT NULL AND lease_expires_at < datetime('now') AND socket_sids <> '[]'"
    )
    conn.commit()
    return cur.rowcount


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------
def _vet_rows(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT u.id vet_id, u.full_name, u.specialization, u.preferred_language,
               u.state, u.district, u.block, u.village,
               COALESCE(a.status, 'OFFLINE') availability_status,
               COALESCE(a.supported_languages, '["en"]') supported_languages,
               a.current_call_id AS ivr_call_id,
               p.lease_expires_at, p.last_heartbeat_at
        FROM users u
        LEFT JOIN vet_availability a ON a.vet_id = u.id
        LEFT JOIN vet_presence p ON p.vet_id = u.id
        WHERE u.role='vet'
        """
    ).fetchall()
    output = []
    for row in rows:
        item = dict(row)
        item["supported_languages"] = _loads(item["supported_languages"], ["en"])
        online = bool(item["lease_expires_at"]) and _parse(item["lease_expires_at"]) > _now()
        item["online"] = online
        item["active_web_calls"] = conn.execute(
            "SELECT COUNT(*) c FROM web_calls WHERE vet_id=? AND status IN "
            "('ringing','accepted','connecting','connected')",
            (item["vet_id"],),
        ).fetchone()["c"]
        item["active_cases"] = conn.execute(
            "SELECT COUNT(*) c FROM cases WHERE vet_id=? AND status NOT IN ('CLOSED','RECOVERED')",
            (item["vet_id"],),
        ).fetchone()["c"]
        output.append(item)
    return output


def vet_is_reachable(conn, vet_id: int) -> bool:
    rows = [v for v in _vet_rows(conn) if v["vet_id"] == vet_id]
    return bool(rows and rows[0]["online"])


def choose_veterinarian(conn, call_row) -> tuple[dict | None, list[dict]]:
    """Pick one veterinarian using the documented routing policy.

    Policy ``district_language_load_v1`` (deterministic, ties broken by lower id):
      1. HARD filters (a call is never offered to a vet who cannot serve it)
         - role 'vet', explicit availability status AVAILABLE,
         - presence lease is live (a closed browser is not "available"),
         - supports the language the farmer selected,
         - not already in a web call or an IVR call.
      2. SCORE (higher wins)
         - +100 same district, +25 adjacent district, +10 same state
         - +20 same block
         - +35 existing relationship (previous case with this farmer)
         - +15 specialization matches the reason/notes vocabulary
         - -min(active cases, 20) and -5 per live web/IVR call
    Returns ``(chosen, skipped)`` where ``skipped`` explains every rejection so
    the farmer-facing answer can be truthful ("no vet is online for Marathi")
    instead of an invented "connecting" screen.
    """
    candidates, skipped = [], []
    language = call_row["language"] or "en"
    district = (call_row["district"] or "").strip().lower()
    block = (call_row["block"] or "").strip().lower()
    state = (call_row["state"] or "Maharashtra").strip().lower()
    try:
        from ivr_service import NEARBY_DISTRICTS
    except Exception:  # pragma: no cover - defensive
        NEARBY_DISTRICTS = {}

    for vet in _vet_rows(conn):
        reasons: list[str] = []
        if vet["availability_status"] != "AVAILABLE":
            skipped.append({"vet_id": vet["vet_id"], "reason": f"NOT_AVAILABLE:{vet['availability_status']}"})
            continue
        if not vet["online"]:
            skipped.append({"vet_id": vet["vet_id"], "reason": "NO_LIVE_SESSION"})
            continue
        if language not in vet["supported_languages"]:
            skipped.append({"vet_id": vet["vet_id"], "reason": "LANGUAGE_NOT_SUPPORTED"})
            continue
        if vet["active_web_calls"]:
            skipped.append({"vet_id": vet["vet_id"], "reason": "BUSY_WEB_CALL"})
            continue
        if vet["ivr_call_id"]:
            skipped.append({"vet_id": vet["vet_id"], "reason": "BUSY_IVR_CALL"})
            continue

        score = 0.0
        vet_district = (vet["district"] or "").strip().lower()
        if district and district == vet_district:
            score += 100
            reasons.append("same_region")
        elif district and vet_district in NEARBY_DISTRICTS.get(district, set()):
            score += 25
            reasons.append("nearby_region")
        elif state and (vet["state"] or "").strip().lower() == state:
            score += 10
            reasons.append("same_state")
        if block and block == (vet["block"] or "").strip().lower():
            score += 20
            reasons.append("same_block")
        prior = conn.execute(
            "SELECT COUNT(*) c FROM cases WHERE owner_id=? AND vet_id=?",
            (call_row["caller_id"], vet["vet_id"]),
        ).fetchone()["c"]
        if prior:
            score += 35
            reasons.append("existing_relationship")
        vocabulary = " ".join(
            str(part or "").lower()
            for part in (call_row["reason"], call_row["reason_note"], call_row["language"])
        )
        specialization = (vet["specialization"] or "").lower()
        if specialization and any(
            word in specialization for word in re.findall(r"[a-z]+", vocabulary) if len(word) > 4
        ):
            score += 15
            reasons.append("specialization_match")
        if language in vet["supported_languages"]:
            reasons.append("language_match")
        score -= min(vet["active_cases"], 20)
        score -= 5 * (vet["active_web_calls"] + (1 if vet["ivr_call_id"] else 0))
        candidates.append({"vet": vet, "score": score, "reasons": reasons})

    if not candidates:
        return None, skipped
    candidates.sort(key=lambda item: (item["score"], -item["vet"]["active_cases"], -item["vet"]["vet_id"]), reverse=True)
    return candidates[0], skipped


def available_veterinarians(conn) -> list[dict]:
    """Truthful availability snapshot for the portal (no phone numbers)."""
    out = []
    for vet in _vet_rows(conn):
        out.append({
            "vet_id": vet["vet_id"],
            "name": vet["full_name"],
            "district": vet["district"],
            "online": vet["online"],
            "availability": vet["availability_status"],
            "languages": vet["supported_languages"],
            "active_web_calls": vet["active_web_calls"],
        })
    return out


# --------------------------------------------------------------------------
# Call creation and lifecycle
# --------------------------------------------------------------------------
def _farmer_rate_limited(conn, caller_id: int) -> bool:
    recent = conn.execute(
        "SELECT COUNT(*) c FROM web_calls WHERE caller_id=? AND created_at > datetime('now', ?)",
        (caller_id, f"-{CALL_WINDOW_MINUTES} minutes"),
    ).fetchone()["c"]
    return recent >= MAX_CALLS_PER_WINDOW


def active_call_for(conn, user_id: int, role: str):
    if role == "vet":
        return conn.execute(
            "SELECT * FROM web_calls WHERE vet_id=? AND status IN "
            "('ringing','accepted','connecting','connected') ORDER BY id DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    return conn.execute(
        "SELECT * FROM web_calls WHERE caller_id=? AND status IN "
        "('created','ringing','accepted','connecting','connected') ORDER BY id DESC LIMIT 1",
        (user_id,),
    ).fetchone()


def create_call(conn, *, caller: dict, payload: dict) -> dict:
    """Create a call for the authenticated caller and route it.

    The caller identity, region and role come from the database (the JWT's
    subject), never from the request body.
    """
    caller_id = int(caller["uid"])
    if caller.get("role") != "owner":
        raise WebCallError("Only farmers can start a web call from this endpoint", 403, "role_not_allowed")

    profile = conn.execute(
        "SELECT id, full_name, role, mobile, preferred_language, village, block, district, state FROM users WHERE id=?",
        (caller_id,),
    ).fetchone()
    if not profile:
        raise WebCallError("Caller account not found", 401, "unknown_user")

    language = (payload.get("language") or profile["preferred_language"] or "en").strip().lower()
    try:
        from ivr_config import SUPPORTED_LANGUAGES
    except Exception:  # pragma: no cover
        SUPPORTED_LANGUAGES = ("en", "hi", "mr", "te")
    if language not in SUPPORTED_LANGUAGES:
        raise WebCallError("Unsupported call language", 400, "bad_language")

    reason = (payload.get("reason") or "other").strip().lower()
    if reason not in CALL_REASONS:
        raise WebCallError("Unknown call reason", 400, "bad_reason")
    note = (payload.get("reason_note") or "").strip()[:MAX_REASON_NOTE]

    case_id = payload.get("case_id")
    animal_id = payload.get("animal_id")
    district, block, village = profile["district"], profile["block"], profile["village"]
    state = profile["state"] or "Maharashtra"
    if case_id not in (None, "", 0, "0"):
        case = conn.execute(
            "SELECT c.id, c.owner_id, c.animal_id, a.district, a.block, a.village "
            "FROM cases c LEFT JOIN animals a ON a.id=c.animal_id WHERE c.id=?",
            (int(case_id),),
        ).fetchone()
        if not case or int(case["owner_id"]) != caller_id:
            raise WebCallError("Case not found for this farmer", 403, "case_not_authorized")
        case_id = case["id"]
        animal_id = case["animal_id"]
        district = case["district"] or district
        block = case["block"] or block
        village = case["village"] or village
    elif animal_id not in (None, "", 0, "0"):
        animal = conn.execute("SELECT id, owner_id, district, block, village FROM animals WHERE id=?", (int(animal_id),)).fetchone()
        if not animal or int(animal["owner_id"]) != caller_id:
            raise WebCallError("Animal not found for this farmer", 403, "animal_not_authorized")
        animal_id = animal["id"]
        district = animal["district"] or district
        block = animal["block"] or block
        village = animal["village"] or village
    else:
        case_id, animal_id = None, None

    existing = active_call_for(conn, caller_id, "owner")
    if existing:
        raise WebCallError(
            "You already have a call in progress", 409, "caller_busy",
            call=serialize_call(conn, existing, viewer=caller),
        )

    if _farmer_rate_limited(conn, caller_id):
        raise WebCallError(
            f"Too many call attempts. Try again in {CALL_WINDOW_MINUTES} minutes.", 429, "rate_limited"
        )

    call_id = new_call_id()
    timeout = ring_timeout_seconds()
    conn.execute(
        """
        INSERT INTO web_calls (call_id, caller_id, caller_role, language, reason, reason_note,
                               case_id, animal_id, state, district, block, village,
                               status, ring_timeout_seconds)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'created', ?)
        """,
        (call_id, caller_id, "owner", language, reason, note or None, case_id, animal_id,
         state, district, block, village, timeout),
    )
    _event(conn, call_id, "CREATED", caller, {"language": language, "reason": reason})
    audit_log(conn, "CREATE_WEB_CALL", "web_call", call_id, actor_id=caller_id, actor_role="owner",
              details={"language": language, "reason": reason, "district": district})
    conn.commit()

    call_row = _row(conn, call_id)
    chosen, skipped = choose_veterinarian(conn, call_row)
    if not chosen:
        _transition(conn, call_id, ("created",), "missed",
                    extra_sql=", ended_at=datetime('now'), end_reason=?",
                    extra_params=("NO_VET_AVAILABLE",))
        _event(conn, call_id, "NO_VET_AVAILABLE", None, {"skipped": skipped})
        conn.commit()
        return {
            "call": serialize_call(conn, _row(conn, call_id), viewer=caller),
            "outcome": "unavailable",
            "message": _unavailable_message(skipped, language),
            "skipped_reasons": sorted({item["reason"] for item in skipped}),
            "skipped_codes": sorted({item["reason"].split(":")[0] for item in skipped}),
        }

    vet = chosen["vet"]
    accepted = _transition(
        conn, call_id, ("created",), "ringing",
        extra_sql=", vet_id=?, ringing_at=datetime('now'), routing_policy=?, routing_score=?, routing_reasons=?",
        extra_params=(vet["vet_id"], _ROUTING_POLICY, chosen["score"], json.dumps(chosen["reasons"])),
    )
    if not accepted:  # pragma: no cover - the partial unique index catches races
        conn.rollback()
        raise WebCallError("The call could not be placed. Please try again.", 409, "call_not_placed")
    _event(conn, call_id, "RINGING", caller, {"vet_id": vet["vet_id"], "score": chosen["score"], "reasons": chosen["reasons"]})
    audit_log(conn, "ROUTE_WEB_CALL", "web_call", call_id, actor_id=None, actor_role="system",
              details={"vet_id": vet["vet_id"], "policy": _ROUTING_POLICY, "score": chosen["score"]})
    conn.commit()

    call_row = _row(conn, call_id)
    return {
        "call": serialize_call(conn, call_row, viewer=caller),
        "outcome": "ringing",
        "routed_to": {"vet_id": vet["vet_id"], "name": vet["full_name"], "district": vet["district"]},
        "message": f"Calling {vet['full_name']}…",
    }


def _unavailable_message(skipped: list[dict], language: str) -> str:
    """Truthful text: never implies a connection that does not exist."""
    if not skipped:
        return "No veterinarian is registered for web calls yet."
    reasons = {item["reason"].split(":")[0] for item in skipped}
    if "LANGUAGE_NOT_SUPPORTED" in reasons:
        return "No veterinarian who speaks the selected language is on duty right now."
    if "NO_LIVE_SESSION" in reasons:
        return "No veterinarian is online right now. Please try again or use the helpline number."
    if "BUSY_WEB_CALL" in reasons or "BUSY_IVR_CALL" in reasons:
        return "All veterinarians are on other calls right now. Please try again shortly."
    return "No veterinarian is available for a web call right now."


def require_participant(conn, call_id: str, user: dict, *, allow_govt: bool = False):
    call_row = _row(conn, call_id)
    if not call_row:
        raise WebCallError("Call not found", 404, "not_found")
    uid = int(user["uid"])
    if uid == int(call_row["caller_id"]) or (call_row["vet_id"] and uid == int(call_row["vet_id"])):
        return call_row
    if allow_govt and user.get("role") == "govt":
        return call_row
    raise WebCallError("You are not a participant of this call", 403, "not_a_participant")


def get_call(conn, call_id: str, user: dict) -> dict:
    call_row = require_participant(conn, call_id, user, allow_govt=True)
    return serialize_call(conn, call_row, viewer=user)


def accept_call(conn, call_id: str, user: dict) -> dict:
    """Veterinarian answers. Atomic: exactly one answer can win."""
    if user.get("role") != "vet":
        raise WebCallError("Only the assigned veterinarian can answer this call", 403, "role_not_allowed")
    call_row = _row(conn, call_id)
    if not call_row:
        raise WebCallError("Call not found", 404, "not_found")
    if call_row["vet_id"] and int(call_row["vet_id"]) != int(user["uid"]):
        raise WebCallError("This call is assigned to another veterinarian", 403, "not_assigned")
    if call_row["status"] == "accepted" and int(call_row["vet_id"] or 0) == int(user["uid"]):
        # Idempotent repeat of the same vet's answer (duplicate click, retry).
        return serialize_call(conn, call_row, viewer=user)

    ok = _transition(conn, call_id, ("ringing",), "accepted",
                     extra_sql=", accepted_at=datetime('now'), end_reason=NULL", extra_params=())
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError(
            f"The call is no longer ringing (state: {current['status']})" if current else "Call not found",
            409, "state_conflict",
            call=serialize_call(conn, current, viewer=user) if current else None,
        )
    _event(conn, call_id, "ACCEPTED", user)
    audit_log(conn, "ACCEPT_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role="vet")
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def reject_call(conn, call_id: str, user: dict, reason: str | None = None) -> dict:
    if user.get("role") != "vet":
        raise WebCallError("Only the assigned veterinarian can decline this call", 403, "role_not_allowed")
    call_row = _row(conn, call_id)
    if not call_row:
        raise WebCallError("Call not found", 404, "not_found")
    if call_row["vet_id"] and int(call_row["vet_id"]) != int(user["uid"]):
        raise WebCallError("This call is assigned to another veterinarian", 403, "not_assigned")
    ok = _transition(conn, call_id, ("ringing", "accepted", "connecting"), "rejected",
                     extra_sql=", ended_at=datetime('now'), ended_by=?, end_reason=?",
                     extra_params=(user["uid"], (reason or "VET_DECLINED")[:120]))
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError(
            f"The call can no longer be declined (state: {current['status']})" if current else "Call not found",
            409, "state_conflict",
            call=serialize_call(conn, current, viewer=user) if current else None,
        )
    _event(conn, call_id, "REJECTED", user, {"reason": reason})
    audit_log(conn, "REJECT_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role="vet",
              details={"reason": reason})
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def cancel_call(conn, call_id: str, user: dict) -> dict:
    call_row = _row(conn, call_id)
    if not call_row:
        raise WebCallError("Call not found", 404, "not_found")
    if int(call_row["caller_id"]) != int(user["uid"]):
        raise WebCallError("Only the farmer who started the call can cancel it", 403, "not_caller")
    ok = _transition(conn, call_id, ("created", "ringing", "accepted", "connecting"), "cancelled",
                     extra_sql=", ended_at=datetime('now'), ended_by=?, end_reason='CALLER_CANCELLED'",
                     extra_params=(user["uid"],))
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError(
            f"The call cannot be cancelled (state: {current['status']})" if current else "Call not found",
            409, "state_conflict",
            call=serialize_call(conn, current, viewer=user) if current else None,
        )
    _event(conn, call_id, "CANCELLED", user)
    audit_log(conn, "CANCEL_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role=user.get("role"))
    finalize_call(conn, _row(conn, call_id))
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def end_call(conn, call_id: str, user: dict, reason: str | None = None) -> dict:
    call_row = require_participant(conn, call_id, user)
    status = call_row["status"]
    if status in TERMINAL_STATUSES:
        return serialize_call(conn, call_row, viewer=user)

    # A ringing call that the caller drops is a cancellation; anything further
    # along is an ordinary hang-up.
    target = "cancelled" if (status == "ringing" and int(call_row["caller_id"]) == int(user["uid"])) else "ended"
    duration = _duration_seconds(call_row, status)
    ok = _transition(
        conn, call_id, ("created", "ringing", "accepted", "connecting", "connected"), target,
        extra_sql=", ended_at=datetime('now'), ended_by=?, end_reason=?, duration_seconds=?",
        extra_params=(user["uid"], (reason or "HANGUP")[:120], duration),
    )
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError("The call already ended", 409, "state_conflict",
                           call=serialize_call(conn, current, viewer=user) if current else None)
    _event(conn, call_id, "ENDED" if target == "ended" else "CANCELLED", user, {"reason": reason})
    audit_log(conn, "END_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role=user.get("role"),
              details={"reason": reason, "duration_seconds": duration})
    finalize_call(conn, _row(conn, call_id))
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def mark_connecting(conn, call_id: str, user: dict) -> dict:
    call_row = require_participant(conn, call_id, user)
    if call_row["status"] == "connecting":
        return serialize_call(conn, call_row, viewer=user)
    ok = _transition(conn, call_id, ("accepted",), "connecting")
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError(f"The call is not ready for media setup (state: {current['status']})",
                           409, "state_conflict",
                           call=serialize_call(conn, current, viewer=user))
    _event(conn, call_id, "CONNECTING", user)
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def mark_connected(conn, call_id: str, user: dict, *, media_confirmed: bool = False) -> dict:
    """Record a genuinely established media connection.

    The client only sends this after its ``RTCPeerConnection`` reached the
    ``connected`` state; the server records its own ``connected_at`` timestamp
    and refuses the transition for any other state.
    """
    call_row = require_participant(conn, call_id, user)
    if call_row["status"] == "connected":
        return serialize_call(conn, call_row, viewer=user)
    ok = _transition(conn, call_id, ("accepted", "connecting"), "connected",
                     extra_sql=", connected_at=datetime('now')", extra_params=())
    if not ok:
        current = _row(conn, call_id)
        raise WebCallError(f"Media cannot be confirmed from state {current['status']}",
                           409, "state_conflict",
                           call=serialize_call(conn, current, viewer=user))
    _event(conn, call_id, "CONNECTED", user, {"media_confirmed": bool(media_confirmed)})
    audit_log(conn, "CONNECT_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role=user.get("role"),
              details={"media_confirmed": bool(media_confirmed)})
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def mark_failed(conn, call_id: str, user: dict, reason: str | None = None) -> dict:
    call_row = require_participant(conn, call_id, user, allow_govt=True)
    if call_row["status"] in TERMINAL_STATUSES:
        return serialize_call(conn, call_row, viewer=user)
    duration = _duration_seconds(call_row, call_row["status"])
    ok = _transition(conn, call_id, ("created", "ringing", "accepted", "connecting", "connected"), "failed",
                     extra_sql=", ended_at=datetime('now'), ended_by=?, end_reason=?, duration_seconds=?",
                     extra_params=(user["uid"], (reason or "MEDIA_FAILED")[:120], duration))
    if not ok:  # pragma: no cover - concurrent terminal transition
        conn.rollback()
    else:
        _event(conn, call_id, "FAILED", user, {"reason": reason})
        audit_log(conn, "FAIL_WEB_CALL", "web_call", call_id, actor_id=user["uid"], actor_role=user.get("role"),
                  details={"reason": reason})
    finalize_call(conn, _row(conn, call_id))
    conn.commit()
    return serialize_call(conn, _row(conn, call_id), viewer=user)


def _duration_seconds(call_row, status: str) -> int:
    start = call_row["connected_at"] if status == "connected" else call_row["accepted_at"]
    start_dt = _parse(start)
    return max(0, int((_now() - start_dt).total_seconds()))


def finalize_call(conn, call_row) -> None:
    """Housekeeping after a terminal transition (signal retention, notifications)."""
    if call_row is None:
        return
    conn.execute("DELETE FROM web_call_signals WHERE call_id=?", (call_row["call_id"],))
    if call_row["vet_id"] and call_row["status"] in ("missed",):
        conn.execute(
            "INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)",
            (call_row["vet_id"], "A web call to you was not answered.", "call"),
        )


def expire_stale_calls(conn) -> int:
    """Ring timeout / abandoned-call sweeper. Safe to run from any process.

    A call left in a non-terminal state (browser killed, network gone, ticket
    never answered) is moved to an accurate terminal status:
      * ringing past its ring timeout  -> expired
      * accepted/connecting/connected with no activity for 10 minutes -> failed
        (measured from the last server-recorded timestamp, never client-supplied)
    """
    changed = 0
    stale_local = conn.execute(
        "SELECT * FROM web_calls WHERE status='ringing' AND ringing_at IS NOT NULL "
        "AND (julianday('now') - julianday(ringing_at)) * 86400.0 > ring_timeout_seconds"
    ).fetchall()
    for call_row in stale_local:
        if _transition(conn, call_row["call_id"], ("ringing",), "expired",
                       extra_sql=", ended_at=datetime('now'), end_reason='RING_TIMEOUT'", extra_params=()):
            _event(conn, call_row["call_id"], "EXPIRED", None, {"reason": "RING_TIMEOUT"})
            audit_log(conn, "EXPIRE_WEB_CALL", "web_call", call_row["call_id"], actor_role="system",
                      details={"reason": "RING_TIMEOUT"})
            finalize_call(conn, _row(conn, call_row["call_id"]))
            changed += 1
    abandoned = conn.execute(
        "SELECT * FROM web_calls WHERE status IN ('accepted','connecting','connected') "
        "AND COALESCE(connected_at, accepted_at, ringing_at, created_at) < datetime('now', ?)",
        (f"-{reconcile_stale_minutes()} minutes",),
    ).fetchall()
    for call_row in abandoned:
        if _transition(conn, call_row["call_id"], ("accepted", "connecting", "connected"), "failed",
                       extra_sql=", ended_at=datetime('now'), end_reason='SESSION_ABANDONED', duration_seconds=0",
                       extra_params=()):
            _event(conn, call_row["call_id"], "FAILED", None, {"reason": "SESSION_ABANDONED"})
            finalize_call(conn, _row(conn, call_row["call_id"]))
            changed += 1
    # Never keep stale signaling rows around beyond the retention window.
    conn.execute("DELETE FROM web_call_signals WHERE created_at < datetime('now', ?)",
                 (f"-{SIGNAL_RETENTION_HOURS} hours",))
    conn.commit()
    return changed


def reconcile_stale_minutes() -> int:
    try:
        return max(1, int(os.environ.get("SIH_WEBCALL_ABANDON_MINUTES", "45")))
    except (TypeError, ValueError):
        return 45


# --------------------------------------------------------------------------
# Durable WebRTC signaling
# --------------------------------------------------------------------------
def add_signal(conn, call_id: str, sender: dict, kind: str, payload) -> int:
    """Validate and persist one signaling message; returns its sequence id."""
    if kind not in SIGNAL_KINDS:
        raise WebCallError(f"Unsupported signal kind '{kind}'", 400, "bad_signal_kind")
    call_row = require_participant(conn, call_id, sender)
    if call_row["status"] in TERMINAL_STATUSES:
        raise WebCallError("The call has ended; signaling is closed", 409, "call_ended",
                           call=serialize_call(conn, call_row, viewer=sender))
    if call_row["status"] not in ("accepted", "connecting", "connected"):
        raise WebCallError(f"Signaling is not allowed while the call is {call_row['status']}",
                           409, "state_conflict",
                           call=serialize_call(conn, call_row, viewer=sender))
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_SIGNAL_BYTES:
        raise WebCallError("Signaling payload too large", 413, "signal_too_large")
    cur = conn.execute(
        "INSERT INTO web_call_signals (call_id, sender_id, kind, payload) VALUES (?,?,?,?)",
        (call_id, int(sender["uid"]), kind, encoded),
    )
    conn.commit()
    return int(cur.lastrowid)


def list_signals(conn, call_id: str, viewer: dict, after: int = 0, limit: int = 200) -> list[dict]:
    call_row = require_participant(conn, call_id, viewer)
    rows = conn.execute(
        "SELECT id, sender_id, kind, payload, created_at FROM web_call_signals "
        "WHERE call_id=? AND id>? ORDER BY id ASC LIMIT ?",
        (call_id, int(after or 0), min(max(int(limit or 200), 1), 500)),
    ).fetchall()
    peer_id = int(call_row["vet_id"] or 0) if int(call_row["caller_id"]) == int(viewer["uid"]) else int(call_row["caller_id"])
    output = []
    for row in rows:
        output.append({
            "id": row["id"],
            "from": "peer" if int(row["sender_id"]) == peer_id else "self",
            "sender_id": row["sender_id"],
            "kind": row["kind"],
            "payload": _loads(row["payload"], {}),
            "created_at": row["created_at"],
        })
    return output


def participant_ids(call_row) -> list[int]:
    ids = [int(call_row["caller_id"])]
    if call_row["vet_id"]:
        ids.append(int(call_row["vet_id"]))
    return ids


def peer_id(call_row, user_id: int) -> int | None:
    uid = int(user_id)
    if uid == int(call_row["caller_id"]):
        return int(call_row["vet_id"]) if call_row["vet_id"] else None
    if call_row["vet_id"] and uid == int(call_row["vet_id"]):
        return int(call_row["caller_id"])
    return None


# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------
def list_history(conn, user: dict, limit: int = 50, offset: int = 0) -> list[dict]:
    role = user.get("role")
    uid = int(user["uid"])
    limit = min(max(int(limit or 50), 1), 200)
    offset = max(int(offset or 0), 0)
    if role == "owner":
        rows = conn.execute(
            "SELECT * FROM web_calls WHERE caller_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
            (uid, limit, offset),
        ).fetchall()
    elif role == "vet":
        rows = conn.execute(
            "SELECT * FROM web_calls WHERE vet_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
            (uid, limit, offset),
        ).fetchall()
    elif role == "govt":
        rows = conn.execute(
            "SELECT * FROM web_calls ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)
        ).fetchall()
    else:
        raise WebCallError("Call history is not available for this role", 403, "role_not_allowed")
    return [serialize_call(conn, row, viewer=user) for row in rows]


def stats_for_vet(conn, vet_id: int) -> dict:
    row = conn.execute(
        """
        SELECT COUNT(*) total,
               SUM(CASE WHEN status IN ('ended','connected') THEN 1 ELSE 0 END) answered,
               SUM(CASE WHEN status IN ('missed','expired','rejected') THEN 1 ELSE 0 END) missed,
               COALESCE(SUM(duration_seconds), 0) talk_seconds
        FROM web_calls WHERE vet_id=?
        """,
        (vet_id,),
    ).fetchone()
    return {
        "total": row["total"] or 0,
        "answered": row["answered"] or 0,
        "missed": row["missed"] or 0,
        "talk_seconds": row["talk_seconds"] or 0,
    }


# --------------------------------------------------------------------------
# Web Push (incoming call) — uses the existing push_subscriptions table
# --------------------------------------------------------------------------
def dispatch_incoming_call_push(conn, call_row) -> int:
    """Send a Web Push "incoming call" to the assigned veterinarian's devices.

    Runs in a short-lived background thread: a slow push service must never
    delay the ringing event. Stale subscriptions (404/410) are pruned.
    """
    if not call_row or not call_row["vet_id"]:
        return 0
    try:
        from push_service import is_push_configured, push_notification
    except Exception:  # pragma: no cover
        return 0
    if not is_push_configured():
        return 0
    subs = conn.execute(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?",
        (call_row["vet_id"],),
    ).fetchall()
    if not subs:
        return 0
    caller = conn.execute("SELECT full_name, village, district FROM users WHERE id=?", (call_row["caller_id"],)).fetchone()
    payload = {
        "type": "incoming_call",
        "call_id": call_row["call_id"],
        "title": "Incoming web call",
        "body": f"{caller['full_name'] if caller else 'A farmer'} · {call_row['district'] or ''}".strip(" ·"),
        "language": call_row["language"],
        "reason": call_row["reason"],
        "ring_timeout_seconds": call_row["ring_timeout_seconds"],
        "url": f"/#/vet/calls?incoming={call_row['call_id']}",
        # Deliberately no phone number: push payloads can be shown on a lock screen.
    }
    subscriptions = [dict(s) for s in subs]

    def _worker():
        dead = []
        for sub in subscriptions:
            ok = push_notification(
                {"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                payload,
                # A ringing call is worth waking the device for, and a call
                # notification must expire with the ring window instead of
                # surfacing minutes or hours later.
                ttl=max(10, int(call_row["ring_timeout_seconds"] or 45)),
                urgency="high",
            )
            if not ok:
                dead.append(sub["id"])
        if dead:
            try:
                import database
                cleanup = database.get_db()
                try:
                    cleanup.executemany("DELETE FROM push_subscriptions WHERE id=?", [(i,) for i in dead])
                    cleanup.commit()
                finally:
                    cleanup.close()
            except Exception as exc:  # pragma: no cover - best effort
                logger.debug("push subscription cleanup failed: %s", exc)

    if os.environ.get("SIH_WEBCALL_PUSH_SYNC", "").strip().lower() in {"1", "true", "yes", "on"}:
        # Deterministic path for automated tests; production keeps the thread.
        _worker()
    else:
        threading.Thread(target=_worker, name="webcall-push", daemon=True).start()
    return len(subscriptions)


def notify_vet_of_call(conn, call_row) -> None:
    """In-app notification (works with no push subscription) + best-effort push."""
    if not call_row["vet_id"]:
        return
    caller = conn.execute("SELECT full_name, village, district FROM users WHERE id=?", (call_row["caller_id"],)).fetchone()
    where = ", ".join(part for part in [caller["village"] if caller else None, call_row["district"]] if part)
    label = f"{caller['full_name'] if caller else 'A farmer'}" + (f" ({where})" if where else "")
    conn.execute(
        "INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)",
        (call_row["vet_id"], f"Incoming web call from {label} — language {call_row['language']}", "call"),
    )
    conn.commit()
    dispatch_incoming_call_push(conn, call_row)


def signal_rate_limited(conn, user_id: int) -> bool:
    count = conn.execute(
        "SELECT COUNT(*) c FROM web_call_signals WHERE sender_id=? AND created_at > datetime('now','-1 minute')",
        (int(user_id),),
    ).fetchone()["c"]
    return count >= MAX_SIGNALS_PER_MINUTE
