"""
Pashu-Shield — CAPTCHA integration hook (GuDApps 3.5.2 / GIGW C1.2f)

Additive, env-driven, no hard-coded secrets.

Design:
- Provider is selected via SIH_CAPTCHA_PROVIDER: none (default), recaptcha, hcaptcha, turnstile, test
- Site key and secret key are from env SIH_CAPTCHA_SITE_KEY / SIH_CAPTCHA_SECRET_KEY — never hard-coded
- Verification is server-side only; client token is verified against provider API when configured
- Accessible alternative: when CAPTCHA is enabled, a simple math challenge is offered as fallback
  (audio CAPTCHA would be provider-dependent; math challenge is WCAG 1.1.1 text alternative)
- If provider is none or test mode, verification always passes (so existing tests stay green)
- Rate limiting and honeypot are complementary, not replacements

Usage in Flask:
    from captcha_service import captcha_required, verify_captcha, captcha_public_config

    @app.post("/api/auth/login")
    @captcha_required(action="login")  # optional decorator, checks token if provider configured
    def login(): ...

Frontend:
    GET /api/captcha/config returns {enabled, provider, site_key, alternative_enabled}
    The SPA can render the widget if enabled, otherwise no UI change.
"""

from __future__ import annotations

import os
import time
import logging
import random
from functools import wraps
from flask import request, jsonify, g

log = logging.getLogger(__name__)

def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()

def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")

CAPTCHA_PROVIDER = _env("SIH_CAPTCHA_PROVIDER", "none").lower()  # none, recaptcha, hcaptcha, turnstile, test
CAPTCHA_SITE_KEY = _env("SIH_CAPTCHA_SITE_KEY", "")
CAPTCHA_SECRET_KEY = _env("SIH_CAPTCHA_SECRET_KEY", "")
CAPTCHA_ENABLED = CAPTCHA_PROVIDER != "none" and CAPTCHA_PROVIDER != ""
CAPTCHA_ALTERNATIVE_ENABLED = _flag("SIH_CAPTCHA_ALTERNATIVE_ENABLED", True)
CAPTCHA_TIMEOUT_SECONDS = int(os.environ.get("SIH_CAPTCHA_TIMEOUT", "300"))  # math challenge TTL

# In-memory math challenges: token -> (answer, expires_at)
_MATH_CHALLENGES: dict[str, tuple[int, float]] = {}

def captcha_public_config() -> dict:
    """Public config safe to send to frontend — never includes secret."""
    return {
        "enabled": CAPTCHA_ENABLED,
        "provider": CAPTCHA_PROVIDER if CAPTCHA_ENABLED else "none",
        "site_key": CAPTCHA_SITE_KEY if CAPTCHA_ENABLED else "",
        "alternative_enabled": CAPTCHA_ALTERNATIVE_ENABLED,
        "message": "CAPTCHA verification may be required for security." if CAPTCHA_ENABLED else "",
    }

def _verify_with_provider(token: str, remote_ip: str | None = None) -> bool:
    """Verify token against configured provider. Returns True if provider is none/test or verification succeeds."""
    if not CAPTCHA_ENABLED:
        return True
    if CAPTCHA_PROVIDER == "test":
        # Test mode: any non-empty token passes, empty fails only if we require it
        return bool(token)
    if not token:
        return False
    if not CAPTCHA_SECRET_KEY:
        log.warning("captcha_enabled_but_secret_missing provider=%s", CAPTCHA_PROVIDER)
        # Fail closed if secret missing but provider says enabled — don't let bypass
        return False

    # Lazy import requests to avoid hard dependency at import time
    try:
        import requests
    except Exception:
        log.error("captcha_requests_missing")
        return False

    try:
        if CAPTCHA_PROVIDER == "recaptcha":
            resp = requests.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": CAPTCHA_SECRET_KEY, "response": token, "remoteip": remote_ip or ""},
                timeout=5,
            )
            data = resp.json()
            return bool(data.get("success"))
        elif CAPTCHA_PROVIDER == "hcaptcha":
            resp = requests.post(
                "https://api.hcaptcha.com/siteverify",
                data={"secret": CAPTCHA_SECRET_KEY, "response": token, "remoteip": remote_ip or ""},
                timeout=5,
            )
            data = resp.json()
            return bool(data.get("success"))
        elif CAPTCHA_PROVIDER == "turnstile":
            resp = requests.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": CAPTCHA_SECRET_KEY, "response": token, "remoteip": remote_ip or ""},
                timeout=5,
            )
            data = resp.json()
            return bool(data.get("success"))
        else:
            log.warning("captcha_unknown_provider provider=%s", CAPTCHA_PROVIDER)
            return False
    except Exception:
        log.exception("captcha_verify_failed provider=%s", CAPTCHA_PROVIDER)
        return False

def generate_math_challenge() -> dict:
    """Generate an accessible math challenge as CAPTCHA alternative."""
    a = random.randint(1, 20)
    b = random.randint(1, 20)
    op = random.choice(["+", "-"])
    if op == "+":
        ans = a + b
        q = f"What is {a} + {b}?"
    else:
        # Ensure non-negative for accessibility
        if a < b:
            a, b = b, a
        ans = a - b
        q = f"What is {a} - {b}?"
    token = f"math_{random.randint(100000,999999)}_{int(time.time())}"
    _MATH_CHALLENGES[token] = (ans, time.time() + CAPTCHA_TIMEOUT_SECONDS)
    # Cleanup old
    now = time.time()
    for k in list(_MATH_CHALLENGES.keys()):
        if _MATH_CHALLENGES[k][1] < now:
            del _MATH_CHALLENGES[k]
    return {"challenge_token": token, "question": q, "expires_in": CAPTCHA_TIMEOUT_SECONDS}

def verify_math_challenge(challenge_token: str, answer: str) -> bool:
    """Verify math challenge answer."""
    if not challenge_token or answer is None:
        return False
    entry = _MATH_CHALLENGES.get(challenge_token)
    if not entry:
        return False
    expected, expires_at = entry
    if time.time() > expires_at:
        _MATH_CHALLENGES.pop(challenge_token, None)
        return False
    try:
        given = int(str(answer).strip())
    except Exception:
        return False
    ok = given == expected
    if ok:
        _MATH_CHALLENGES.pop(challenge_token, None)
    return ok

def verify_captcha(token: str | None = None, remote_ip: str | None = None, alternative: dict | None = None) -> tuple[bool, str | None]:
    """
    Verify CAPTCHA. Supports:
    - provider token (recaptcha/hcaptcha/turnstile)
    - alternative math challenge: alternative = {"challenge_token": ..., "answer": ...}
    Returns (ok, error_message)
    """
    if not CAPTCHA_ENABLED:
        return True, None

    # First try provider token if present
    if token:
        if _verify_with_provider(token, remote_ip):
            return True, None
        # If provider token present but fails, try alternative if provided
        if alternative:
            if verify_math_challenge(alternative.get("challenge_token", ""), alternative.get("answer", "")):
                return True, None
        return False, "CAPTCHA verification failed. Please try again or use the accessible alternative."

    # No provider token, try alternative
    if alternative and CAPTCHA_ALTERNATIVE_ENABLED:
        if verify_math_challenge(alternative.get("challenge_token", ""), alternative.get("answer", "")):
            return True, None
        return False, "Incorrect answer to the accessible challenge. Please try again."

    # No token at all
    return False, "CAPTCHA verification is required."

def captcha_required(action: str = "generic"):
    """Decorator for Flask routes that enforces CAPTCHA when enabled."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not CAPTCHA_ENABLED:
                return fn(*args, **kwargs)
            data = {}
            try:
                if request.is_json:
                    data = request.get_json(silent=True) or {}
                else:
                    data = request.form.to_dict() or {}
            except Exception:
                data = {}
            token = data.get("captcha_token") or request.headers.get("X-Captcha-Token") or ""
            alt_token = data.get("captcha_alternative") or {}
            # Honeypot check — if honeypot field filled, reject (bot)
            if data.get("website") or data.get("url") or data.get("honeypot"):
                log.warning("captcha_honeypot_triggered action=%s", action)
                return jsonify({"error": "Request could not be verified.", "code": "CAPTCHA_HONEYPOT"}), 400

            ok, err = verify_captcha(token, request.remote_addr, alt_token if isinstance(alt_token, dict) else None)
            if not ok:
                return jsonify({"error": err or "CAPTCHA verification failed.", "code": "CAPTCHA_FAILED"}), 400
            return fn(*args, **kwargs)
        return wrapper
    return decorator

def install_captcha(app):
    """Register CAPTCHA config and alternative challenge endpoints (additive)."""

    @app.get("/api/captcha/config")
    def get_captcha_config():
        return jsonify(captcha_public_config())

    @app.post("/api/captcha/alternative")
    def get_alternative_challenge():
        """Get an accessible math challenge."""
        if not CAPTCHA_ALTERNATIVE_ENABLED:
            return jsonify({"error": "Accessible alternative not enabled"}), 404
        challenge = generate_math_challenge()
        return jsonify(challenge)

    @app.post("/api/captcha/verify")
    def verify_captcha_endpoint():
        """Standalone verification endpoint for testing and for SPA to pre-verify."""
        data = request.get_json(silent=True) or {}
        token = data.get("captcha_token") or ""
        alt = data.get("captcha_alternative") or {}
        ok, err = verify_captcha(token, request.remote_addr, alt if isinstance(alt, dict) else None)
        if ok:
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": err}), 400

    return app
