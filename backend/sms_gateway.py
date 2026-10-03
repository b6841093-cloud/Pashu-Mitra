"""Reusable SMS gateway client for the SMS Gateway for Android™ (capcom6)
Cloud Server API — used by transactional flows such as farmer OTP login.

API CONTRACT (verified against the official documentation)
==========================================================
Official docs: https://docs.sms-gate.app/getting-started/public-cloud-server/
               https://docs.sms-gate.app/features/sending-messages/
               https://docs.sms-gate.app/features/status-tracking/
               https://docs.sms-gate.app/features/multi-device/

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
``id``/``state``. **A 2xx means the message was queued on the server — it is
not proof that the Android device sent the SMS.** Delivery must be confirmed
with ``GET /3rdparty/v1/messages/{id}`` (:func:`get_message_status`); the
documented lifecycle is Pending → Processed → Sent → Delivered/Failed, and a
message stays ``Pending`` until a device picks it up (the public cloud server
rejects messages still pending after 24 h).

Device routing (documented multi-device behaviour): when ``deviceId`` is
omitted the cloud server distributes messages **randomly across every device
of the account**, so a stale second handset can silently receive the OTP
dispatch. ``GET /3rdparty/v1/devices`` (:func:`list_devices`) lists the
devices (with their online state) so a single handset can be pinned via
``SMS_GATEWAY_DEVICE_ID``.

The legacy ``{"message": "...", "phoneNumbers": [...]}`` shape is still
accepted by the gateway, but this client sends the documented
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
    SMS_GATEWAY_DEVICE_ID       = <optional device id, pins the sending handset>
    SMS_GATEWAY_TIMEOUT         = read timeout in seconds, default 15
    SMS_GATEWAY_CONNECT_TIMEOUT = connect timeout in seconds, default 5
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
  logged. Authorization headers are never logged, and every remote error
  string passes through :func:`scrub` (digit runs are redacted) before it is
  written.
* ``MOCK`` never contacts the network and never pretends to have delivered a
  real SMS: callers receive ``accepted=False`` and a response tagged
  ``"mode": "MOCK"``. Production refuses MOCK unless explicitly overridden.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import requests

logger = logging.getLogger(__name__)

DEFAULT_CLOUD_BASE_URL = "https://api.sms-gate.app/3rdparty/v1"
DEFAULT_TIMEOUT_SECONDS = 15.0
DEFAULT_CONNECT_TIMEOUT_SECONDS = 5.0
CLOUD_API_PATH = "/3rdparty/v1"
MESSAGES_SEGMENT = "messages"
LOCAL_MESSAGE_SEGMENT = "message"
MOCK_MODE = "MOCK"
CLOUD_MODE = "CLOUD"
DISABLED_MODE = "DISABLED"
VALID_MODES = (CLOUD_MODE, MOCK_MODE, DISABLED_MODE)

# Stable, non-secret error categories used in structured diagnostics. Callers
# and dashboards can group failures without ever reading a raw gateway message.
CATEGORY_NOT_CONFIGURED = "NOT_CONFIGURED"
CATEGORY_AUTH = "AUTH"
CATEGORY_RATE_LIMIT = "RATE_LIMIT"
CATEGORY_QUEUE_LIMIT = "QUEUE_LIMIT"
CATEGORY_SERVER = "SERVER"
CATEGORY_REJECTED = "REJECTED"
CATEGORY_TIMEOUT = "TIMEOUT"
CATEGORY_CONNECTIVITY = "CONNECTIVITY"
CATEGORY_INVALID_REQUEST = "INVALID_REQUEST"

# One warning per process is enough to flag unpinned multi-device routing.
_routing_warning_emitted = False


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
class SmsGatewayError(RuntimeError):
    """Raised when a message could not be handed over to the SMS gateway.

    ``code`` is a stable, machine readable identifier that API layers can map
    to a safe user-facing message, ``category`` is a coarse, non-secret failure
    class for diagnostics, and ``retryable`` hints whether a plain retry of the
    same request may succeed.
    """

    code = "SMS_GATEWAY_ERROR"
    category = "GATEWAY"

    def __init__(self, message: str, *, code: str | None = None,
                 status: int | None = None, retryable: bool = False,
                 category: str | None = None, reason: str | None = None,
                 upstream_status: int | None = None):
        super().__init__(message)
        if code:
            self.code = code
        if category:
            self.category = category
        # ``status`` is the HTTP status this service returns to its caller;
        # ``upstream_status`` is the raw status the SMS gateway answered with.
        self.status = status
        self.upstream_status = upstream_status
        self.retryable = retryable
        # Already scrubbed; safe for logs and diagnostics (never credentials).
        self.reason = scrub(reason) if reason else None

    def diagnostics(self) -> dict:
        """Secret-free description suitable for logs and admin endpoints."""
        return {
            "code": self.code,
            "category": self.category,
            "api_status": self.status,
            "gateway_http_status": self.upstream_status,
            "retryable": self.retryable,
            "reason": self.reason,
        }


class SmsGatewayNotConfigured(SmsGatewayError):
    code = "SMS_GATEWAY_NOT_CONFIGURED"
    category = CATEGORY_NOT_CONFIGURED


class SmsGatewayAuthError(SmsGatewayError):
    code = "SMS_GATEWAY_AUTH_FAILED"
    category = CATEGORY_AUTH


class SmsGatewayRejected(SmsGatewayError):
    code = "SMS_GATEWAY_REJECTED"
    category = CATEGORY_REJECTED


class SmsGatewayUnavailable(SmsGatewayError):
    code = "SMS_GATEWAY_UNAVAILABLE"
    category = CATEGORY_SERVER


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
    connect_timeout: float
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

    def _base_parts(self) -> tuple[str, str, str, str]:
        """Split the configured base URL into (scheme, netloc, path, suffix)."""
        base = (self.base_url or DEFAULT_CLOUD_BASE_URL).strip() or DEFAULT_CLOUD_BASE_URL
        if "://" not in base:
            base = "https://" + base
        parts = urlsplit(base)
        scheme = parts.scheme or "https"
        netloc = parts.netloc or parts.path
        path = (parts.path or "").rstrip("/")
        suffix = f"?{parts.query}" if parts.query else ""
        return scheme, netloc, path, suffix

    @property
    def is_cloud_target(self) -> bool:
        """True when the base URL uses the cloud contract (``/3rdparty/v1``).

        The decision is made from the URL, not only from the mode, so the
        documented LAN setup (``SMS_GATEWAY_BASE_URL=http://<device-ip>:8080``)
        keeps posting to the local server's singular ``/message`` path.
        """
        if not self.base_url:
            return True
        _, netloc, path, _ = self._base_parts()
        host = netloc.split("@")[-1].split(":")[0].lower()
        if path.endswith("/" + MESSAGES_SEGMENT):
            return True
        if path.endswith("/" + LOCAL_MESSAGE_SEGMENT):
            return False
        if host.endswith("sms-gate.app") or CLOUD_API_PATH in path:
            return True
        if _is_local_host(host):
            return False
        # A private/self-hosted server deployment follows the configured mode.
        return self.is_cloud

    def api_base(self) -> str:
        """Canonical API base, e.g. ``https://api.sms-gate.app/3rdparty/v1``.

        Accepts any of the shapes operators actually paste into Render:
        ``https://api.sms-gate.app``, ``https://api.sms-gate.app/3rdparty/v1``,
        ``https://api.sms-gate.app/3rdparty/v1/messages`` or a local-server URL.
        """
        scheme, netloc, path, _ = self._base_parts()
        if self.is_cloud_target:
            if path.endswith("/" + MESSAGES_SEGMENT) or path.endswith("/" + LOCAL_MESSAGE_SEGMENT):
                path = path.rsplit("/", 1)[0]
            if path.endswith(CLOUD_API_PATH):
                return f"{scheme}://{netloc}{path}"
            if not path:
                return f"{scheme}://{netloc}{CLOUD_API_PATH}"
            # e.g. https://api.sms-gate.app/api -> keep the prefix, add the API path
            return f"{scheme}://{netloc}{path}{CLOUD_API_PATH}"
        if path.endswith("/" + MESSAGES_SEGMENT) or path.endswith("/" + LOCAL_MESSAGE_SEGMENT):
            path = path.rsplit("/", 1)[0]
        return f"{scheme}://{netloc}{path}"

    def messages_endpoint(self) -> str:
        _, _, _, suffix = self._base_parts()
        tail = MESSAGES_SEGMENT if self.is_cloud_target else LOCAL_MESSAGE_SEGMENT
        return f"{self.api_base()}/{tail}{suffix}"

    def message_status_endpoint(self, message_id: str) -> str:
        """Documented status endpoint for one message (status tracking)."""
        safe_id = quote(str(message_id or ""), safe="")
        return f"{self.api_base()}/{MESSAGES_SEGMENT if self.is_cloud_target else LOCAL_MESSAGE_SEGMENT}/{safe_id}"

    def devices_endpoint(self) -> str | None:
        """Device listing endpoint — public cloud server only."""
        if not self.is_cloud_target:
            return None
        return f"{self.api_base()}/devices"

    def endpoint(self) -> str:
        """Backwards-compatible alias for :meth:`messages_endpoint`."""
        return self.messages_endpoint()

    def public_info(self) -> dict:
        """Safe, secret-free snapshot for health/admin endpoints."""
        return {
            "mode": self.mode,
            "configured": bool(self.credentials_configured and self.base_url),
            "usable": self.is_usable,
            "device_id_configured": bool(self.device_id),
            # Documented multi-device behaviour: without a deviceId the cloud
            # server picks a device at random from the account.
            "device_pinned": bool(self.device_id),
            "endpoint_host": _host_of(self.endpoint()),
            "endpoint_path": urlsplit(self.endpoint()).path,
            "insecure_transport": self.endpoint().startswith("http://"),
            "timeout_seconds": self.timeout,
            "connect_timeout_seconds": self.connect_timeout,
        }


def _host_of(url: str) -> str:
    try:
        return urlsplit(url).hostname or ""
    except Exception:  # pragma: no cover - defensive
        return ""


def _is_local_host(host: str) -> bool:
    """True for LAN/local hosts that can only be the app's Local Server."""
    if not host or host in ("localhost", "localhost.localdomain"):
        return True
    if host.endswith((".local", ".lan", ".internal", ".home")):
        return True
    try:
        from ipaddress import ip_address
        ip = ip_address(host)
    except ValueError:
        return False
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local)


def get_gateway_config() -> SmsGatewayConfig:
    """Build the gateway configuration from server-side environment variables."""
    raw_mode = (os.environ.get("SMS_GATEWAY_MODE") or MOCK_MODE).strip().upper()
    mode = raw_mode if raw_mode in VALID_MODES else MOCK_MODE
    if raw_mode not in VALID_MODES:
        logger.warning("Unknown SMS_GATEWAY_MODE=%r — falling back to MOCK.", raw_mode)

    base_url = (os.environ.get("SMS_GATEWAY_BASE_URL") or "").strip()
    if not base_url and mode == CLOUD_MODE:
        base_url = DEFAULT_CLOUD_BASE_URL

    read_timeout = _env_float("SMS_GATEWAY_TIMEOUT", DEFAULT_TIMEOUT_SECONDS)
    connect_timeout = _env_float(
        "SMS_GATEWAY_CONNECT_TIMEOUT", min(DEFAULT_CONNECT_TIMEOUT_SECONDS, read_timeout)
    )

    return SmsGatewayConfig(
        mode=mode,
        base_url=base_url,
        username=(os.environ.get("SMS_GATEWAY_USERNAME") or "").strip(),
        # Never strip a password: leading/trailing characters may be intentional.
        password=os.environ.get("SMS_GATEWAY_PASSWORD") or "",
        device_id=(os.environ.get("SMS_GATEWAY_DEVICE_ID") or "").strip() or None,
        timeout=read_timeout,
        connect_timeout=max(1.0, connect_timeout),
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
    # CLOUD mode means "operate for real": plain HTTP is refused unless the
    # operator explicitly opts in for a trusted LAN local server.
    if endpoint.startswith("http://") and config.is_cloud and not config.allow_insecure:
        raise SmsGatewayNotConfigured(
            "Refusing to send SMS over plain HTTP in CLOUD mode. "
            "Set SMS_GATEWAY_ALLOW_INSECURE=true only for a trusted LAN.",
            status=503,
        )


def _warn_once_about_device_routing(config: SmsGatewayConfig) -> None:
    """Documented multi-device behaviour: no deviceId ⇒ random device choice.

    The public cloud server distributes a message across *every* device of the
    account, so a second (stale) handset can pick up the OTP. Operators should
    pin the sending handset with SMS_GATEWAY_DEVICE_ID.
    """
    global _routing_warning_emitted
    if _routing_warning_emitted or not config.is_cloud_target or config.device_id:
        return
    _routing_warning_emitted = True
    logger.warning(
        "SMS_GATEWAY_DEVICE_ID is not set: the cloud server will route messages to a "
        "random device of the account. Pin the OTP handset (see GET %s) if the "
        "account has more than one device.",
        config.devices_endpoint() or "/3rdparty/v1/devices",
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
    """Submit one text message to the configured gateway.

    Returns a dict describing the *handover* to the gateway::

        {"accepted": True, "delivered": False, "mode": "CLOUD",
         "message_id": "...", "state": "Pending", "delivery_state": "Pending",
         "http_status": 202, "device_id_configured": False,
         "provider": "ANDROID_SMS_GATEWAY"}

    ``accepted`` means the gateway **queued** the message — nothing more. The
    Android handset still has to send the SMS, so ``delivered`` stays ``False``
    until :func:`get_message_status` reports ``Sent``/``Delivered``; callers
    must not describe ``accepted`` as a delivery.

    Raises ``SmsGatewayError`` (or a subclass) when the message was NOT
    accepted — including the case where the gateway synchronously reports a
    terminal ``Failed`` state. Callers must surface the failure and must never
    fall back to a fake OTP.
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
            "accepted": False,
            "delivered": False,
            "simulated": True,
            "mode": MOCK_MODE,
            "message_id": None,
            "state": "MOCK",
            "delivery_state": "MOCK",
            "http_status": None,
            "device_id_configured": bool(config.device_id),
            "provider": "ANDROID_SMS_GATEWAY",
        }

    if not config.credentials_configured:
        raise SmsGatewayNotConfigured(
            "SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD must be set for CLOUD mode.",
            status=503,
        )

    _validate_transport(config)
    _warn_once_about_device_routing(config)

    endpoint = config.messages_endpoint()
    payload = build_payload(config, to_e164, text)
    params = {}
    if config.skip_phone_validation:
        params["skipPhoneValidation"] = "true"

    recipient = mask_phone(to_e164)          # never the full number
    effective_timeout = timeout or config.timeout
    connect_timeout = min(config.connect_timeout, effective_timeout)

    try:
        response = requests.post(
            endpoint,
            json=payload,
            params=params or None,
            auth=(config.username, config.password),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=(connect_timeout, effective_timeout),
        )
    except requests.exceptions.Timeout as exc:
        logger.warning(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s "
            "timeout_seconds=%s device_pinned=%s",
            SmsGatewayUnavailable.code, CATEGORY_TIMEOUT, None, recipient,
            effective_timeout, bool(config.device_id),
        )
        raise SmsGatewayUnavailable(
            "SMS gateway timed out.", retryable=True, category=CATEGORY_TIMEOUT
        ) from exc
    except requests.exceptions.RequestException as exc:
        # str(exc) may embed the URL (credentials are never placed in the URL).
        logger.warning(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s "
            "detail=%s device_pinned=%s",
            SmsGatewayUnavailable.code, CATEGORY_CONNECTIVITY, None, recipient,
            scrub(type(exc).__name__ + ": " + str(exc)), bool(config.device_id),
        )
        raise SmsGatewayUnavailable(
            "SMS gateway is unreachable.", retryable=True, category=CATEGORY_CONNECTIVITY
        ) from exc

    status = response.status_code
    reason = _safe_reason(response)

    if status in (200, 201, 202, 204):
        message_id, state = _parse_success(response)
        if _is_terminal_failure(state):
            # The gateway answered 2xx but already reports a terminal failure;
            # never present that as an accepted message.
            logger.error(
                "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s "
                "message_id=%s message_state=%s reason=%s",
                SmsGatewayRejected.code, CATEGORY_REJECTED, status, recipient,
                message_id, state, reason,
            )
            raise SmsGatewayRejected(
                f"SMS gateway reported the message as failed ({state}).",
                status=502, category=CATEGORY_REJECTED, reason=reason,
                upstream_status=status,
            )
        logger.info(
            "sms_gateway_accepted http_status=%s recipient=%s message_id=%s message_state=%s "
            "device_pinned=%s note=queued_not_delivered",
            status, recipient, message_id, state, bool(config.device_id),
        )
        return {
            # ``accepted`` = queued by the server; ``delivered`` stays False until
            # the message status endpoint reports a real send.
            "accepted": True,
            "delivered": False,
            "simulated": False,
            "mode": config.mode,
            "message_id": message_id,
            "state": state,
            "delivery_state": state,
            "http_status": status,
            "device_id_configured": bool(config.device_id),
            "provider": "ANDROID_SMS_GATEWAY",
        }

    if status in (401, 403):
        logger.error(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s "
            "reason=%s user_action=check_SMS_GATEWAY_USERNAME_and_SMS_GATEWAY_PASSWORD",
            SmsGatewayAuthError.code, CATEGORY_AUTH, status, recipient, reason,
        )
        raise SmsGatewayAuthError(
            "SMS gateway authentication failed; check the gateway credentials.",
            status=502, category=CATEGORY_AUTH, reason=reason, upstream_status=status,
        )
    if status == 429:
        logger.warning(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s reason=%s",
            SmsGatewayUnavailable.code, CATEGORY_RATE_LIMIT, status, recipient, reason,
        )
        raise SmsGatewayUnavailable(
            "SMS gateway rate limit reached.", status=502, retryable=True,
            category=CATEGORY_RATE_LIMIT, reason=reason, upstream_status=status,
        )
    if status == 503 and _is_queue_limit(reason):
        logger.warning(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s reason=%s",
            SmsGatewayUnavailable.code, CATEGORY_QUEUE_LIMIT, status, recipient, reason,
        )
        raise SmsGatewayUnavailable(
            "SMS gateway device queue limit reached.", status=502, retryable=True,
            category=CATEGORY_QUEUE_LIMIT, reason=reason, upstream_status=status,
        )
    if 500 <= status < 600:
        logger.warning(
            "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s reason=%s",
            SmsGatewayUnavailable.code, CATEGORY_SERVER, status, recipient, reason,
        )
        raise SmsGatewayUnavailable(
            "SMS gateway is temporarily unavailable.", status=502, retryable=True,
            category=CATEGORY_SERVER, reason=reason, upstream_status=status,
        )

    logger.warning(
        "sms_gateway_submission_failed code=%s category=%s http_status=%s recipient=%s reason=%s",
        SmsGatewayRejected.code,
        CATEGORY_INVALID_REQUEST if status == 400 else CATEGORY_REJECTED,
        status, recipient, reason,
    )
    raise SmsGatewayRejected(
        f"SMS gateway rejected the request (HTTP {status}).", status=502,
        category=CATEGORY_INVALID_REQUEST if status == 400 else CATEGORY_REJECTED,
        reason=reason, upstream_status=status,
    )


# --------------------------------------------------------------------------
# Status & device inspection (read-only diagnostics)
# --------------------------------------------------------------------------
_TERMINAL_FAILURE_STATES = {"failed", "cancelled", "canceled", "expired"}


def _is_terminal_failure(state: str | None) -> bool:
    return str(state or "").strip().lower() in _TERMINAL_FAILURE_STATES


def _is_queue_limit(reason: str | None) -> bool:
    text = str(reason or "").lower()
    return "queuelimitexceeded" in text.replace(" ", "") or "queue limit" in text


def _safe_get_json(url: str, config: SmsGatewayConfig, *, timeout: float | None = None):
    """Authenticated GET used only by the read-only diagnostics helpers."""
    effective_timeout = timeout or config.timeout
    return requests.get(
        url,
        auth=(config.username, config.password),
        headers={"Accept": "application/json"},
        timeout=(min(config.connect_timeout, effective_timeout), effective_timeout),
    )


def get_message_status(message_id: str, *, timeout: float | None = None) -> dict:
    """Read the documented message lifecycle state for one submitted message.

    ``GET /3rdparty/v1/messages/{id}`` → ``{"id": "...", "state": "Pending",
    "states": {...}, "recipients": [...]}``.

    This is the only way to obtain *evidence* about delivery: ``state`` moves
    Pending → Processed → Sent → Delivered (or Failed). Raises
    ``SmsGatewayError`` when the status cannot be read; it never guesses.
    """
    message_id = str(message_id or "").strip()
    if not message_id:
        raise SmsGatewayError("message_id is required.", code="SMS_INVALID_MESSAGE_ID",
                              category=CATEGORY_INVALID_REQUEST)

    config = get_gateway_config()
    if config.is_disabled or config.is_mock or not config.credentials_configured:
        raise SmsGatewayNotConfigured(
            "Message status requires a configured gateway (SMS_GATEWAY_MODE=CLOUD).", status=503
        )

    url = config.message_status_endpoint(message_id)
    try:
        response = _safe_get_json(url, config, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        logger.warning("sms_gateway_status_failed message_id=%s category=%s detail=%s",
                       message_id, CATEGORY_CONNECTIVITY, scrub(str(exc)))
        raise SmsGatewayUnavailable("Could not read the message status.", retryable=True,
                                    category=CATEGORY_CONNECTIVITY) from exc

    if response.status_code not in (200, 201, 202):
        reason = _safe_reason(response)
        logger.warning("sms_gateway_status_failed message_id=%s http_status=%s reason=%s",
                       message_id, response.status_code, reason)
        if response.status_code in (401, 403):
            raise SmsGatewayAuthError("SMS gateway authentication failed (status read).",
                                      status=502, category=CATEGORY_AUTH, reason=reason)
        if response.status_code == 404:
            raise SmsGatewayRejected("Message not found at the gateway.", status=404,
                                     category=CATEGORY_REJECTED, reason=reason)
        raise SmsGatewayUnavailable("Could not read the message status.", status=502,
                                    category=CATEGORY_SERVER, reason=reason)

    data = _json_of(response)
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict):
        data = {}
    return {
        "ok": True,
        "message_id": str(data.get("id") or message_id),
        "state": data.get("state"),
        # Non-secret metadata only; recipients/payloads are never surfaced.
        "states": data.get("states") if isinstance(data.get("states"), dict) else None,
        "recipients": _safe_recipients(data.get("recipients")),
        "reason": scrub(data.get("reason")) if data.get("reason") else None,
    }


def _safe_recipients(recipients) -> list | None:
    """Keep per-recipient delivery states, dropping anything secret-looking."""
    if not isinstance(recipients, list):
        return None
    safe = []
    for item in recipients[:5]:
        if not isinstance(item, dict):
            continue
        entry = {}
        for key in ("phoneNumber", "state", "reason"):
            if item.get(key) is not None:
                value = item[key]
                entry[key] = mask_phone(value) if key == "phoneNumber" else scrub(str(value), 120)
        if entry:
            safe.append(entry)
    return safe or None


def list_devices(*, timeout: float | None = None) -> dict:
    """List the account's devices (public cloud server, ``devices:list``).

    Returns ``{"ok": True, "count": n, "devices": [ ... ]}`` with a whitelist of
    non-secret fields (id, name, online state, last-seen timestamp). Expired
    accounts get an auth error; local-server mode has no device endpoint.
    """
    config = get_gateway_config()
    if config.devices_endpoint() is None:
        raise SmsGatewayNotConfigured("Device listing is only available on the cloud server.",
                                      status=503)
    if not config.credentials_configured:
        raise SmsGatewayNotConfigured(
            "SMS_GATEWAY_USERNAME and SMS_GATEWAY_PASSWORD must be set.", status=503
        )

    url = config.devices_endpoint()
    try:
        response = _safe_get_json(url, config, timeout=timeout)
    except requests.exceptions.RequestException as exc:
        logger.warning("sms_gateway_devices_failed category=%s detail=%s",
                       CATEGORY_CONNECTIVITY, scrub(str(exc)))
        raise SmsGatewayUnavailable("Could not list the gateway devices.", retryable=True,
                                    category=CATEGORY_CONNECTIVITY) from exc

    if response.status_code in (401, 403):
        raise SmsGatewayAuthError("SMS gateway authentication failed (device list).",
                                  status=502, category=CATEGORY_AUTH, reason=_safe_reason(response))
    if response.status_code not in (200, 201, 202):
        raise SmsGatewayUnavailable("Could not list the gateway devices.", status=502,
                                    category=CATEGORY_SERVER, reason=_safe_reason(response))

    data = _json_of(response)
    if isinstance(data, dict):
        data = data.get("devices") or data.get("items") or []
    devices = [_safe_device(item) for item in data if isinstance(item, dict)] if isinstance(data, list) else []
    logger.info("sms_gateway_devices_listed count=%s", len(devices))
    return {"ok": True, "count": len(devices), "devices": devices}


def _safe_device(item: dict) -> dict:
    """Whitelist non-secret device fields (never push tokens or credentials)."""
    device: dict = {}
    if item.get("id"):
        device["id"] = str(item["id"])
    for key in ("name", "online", "isOnline", "lastSeen", "lastSeenAt", "createdAt"):
        if item.get(key) is not None:
            device[key] = item[key] if isinstance(item[key], bool) else scrub(str(item[key]), 60)
    return device


def _json_of(response):
    try:
        return response.json()
    except ValueError:
        return None


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
