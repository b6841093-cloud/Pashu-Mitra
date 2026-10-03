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

TABLES (created additively by ``database.init_db``)
==================================================
``otp_codes``        one row per issued OTP (hash, salt, attempts, status)
``otp_request_log``  rate-limiting / audit trail for requests and verifications
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import threading
from datetime import datetime, timedelta, timezone

import sms_gateway
from database import get_db
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
    """Raised for expected OTP flow failures with a safe, stable error code."""

    def __init__(self, code: str, message: str, *, status: int = 400,
                 retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after

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
        _int_env("OTP_HASH_ITERATIONS", DEFAULT_HASH_ITERATIONS, minimum=1_000, maximum=1_000_000),
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
                 purpose: str, detail: str | None = None) -> None:
    conn.execute(
        "INSERT INTO otp_request_log (mobile_e164, ip_address, outcome, purpose, detail, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (mobile, ip, outcome, purpose, (detail or "")[:200], _iso(_utcnow())),
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
                purpose: str = PURPOSE_FARMER_LOGIN) -> dict:
    """Issue (and send) a new login OTP for an existing farmer account.

    Returns a dict with ``status`` and timing metadata. It never raises for an
    unknown or non-farmer number — the caller must return an identical, generic
    response to avoid account enumeration.

    Raises :class:`OtpError` for invalid input, rate limits, cooldown, and for
    real SMS delivery failures (a failure is never reported as success).
    """
    e164 = normalize_mobile(mobile_raw)
    if not e164:
        raise OtpError("INVALID_MOBILE", "Enter a valid 10-digit Indian mobile number.", status=400)

    conn = _open_conn()
    try:
        now = _utcnow()
        mobile_window = _int_env("OTP_MOBILE_RATE_WINDOW_SECONDS", DEFAULT_MOBILE_WINDOW, minimum=60)
        ip_window = _int_env("OTP_IP_RATE_WINDOW_SECONDS", DEFAULT_IP_WINDOW, minimum=60)
        mobile_max = _int_env("OTP_MOBILE_MAX_REQUESTS", DEFAULT_MOBILE_MAX_REQUESTS, minimum=1)
        ip_max = _int_env("OTP_IP_MAX_REQUESTS", DEFAULT_IP_MAX_REQUESTS, minimum=1)

        # --- rate limits (per mobile, then per client IP) --------------------
        recent_mobile = conn.execute(
            "SELECT COUNT(*) AS c FROM otp_request_log WHERE mobile_e164=? AND created_at >= ? "
            "AND outcome IN ('SENT','SEND_FAILED','UNKNOWN_ACCOUNT')",
            (e164, _iso(now - timedelta(seconds=mobile_window))),
        ).fetchone()["c"]
        if recent_mobile >= mobile_max:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="RATE_LIMITED", purpose=purpose)
            raise OtpError(
                "RATE_LIMITED",
                "Too many OTP requests for this number. Please try again later.",
                status=429, retry_after=mobile_window,
            )

        if ip:
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
        cooldown = resend_cooldown_seconds()
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
        user = conn.execute(
            "SELECT * FROM users WHERE role=? AND (mobile=? OR mobile=?) LIMIT 1",
            (FARMER_ROLE, e164_form, local_form),
        ).fetchone()

        if not user:
            # Anti-enumeration: identical success shape, no SMS is sent.
            _log_attempt(conn, mobile=e164, ip=ip, outcome="UNKNOWN_ACCOUNT", purpose=purpose)
            purge_stale(conn)
            return {
                "status": "ACCEPTED",
                "sent": False,
                "expires_in": otp_ttl_seconds(),
                "resend_after": cooldown,
            }

        # --- issue the OTP ---------------------------------------------------
        code = generate_otp()
        salt = secrets.token_hex(16)
        otp_hash = hash_otp(code, salt)
        expires_at = now + timedelta(seconds=otp_ttl_seconds())

        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                "UPDATE otp_codes SET status=? WHERE user_id=? AND purpose=? AND status=?",
                (_STATUS_INVALIDATED, user["id"], purpose, _STATUS_ACTIVE),
            )
            cursor = conn.execute(
                "INSERT INTO otp_codes (user_id, role, mobile_e164, otp_hash, otp_salt, purpose, "
                "attempts, max_attempts, status, created_at, expires_at, request_ip) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (user["id"], user["role"], e164, otp_hash, salt, purpose,
                 0, otp_max_attempts(), _STATUS_ACTIVE, _iso(now), _iso(expires_at), ip),
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
            delivery = _send_otp_sms(e164, code, user["preferred_language"], purpose)
        except sms_gateway.SmsGatewayError as exc:
            # Never claim delivery; the issued OTP is unusable and is retired.
            conn.execute(
                "UPDATE otp_codes SET status=? WHERE id=? AND status=?",
                (_STATUS_SEND_FAILED, otp_id, _STATUS_ACTIVE),
            )
            _log_attempt(conn, mobile=e164, ip=ip, outcome="SEND_FAILED", purpose=purpose,
                         detail=exc.code)
            logger.error(
                "OTP SMS delivery failed for user_id=%s (code=%s, gateway_status=%s)",
                user["id"], exc.code, getattr(exc, "status", None),
            )
            safe_status = 503 if exc.code == "SMS_GATEWAY_NOT_CONFIGURED" else 502
            raise OtpError(
                exc.code,
                "We could not send the OTP SMS right now. Please try again shortly.",
                status=safe_status,
            ) from exc

        mode = str(delivery.get("mode") or "").upper()
        _log_attempt(conn, mobile=e164, ip=ip, outcome="SENT", purpose=purpose,
                     detail=f"mode={mode}")
        logger.info(
            "OTP issued for user_id=%s (purpose=%s, mode=%s, simulated=%s, expires_in=%ss)",
            user["id"], purpose, mode, bool(delivery.get("simulated")), otp_ttl_seconds(),
        )
        purge_stale(conn)
        return {
            "status": "SENT",
            "sent": True,
            "simulated": bool(delivery.get("simulated")),
            "expires_in": otp_ttl_seconds(),
            "resend_after": cooldown,
        }
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover - defensive
            pass


def resend_otp(mobile_raw, *, ip: str | None = None,
               purpose: str = PURPOSE_FARMER_LOGIN) -> dict:
    """Resend an OTP — identical to :func:`request_otp` but intended for the
    explicit "resend" action; the shared 60-second cooldown still applies."""
    return request_otp(mobile_raw, ip=ip, purpose=purpose)


# --------------------------------------------------------------------------
# Public API: verify
# --------------------------------------------------------------------------
def verify_otp(mobile_raw, code, *, ip: str | None = None,
               purpose: str = PURPOSE_FARMER_LOGIN) -> dict:
    """Verify an OTP and atomically consume it.

    On success returns the authenticated farmer record as a dict:
    ``{"user": {...}, "user_id": int, "consumed_at": iso}``.

    The generic failure codes (:class:`OtpError`) are: ``INVALID_MOBILE``,
    ``OTP_INVALID``, ``OTP_EXPIRED``, ``OTP_LOCKED``, ``OTP_ALREADY_USED``,
    ``RATE_LIMITED``. Unknown numbers report ``OTP_INVALID`` / ``OTP_EXPIRED``
    exactly like a wrong code, so nothing is revealed about registration.
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
        failure_window = _int_env("OTP_FAILURE_WINDOW_SECONDS", DEFAULT_MOBILE_WINDOW, minimum=60)
        failures = _count_since(
            conn, "otp_request_log", "mobile_e164", e164,
            now - timedelta(seconds=failure_window),
            "AND outcome='VERIFY_FAILED'",
        )
        max_failures = _int_env("OTP_MAX_VERIFY_FAILURES", DEFAULT_MOBILE_MAX_FAILURES, minimum=1)
        if failures >= max_failures:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_RATE_LIMITED", purpose=purpose)
            raise OtpError(
                "RATE_LIMITED",
                "Too many incorrect OTP attempts. Please try again later.",
                status=429, retry_after=failure_window,
            )

        row = conn.execute(
            "SELECT * FROM otp_codes WHERE mobile_e164=? AND purpose=? ORDER BY id DESC LIMIT 1",
            (e164, purpose),
        ).fetchone()

        if not row:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose,
                         detail="no_otp")
            raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                           status=401)

        status = row["status"]
        expires_at = _parse_iso(row["expires_at"])

        if status == _STATUS_USED:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_REPLAY", purpose=purpose)
            raise OtpError("OTP_ALREADY_USED", "This OTP has already been used. Please request a new one.",
                           status=401)

        if status in (_STATUS_INVALIDATED, _STATUS_SEND_FAILED):
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose,
                         detail=f"status={status}")
            raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                           status=401)

        if status == _STATUS_LOCKED:
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_LOCKED", purpose=purpose)
            raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                           status=429, retry_after=resend_cooldown_seconds())

        if status == _STATUS_EXPIRED or (expires_at and expires_at <= now):
            conn.execute("UPDATE otp_codes SET status=? WHERE id=? AND status=?",
                         (_STATUS_EXPIRED, row["id"], _STATUS_ACTIVE))
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_EXPIRED", purpose=purpose)
            raise OtpError("OTP_EXPIRED", "This OTP has expired. Please request a new one.", status=401)

        max_attempts = int(row["max_attempts"] or otp_max_attempts())
        attempts = int(row["attempts"] or 0)
        if attempts >= max_attempts:
            conn.execute("UPDATE otp_codes SET status=? WHERE id=? AND status=?",
                         (_STATUS_LOCKED, row["id"], _STATUS_ACTIVE))
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_LOCKED", purpose=purpose)
            raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                           status=429, retry_after=resend_cooldown_seconds())

        # --- compare the submitted code --------------------------------------
        if not _constant_time_match(submitted, row["otp_salt"], row["otp_hash"]):
            remaining = max(0, max_attempts - (attempts + 1))
            new_status = _STATUS_LOCKED if remaining <= 0 else _STATUS_ACTIVE
            conn.execute(
                "UPDATE otp_codes SET attempts = attempts + 1, status=? WHERE id=? AND status IN (?, ?)",
                (new_status, row["id"], _STATUS_ACTIVE, _STATUS_LOCKED),
            )
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_FAILED", purpose=purpose)
            if new_status == _STATUS_LOCKED:
                raise OtpError("OTP_LOCKED", "Too many incorrect attempts. Please request a new OTP.",
                               status=429, retry_after=resend_cooldown_seconds())
            raise OtpError("OTP_INVALID", "The OTP is incorrect. Please check and try again.",
                           status=401)

        # --- atomic single-use consumption ------------------------------------
        consumed_at = _iso(now)
        cursor = conn.execute(
            "UPDATE otp_codes SET status=?, consumed_at=?, attempts=attempts+1 "
            "WHERE id=? AND status=?",
            (_STATUS_USED, consumed_at, row["id"], _STATUS_ACTIVE),
        )
        if cursor.rowcount != 1:
            # Lost a race (concurrent verify or a concurrent new OTP).
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_REPLAY", purpose=purpose)
            raise OtpError("OTP_ALREADY_USED", "This OTP has already been used. Please request a new one.",
                           status=401)

        user = conn.execute("SELECT * FROM users WHERE id=?", (row["user_id"],)).fetchone()
        if not user or user["role"] != FARMER_ROLE:
            # Defensive: an OTP must never authenticate a non-farmer account.
            _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFY_ROLE_MISMATCH", purpose=purpose)
            raise OtpError("OTP_INVALID", "The OTP is incorrect or has expired. Please request a new one.",
                           status=401)

        _log_attempt(conn, mobile=e164, ip=ip, outcome="VERIFIED", purpose=purpose)
        purge_stale(conn)
        logger.info("OTP verified for user_id=%s (purpose=%s)", user["id"], purpose)
        return {"user": dict(user), "user_id": user["id"], "consumed_at": consumed_at}
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover - defensive
            pass


# --------------------------------------------------------------------------
# Introspection for the API/UI layer
# --------------------------------------------------------------------------
def otp_login_available() -> bool:
    """True when the SMS gateway can actually deliver an OTP."""
    try:
        return sms_gateway.get_gateway_config().is_usable
    except Exception:  # pragma: no cover - defensive
        return False


def public_settings() -> dict:
    """Non-secret OTP settings for the login UI."""
    return {
        "otp_login_enabled": otp_login_available(),
        "otp_length": OTP_LENGTH,
        "otp_ttl_seconds": otp_ttl_seconds(),
        "resend_cooldown_seconds": resend_cooldown_seconds(),
        "max_attempts": otp_max_attempts(),
    }
