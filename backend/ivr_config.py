"""Central, validated configuration for the Pashu-Shield helpline."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

OFFICIAL_HELPLINE_NUMBER = "7382210251"
SUPPORTED_LANGUAGES = ("en", "te", "hi", "mr")
LANGUAGE_NAMES = {
    "en": "English",
    "te": "Telugu",
    "hi": "Hindi",
    "mr": "Marathi",
}


def _bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def normalize_indian_number(value: str | None) -> str | None:
    """Return a canonical Indian E.164 number without inventing caller identity."""
    if not value:
        return None
    digits = re.sub(r"\D", "", str(value))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10:
        digits = "91" + digits
    if len(digits) == 12 and digits.startswith("91"):
        return "+" + digits
    return None


def local_number(value: str | None) -> str | None:
    normalized = normalize_indian_number(value)
    return normalized[-10:] if normalized else None


@dataclass(frozen=True)
class IvrSettings:
    phone_number: str
    helpline_e164: str
    display_number: str
    provider_mode: str
    pstn_connected: bool
    pstn_verified_at: str | None
    work_start_hour: int
    work_end_hour: int
    max_active_cases: int
    stale_minutes: int
    duplicate_window_hours: int
    allow_outside_hours_fallback: bool

    @property
    def tel_uri(self) -> str:
        return f"tel:{self.helpline_e164}"


def get_ivr_settings() -> IvrSettings:
    configured = re.sub(r"\D", "", os.environ.get("IVR_PHONE_NUMBER", OFFICIAL_HELPLINE_NUMBER))
    if configured != OFFICIAL_HELPLINE_NUMBER:
        raise RuntimeError(
            f"IVR_PHONE_NUMBER must remain the official Pashu-Shield number {OFFICIAL_HELPLINE_NUMBER}"
        )

    provider_mode = os.environ.get("IVR_PROVIDER_MODE", "MOCK").strip().upper()
    if provider_mode not in {"MOCK", "SIP_PBX"}:
        raise RuntimeError("IVR_PROVIDER_MODE must be MOCK or SIP_PBX")

    verified_at = (os.environ.get("IVR_PSTN_VERIFIED_AT") or "").strip() or None
    # Connectivity is only reportable after both SIP/PBX configuration and a
    # separately recorded real-phone verification. The repository sets neither.
    pstn_connected = bool(
        provider_mode == "SIP_PBX"
        and _bool_env("IVR_PSTN_CONNECTED", False)
        and verified_at
    )

    return IvrSettings(
        phone_number=OFFICIAL_HELPLINE_NUMBER,
        helpline_e164=f"+91{OFFICIAL_HELPLINE_NUMBER}",
        display_number=f"+91 {OFFICIAL_HELPLINE_NUMBER[:5]} {OFFICIAL_HELPLINE_NUMBER[5:]}",
        provider_mode=provider_mode,
        pstn_connected=pstn_connected,
        pstn_verified_at=verified_at,
        work_start_hour=_int_env("VET_WORK_START_HOUR", 0, 0, 23),
        work_end_hour=_int_env("VET_WORK_END_HOUR", 24, 1, 24),
        max_active_cases=_int_env("VET_MAX_ACTIVE_CASES", 25, 1, 500),
        stale_minutes=_int_env("VET_LIVE_CALL_STALE_MINUTES", 30, 1, 1440),
        duplicate_window_hours=_int_env("IVR_DUPLICATE_WINDOW_HOURS", 48, 1, 720),
        allow_outside_hours_fallback=_bool_env("IVR_ALLOW_OUTSIDE_HOURS_FALLBACK", False),
    )
