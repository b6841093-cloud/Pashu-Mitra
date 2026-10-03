"""Authentication and bounded rate limiting for PBX/voice webhooks."""
from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from collections import defaultdict, deque
from functools import wraps

from flask import current_app, jsonify, request

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, deque] = defaultdict(deque)


def sign_webhook_payload(secret: str, timestamp: str, raw_body: bytes) -> str:
    digest = hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("ascii") + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return f"sha256={digest}"


def _rate_limit_ok(key: str) -> bool:
    try:
        maximum = int(os.environ.get("IVR_RATE_LIMIT_PER_MINUTE", "60"))
    except ValueError:
        maximum = 60
    maximum = min(1000, max(1, maximum))
    now = time.monotonic()
    cutoff = now - 60.0
    with _RATE_LOCK:
        bucket = _RATE_BUCKETS[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= maximum:
            return False
        bucket.append(now)
        return True


def shared_rate_limit_ok(key: str) -> bool:
    """Public wrapper for the bounded, in-process limiter.

    Used by admin endpoints that trigger outbound work (for example the OTP
    diagnostics ``live`` gateway checks) so a leaked token cannot be turned into
    a request amplifier.
    """
    return _rate_limit_ok(key)


def ivr_webhook_required(fn):
    """Require timestamped HMAC signatures on all call-state mutations."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        key = f"{request.remote_addr or 'unknown'}:{request.endpoint}"
        if not _rate_limit_ok(key):
            return jsonify({"error": "IVR webhook rate limit exceeded"}), 429

        secret = os.environ.get("IVR_WEBHOOK_SECRET", "")
        if current_app.testing and current_app.config.get("IVR_ALLOW_UNSIGNED_TESTS", False) and not secret:
            return fn(*args, **kwargs)
        if not secret:
            return jsonify({"error": "IVR webhook authentication is not configured"}), 503

        timestamp = request.headers.get("X-IVR-Timestamp", "")
        signature = request.headers.get("X-IVR-Signature", "")
        try:
            timestamp_number = int(timestamp)
        except (TypeError, ValueError):
            return jsonify({"error": "Missing or invalid IVR timestamp"}), 401
        if abs(int(time.time()) - timestamp_number) > 300:
            return jsonify({"error": "Expired IVR webhook"}), 401

        expected = sign_webhook_payload(secret, timestamp, request.get_data(cache=True))
        if not hmac.compare_digest(signature, expected):
            return jsonify({"error": "Invalid IVR webhook signature"}), 401
        return fn(*args, **kwargs)
    return wrapper
