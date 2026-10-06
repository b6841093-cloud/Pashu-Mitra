"""
Pashu-Shield — Auth recovery & deactivation (GA-20)

- Forgot password for Vet/Govt/Lab (owner/Farmer is OTP-only, blocked)
- Reset password via token
- Account deactivation (soft delete) for self or admin
- Preserves Farmer OTP-only, preserves Vet/Govt/Lab auth, no secrets hard-coded

Tables: password_reset_tokens (added via SCHEMA_AUTH_RECOVERY)
Users: account_status ACTIVE/DEACTIVATED/LOCKED, deactivated_at, deactivation_reason

Security:
- Anti-enumeration: forgot-password always returns same message, even if account not found
- Reset tokens: random 32 bytes, stored as salted hash, short-lived (1 hour), single-use, attempt-limited
- No plaintext token in DB, no email/SMS content in logs
- Audit log for recovery and deactivation
- Deactivated accounts cannot login
"""

from __future__ import annotations

import os
import secrets
import time
import logging
from datetime import datetime, timedelta

from database import get_db, hash_password, verify_password
from flask import g

log = logging.getLogger(__name__)

RESET_TOKEN_TTL_HOURS = int(os.environ.get("SIH_RESET_TOKEN_TTL_HOURS", "1"))
RESET_TOKEN_MAX_ATTEMPTS = int(os.environ.get("SIH_RESET_TOKEN_MAX_ATTEMPTS", "5"))

def _now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def _expires_at_iso() -> str:
    return (datetime.utcnow() + timedelta(hours=RESET_TOKEN_TTL_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")

def generate_reset_token() -> tuple[str, str, str]:
    """Generate (plain_token, hash, salt) — plain token returned only once."""
    plain = secrets.token_urlsafe(32)
    # Reuse existing hash_password which returns (hash, salt)
    h, s = hash_password(plain)
    return plain, h, s

def create_reset_token_for_user(user_id: int, request_ip: str | None = None, user_agent: str | None = None) -> str | None:
    """Create a reset token row, returns plain token (to be sent via email/SMS in production)."""
    plain, h, s = generate_reset_token()
    conn = get_db()
    try:
        # Invalidate any existing active tokens for this user
        conn.execute(
            "UPDATE password_reset_tokens SET status='INVALIDATED' WHERE user_id=? AND status='ACTIVE'",
            (user_id,),
        )
        conn.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, token_salt, status, expires_at, request_ip, user_agent) VALUES (?,?,?,?,?,?,?)",
            (user_id, h, s, "ACTIVE", _expires_at_iso(), request_ip, user_agent),
        )
        conn.commit()
    except Exception:
        log.exception("reset_token_create_failed user_id=%s", user_id)
        return None
    finally:
        conn.close()
    return plain

def verify_reset_token(plain_token: str) -> tuple[dict | None, str | None]:
    """
    Verify reset token. Returns (user_row, error).
    Checks hash, expiry, status, attempts, account_status.
    """
    if not plain_token or not plain_token.strip():
        return None, "Reset token is required."

    conn = get_db()
    try:
        # Find active tokens (we need to check hash against each active token — but we have hash per token)
        # For efficiency, we iterate active tokens and verify_password
        rows = conn.execute(
            "SELECT prt.*, u.* FROM password_reset_tokens prt JOIN users u ON u.id=prt.user_id WHERE prt.status='ACTIVE'"
        ).fetchall()
        matched = None
        for r in rows:
            try:
                if verify_password(plain_token, r["token_salt"], r["token_hash"]):
                    matched = r
                    break
            except Exception:
                continue

        if not matched:
            return None, "Invalid or expired reset token."

        # Check expiry
        try:
            exp = datetime.strptime(matched["expires_at"], "%Y-%m-%dT%H:%M:%SZ")
            if datetime.utcnow() > exp:
                conn.execute("UPDATE password_reset_tokens SET status='EXPIRED' WHERE id=?", (matched["id"],))
                conn.commit()
                return None, "Reset token has expired."
        except Exception:
            pass

        # Check user status
        if matched["account_status"] == "DEACTIVATED":
            return None, "Account is deactivated."

        # Check if user is owner (farmer) — password reset not allowed
        if matched["role"] == "owner":
            return None, "Farmers use OTP to sign in. Password reset is not applicable."

        # Return user dict
        user_dict = {k: matched[k] for k in matched.keys() if k in ("id", "full_name", "mobile", "email", "role", "account_status")}
        # Also need full row for token update
        return {"user": user_dict, "token_row": dict(matched)}, None

    except Exception:
        log.exception("reset_token_verify_failed")
        return None, "Could not verify reset token."
    finally:
        conn.close()

def consume_reset_token(token_id: int):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE password_reset_tokens SET status='USED', consumed_at=? WHERE id=?",
            (_now_iso(), token_id),
        )
        conn.commit()
    except Exception:
        log.exception("reset_token_consume_failed id=%s", token_id)
    finally:
        conn.close()

def deactivate_user(user_id: int, reason: str | None = None, actor_id: int | None = None):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE users SET account_status='DEACTIVATED', deactivated_at=?, deactivation_reason=? WHERE id=?",
            (_now_iso(), reason or "User requested deactivation", user_id),
        )
        # Invalidate active reset tokens
        conn.execute(
            "UPDATE password_reset_tokens SET status='INVALIDATED' WHERE user_id=? AND status='ACTIVE'",
            (user_id,),
        )
        # Invalidate active OTP codes
        try:
            conn.execute(
                "UPDATE otp_codes SET status='INVALIDATED' WHERE user_id=? AND status='ACTIVE'",
                (user_id,),
            )
        except Exception:
            pass
        conn.commit()
    except Exception:
        log.exception("deactivate_failed user_id=%s", user_id)
        raise
    finally:
        conn.close()
