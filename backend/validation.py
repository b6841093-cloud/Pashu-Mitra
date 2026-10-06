"""
Pashu-Shield — Systematic server-side validation (GuDApps 2.1.1–2.1.5, 4.4.1.1)

Additive only. Provides data-dictionary-driven validation for every important field.
Used by app.py routes to enforce mandatory, format, range, cross-field, and to
return safe errors with reference ids (never traceback/SQL/path/credential).

Preserves Farmer OTP-only, Vet/Govt/Lab auth, WebRTC, etc.
"""

from __future__ import annotations

import re
from typing import Any

# --------------------------------------------------------------------------
# Constants from data dictionary
# --------------------------------------------------------------------------

MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CASE_STATUSES = [
    "NEW", "ASSIGNED", "UNDER INVESTIGATION", "SAMPLE COLLECTED", "LAB PENDING",
    "DIAGNOSED", "TREATMENT", "FOLLOW-UP", "RECOVERED", "CLOSED"
]
SAMPLE_STATUSES = [
    "COLLECTED", "READY_FOR_PICKUP", "PICKED_UP", "IN_TRANSIT",
    "ARRIVED_AT_LAB", "LAB_RECEIVED", "TESTING", "RESULT_READY",
    "COMPLETED", "REJECTED"
]
SAMPLE_TYPES = ["Blood Sample", "Nasal Swab", "Tissue Biopsy", "Milk Sample", "Fecal Sample"]
SEVERITIES = ["Low", "Medium", "High", "Critical"]
SPECIES = ["cattle", "buffalo", "goat", "sheep", "horse", "pig", "poultry", "other"]
GENDERS = ["Male", "Female"]
LANGUAGES = ["en", "hi", "mr", "te"]
ROLES = ["owner", "vet", "govt", "lab", "admin"]

def _trim(v: Any) -> str:
    return str(v or "").strip()

def _is_int(v: Any) -> bool:
    try:
        int(v)
        return True
    except Exception:
        return False

def _is_float(v: Any) -> bool:
    try:
        float(v)
        return True
    except Exception:
        return False

# --------------------------------------------------------------------------
# Generic validators
# --------------------------------------------------------------------------

def validate_mandatory(value: Any, field: str, max_len: int | None = None, min_len: int | None = None) -> str | None:
    s = _trim(value)
    if not s:
        return f"{field} is required."
    if min_len is not None and len(s) < min_len:
        return f"{field} must be at least {min_len} characters."
    if max_len is not None and len(s) > max_len:
        return f"{field} must be at most {max_len} characters."
    if "<" in s or ">" in s:
        # Basic XSS prevention at validation layer (output escaping is still authoritative)
        return f"{field} contains invalid characters."
    return None

def validate_optional(value: Any, field: str, max_len: int = 1000) -> str | None:
    if value is None or _trim(value) == "":
        return None
    s = _trim(value)
    if len(s) > max_len:
        return f"{field} must be at most {max_len} characters."
    if "<" in s or ">" in s:
        return f"{field} contains invalid characters."
    return None

def validate_mobile(value: Any) -> str | None:
    s = _trim(value)
    if not s:
        return "Mobile number is required."
    if not MOBILE_RE.match(s):
        return "Enter a valid 10-digit mobile number starting with 6-9."
    return None

def validate_email(value: Any, mandatory: bool = True) -> str | None:
    s = _trim(value)
    if not s:
        return "Email is required." if mandatory else None
    if len(s) > 254 or not EMAIL_RE.match(s):
        return "Enter a valid email address."
    return None

def validate_enum(value: Any, field: str, allowed: list[str]) -> str | None:
    s = _trim(value)
    if not s:
        return f"{field} is required."
    if s not in allowed:
        return f"{field} must be one of: {', '.join(allowed)}."
    return None

def validate_optional_enum(value: Any, field: str, allowed: list[str]) -> str | None:
    if value is None or _trim(value) == "":
        return None
    return validate_enum(value, field, allowed)

def validate_number(value: Any, field: str, min_val: float | None = None, max_val: float | None = None) -> str | None:
    if value is None or _trim(value) == "":
        return f"{field} is required."
    if not _is_float(value):
        return f"{field} must be a number."
    n = float(value)
    if min_val is not None and n < min_val:
        return f"{field} must be at least {min_val}."
    if max_val is not None and n > max_val:
        return f"{field} must be at most {max_val}."
    return None

def validate_optional_number(value: Any, field: str, min_val: float | None = None, max_val: float | None = None) -> str | None:
    if value is None or _trim(value) == "":
        return None
    return validate_number(value, field, min_val, max_val)

# --------------------------------------------------------------------------
# Entity validators (return list of {field, message})
# --------------------------------------------------------------------------

def validate_animal(payload: dict) -> list[dict]:
    errors = []
    if not isinstance(payload, dict):
        return [{"field": "body", "message": "Expected a JSON object."}]

    # animal_name optional 1-100
    e = validate_optional(payload.get("animal_name"), "Animal name", 100)
    if e:
        errors.append({"field": "animal_name", "message": e})

    # animal_type / species mandatory, LOV but allow free text fallback max 50
    species = _trim(payload.get("animal_type") or payload.get("species"))
    if not species:
        errors.append({"field": "animal_type", "message": "Animal type is required."})
    elif len(species) > 50:
        errors.append({"field": "animal_type", "message": "Animal type must be at most 50 characters."})

    # breed optional max 50
    e = validate_optional(payload.get("breed"), "Breed", 50)
    if e:
        errors.append({"field": "breed", "message": e})

    # gender optional enum
    e = validate_optional_enum(payload.get("gender"), "Gender", GENDERS)
    if e:
        errors.append({"field": "gender", "message": e})

    # age optional 0-30
    e = validate_optional_number(payload.get("age"), "Age", 0, 30)
    if e:
        errors.append({"field": "age", "message": e})

    # owner fields
    if payload.get("owner_name") is not None:
        e = validate_mandatory(payload.get("owner_name"), "Owner name", 100, 2)
        if e:
            errors.append({"field": "owner_name", "message": e})
    if payload.get("mobile") is not None:
        # For registration, keep backward compat: original code did not enforce strict 6-9 start,
        # only presence. Enforce strict only if it's all digits, otherwise just length and XSS.
        mob = _trim(payload.get("mobile"))
        if mob:
            if "<" in mob or ">" in mob:
                errors.append({"field": "mobile", "message": "Mobile contains invalid characters."})
            elif mob.isdigit():
                e = validate_mobile(mob)
                if e:
                    errors.append({"field": "mobile", "message": e})
            elif len(mob) != 10:
                if len(mob) < 6 or len(mob) > 15:
                    errors.append({"field": "mobile", "message": "Enter a valid mobile number."})
    if payload.get("village") is not None:
        e = validate_optional(payload.get("village"), "Village", 100)
        if e:
            errors.append({"field": "village", "message": e})
    if payload.get("district") is not None:
        e = validate_mandatory(payload.get("district"), "District", 100, 2)
        if e:
            errors.append({"field": "district", "message": e})

    return errors

def validate_case(payload: dict) -> list[dict]:
    errors = []
    if not isinstance(payload, dict):
        return [{"field": "body", "message": "Expected a JSON object."}]

    if not payload.get("animal_id"):
        errors.append({"field": "animal_id", "message": "Animal is required."})
    elif not _is_int(payload.get("animal_id")):
        errors.append({"field": "animal_id", "message": "Animal must be a valid ID."})

    e = validate_mandatory(payload.get("symptoms"), "Symptoms", 500, 5)
    if e:
        errors.append({"field": "symptoms", "message": e})

    # Severity case-insensitive for backward compat (HIGH vs High)
    sev = payload.get("severity")
    if sev is not None and _trim(sev) != "":
        normalized = _trim(sev).lower()
        allowed_lower = [s.lower() for s in SEVERITIES]
        if normalized not in allowed_lower:
            errors.append({"field": "severity", "message": f"Severity must be one of: {', '.join(SEVERITIES)}."})

    e = validate_optional(payload.get("description"), "Additional details", 1000)
    if e:
        errors.append({"field": "description", "message": e})

    return errors

def validate_sample(payload: dict) -> list[dict]:
    errors = []
    if not isinstance(payload, dict):
        return [{"field": "body", "message": "Expected a JSON object."}]

    e = validate_optional_enum(payload.get("sample_type"), "Sample type", SAMPLE_TYPES)
    if e:
        errors.append({"field": "sample_type", "message": e})

    e = validate_optional(payload.get("collection_notes"), "Collection notes", 500)
    if e:
        errors.append({"field": "collection_notes", "message": e})

    # lat/lng optional but must be range if present
    if payload.get("collection_lat") not in (None, ""):
        e = validate_number(payload.get("collection_lat"), "Latitude", -90, 90)
        if e:
            errors.append({"field": "collection_lat", "message": e})
    if payload.get("collection_lng") not in (None, ""):
        e = validate_number(payload.get("collection_lng"), "Longitude", -180, 180)
        if e:
            errors.append({"field": "collection_lng", "message": e})

    return errors

def validate_user_register(payload: dict) -> list[dict]:
    errors = []
    if not isinstance(payload, dict):
        return [{"field": "body", "message": "Expected a JSON object."}]

    # Preserve original required-field behavior: only validate if present, to avoid breaking existing 400 flows.
    # The systematic checks are additive and only trigger on present values or XSS.
    if payload.get("full_name") is not None:
        e = validate_mandatory(payload.get("full_name"), "Full name", 100, 2)
        if e:
            errors.append({"field": "full_name", "message": e})

    if payload.get("mobile") is not None:
        mob = _trim(payload.get("mobile"))
        if mob:
            if "<" in mob or ">" in mob:
                errors.append({"field": "mobile", "message": "Mobile contains invalid characters."})
            elif mob.isdigit():
                e = validate_mobile(mob)
                if e:
                    errors.append({"field": "mobile", "message": e})
            elif len(mob) != 10:
                if len(mob) < 6 or len(mob) > 15:
                    errors.append({"field": "mobile", "message": "Enter a valid mobile number."})

    if payload.get("email") is not None:
        e = validate_email(payload.get("email"), mandatory=True)
        if e:
            errors.append({"field": "email", "message": e})

    # Password checks only if present — original 400 path handles missing/short/mismatch first
    if payload.get("password") is not None:
        pwd = _trim(payload.get("password"))
        if pwd and len(pwd) < 6:
            errors.append({"field": "password", "message": "Password must be at least 6 characters."})
        if len(pwd) > 128:
            errors.append({"field": "password", "message": "Password must be at most 128 characters."})

    if payload.get("password") is not None and payload.get("confirm_password") is not None:
        if payload.get("password") != payload.get("confirm_password"):
            errors.append({"field": "confirm_password", "message": "Passwords do not match."})

    if payload.get("role") is not None:
        e = validate_optional_enum(payload.get("role"), "Role", ROLES)
        if e:
            errors.append({"field": "role", "message": e})
    # role owner is not allowed via password endpoint — enforced in app.py

    # District optional for backward compat (original required list did not include district)
    if payload.get("district") is not None and _trim(payload.get("district")) != "":
        e = validate_mandatory(payload.get("district"), "District", 100, 2)
        if e:
            errors.append({"field": "district", "message": e})

    e = validate_optional(payload.get("village"), "Village", 100)
    if e:
        errors.append({"field": "village", "message": e})
    e = validate_optional(payload.get("block"), "Block", 100)
    if e:
        errors.append({"field": "block", "message": e})

    # XSS checks for any string fields even if not otherwise required
    for f in ("full_name", "village", "block", "district", "specialization"):
        v = payload.get(f)
        if v is not None and isinstance(v, str) and ("<" in v or ">" in v):
            if not any(err["field"] == f for err in errors):
                errors.append({"field": f, "message": f"{f} contains invalid characters."})

    return errors

def validate_login(payload: dict) -> list[dict]:
    errors = []
    if not isinstance(payload, dict):
        return [{"field": "body", "message": "Expected a JSON object."}]
    if not _trim(payload.get("identifier") or payload.get("email") or payload.get("mobile")):
        errors.append({"field": "identifier", "message": "Email or mobile is required."})
    if not _trim(payload.get("password")):
        errors.append({"field": "password", "message": "Password is required."})
    return errors

# --------------------------------------------------------------------------
# Cross-field verification helpers
# --------------------------------------------------------------------------

def verify_animal_owner(conn, animal_id: int, owner_id: int) -> bool:
    """Verify animal belongs to owner."""
    try:
        row = conn.execute("SELECT owner_id FROM animals WHERE id=?", (animal_id,)).fetchone()
        return row and row["owner_id"] == owner_id
    except Exception:
        return False

def verify_case_animal(conn, case_id: int, animal_id: int) -> bool:
    try:
        row = conn.execute("SELECT animal_id FROM cases WHERE id=?", (case_id,)).fetchone()
        return row and row["animal_id"] == animal_id
    except Exception:
        return False

def verify_sample_case_animal(conn, sample: dict) -> bool:
    """Sample's case's animal must equal sample's animal."""
    try:
        case_id = sample.get("case_id") or sample.get("case_id")
        animal_id = sample.get("animal_id")
        if not case_id or not animal_id:
            return True  # skip if not present
        row = conn.execute("SELECT animal_id FROM cases WHERE id=?", (case_id,)).fetchone()
        return row and row["animal_id"] == int(animal_id)
    except Exception:
        return False
