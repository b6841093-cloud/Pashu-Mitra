"""Farmer OTP login service — OTP generation, storage, sending and verification.

SECURITY MODEL
==============
* Six-digit code from :func:`secrets.randbelow` (CSPRNG), uniform over 000000-999999.
* Only a PBKDF2-HMAC-SHA256 hash of the code is stored, salted per OTP row and
  peppered with a server secret (``OTP_PEPPER`` or ``SIH_SECRET_KEY``) so a
  database leak alone cannot recover a code.
* Five minute expiry, maximum five verification attempts, single use.
* Sixty second resend cooldown, per-mobile and per-IP request rate limits,
  and a per-mobile limit on failed verifications (slows 6-digit guessing).
* Consumption is atomic: ``UPDATE ... WHERE id=? AND status='ACTIVE'`` with a
  ``rowcount`` check, so two concurrent verifies can never both succeed.
* Issuing a new OTP invalidates every older active OTP for that account.
* Responses never contain the OTP and never reveal whether a mobile number is
  registered: unknown numbers get the same success shape as known ones.
* Verification state lives only in the database — never in localStorage or a
  JWT — and the OTP plaintext is never logged.

PROTOTYPE DEMO ACCOUNT
======================
When ``DEMO_MODE`` is explicitly enabled (see ``demo_auth.py``), the single
configured demo number is issued an OTP row whose code is the fixed demo value
and whose SMS is *not* dispatched. The row is a normal row — salted, peppered
hashed, expiring, single-use, attempt-limited — so verification goes through
exactly the same code as every other farmer, and the JWT is minted from the
database row exactly the same way. Nothing about the verification, the token or
the role claims changes; only the *source* of the code changes. With demo mode
off, no such row is ever created and the fixed code is rejected by the ordinary
rules.

TABLES (created additively by ``database.init_db``)
==================================================
``otp_codes``        one row per issued OTP (hash, salt, attempts, status)
``otp_request_log``  rate-limiting / audit trail for requests and verifications
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone

import sms_gateway
import demo_auth
from database import DB_PATH, get_db
from ivr_config import normalize_indian_number

logger = logging.getLogger(__name__)

PURPOSE_FARMER_LOGIN = "farmer_login"
FARMER_ROLE = "owner"

OTP_LENGTH = 6
DEFAULT_TTL_SECONDS = 300          # five minutes
DEFAULT_MAX_ATTEMPTS = 5
DEFAULT_RESEND_COOLDOWN = 60       # one minute
DEFAULT_MOBILE_WINDOW = 15 * 60    # 15 minutes
DEFAULT_MOBILE_MAX_REQUESTS = 5    # OTP requests per mobile per window
DEFAULT_IP_WINDOW = 60 * 60        # one hour
DEFAULT_IP_MAX_REQUESTS = 20       # OTP requests per IP per window
DEFAULT_MOBILE_MAX_FAILURES = 10   # failed verifications per mobile per window
DEFAULT_HASH_ITERATIONS = 50_000

_STATUS_ACTIVE = "ACTIVE"
_STATUS_USED = "USED"
_STATUS_INVALIDATED = "INVALIDATED"
_STATUS_EXPIRED = "EXPIRED"
_STATUS_LOCKED = "LOCKED"
_STATUS_SEND_FAILED = "SEND_FAILED"

_ephemeral_pepper: bytes | None = None
_pepper_lock = threading.Lock()


class OtpError(Exception):
    """Raised for expected OTP flow failures with a safe, stable error code.

    ``reason`` is an *internal*, non-secret diagnostic used for logs and audit
    events (for example ``code_mismatch`` vs ``pepper_mismatch``). It is never
    serialized into an API response.
    """

    def __init__(self, code: str, message: str, *, status: int = 400,
                 retry_after: int | None = None, reason: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after
        self.reason = reason

    def to_payload(self) -> dict:
        payload = {"error": self.message, "code": self.code}
        if self.retry_after:
            payload["retry_after"] = int(self.retry_after)
        return payload


# --------------------------------------------------------------------------
# Configuration helpers (read per call so tests/deployments can tune them)
# --------------------------------------------------------------------------
def otp_ttl_seconds() -> int:
    return _int_env("OTP_TTL_SECONDS", DEFAULT_TTL_SECONDS, minimum=60, maximum=3600)


def otp_max_attempts() -> int:
    return _int_env("OTP_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS, minimum=1, maximum=20)


def resend_cooldown_seconds() -> int:
    return _int_env("OTP_RESEND_COOLDOWN_SECONDS", DEFAULT_RESEND_COOLDOWN, minimum=0, maximum=3600)


def _int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 10**9) -> int:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid integer value for %s", name)
        return default
    return max(minimum, min(maximum, value))


def _pepper() -> bytes:
    """Server-side pepper. Never leaves the process."""
    value = os.environ.get("OTP_PEPPER") or os.environ.get("SIH_SECRET_KEY")
    if value:
        return value.encode("utf-8")
    global _ephemeral_pepper
    with _pepper_lock:
        if _ephemeral_pepper is None:
            _ephemeral_pepper = secrets.token_bytes(32)
            logger.warning(
                "OTP_PEPPER/SIH_SECRET_KEY is not configured; generated an ephemeral "
                "pepper. In-flight OTPs are invalidated by a restart — set OTP_PEPPER "
                "in production."
            )
        return _ephemeral_pepper


PEPPER_SOURCE_ENV = "OTP_PEPPER"
PEPPER_SOURCE_FALLBACK = "SIH_SECRET_KEY"
PEPPER_SOURCE_EPHEMERAL = "EPHEMERAL"


def pepper_source() -> str:
    """Where the OTP pepper comes from (never the value itself)."""
    if os.environ.get("OTP_PEPPER"):
        return PEPPER_SOURCE_ENV
    if os.environ.get("SIH_SECRET_KEY"):
        return PEPPER_SOURCE_FALLBACK
    return PEPPER_SOURCE_EPHEMERAL


def pepper_is_stable() -> bool:
    """False when the pepper is generated per process (breaks OTP verification).

    With ``gunicorn --workers 2`` an ephemeral pepper means the worker that
    issues an OTP cannot be verified by the worker that handles the check, so
    the farmer sees a 401 for a code that was correct.
    """
    return pepper_source() != PEPPER_SOURCE_EPHEMERAL


def pepper_fingerprint() -> str:
    """Non-reversible fingerprint of the current pepper (safe to store/log).

    Stored on each OTP row so a hash mismatch can be attributed to a rotated or
    per-process pepper instead of a wrong code. A high-entropy pepper cannot be
    recovered from a truncated HMAC fingerprint.
    """
    return hmac.new(_pepper(), b"pashu-otp-pepper-fingerprint-v1",
                    hashlib.sha256).hexdigest()[:16]


def hash_iterations() -> int:
    return _int_env("OTP_HASH_ITERATIONS", DEFAULT_HASH_ITERATIONS,
                    minimum=1_000, maximum=1_000_000)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


# --------------------------------------------------------------------------
# Crypto helpers
# --------------------------------------------------------------------------
def generate_otp() -> str:
    """Return a cryptographically secure, zero-padded six-digit code."""
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def hash_otp(otp: str, salt: str, pepper: bytes | None = None) -> str:
    """PBKDF2-HMAC-SHA256 hash of the code bound to a per-row salt and pepper."""
    material = hashlib.pbkdf2_hmac(
        "sha256",
        str(otp).encode("utf-8"),
        (pepper if pepper is not None else _pepper()) + b":" + salt.encode("utf-8"),
        hash_iterations(),
    )
    return material.hex()


def _constant_time_match(otp: str, salt: str, expected_hash: str) -> bool:
    try:
        return hmac.compare_digest(hash_otp(otp, salt), expected_hash)
    except Exception:  # pragma: no cover - defensive
        return False


def normalize_mobile(value) -> str | None:
    """Normalize an Indian mobile number to E.164 (``+91XXXXXXXXXX``)."""
    return normalize_indian_number(value)


def mobile_variants(e164: str) -> tuple[str, str]:
    """Return (E.164, 10-digit local) so either stored format can match."""
    return e164, e164[-10:]


# --------------------------------------------------------------------------
# OTP message templates (farmer's preferred language when available)
# --------------------------------------------------------------------------
_MESSAGES = {
    "en": "PashuMitra: {code} is your login OTP. Valid for {minutes} minutes. Never share this code.",
    "mr": "PashuMitra: {code} हा तुमचा लॉगिन OTP आहे. {minutes} मिनिटांसाठी वैध. हा कोड कोणालाही देऊ नका.",
    "hi": "PashuMitra: {code} आपका लॉगिन OTP है। {minutes} मिनट तक मान्य। यह कोड किसी को न बताएं।",
    "te": "PashuMitra: {code} మీ లాగిన్ OTP. {minutes} నిమిషాల పాటు చెల్లుతుంది. ఈ కోడ్ ఎవరికీ చెప్పవద్దు.",
}


def build_otp_message(code: str, language: str | None = None) -> str:
    lang = (language or "en").strip().lower()
    template = _MESSAGES.get(lang) or _MESSAGES["en"]
    return template.format(code=code, minutes=max(1, otp_ttl_seconds() // 60))


def _send_otp_sms(e164: str, code: str, language: str | None, purpose: str) -> dict:
    """Hand the OTP to the SMS gateway. Raises SmsGatewayError on failure."""
    text = build_otp_message(code, language)
    result = sms_gateway.send_text_message(e164, text)
    if result.get("simulated") and _dev_print_enabled():
        # Explicit, non-production-only developer aid. Never active in production.
        logger.warning(
            "DEV ONLY — MOCK SMS to farmer (%s) for purpose=%s: %s",
            sms_gateway.mask_phone(e164), purpose, text,
        )
    return result


def _dev_print_enabled() -> bool:
    if sms_gateway.is_production():
        return False
    return (os.environ.get("OTP_DEV_PRINT_CODE") or "").strip().lower() in ("1", "true", "yes", "on")


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def _open_conn():
    """Dedicated connection with explicit transaction control."""
    conn = get_db()
    conn.isolation_level = None  # autocommit; we issue BEGIN IMMEDIATE ourselves
    return conn


def _log_attempt(conn, *, mobile: str | None, ip: str | None, outcome: str,
                 purpose: str, detail: str | None = None,
                 gateway_http_status: int | None = None,
                 gateway_state: str | None = None,
                 error_category: str | None = None) -> None:
    """Append one audit row. Never stores a code, hash or full phone number."""
    conn.execute(
        "INSERT INTO otp_request_log (mobile_e164, ip_address, outcome, purpose, detail, "
        "gateway_http_status, gateway_state, error_category, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (mobile, ip, outcome, purpose, (detail or "")[:200], gateway_http_status,
         (gateway_state or None), (error_category or None), _iso(_utcnow())),
    )


def purge_stale(conn, *, older_than_days: int = 7) -> None:
    """Best-effort housekeeping: expire old OTPs and drop stale log rows."""
    now = _utcnow()
    conn.execute(
        "UPDATE otp_codes SET status=? WHERE status=? AND expires_at < ?",
        (_STATUS_EXPIRED, _STATUS_ACTIVE, _iso(now)),
    )
    cutoff = _iso(now - timedelta(days=older_than_days))
    conn.execute("DELETE FROM otp_codes WHERE created_at < ?", (cutoff,))
    conn.execute("DELETE FROM otp_request_log WHERE created_at < ?", (cutoff,))


def _count_since(conn, table: str, column: str, value: str, since: datetime,
                 extra_where: str = "") -> int:
    sql = f"SELECT COUNT(*) AS c FROM {table} WHERE {column}=? AND created_at >= ?"
    if extra_where:
        sql += " " + extra_where
    row = conn.execute(sql, (value, _iso(since))).fetchone()
    return int(row["c"] if row else 0)


def _row_value(row, column: str):
    """Read a column that may be missing on rows from an older revision."""
    try:
        return row[column]
    except (IndexError, KeyError):
        return None


def _row_age_seconds(row) -> int | None:
    created = _parse_iso(_row_value(row, "created_at"))
    if not created:
        return None
    return max(0, int((_utcnow() - created).total_seconds()))


def _log_verify_failure(mobile_e164: str, reason: str, error_code: str, *,
                        row=None, attempts_remaining: int | None = None,
                        row_age: int | None = None) -> None:
    """Structured, secret-free log line for every failed verification.

    ``error_code`` is the OtpError code (never an OTP); the recipient is masked
    and no hash/salt/code is written.
    """
    logger.warning(
        "otp_verify_failed error_code=%s reason=%s recipient=%s otp_row_status=%s "
        "otp_row_age_seconds=%s attempts=%s/%s attempts_remaining=%s pepper_source=%s "
        "pepper_stable=%s",
        error_code, reason, sms_gateway.mask_phone(mobile_e164),
        _row_value(row, "status") if row is not None else None,
        _row_age_seconds(row) if row is not None else row_age,
        _row_value(row, "attempts") if row is not None else None,
        _row_value(row, "max_attempts") if row is not None else None,
        attempts_remaining, pepper_source(), pepper_is_stable(),
    )


def _last_sent_at(conn, mobile: str, purpose: str) -> datetime | None:
    row = conn.execute(
        "SELECT created_at FROM otp_request_log WHERE mobile_e164=? AND purpose=? "
        "AND outcome='SENT' ORDER BY id DESC LIMIT 1",
        (mobile, purpose),
    ).fetchone()
    return _parse_iso(row["created_at"]) if row else None


# --------------------------------------------------------------------------
# Public API: request / resend
# --------------------------------------------------------------------------
def request_otp(mobile_raw, *, ip: str | None = None,
                purpose: str = PURPOSE_FARMER_LOGIN,
                allow_unregistered: bool = False) -> dict:
    """Issue (and send) a new OTP for a farmer mobile number.

    When ``allow_unregistered`` is true (farmer profile creation) a number with
    no account yet also receives a real OTP: the row carries ``user_id = NULL``
    and verification returns a short-lived registration token instead of a
    session. Every rate limit, cooldown and anti-enumeration rule applies to
    both intents identically.

    The prototype demo account is a strictly narrower path: only when demo mode
    is on *and* the number is the configured demo number, the issued code is
    the fixed demo value and no SMS is dispatched. The row it writes is an
    ordinary OTP row, so verification, the JWT and the role claims are
    unchanged. Demo mode off ⇒ identical behaviour to every other number.

    Returns a dict with ``status`` and timing metadata. It never raises for an
    unknown or non-farmer number — the caller must return an identical, generic
    response to avoid account enumeration.

    Raises :class:`OtpError` for invalid input, rate limits, cooldown, and for
    real SMS delivery failures (a failure is never reported as success).
    """
    e164 = normalize_mobile(mobile_raw)
    if not e164:
        raise OtpError("INVALID_MOBILE", "Enter a valid 10-digit Indian mobile number.", status=400)

    # Demo mode is decided here and nowhere else: the flag plus the configured
    # number. Using the demo number while demo mode is off changes nothing.
    demo_login = demo_auth.is_demo_farmer(e164)
    demo_code = demo_auth.demo_farmer_otp() if demo_login else None

    readiness = otp_login_status()
    if not readiness["ready"] and not demo_login:
        raise OtpError(
            readiness["blockers"][0],
            "OTP login is not available right now. Please try again shortly.",
            status=503,
            reason=readiness["blockers"][0],
        )

    conn = _open_conn()
    try:
        now = _utcnow()
        mobile_window = _int_env("OTP_MOBILE_RATE_WINDOW_SECONDS", DEFAULT_MOBILE_WINDOW, minimum=60)
        ip_window = _int_env("OTP_IP_RATE_WINDOW_SECONDS", DEFAULT_IP_WINDOW, minimum=60)
        mobile_max = _int_env("OTP_MOBILE_MAX_REQUESTS", DEFAULT_MOBILE_MAX_REQUESTS, minimum=1)
        ip_max = _int_env("OTP_IP_MAX_REQUESTS", DEFAULT_IP_MAX_REQUESTS, minimum=1)

        # --- rate limits (per mobile, then per client IP) --------------------
        # The demo number is exempt while demo mode is on: no SMS leaves the
        # server for it, the code is already public by design, and a
        # presenter must be able to log out and back in during a demo without
        # waiting out a 60-second cooldown. No other number is affected.
        recent_mobile = conn.execute(
            "SELECT COUNT(*) AS c FROM otp_request_log WHERE mobile_e164=? AND created_at >= ? "
            "AND outcome IN ('SENT','SENT_DEMO','SEND_FAILED','UNKNOWN_ACCOUNT')",
            (e164, _iso(now - timedelta(seconds=mobile_window))),
        ).fetchone()["c"]
        if recent_mobile >= mobile_max and not demo_login:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="RATE_LIMITED", purpose=purpose)
            raise OtpError(
                "RATE_LIMITED",
                "Too many OTP requests for this number. Please try again later.",
                status=429, retry_after=mobile_window,
            )

        if ip and not demo_login:
            recent_ip = _count_since(conn, "otp_request_log", "ip_address", ip,
                                     now - timedelta(seconds=ip_window))
            if recent_ip >= ip_max:
                _log_attempt(conn, mobile=e164, ip=ip, outcome="RATE_LIMITED_IP", purpose=purpose)
                raise OtpError(
                    "RATE_LIMITED",
                    "Too many OTP requests from this network. Please try again later.",
                    status=429, retry_after=ip_window,
                )

        # --- resend cooldown -------------------------------------------------
        cooldown = 0 if demo_login else resend_cooldown_seconds()
        last_sent = _last_sent_at(conn, e164, purpose)
        if last_sent and cooldown > 0:
            elapsed = (now - last_sent).total_seconds()
            if elapsed < cooldown:
                remaining = int(cooldown - elapsed) or 1
                _log_attempt(conn, mobile=e164, ip=ip, outcome="COOLDOWN_BLOCKED", purpose=purpose)
                raise OtpError(
                    "COOLDOWN_ACTIVE",
                    "An OTP was sent recently. Please wait before requesting another one.",
                    status=429, retry_after=remaining,
                )

        # --- account lookup (farmers only, never another role) ---------------
        e164_form, local_form = mobile_variants(e164)
        if demo_login:
            # Create-or-reuse the single demo farmer row (never a duplicate).
            user = demo_auth.ensure_demo_farmer(conn)
            if user is None:
                _log_attempt(conn, mobile=e164, ip=ip, outcome="DEMO_ACCOUNT_UNAVAILABLE",
                             purpose=purpose)
                logger.error(
                    "demo_login_unavailable recipient=%s reason=demo_account_conflict",
                    sms_gateway.mask_phone(e164),
                )
                raise OtpError(
                    "DEMO_ACCOUNT_UNAVAILABLE",
                    "The demo account is not available right now. Please try again shortly.",
                    status=503, reason="demo_account_conflict",
                )
            conn.commit()
        else:
            user = conn.execute(
                "SELECT * FROM users WHERE role=? AND (mobile=? OR mobile=?) LIMIT 1",
                (FARMER_ROLE, e164_form, local_form),
            ).fetchone()

        signup_otp = False
        if not user:
            if not allow_unregistered:
                # Anti-enumeration: identical success shape, no SMS is sent.
                _log_attempt(conn, mobile=e164, ip=ip, outcome="UNKNOWN_ACCOUNT", purpose=purpose)
                purge_stale(conn)
                return {
                    "status": "ACCEPTED",
                    # No SMS is dispatched for an unknown (or non-farmer) number and
                    # the caller must not describe this as a delivery.
                    "sent": False,
                    "accepted": False,
                    "delivery_confirmed": False,
                    "gateway_message_id": None,
                    "gateway_state": None,
                    "expires_in": otp_ttl_seconds(),
                    "resend_after": cooldown,
                }
            signup_otp = True

        # --- issue the OTP ---------------------------------------------------
        # Demo mode: the fixed code is stored exactly like a random one (salted,
        # peppered hash only). The plaintext is never written to the log, the
        # audit trail or the response — it is read from the login screen, which
        # only shows it while demo mode is on.
        code = demo_code if demo_login else generate_otp()
        salt = secrets.token_hex(16)
        otp_hash = hash_otp(code, salt)
        fingerprint = pepper_fingerprint()
        expires_at = now + timedelta(seconds=otp_ttl_seconds())

        conn.execute("BEGIN IMMEDIATE")
        try:
            if user:
                conn.execute(
                    "UPDATE otp_codes SET status=? WHERE user_id=? AND purpose=? AND status=?",
                    (_STATUS_INVALIDATED, user["id"], purpose, _STATUS_ACTIVE),
                )
            else:
                # No account yet: invalidate by number so only the newest code works.
                conn.execute(
                    "UPDATE otp_codes SET status=? WHERE mobile_e164=? AND purpose=? AND status=?",
                    (_STATUS_INVALIDATED, e164, purpose, _STATUS_ACTIVE),
                )
            cursor = conn.execute(
                "INSERT INTO otp_codes (user_id, role, mobile_e164, otp_hash, otp_salt, purpose, "
                "attempts, max_attempts, status, created_at, expires_at, request_ip, "
                "pepper_fingerprint) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (user["id"] if user else None, user["role"] if user else FARMER_ROLE,
                 e164, otp_hash, salt, purpose,
                 0, otp_max_attempts(), _STATUS_ACTIVE, _iso(now), _iso(expires_at), ip,
                 fingerprint),
            )
            otp_id = cursor.lastrowid
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise

        # --- deliver ---------------------------------------------------------
        try:
            if demo_login:
                # No SMS is dispatched for the demo number: 9999999999 may well
                # be a real handset. The code is displayed on the login screen.
                delivery = {
                    "delivered": False, "simulated": True, "mode": "DEMO",
                    "accepted": True, "message_id": None, "state": "DemoSuppressed",
                    "device_id_configured": False, "http_status": None,
                }
            else:
                delivery = _send_otp_sms(e164, code,
                                         user["preferred_language"] if user else None, purpose)
        except sms_gateway.SmsGatewayError as exc:
            # Never claim delivery; the issued OTP is unusable and is retired.
            diag = exc.diagnostics()
            conn.execute(
                "UPDATE otp_codes SET status=?, send_error_code=?, send_error_category=?, "
                "gateway_http_status=? WHERE id=? AND status=?",
                (_STATUS_SEND_FAILED, diag["code"], diag["category"],
                 diag["gateway_http_status"], otp_id, _STATUS_ACTIVE),
            )
            _log_attempt(conn, mobile=e164, ip=ip, outcome="SEND_FAILED", purpose=purpose,
                         detail=(f"code={diag['code']} category={diag['category']} "
                                 f"gateway_http_status={diag['gateway_http_status']}"),
                         gateway_http_status=diag["gateway_http_status"],
                         error_category=diag["category"])
            logger.error(
                "otp_sms_submission_failed user_id=%s error_code=%s category=%s "
                "gateway_http_status=%s recipient=%s retryable=%s detail=%s",
                user["id"] if user else "signup", diag["code"], diag["category"],
                diag["gateway_http_status"],
                sms_gateway.mask_phone(e164), diag["retryable"], diag["reason"],
            )
            safe_status = 503 if exc.code == "SMS_GATEWAY_NOT_CONFIGURED" else 502
            raise OtpError(
                exc.code,
                "We could not send the OTP SMS right now. Please try again shortly.",
                status=safe_status,
                reason=diag["category"],
            ) from exc

        mode = str(delivery.get("mode") or "").upper()
        message_state = delivery.get("delivery_state") or delivery.get("state")
        accepted = bool(delivery.get("accepted"))
        conn.execute(
            "UPDATE otp_codes SET gateway_message_id=?, gateway_state=?, gateway_mode=?, "
            "gateway_http_status=?, gateway_device_configured=? WHERE id=?",
            (delivery.get("message_id"), message_state, mode, delivery.get("http_status"),
             1 if delivery.get("device_id_configured") else 0, otp_id),
        )
        _log_attempt(conn, mobile=e164, ip=ip,
                     outcome=("SENT_DEMO" if demo_login
                              else "SENT_SIGNUP" if signup_otp else "SENT"),
                     purpose=purpose,
                     detail=f"mode={mode} accepted={accepted} state={message_state}",
                     gateway_http_status=delivery.get("http_status"),
                     gateway_state=message_state)
        # A gateway 2xx = queued, not delivered. The message id is the handle for
        # provider-side tracing (GET /3rdparty/v1/messages/{id}).
        logger.info(
            "otp_sms_submitted user_id=%s purpose=%s intent=%s mode=%s simulated=%s accepted=%s "
            "message_id=%s message_state=%s device_pinned=%s note=queued_not_delivered",
            user["id"] if user else "signup", purpose,
            "demo" if demo_login else "signup" if signup_otp else "login",
            mode, bool(delivery.get("simulated")), accepted,
            delivery.get("message_id"), message_state,
            bool(delivery.get("device_id_configured")),
        )
        purge_stale(conn)
        return {
            "status": "SENT",
            "sent": True,
            # True when the OTP was issued for a number without an account yet
            # (farmer profile creation) instead of an existing login.
            "signup": signup_otp,
            # True only for the demo number while demo mode is on: no SMS was
            # dispatched, the fixed code is shown on the login screen instead.
            "demo": demo_login,
            "simulated": bool(delivery.get("simulated")),
            "accepted": accepted,
            "delivery_confirmed": False,
            "gateway_mode": mode or None,
            "gateway_message_id": delivery.get("message_id"),
            "gateway_state": message_state,
            "gateway_http_status": delivery.get("http_status"),
            "expires_in": otp_ttl_seconds(),
            "resend_after": cooldown,
        }
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover - defensive
            pass


def resend_otp(mobile_raw, *, ip: str | None = None,
               purpose: str = PURPOSE_FARMER_LOGIN,
               allow_unregistered: bool = False) -> dict:
    """Resend an OTP — identical to :func:`request_otp` but intended for the
    explicit "resend" action; the shared 60-second cooldown still applies."""
    return request_otp(mobile_raw, ip=ip, purpose=purpose,
                       allow_unregistered=allow_unregistered)


# --------------------------------------------------------------------------
# Farmer profile creation after phone verification
# --------------------------------------------------------------------------
# A signup OTP proves control of a mobile number, not the right to an account.
# Verification therefore issues a short-lived, HMAC-signed token bound to the
# exact verified number; the profile endpoint refuses anything else and always
# creates the account with the farmer role — never the role the client asked
# for. The token is signed with the OTP pepper (stable ``OTP_PEPPER`` or
# ``SIH_SECRET_KEY``), so it survives restarts and multiple workers exactly
# like OTP verification does.
DEFAULT_REGISTRATION_TOKEN_TTL = 900   # 15 minutes
_REGISTRATION_TOKEN_CONTEXT = b"pashumitra-farmer-registration-v1"


def registration_token_ttl_seconds() -> int:
    return _int_env("OTP_REGISTRATION_TOKEN_TTL_SECONDS", DEFAULT_REGISTRATION_TOKEN_TTL,
                    minimum=60, maximum=24 * 3600)


def issue_registration_token(e164: str) -> str:
    """Return a signed, expiring token that authorizes one farmer profile."""
    expires = int(_utcnow().timestamp()) + registration_token_ttl_seconds()
    message = f"{e164}|{expires}".encode("utf-8")
    signature = hmac.new(_pepper(), _REGISTRATION_TOKEN_CONTEXT + b":" + message,
                         "sha256").hexdigest()
    payload = base64.urlsafe_b64encode(message).decode("ascii").rstrip("=")
    return f"{payload}.{signature}"


def _token_fingerprint(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def consume_registration_token(conn, token) -> str | None:
    """Validate **and spend** a registration token, returning the E.164 number.

    A token is single use: it is accepted only while the OTP row it was issued
    from has no ``registration_used_at``, and claiming is atomic
    (``UPDATE ... WHERE registration_used_at IS NULL`` + rowcount check), so two
    concurrent signups with the same token cannot both proceed.

    It runs on the caller's connection so the claim belongs to the caller's
    transaction: profile validation errors do not burn the token, while a
    successful signup (or a login for a number that just gained an account)
    always does. Returns ``None`` for a missing, expired, tampered, unknown or
    already-used token.
    """
    e164 = verify_registration_token(token)
    if not e164:
        return None
    fingerprint = _token_fingerprint(token)
    row = conn.execute(
        "SELECT id FROM otp_codes WHERE mobile_e164=? AND purpose=? "
        "AND registration_token_hash=? AND registration_used_at IS NULL "
        "ORDER BY id DESC LIMIT 1",
        (e164, PURPOSE_FARMER_LOGIN, fingerprint),
    ).fetchone()
    if not row:
        return None
    cursor = conn.execute(
        "UPDATE otp_codes SET registration_used_at=? WHERE id=? AND registration_used_at IS NULL",
        (_iso(_utcnow()), row["id"]),
    )
    return e164 if cursor.rowcount == 1 else None


def verify_registration_token(token) -> str | None:
    """Return the verified E.164 number, or None when invalid/expired/tampered."""
    raw = str(token or "").strip()
    if not raw or "." not in raw:
        return None
    payload, _, signature = raw.rpartition(".")
    try:
        message = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode("utf-8")
    except Exception:
        return None
    expected = hmac.new(_pepper(), _REGISTRATION_TOKEN_CONTEXT + b":" + message.encode("utf-8"),
                        "sha256").hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    e164, _, expires = message.partition("|")
    try:
        if int(expires) < int(_utcnow().timestamp()):
            return None
    except (TypeError, ValueError):
        return None
    return e164 if e164.startswith("+") else None


# --------------------------------------------------------------------------
# Public API: verify
# --------------------------------------------------------------------------
def verify_otp(mobile_raw, code, *, ip: str | None = None,
               purpose: str = PURPOSE_FARMER_LOGIN) -> dict:
    """Verify an OTP and atomically consume it.

    On success returns the authenticated farmer record as a dict:
    ``{"user": {...}, "user_id": int, "consumed_at": iso}``.

    A *signup* OTP (issued with ``allow_unregistered=True`` for a number without
    an account) returns ``{"user": None, "registration_required": True,
    "registration_token": ..., "mobile_e164": ..., "role": "owner"}`` instead:
    the caller can then create the farmer profile, and the token — never the
    client's word — decides which number the new account belongs to.

    The generic failure codes (:class:`OtpError`) are: ``INVALID_MOBILE``,
    ``OTP_INVALID``, ``OTP_EXPIRED``, ``OTP_LOCKED``, ``OTP_ALREADY_USED``,
    ``RATE_LIMITED``. Unknown numbers report ``OTP_INVALID`` / ``OTP_EXPIRED``
    exactly like a wrong code, so nothing is revealed about registration.

    Each failure also carries ``OtpError.reason`` — an internal, non-secret
    diagnostic (``no_otp_row``, ``status=SEND_FAILED``, ``expired``,
    ``code_mismatch``, ``pepper_mismatch``, ``used``, ``locked``,
    ``attempts_exhausted``, ``role_mismatch``) that is logged and audited so a
    production 401 can be attributed to an exact cause.
    """
    e164 = normalize_mobile(mobile_raw)
    if not e164:
        raise OtpError("INVALID_MOBILE", "Enter a valid 10-digit Indian mobile number.", status=400)

    submitted = str(code or "").strip()
    if not submitted.isdigit() or len(submitted) != OTP_LENGTH:
        raise OtpError("INVALID_OTP_FORMAT", f"Enter the {OTP_LENGTH}-digit OTP.", status=400)

    conn = _open_conn()
    try:
        now = _utcnow()
        # The demo number is exempt from the rolling failed-verification cap
        # while demo mode is on: its code is shared on the login screen by
        # design, so the cap protects nothing there, and a live prototype must
        # not be locked out by a mistyped digit. Every other number keeps the
        # full anti-brute-force limit.
        demo_login = demo_auth.is_demo_farmer(e164)
        failure_window = _int_env("OTP_FAILURE_WINDOW_SECONDS", DEFAULT_MOBILE_WINDOW, minimum=60)
        failures = _count_since(
            conn, "otp_request_log", "mobile_e164", e164,
            now - timedelta(seconds=failure_window),
            "AND outcome='VERIFY_FAILED'",
        )
        max_failures = _int_env("OTP_MAX_VERIFY_FAILURES", DEFAULT_MOBILE_MAX_FAILURES, minimum=1)
        if failures >= max_failures and not demo_login:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_RATE_LIMITED", purpose=purpose,
                         detail=f"reason=failure_limit failures={failures}")
            _log_verify_failure(e164, "failure_limit", "RATE_LIMITED", row=None,
                                attempts_remaining=0)
            raise OtpError(
                "RATE_LIMITED",
                "Too many incorrect OTP attempts. Please try again later.",
                status=429, retry_after=failure_window, reason="failure_limit",
            )

        row = conn.execute(
            "SELECT * FROM otp_codes WHERE mobile_e164=? AND purpose=? ORDER BY id DESC LIMIT 1",
            (e164, purpose),
        ).fetchone()

        if not row:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose,
                         detail="reason=no_otp_row")
            _log_verify_failure(e164, "no_otp_row", "OTP_INVALID", row=None)
            raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                           status=401, reason="no_otp_row")

        status = row["status"]
        expires_at = _parse_iso(row["expires_at"])
        row_age = _row_age_seconds(row)

        if status == _STATUS_USED:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_REPLAY", purpose=purpose,
                         detail="reason=used")
            _log_verify_failure(e164, "used", "OTP_ALREADY_USED", row=row)
            raise OtpError("OTP_ALREADY_USED", "This OTP has already been used. Please request a new one.",
                           status=401, reason="used")

        if status in (_STATUS_INVALIDATED, _STATUS_SEND_FAILED):
            # A send failure or a superseded OTP: the farmer cannot have a code.
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose,
                         detail=f"reason=status={status}")
            _log_verify_failure(e164, f"status={status}", "OTP_INVALID", row=row)
            raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                           status=401, reason=f"status={status}")

        if status == _STATUS_LOCKED:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_LOCKED", purpose=purpose,
                         detail="reason=locked")
            _log_verify_failure(e164, "locked", "OTP_LOCKED", row=row)
            raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                           status=429, retry_after=resend_cooldown_seconds(), reason="locked")

        if status == _STATUS_EXPIRED or (expires_at and expires_at <= now):
            conn.execute("UPDATE otp_codes SET status=? WHERE id=? AND status=?",
                         (_STATUS_EXPIRED, row["id"], _STATUS_ACTIVE))
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_EXPIRED", purpose=purpose,
                         detail="reason=expired")
            _log_verify_failure(e164, "expired", "OTP_EXPIRED", row=row, row_age=row_age)
            raise OtpError("OTP_EXPIRED", "This OTP has expired. Please request a new one.",
                           status=401, reason="expired")

        max_attempts = int(row["max_attempts"] or otp_max_attempts())
        attempts = int(row["attempts"] or 0)
        if attempts >= max_attempts:
            conn.execute("UPDATE otp_codes SET status=? WHERE id=? AND status=?",
                         (_STATUS_LOCKED, row["id"], _STATUS_ACTIVE))
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_LOCKED", purpose=purpose,
                         detail="reason=attempts_exhausted")
            _log_verify_failure(e164, "attempts_exhausted", "OTP_LOCKED", row=row)
            raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                           status=429, retry_after=resend_cooldown_seconds(),
                           reason="attempts_exhausted")

        # --- compare the submitted code --------------------------------------
        if not _constant_time_match(submitted, row["otp_salt"], row["otp_hash"]):
            # Distinguish "wrong code" from "the pepper changed underneath us"
            # (rotated OTP_PEPPER, or a per-process ephemeral pepper with more
            # than one Gunicorn worker). The latter fails every valid OTP.
            reason = "code_mismatch"
            stored_fingerprint = _row_value(row, "pepper_fingerprint")
            if stored_fingerprint and stored_fingerprint != pepper_fingerprint():
                reason = "pepper_mismatch"
            remaining = max(0, max_attempts - (attempts + 1))
            new_status = _STATUS_LOCKED if remaining <= 0 else _STATUS_ACTIVE
            conn.execute(
                "UPDATE otp_codes SET attempts = attempts + 1, status=? WHERE id=? AND status IN (?, ?)",
                (new_status, row["id"], _STATUS_ACTIVE, _STATUS_LOCKED),
            )
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose,
                         detail=f"reason={reason} attempts_remaining={remaining}")
            _log_verify_failure(e164, reason, "OTP_INVALID", row=row,
                                attempts_remaining=remaining, row_age=row_age)
            if reason == "pepper_mismatch":
                logger.error(
                    "otp_pepper_mismatch recipient=%s pepper_source=%s stored_fingerprint=%s "
                    "current_fingerprint=%s user_action=set_a_stable_OTP_PEPPER_and_reissue",
                    sms_gateway.mask_phone(e164), pepper_source(), stored_fingerprint,
                    pepper_fingerprint(),
                )
            if new_status == _STATUS_LOCKED:
                raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                               status=429, retry_after=resend_cooldown_seconds(), reason=reason)
            raise OtpError("OTP_INVALID", "The OTP is incorrect. Please check and try again.",
                           status=401, reason=reason)

        # --- atomic single-use consumption ------------------------------------
        consumed_at = _iso(now)
        cursor = conn.execute(
            "UPDATE otp_codes SET status=?, consumed_at=?, attempts=attempts+1 "
            "WHERE id=? AND status=?",
            (_STATUS_USED, consumed_at, row["id"], _STATUS_ACTIVE),
        )
        if cursor.rowcount != 1:
            # Lost a race (concurrent verify or a concurrent new OTP).
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_REPLAY", purpose=purpose,
                         detail="reason=consumption_race")
            _log_verify_failure(e164, "consumption_race", "OTP_ALREADY_USED", row=row)
            raise OtpError("OTP_ALREADY_USED", "This OTP has already been used. Please request a new one.",
                           status=401, reason="consumption_race")

        user = None
        row_user_id = _row_value(row, "user_id")
        if row_user_id is not None:
            user = conn.execute("SELECT * FROM users WHERE id=?", (row_user_id,)).fetchone()
            if not user or user["role"] != FARMER_ROLE:
                # Defensive: an OTP must never authenticate a non-farmer account.
                _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_ROLE_MISMATCH",
                             purpose=purpose, detail="reason=role_mismatch")
                _log_verify_failure(e164, "role_mismatch", "OTP_INVALID", row=row)
                raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                               status=401, reason="role_mismatch")
        else:
            # Signup OTP: issued for a number without an account yet. Another
            # role may never be signed in through the farmer OTP flow.
            account = conn.execute(
                "SELECT * FROM users WHERE mobile=? OR mobile=? LIMIT 1",
                (e164, e164[-10:]),
            ).fetchone()
            if account and account["role"] != FARMER_ROLE:
                _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_ROLE_MISMATCH",
                             purpose=purpose, detail="reason=role_mismatch_signup")
                _log_verify_failure(e164, "role_mismatch", "OTP_INVALID", row=row)
                raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                               status=401, reason="role_mismatch")
            if account:
                user = account  # registered between request and verify → login

        if user is None:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFIED_SIGNUP", purpose=purpose)
            purge_stale(conn)
            token = issue_registration_token(e164)
            # Bind the token to this OTP row: it is accepted once and only once.
            conn.execute("UPDATE otp_codes SET registration_token_hash=? WHERE id=?",
                         (_token_fingerprint(token), row["id"]))
            conn.commit()
            logger.info(
                "otp_verified_signup purpose=%s recipient=%s otp_id=%s issued_age_seconds=%s "
                "registration_token_ttl=%ss status=verified_unregistered",
                purpose, sms_gateway.mask_phone(e164), row["id"], row_age,
                registration_token_ttl_seconds(),
            )
            return {
                "user": None,
                "user_id": None,
                "registration_required": True,
                "registration_token": token,
                "mobile_e164": e164,
                "role": FARMER_ROLE,
                "consumed_at": consumed_at,
            }

        _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFIED", purpose=purpose)
        purge_stale(conn)
        logger.info(
            "otp_verified user_id=%s purpose=%s recipient=%s otp_id=%s issued_age_seconds=%s",
            user["id"], purpose, sms_gateway.mask_phone(e164), row["id"], row_age,
        )
        return {"user": dict(user), "user_id": user["id"], "consumed_at": consumed_at}
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover - defensive
            pass


# --------------------------------------------------------------------------
# Introspection for the API/UI layer
# --------------------------------------------------------------------------
def otp_login_blockers() -> list[str]:
    """Configuration problems that would make OTP login fail (secret-free).

    ``SMS_GATEWAY_NOT_CONFIGURED``  gateway disabled / unusable / MOCK in prod.
                                    Ignored while demo mode is on, because the
                                    demo farmer never receives an SMS.
    ``OTP_PEPPER_UNSTABLE``         no stable pepper ⇒ valid codes fail with 401
                                    whenever more than one worker is running.
                                    Still applies in demo mode: the demo code is
                                    stored as a normal peppered hash.
    """
    blockers: list[str] = []
    try:
        gateway_usable = sms_gateway.get_gateway_config().is_usable
    except Exception:  # pragma: no cover - defensive
        gateway_usable = False
    if not gateway_usable and not demo_auth.demo_mode_enabled():
        blockers.append("SMS_GATEWAY_NOT_CONFIGURED")
    try:
        production = sms_gateway.is_production()
    except Exception:  # pragma: no cover - defensive
        production = False
    if production and not pepper_is_stable():
        blockers.append("OTP_PEPPER_UNSTABLE")
    return blockers


def otp_login_status() -> dict:
    """Non-secret readiness snapshot: is OTP login able to work at all?"""
    blockers = otp_login_blockers()
    try:
        gateway_info = sms_gateway.get_gateway_config().public_info()
    except Exception:  # pragma: no cover - defensive
        gateway_info = {}
    return {
        "ready": not blockers,
        "blockers": blockers,
        "pepper_source": pepper_source(),
        "pepper_stable": pepper_is_stable(),
        "gateway": gateway_info,
    }


def otp_login_available() -> bool:
    """True when an OTP can actually be issued *and* later verified."""
    return otp_login_status()["ready"]


def public_settings() -> dict:
    """Non-secret OTP settings for the login UI."""
    return {
        "otp_login_enabled": otp_login_available(),
        "otp_length": OTP_LENGTH,
        "otp_ttl_seconds": otp_ttl_seconds(),
        "resend_cooldown_seconds": resend_cooldown_seconds(),
        "max_attempts": otp_max_attempts(),
        "pepper_stable": pepper_is_stable(),
        # Prototype demo account. Carries a number and a code only while demo
        # mode is explicitly enabled; otherwise it is just {"enabled": false}.
        "demo": demo_auth.public_demo_settings(),
    }


# --------------------------------------------------------------------------
# Protected diagnostics (used by the admin endpoint; never exposes secrets)
# --------------------------------------------------------------------------
def _database_diagnostics() -> dict:
    configured_path = (os.environ.get("SIH_DB_PATH") or "").strip()
    on_render = bool(os.environ.get("RENDER"))
    persistent = bool(configured_path) and (not on_render or DB_PATH.startswith("/var/data"))
    info = {
        "path_configured": bool(configured_path),
        # Render mounts persistent disks under /var/data; anything else is wiped
        # on every deploy/restart, which silently destroys in-flight OTPs.
        "persistent_mount_configured": persistent,
        "path_source": "SIH_DB_PATH" if configured_path else "default_in_container",
        "journal_mode": None,
        "writable": False,
        "users_by_role": {},
    }
    conn = None
    try:
        conn = get_db()
        info["journal_mode"] = conn.execute("PRAGMA journal_mode").fetchone()[0]
        info["users_by_role"] = {
            row["role"]: row["c"] for row in
            conn.execute("SELECT role, COUNT(*) c FROM users GROUP BY role").fetchall()
        }
        info["writable"] = True
    except Exception as exc:  # pragma: no cover - defensive
        info["error"] = type(exc).__name__
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return info


def diagnostics(mobile_raw=None, *, recent_limit: int = 5) -> dict:
    """Secret-free OTP diagnostics for one (masked) mobile number.

    Answers, file-free: is this number a registered farmer, does an OTP row
    exist, what is its status/attempts/expiry, was the SMS accepted by the
    gateway (message id/state), and does the stored pepper fingerprint still
    match this process. No code, hash, salt, credential or full number is ever
    returned — only counts, states and a masked recipient.
    """
    e164 = normalize_mobile(mobile_raw) if mobile_raw else None
    status = otp_login_status()
    report = {
        "generated_at": _iso(_utcnow()),
        "process_id": os.getpid(),
        "otp": {
            "ready": status["ready"],
            "blockers": status["blockers"],
            "pepper_source": status["pepper_source"],
            "pepper_stable": status["pepper_stable"],
            "pepper_fingerprint": pepper_fingerprint(),
            "hash_iterations": hash_iterations(),
            "ttl_seconds": otp_ttl_seconds(),
            "max_attempts": otp_max_attempts(),
            "resend_cooldown_seconds": resend_cooldown_seconds(),
            "gateway": status["gateway"],
        },
        "database": _database_diagnostics(),
        "mobile_masked": sms_gateway.mask_phone(e164) if e164 else None,
        "owner_registered": None,
        "latest_otp": None,
        "recent_events": [],
        "gateway_status_endpoint": None,
    }
    if not e164:
        return report

    conn = None
    try:
        conn = get_db()
        report["owner_registered"] = bool(conn.execute(
            "SELECT 1 FROM users WHERE role=? AND (mobile=? OR mobile=?) LIMIT 1",
            (FARMER_ROLE, e164, e164[-10:]),
        ).fetchone())
        row = conn.execute(
            "SELECT * FROM otp_codes WHERE mobile_e164=? AND purpose=? ORDER BY id DESC LIMIT 1",
            (e164, PURPOSE_FARMER_LOGIN),
        ).fetchone()
        if row:
            stored_fingerprint = _row_value(row, "pepper_fingerprint")
            report["latest_otp"] = {
                "id": row["id"],
                "status": row["status"],
                "attempts": row["attempts"],
                "max_attempts": row["max_attempts"],
                "created_at": row["created_at"],
                "expires_at": row["expires_at"],
                "consumed_at": _row_value(row, "consumed_at"),
                "age_seconds": _row_age_seconds(row),
                "expired": bool((_parse_iso(row["expires_at"]) or _utcnow()) <= _utcnow()),
                "device_pinned": bool(_row_value(row, "gateway_device_configured")),
                "gateway_mode": _row_value(row, "gateway_mode"),
                "gateway_state": _row_value(row, "gateway_state"),
                "gateway_http_status": _row_value(row, "gateway_http_status"),
                "gateway_message_id": _row_value(row, "gateway_message_id"),
                "send_error_code": _row_value(row, "send_error_code"),
                "send_error_category": _row_value(row, "send_error_category"),
                "pepper_fingerprint": stored_fingerprint,
                # False ⇒ this process cannot verify the row (pepper changed).
                "pepper_fingerprint_matches": (
                    None if not stored_fingerprint
                    else stored_fingerprint == pepper_fingerprint()
                ),
            }
            message_id = _row_value(row, "gateway_message_id")
            if message_id:
                try:
                    report["gateway_status_endpoint"] = (
                        sms_gateway.get_gateway_config().message_status_endpoint(message_id)
                    )
                except Exception:  # pragma: no cover - defensive
                    report["gateway_status_endpoint"] = None
        report["recent_events"] = [
            {
                "outcome": event["outcome"],
                "created_at": event["created_at"],
                "gateway_http_status": _row_value(event, "gateway_http_status"),
                "gateway_state": _row_value(event, "gateway_state"),
                "error_category": _row_value(event, "error_category"),
                "detail": event["detail"],
            }
            for event in conn.execute(
                "SELECT * FROM otp_request_log WHERE mobile_e164=? ORDER BY id DESC LIMIT ?",
                (e164, max(1, min(20, recent_limit))),
            ).fetchall()
        ]
    except Exception as exc:  # pragma: no cover - defensive
        report["error"] = type(exc).__name__
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return report
