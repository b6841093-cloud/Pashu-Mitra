"""Reusable SMS gateway client for the SMS Gateway for Android™ (capcom6)
Cloud Server API — used by transactional flows such as farmer OTP login.

API CONTRACT (verified against the official documentation)
==========================================================
Official docs: https://docs.sms-gate.app/getting-started/public-cloud-server/
               https://docs.sms-gate.app/features/sending-messages/

    POST https://api.sms-gate.app/3rdparty/v1/messages
    Authorization: Basic <username>:<password>
    Content-Type: application/json

    {
      "textMessage": { "text": "Your OTP is 123456" },
      "phoneNumbers": ["+919800000001"],
      "deviceId": "yVULogr4Y1ksRfnos1Dsw",   # optional, only when configured
      "simNumber": 1,                         # optional
      "ttl": 3600,                            # optional
      "priority": 100                         # optional
    }

Success responses are ``200/201/202`` and include the queued message
``id``/``state``. The legacy ``{"message": "...", "phoneNumbers": [...]}``
shape is still accepted by the gateway, but this client sends the documented
``textMessage.text`` structure.

The Local Server (same app, LAN mode) exposes the same JSON contract at
``POST http://<device-ip>:8080/message``.

ENVIRONMENT VARIABLES (server side only — never expose these to a browser)
=========================================================================
    SMS_GATEWAY_MODE            = CLOUD | MOCK | DISABLED      (default: MOCK)
    SMS_GATEWAY_BASE_URL        = https://api.sms-gate.app/3rdparty/v1
                                  (or http://<device-ip>:8080 for LAN mode)
    SMS_GATEWAY_USERNAME        = <cloud account username>
    SMS_GATEWAY_PASSWORD        = <cloud account password>
    SMS_GATEWAY_DEVICE_ID       = <optional device id>
    SMS_GATEWAY_TIMEOUT         = seconds, default 15
    SMS_GATEWAY_SIM_NUMBER      = optional SIM slot (1/2)
    SMS_GATEWAY_TTL_SECONDS     = optional message TTL
    SMS_GATEWAY_PRIORITY        = optional priority (cloud: 1-100)
    SMS_GATEWAY_SKIP_PHONE_VALIDATION = true|false (default false)
    SMS_GATEWAY_ALLOW_INSECURE  = true|false — allow http:// in CLOUD mode
    SMS_GATEWAY_ALLOW_MOCK      = true|false — allow MOCK mode in production

SECURITY NOTES
==============
* Credentials are read from the environment only. They are never returned by
  an API, written to logs, or stored in the frontend.
* Message bodies are never logged (an OTP SMS body contains a live secret).
  Only the gateway message id, the (masked) recipient and the HTTP status are
  logged.
* ``MOCK`` never contacts the network and never pretends to have delivered a
  real SMS: callers receive ``delivered=False`` and a response tagged
  ``"mode": "MOCK"``. Production refuses MOCK unless explicitly overridden.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import urlsplit

import requests

logger = logging.getLogger(__name__)

DEFAULT_CLOUD_BASE_URL = "https://api.sms-gate.app/3rdparty/v1"
DEFAULT_TIMEOUT_SECONDS = 15.0
MOCK_MODE = "MOCK"
CLOUD_MODE = "CLOUD"
DISABLED_MODE = "DISABLED"
VALID_MODES = (CLOUD_MODE, MOCK_MODE, DISABLED_MODE)


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
class SmsGatewayError(RuntimeError):
    """Raised when a message could not be handed over to the SMS gateway.

    ``code`` is a stable, machine readable identifier that API layers can map
    to a safe user-facing message. ``retryable`` hints whether a plain retry
    of the same request may succeed.
    """

    code = "SMS_GATEWAY_ERROR"

    def __init__(self, message: str, *, code: str | None = None,
                 status: int | None = None, retryable: bool = False):
        super().__init__(message)
        if code:
            self.code = code
        self.status = status
        self.retryable = retryable


class SmsGatewayNotConfigured(SmsGatewayError):
    code = "SMS_GATEWAY_NOT_CONFIGURED"


class SmsGatewayAuthError(SmsGatewayError):
    code = "SMS_GATEWAY_AUTH_FAILED"


class SmsGatewayRejected(SmsGatewayError):
    code = "SMS_GATEWAY_REJECTED"


class SmsGatewayUnavailable(SmsGatewayError):
    code = "SMS_GATEWAY_UNAVAILABLE"


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int | None = None) -> int | None:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid integer value for %s", name)
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return float(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("Ignoring invalid numeric value for %s", name)
        return default


def is_production() -> bool:
    """Best-effort production detection (Render sets RENDER=true)."""
    if _env_flag("RENDER", False):
        return True
    env = (os.environ.get("FLASK_ENV") or os.environ.get("APP_ENV") or "").strip().lower()
    return env in ("production", "prod")


def mask_phone(value: str | None) -> str:
    """Mask all but the last four digits of a phone number for safe logging."""
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) <= 4:
        return "****"
    return "*" * (len(digits) - 4) + digits[-4:]


def scrub(text: str, limit: int = 180) -> str:
    """Remove anything secret-looking from a remote message before logging.

    Digit runs of length >= 4 (OTPs, phone numbers, tokens) are redacted.
    """
    cleaned = re.sub(r"\d{4,}", "[redacted]", str(text or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit]


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class SmsGatewayConfig:
    mode: str
    base_url: str
    username: str
    password: str
    device_id: str | None
    timeout: float
    sim_number: int | None
    ttl_seconds: int | None
    priority: int | None
    skip_phone_validation: bool
    allow_insecure: bool
    allow_mock_in_production: bool

    @property
    def credentials_configured(self) -> bool:
        return bool(self.username and self.password)

    @property
    def is_cloud(self) -> bool:
        return self.mode == CLOUD_MODE

    @property
    def is_mock(self) -> bool:
        return self.mode == MOCK_MODE

    @property
    def is_disabled(self) -> bool:
        return self.mode == DISABLED_MODE

    @property
    def is_usable(self) -> bool:
        """True when an OTP may actually be handed to the gateway."""
        if self.is_disabled:
            return False
        if self.is_mock:
            # MOCK simulates delivery for local development only.
            return not is_production() or self.allow_mock_in_production
        return self.credentials_configured and bool(self.base_url)

    def endpoint(self) -> str:
        base = (self.base_url or DEFAULT_CLOUD_BASE_URL).strip()
        if not base:
            base = DEFAULT_CLOUD_BASE_URL
        if "://" not in base:
            base = "https://" + base
        base = base.rstrip("/")
        if base.endswith("/messages") or base.endswith("/message"):
            return base
        # Cloud server: /3rdparty/v1/messages — Local server: /message
        if "sms-gate.app" in base or base.endswith("/3rdparty/v1"):
            return base + "/messages"
        return base + "/message"

    def public_info(self) -> dict:
        """Safe, secret-free snapshot for health/admin endpoints."""
        return {
            "mode": self.mode,
            "configured": bool(self.credentials_configured and self.base_url),
            "usable": self.is_usable,
            "device_id_configured": bool(self.device_id),
            "endpoint_host": _host_of(self.endpoint()),
            "insecure_transport": self.endpoint().startswith("http://"),
            "timeout_seconds": self.timeout,
        }


def _host_of(url: str) -> str:
    try:
        return urlsplit(url).hostname or ""
    except Exception:  # pragma: no cover - defensive
        return ""


def get_gateway_config() -> SmsGatewayConfig:
    """Build the gateway configuration from server-side environment variables."""
    raw_mode = (os.environ.get("SMS_GATEWAY_MODE") or MOCK_MODE).strip().upper()
    mode = raw_mode if raw_mode in VALID_MODES else MOCK_MODE
    if raw_mode not in VALID_MODES:
        logger.warning("Unknown SMS_GATEWAY_MODE=%r — falling back to MOCK.", raw_mode)

    base_url = (os.environ.get("SMS_GATEWAY_BASE_URL") or "").strip()
    if not base_url and mode == CLOUD_MODE:
        base_url = DEFAULT_CLOUD_BASE_URL

    return SmsGatewayConfig(
        mode=mode,
        base_url=base_url,
        username=(os.environ.get("SMS_GATEWAY_USERNAME") or "").strip(),
        # Never strip a password: leading/trailing characters may be intentional.
        password=os.environ.get("SMS_GATEWAY_PASSWORD") or "",
        device_id=(os.environ.get("SMS_GATEWAY_DEVICE_ID") or "").strip() or None,
        timeout=_env_float("SMS_GATEWAY_TIMEOUT", DEFAULT_TIMEOUT_SECONDS),
        sim_number=_env_int("SMS_GATEWAY_SIM_NUMBER"),
        ttl_seconds=_env_int("SMS_GATEWAY_TTL_SECONDS"),
        priority=_env_int("SMS_GATEWAY_PRIORITY"),
        skip_phone_validation=_env_flag("SMS_GATEWAY_SKIP_PHONE_VALIDATION", False),
        allow_insecure=_env_flag("SMS_GATEWAY_ALLOW_INSECURE", False),
        allow_mock_in_production=_env_flag("SMS_GATEWAY_ALLOW_MOCK", False),
    )


def gateway_public_info() -> dict:
    """Secret-free gateway status for health/monitoring endpoints."""
    return get_gateway_config().public_info()


def _validate_transport(config: SmsGatewayConfig) -> None:
    endpoint = config.endpoint()
    if endpoint.startswith("http://") and config.is_cloud and not config.allow_insecure:
        raise SmsGatewayNotConfigured(
            "Refusing to send SMS over plain HTTP in CLOUD mode. "
            "Set SMS_GATEWAY_ALLOW_INSECURE=true only for a trusted LAN.",
            status=503,
        )


def build_payload(config: SmsGatewayConfig, to_e164: str, text: str) -> dict:
    """Build the documented request body (only documented, non-empty fields)."""
    payload: dict = {
        "textMessage": {"text": text},
        "phoneNumbers": [to_e164],
    }
    if config.device_id:
        payload["deviceId"] = config.device_id
    if config.sim_number:
        payload["simNumber"] = config.sim_number
    if config.ttl_seconds:
        payload["ttl"] = config.ttl_seconds
    if config.priority:
        payload["priority"] = config.priority
    return payload


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------
def send_text_message(to_e164: str, text: str, *, timeout: float | None = None) -> dict:
    """Send one text message through the configured gateway.

    Returns a dict describing the *handover* to the gateway::

        {"delivered": True, "mode": "CLOUD", "message_id": "...",
         "state": "Pending", "provider": "ANDROID_SMS_GATEWAY"}

    ``delivered`` means "accepted by the gateway" — the Android handset still
    has to send the SMS, and status can be polled/verified via the gateway.

    Raises ``SmsGatewayError`` (or a subclass) when the message was NOT
    accepted. Callers must surface the failure and must never fall back to a
    fake OTP.
    """
    if not to_e164:
        raise SmsGatewayError("Recipient phone number is required.", code="SMS_INVALID_RECIPIENT")
    if not text or not text.strip():
        raise SmsGatewayError("Message text is required.", code="SMS_EMPTY_BODY")

    config = get_gateway_config()

    if config.is_disabled:
        raise SmsGatewayNotConfigured("SMS gateway is disabled (SMS_GATEWAY_MODE=DISABLED).", status=503)

    if config.is_mock:
        if is_production() and not config.allow_mock_in_production:
            raise SmsGatewayNotConfigured(
                "SMS gateway is in MOCK mode while running in production; "
                "set SMS_GATEWAY_MODE=CLOUD with real credentials.",
                status=503,
            )
        # Development-only simulation. Never reported as a real delivery.
        logger.info("SMS gateway MOCK: simulated send to %s", mask_phone(to_e164))
        return {
            "delivered": False,
            "simulated": True,
            "mode": MOCK_MODE,
            "message_id": None,
            "state": "MOCK",
            "provider": "ANDROID_SMS_GATEWAY",
        }

    if not config.credentials_configured:
        raise SmsGatewayNotConfigured(
            "SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD must be set for CLOUD mode.",
            status=503,
        )

    _validate_transport(config)

    endpoint = config.endpoint()
    payload = build_payload(config, to_e164, text)
    params = {}
    if config.skip_phone_validation:
        params["skipPhoneValidation"] = "true"

    try:
        response = requests.post(
            endpoint,
            json=payload,
            params=params or None,
            auth=(config.username, config.password),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=timeout or config.timeout,
        )
    except requests.exceptions.Timeout as exc:
        logger.warning("SMS gateway timeout (%ss) for %s", config.timeout, mask_phone(to_e164))
        raise SmsGatewayUnavailable("SMS gateway timed out.", retryable=True) from exc
    except requests.exceptions.RequestException as exc:
        # str(exc) may embed the URL (no credentials are placed in the URL).
        logger.warning("SMS gateway unreachable for %s: %s", mask_phone(to_e164),
                       scrub(type(exc).__name__ + ": " + str(exc)))
        raise SmsGatewayUnavailable("SMS gateway is unreachable.", retryable=True) from exc

    status = response.status_code

    if status in (200, 201, 202, 204):
        message_id, state = _parse_success(response)
        logger.info("SMS accepted by gateway for %s (status=%s, id=%s)",
                    mask_phone(to_e164), status, message_id)
        return {
            "delivered": True,
            "simulated": False,
            "mode": config.mode,
            "message_id": message_id,
            "state": state,
            "provider": "ANDROID_SMS_GATEWAY",
        }

    reason = _safe_reason(response)

    if status in (401, 403):
        logger.error("SMS gateway rejected credentials (status=%s, reason=%s)", status, reason)
        raise SmsGatewayAuthError(
            "SMS gateway authentication failed; check the gateway credentials.", status=502
        )
    if status == 429:
        logger.warning("SMS gateway rate limited the request (status=%s).", status)
        raise SmsGatewayUnavailable("SMS gateway rate limit reached.", status=502, retryable=True)
    if 500 <= status < 600:
        logger.warning("SMS gateway server error (status=%s, reason=%s)", status, reason)
        raise SmsGatewayUnavailable("SMS gateway is temporarily unavailable.", status=502, retryable=True)

    logger.warning("SMS gateway rejected the request (status=%s, reason=%s)", status, reason)
    raise SmsGatewayRejected(
        f"SMS gateway rejected the request (HTTP {status}).", status=502
    )


def _parse_success(response) -> tuple[str | None, str | None]:
    """Extract the queued message id/state from a successful response."""
    try:
        data = response.json()
    except ValueError:
        return None, None
    if isinstance(data, dict):
        message_id = data.get("id") or data.get("messageId") or data.get("message_id")
        state = data.get("state") or data.get("status")
        return (str(message_id) if message_id else None, str(state) if state else None)
    if isinstance(data, list) and data and isinstance(data[0], dict):
        first = data[0]
        return (str(first.get("id")) if first.get("id") else None,
                str(first.get("state")) if first.get("state") else None)
    return None, None


def _safe_reason(response, limit: int = 200) -> str:
    """Return a scrubbed, non-secret reason string from an error response."""
    try:
        data = response.json()
        if isinstance(data, dict):
            for key in ("message", "error", "reason", "detail", "title"):
                if data.get(key):
                    return scrub(str(data[key]), limit)
        text = response.text or ""
    except ValueError:
        text = (response.text or "")
    return scrub(text, limit)
