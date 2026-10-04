"""Farmer phone-OTP login through Clerk (https://clerk.com).

The browser runs Clerk's phone-code flow (Clerk sends and checks the SMS OTP)
and then hands the resulting short-lived Clerk *session token* to
``POST /api/auth/farmer/clerk``. This module verifies that token **locally**
against Clerk's cached JWKS (no network call per login once the keys are
cached) and resolves the verified mobile number, which the route then maps to
the existing farmer account / signup flow and the app's own JWT.

Configuration (see .env.example):
    CLERK_PUBLISHABLE_KEY   pk_test_... / pk_live_...  (sent to the browser)
    CLERK_SECRET_KEY        sk_test_... / sk_live_...  (server only)
    CLERK_AUTHORIZED_PARTIES  optional comma-separated allowed origins (azp)

Speed: add a ``phone`` claim to the session token in the Clerk dashboard
(Sessions -> Customize session token: ``{"phone": "{{user.primary_phone_number}}"}``)
and the Backend API lookup is skipped entirely.
"""
from __future__ import annotations

import base64
import logging
import os
import threading

import jwt
import requests

logger = logging.getLogger(__name__)

CLERK_API_BASE = "https://api.clerk.com/v1"
_JWKS_LIFESPAN_SECONDS = 6 * 3600
_HTTP_TIMEOUT = (3, 6)

_jwks_lock = threading.Lock()
_jwks_clients: dict[str, jwt.PyJWKClient] = {}
_http = requests.Session()


class ClerkAuthError(Exception):
    def __init__(self, code: str, message: str, status: int = 401):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def publishable_key() -> str:
    return (os.getenv("CLERK_PUBLISHABLE_KEY")
            or os.getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") or "").strip()


def secret_key() -> str:
    return (os.getenv("CLERK_SECRET_KEY") or "").strip()


def frontend_api_host(pk: str | None = None) -> str | None:
    """Decode the Frontend API host embedded in a publishable key.

    ``pk_test_<base64("my-app-12.clerk.accounts.dev$")>`` -> ``my-app-12.clerk.accounts.dev``
    """
    pk = pk if pk is not None else publishable_key()
    if not pk.startswith(("pk_test_", "pk_live_")):
        return None
    encoded = pk.split("_", 2)[2]
    try:
        decoded = base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")
    except Exception:
        return None
    host = decoded.rstrip("$").strip()
    return host if host and "/" not in host and "." in host else None


def is_enabled() -> bool:
    return bool(frontend_api_host() and secret_key().startswith(("sk_test_", "sk_live_")))


def public_settings() -> dict:
    """Non-secret settings for the login screen (the key is public by design)."""
    if not is_enabled():
        return {"enabled": False}
    host = frontend_api_host()
    return {
        "enabled": True,
        "publishable_key": publishable_key(),
        # Served from the instance's own Frontend API: no extra DNS/TLS origin.
        "script_url": f"https://{host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js",
        "frontend_api": f"https://{host}",
    }


def _jwks_client(host: str) -> jwt.PyJWKClient:
    with _jwks_lock:
        client = _jwks_clients.get(host)
        if client is None:
            client = jwt.PyJWKClient(f"https://{host}/.well-known/jwks.json",
                                     cache_keys=True, lifespan=_JWKS_LIFESPAN_SECONDS,
                                     timeout=_HTTP_TIMEOUT[1])
            _jwks_clients[host] = client
        return client


def warm_up() -> None:
    """Fetch the JWKS once in the background so the first login is not slower."""
    host = frontend_api_host()
    if not host:
        return

    def _fetch():
        try:
            _jwks_client(host).get_signing_keys()
        except Exception as exc:  # pragma: no cover - network dependent
            logger.warning("clerk_jwks_warmup_failed error=%s", type(exc).__name__)

    threading.Thread(target=_fetch, name="clerk-jwks-warmup", daemon=True).start()


def _authorized_parties() -> list[str]:
    raw = os.getenv("CLERK_AUTHORIZED_PARTIES") or ""
    return [p.strip().rstrip("/") for p in raw.split(",") if p.strip()]


def verify_session_token(token: str) -> dict:
    host = frontend_api_host()
    if not host or not is_enabled():
        raise ClerkAuthError("CLERK_NOT_CONFIGURED", "Phone login is not available right now.", 503)
    token = str(token or "").strip()
    if not token:
        raise ClerkAuthError("CLERK_TOKEN_MISSING", "Verification token is required.", 400)
    try:
        signing_key = _jwks_client(host).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, signing_key.key, algorithms=["RS256"],
            issuer=f"https://{host}", leeway=30,
            options={"require": ["exp", "iat", "sub", "iss"], "verify_aud": False},
        )
    except jwt.PyJWKClientError as exc:
        logger.warning("clerk_jwks_unavailable error=%s", exc)
        raise ClerkAuthError("CLERK_UNAVAILABLE", "Phone login is not available right now.", 503)
    except jwt.PyJWTError as exc:
        logger.info("clerk_token_rejected reason=%s", type(exc).__name__)
        raise ClerkAuthError("CLERK_TOKEN_INVALID", "Verification failed. Please try again.", 401)

    parties = _authorized_parties()
    azp = str(claims.get("azp") or "").rstrip("/")
    if parties and azp and azp not in parties:
        raise ClerkAuthError("CLERK_TOKEN_INVALID", "Verification failed. Please try again.", 401)
    return claims


def _fetch_verified_phone(user_id: str) -> str | None:
    try:
        res = _http.get(f"{CLERK_API_BASE}/users/{user_id}",
                        headers={"Authorization": f"Bearer {secret_key()}"},
                        timeout=_HTTP_TIMEOUT)
    except requests.RequestException as exc:
        logger.warning("clerk_backend_api_error error=%s", type(exc).__name__)
        raise ClerkAuthError("CLERK_UNAVAILABLE", "Phone login is not available right now.", 503)
    if res.status_code != 200:
        logger.warning("clerk_backend_api_status status=%s", res.status_code)
        raise ClerkAuthError("CLERK_UNAVAILABLE", "Phone login is not available right now.", 503)
    data = res.json() or {}
    primary_id = data.get("primary_phone_number_id")
    verified = [p for p in (data.get("phone_numbers") or [])
                if ((p.get("verification") or {}).get("status") == "verified")]
    verified.sort(key=lambda p: p.get("id") != primary_id)  # primary first
    return verified[0].get("phone_number") if verified else None


def ensure_phone_user(e164: str) -> bool:
    """Make sure a Clerk user exists for ``e164`` so the browser can *sign in*.

    Browser-side sign-up would hit Clerk's bot-protection CAPTCHA and any
    dashboard sign-up requirements (e.g. a required password). Creating the
    user with the secret key skips both. This grants nothing by itself: a
    session still needs the SMS code sent to that number (``phone_code``).
    Returns True when the user was created, False when it already existed.
    """
    headers = {"Authorization": f"Bearer {secret_key()}"}
    try:
        found = _http.get(f"{CLERK_API_BASE}/users", headers=headers,
                          params={"phone_number": e164, "limit": 1}, timeout=_HTTP_TIMEOUT)
        if found.status_code == 200 and found.json():
            return False
        created = _http.post(f"{CLERK_API_BASE}/users", headers=headers, timeout=_HTTP_TIMEOUT,
                             json={"phone_number": [e164],
                                   "skip_password_requirement": True,
                                   "skip_password_checks": True})
    except requests.RequestException as exc:
        logger.warning("clerk_backend_api_error error=%s", type(exc).__name__)
        raise ClerkAuthError("CLERK_UNAVAILABLE", "Phone login is not available right now.", 503)
    if created.status_code in (200, 201):
        return True
    codes = [e.get("code") for e in (created.json() or {}).get("errors", [])] \
        if created.headers.get("content-type", "").startswith("application/json") else []
    if "form_identifier_exists" in codes:  # created concurrently
        return False
    if "unsupported_country_code" in codes:
        logger.warning("clerk_create_user_failed: +91 is not enabled for SMS. Enable India in "
                       "Clerk Dashboard -> SMS -> Settings (only US/Canada are on by default).")
    logger.warning("clerk_create_user_failed status=%s codes=%s", created.status_code, codes)
    raise ClerkAuthError("CLERK_UNAVAILABLE", "Phone login is not available right now.", 503)


def verified_phone_from_token(token: str) -> str:
    """Return the verified phone number (E.164 as stored by Clerk) for a session."""
    claims = verify_session_token(token)
    # Fast path: phone claim added through the dashboard's session-token
    # template. Clerk only allows a verified number to be primary.
    phone = str(claims.get("phone") or "").strip()
    if not phone.startswith("+"):
        phone = _fetch_verified_phone(str(claims["sub"])) or ""
    if not phone:
        raise ClerkAuthError("CLERK_NO_PHONE", "No verified mobile number on this account.", 401)
    return phone
