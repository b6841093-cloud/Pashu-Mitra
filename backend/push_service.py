"""
Web Push notification service for PashuMitra using VAPID.

Implements the Web Push protocol so the frontend can subscribe via the
Push API and receive real-time alerts for critical events.

Configuration
=============
Set the following environment variables to enable Web Push:

    VAPID_PUBLIC_KEY   — ECDSA P-256 public key (base64url-encoded)
    VAPID_PRIVATE_KEY  — ECDSA P-256 private key (base64url-encoded)
    VAPID_CLAIM_EMAIL  — mailto: contact for VAPID JWT claims

If any variable is missing the service degrades gracefully: subscription
endpoints still accept requests (so the frontend does not break) but
``push_notification()`` will log a warning and return without sending.

Key generation
==============
::

    from py_vapid import Vapid
    v = Vapid()
    v.generate_keys()
    print(v.public_key)   # → base64url
    print(v.private_key)  # → base64url

Store the private key in an environment variable; **never** commit it.
"""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger(__name__)

_vapid_public_key: str = os.environ.get("VAPID_PUBLIC_KEY", "")
_vapid_private_key: str = os.environ.get("VAPID_PRIVATE_KEY", "")
_vapid_claim_email: str = os.environ.get("VAPID_CLAIM_EMAIL", "")


def is_push_configured() -> bool:
    return bool(_vapid_public_key and _vapid_private_key)


def get_public_key() -> str:
    return _vapid_public_key


def push_notification(subscription_info: dict, payload: dict, *, ttl: int | None = None,
                      urgency: str | None = None) -> bool:
    """Send a Web Push notification.  Returns True on success.

    ``ttl`` and ``urgency`` implement the Web Push protocol's delivery hints:

    * ``ttl`` — how long the push service may keep the message while the device
      is offline. The default (0) means "deliver now or drop it"; a time-critical
      message such as a ringing call should set it explicitly so a stale
      notification can never be delivered later.
    * ``urgency`` — ``"high"`` asks the push service/OS to wake the device
      immediately instead of batching the notification for a maintenance window.
      This is what makes a background tab ring promptly rather than minutes later.

    Both are optional so existing callers keep their current behaviour.
    """
    if not is_push_configured():
        logger.debug("Web Push not configured; skipping notification.")
        return False
    try:
        from pywebpush import webpush, WebPushException  # type: ignore[import-untyped]
    except ImportError:
        logger.warning("pywebpush not installed; cannot send Web Push.")
        return False
    headers = {"Urgency": urgency} if urgency else None
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=_vapid_private_key,
            vapid_claims={"sub": _vapid_claim_email},
            ttl=int(ttl) if ttl is not None else 0,
            headers=headers,
        )
        return True
    except Exception as exc:
        logger.warning("Web Push send failed: %s", exc)
        return False