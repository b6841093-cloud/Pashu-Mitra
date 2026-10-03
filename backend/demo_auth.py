"""Prototype demo farmer login — an explicitly gated, fixed-OTP demo account.

WHY THIS EXISTS
===============
A live prototype demonstration must not depend on a real SMS reaching a real
handset. This module provides exactly one extra capability on top of the
existing farmer OTP architecture: when demo mode is switched **on**, the one
configured demo mobile number may be issued an OTP whose code is the fixed
value ``DEMO_FARMER_OTP`` (default ``123456``) and the SMS is never dispatched.

WHAT THIS IS NOT
================
* It is not a second authentication system. The fixed code is never checked
  against a request body. A real ``otp_codes`` row is created for the demo
  number, carrying the normal PBKDF2+pepper hash, TTL, attempt counter and
  single-use consumption. Verification therefore runs through the *unchanged*
  :func:`otp_service.verify_otp` path, and the session JWT is minted by the
  unchanged :func:`app.make_token` from the database row, exactly like a
  normal OTP login. Authorization is therefore untouched.
* It is not automatic. The fixed code only ever exists as the hash of a row
  that ``otp_service.request_otp`` created *because* demo mode was enabled for
  that number. Calling ``verify-otp`` with the demo number and ``123456``
  without a prior (demo-mode approved) request is rejected with the ordinary
  ``OTP_INVALID`` rules, exactly like any wrong code.
* It is not on by default. ``DEMO_MODE`` defaults to ``false``.
* It is not a production default. On a process that looks like production
  (``RENDER`` / ``FLASK_ENV=production`` / ``APP_ENV=production``) demo mode
  additionally requires an explicit second opt-in,
  ``DEMO_MODE_ALLOW_PRODUCTION=true``, so a public deployment can never
  silently expose a universal fixed OTP.

SECURITY PROPERTIES
===================
* Configuration is read on every call, so a restart is never required and
  tests can toggle the flag per test.
* The demo account is a normal ``role='owner'`` farmer row with a
  non-authenticating password (``database.otp_only_credentials``), so the
  password login route — which already refuses every farmer — can never be
  used with it. Vet / Government / Laboratory accounts are never touched.
* Account creation is idempotent and single: repeated demo logins reuse the
  same row, and a pre-existing non-farmer row on the demo number is refused
  rather than overwritten.
* Nothing here logs, returns or stores the fixed code outside the hashed OTP
  row, and no OTP, password or token is ever written to a log line.
"""
from __future__ import annotations

import logging
import os

import sms_gateway
from database import otp_only_credentials
from ivr_config import normalize_indian_number

logger = logging.getLogger(__name__)

# --------------------------------------------------------------- settings --
DEMO_MODE_ENV = "DEMO_MODE"
DEMO_MODE_ALLOW_PRODUCTION_ENV = "DEMO_MODE_ALLOW_PRODUCTION"

# Documented prototype credentials. They are configuration, not secrets: the
# whole point of the demo account is that they are printed on the login screen.
# They are kept out of the OTP pepper, the JWT secret and every real user row.
DEFAULT_DEMO_MOBILE = "9999999999"
DEFAULT_DEMO_OTP = "123456"
DEFAULT_DEMO_FARMER_NAME = "Demo Farmer"
DEFAULT_DEMO_DISTRICT = "Pune"
# The account's non-routable placeholder email is derived from the configured
# number (see ensure_demo_farmer) unless DEMO_FARMER_EMAIL is set explicitly.

FARMER_ROLE = "owner"   # the farmer / animal-owner role (unchanged)
OTP_LENGTH = 6          # the fixed code must match the OTP length used everywhere

_TRUE_VALUES = {"1", "true", "yes", "on"}
_FALSE_VALUES = {"0", "false", "no", "off", ""}

DEMO_DISABLED = "DEMO_MODE_DISABLED"
DEMO_DISABLED_IN_PRODUCTION = "DEMO_MODE_DISABLED_IN_PRODUCTION"


def _env_flag(name: str, default: bool = False) -> bool:
    """Parse a boolean environment flag. Anything unrecognised is False."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in _FALSE_VALUES:
        return False
    if value in _TRUE_VALUES:
        return True
    logger.warning("Ignoring unrecognised boolean value for %s", name)
    return False


def demo_mode_requested() -> bool:
    """True when ``DEMO_MODE`` is explicitly switched on (default: False)."""
    return _env_flag(DEMO_MODE_ENV, False)


def demo_mode_allowed_in_production() -> bool:
    """Second, explicit opt-in required to run demo mode on a public process."""
    return _env_flag(DEMO_MODE_ALLOW_PRODUCTION_ENV, False)


def demo_mode_enabled() -> bool:
    """The single gate every demo code path checks.

    False unless ``DEMO_MODE=true`` *and*, on a process that identifies as
    production, ``DEMO_MODE_ALLOW_PRODUCTION=true``.
    """
    if not demo_mode_requested():
        return False
    if sms_gateway.is_production() and not demo_mode_allowed_in_production():
        return False
    return True


def demo_mode_status() -> dict:
    """Secret-free snapshot of the demo configuration (safe for /api/health)."""
    requested = demo_mode_requested()
    production = sms_gateway.is_production()
    allowed = demo_mode_allowed_in_production()
    if not requested:
        disabled_reason = DEMO_DISABLED
    elif production and not allowed:
        disabled_reason = DEMO_DISABLED_IN_PRODUCTION
    else:
        disabled_reason = None
    return {
        "enabled": disabled_reason is None and requested,
        "requested": requested,
        "production_process": production,
        "production_override": allowed,
        "disabled_reason": disabled_reason,
        "mobile_configured": bool(demo_farmer_mobile()),
        # A misconfigured number or code leaves the demo login unusable; the
        # flag above still reports what was asked for.
        "usable": (disabled_reason is None and requested
                   and bool(demo_farmer_mobile())
                   and (os.environ.get("DEMO_FARMER_OTP") or DEFAULT_DEMO_OTP).strip().isdigit()),
    }


# ----------------------------------------------------------- demo account --
def demo_farmer_mobile() -> str | None:
    """The configured demo number in E.164 form, or None when unparseable."""
    return normalize_indian_number(
        os.environ.get("DEMO_FARMER_MOBILE") or DEFAULT_DEMO_MOBILE
    )


def demo_farmer_otp() -> str | None:
    """The fixed demo code — only ever callable from the request path.

    Returns ``None`` when demo mode is off (so a disabled deployment cannot
    produce the code even if a caller asks for it) and when the configured
    value is not a six-digit code, which would make verification impossible.
    A misconfiguration therefore fails closed instead of issuing a code that
    no client could ever submit.
    """
    if not demo_mode_enabled():
        return None
    code = (os.environ.get("DEMO_FARMER_OTP") or DEFAULT_DEMO_OTP).strip()
    if not code.isdigit() or len(code) != OTP_LENGTH:
        logger.error(
            "DEMO_FARMER_OTP must be exactly %d digits; the demo login stays "
            "disabled for this process.", OTP_LENGTH,
        )
        return None
    return code


def demo_login_configured() -> bool:
    """True when demo mode is on *and* its number and code are both usable."""
    return bool(demo_farmer_mobile()) and demo_farmer_otp() is not None


def is_demo_farmer(mobile_raw) -> bool:
    """True only when demo mode is on *and* the number is the configured one.

    This is the exact pair of conditions the prompt requires: the flag decides,
    the number only selects. Using the demo number alone changes nothing.
    """
    if not demo_login_configured():
        return False
    e164 = normalize_indian_number(mobile_raw)
    return bool(e164) and e164 == demo_farmer_mobile()


def ensure_demo_farmer(conn):
    """Create or retrieve the demo farmer. Idempotent — never duplicates.

    Returns the ``sqlite3.Row`` for the ``role='owner'`` account, or ``None``
    when the configured demo number is unusable (unparseable, or already taken
    by a Vet / Government / Laboratory account, which is never overwritten).
    """
    e164 = demo_farmer_mobile()
    if not e164:
        logger.error("DEMO_MODE is on but DEMO_FARMER_MOBILE is not a valid number")
        return None
    local = e164[-10:]

    existing = conn.execute(
        "SELECT * FROM users WHERE mobile=? OR mobile=? ORDER BY id LIMIT 1",
        (e164, local),
    ).fetchone()
    if existing:
        if existing["role"] != FARMER_ROLE:
            # Fail closed: a staff account must never be turned into (or used
            # as) the demo farmer, and a demo login must never reach it.
            logger.error(
                "Demo login refused: the configured demo number is held by a "
                "%s account. Choose a different DEMO_FARMER_MOBILE.",
                existing["role"],
            )
            return None
        return existing

    password_hash, salt = otp_only_credentials()   # can never authenticate
    # ``users.email`` is UNIQUE NOT NULL. The placeholder is derived from the
    # number so pointing DEMO_FARMER_MOBILE at another number can never collide
    # with the account left by a previous configuration. It is non-routable and
    # is not an authentication identifier for farmers.
    email = (os.environ.get("DEMO_FARMER_EMAIL") or "").strip() or \
        f"demo.farmer.{local}@pashumitra.local"
    full_name = (os.environ.get("DEMO_FARMER_NAME") or DEFAULT_DEMO_FARMER_NAME).strip()
    district = (os.environ.get("DEMO_FARMER_DISTRICT") or DEFAULT_DEMO_DISTRICT).strip()
    village = (os.environ.get("DEMO_FARMER_VILLAGE") or "Demo Village").strip()
    block = (os.environ.get("DEMO_FARMER_BLOCK") or "Haveli").strip()
    try:
        conn.execute(
            "INSERT INTO users (full_name, mobile, email, password_hash, salt, role, "
            "preferred_language, village, block, district, state) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,'Maharashtra')",
            (full_name, local, email, password_hash, salt, FARMER_ROLE,
             None, village, block, district),
        )
    except Exception as exc:  # a concurrent worker won the insert — reuse its row
        if getattr(conn, "in_transaction", False):
            conn.rollback()
        row = conn.execute(
            "SELECT * FROM users WHERE mobile=? OR mobile=? ORDER BY id LIMIT 1",
            (e164, local),
        ).fetchone()
        if row is not None and row["role"] == FARMER_ROLE:
            return row
        # Never the exception message: it can embed a row value. The type and
        # the (masked) number are enough for the operator to act on.
        logger.error(
            "Could not create the demo farmer account (error=%s, mobile=%s)",
            type(exc).__name__, sms_gateway.mask_phone(e164),
        )
        return None
    row = conn.execute(
        "SELECT * FROM users WHERE mobile=? OR mobile=? ORDER BY id LIMIT 1",
        (e164, local),
    ).fetchone()
    logger.info(
        "Demo farmer account created (mobile=%s, role=owner). It is reused by "
        "every later demo login; no password is set.",
        sms_gateway.mask_phone(e164),
    )
    return row


def public_demo_settings() -> dict:
    """The demo block served to the farmer login screen.

    The fixed code is returned **only** while demo mode is active — it is a
    deliberately shared prototype credential, not a secret. When demo mode is
    off the block carries no number and no code at all, so the login screen has
    nothing to display and nothing to fill in.
    """
    if not demo_login_configured():
        return {"enabled": False}
    e164 = demo_farmer_mobile()
    return {
        "enabled": True,
        "mobile": e164[-10:] if e164 else None,
        "otp": demo_farmer_otp(),
        "fixed_code": True,
        "notice": "Prototype demo account — no real SMS is sent for this number.",
    }


def log_demo_mode_banner() -> None:
    """Log a loud, secret-free warning at startup when demo mode is active."""
    status = demo_mode_status()
    if not status["enabled"]:
        if status["requested"] and status["disabled_reason"] == DEMO_DISABLED_IN_PRODUCTION:
            logger.error(
                "%s=true was requested but this process is a production process; "
                "the fixed demo OTP stays DISABLED unless %s=true is also set. "
                "See DEMO_ACCOUNT.md.",
                DEMO_MODE_ENV, DEMO_MODE_ALLOW_PRODUCTION_ENV,
            )
        return
    logger.warning(
        "*** DEMO MODE IS ENABLED *** the fixed demo farmer OTP is accepted for "
        "mobile=%s on this %s process. Anyone who knows the number can sign in. "
        "Set %s=false (and %s=false) before any public production use.",
        sms_gateway.mask_phone(demo_farmer_mobile() or ""),
        "production" if status["production_process"] else "development",
        DEMO_MODE_ENV, DEMO_MODE_ALLOW_PRODUCTION_ENV,
    )
