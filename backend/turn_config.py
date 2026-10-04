"""ICE (STUN/TURN) configuration for the WebRTC web-calling feature.

STUN alone discovers a peer's public address but cannot relay media when both
peers sit behind symmetric NAT or a restrictive firewall; those calls need a
TURN relay. This module never ships a permanent TURN credential to the browser:

* Preferred mode — **ephemeral credentials**: set ``SIH_TURN_SECRET`` to the
  ``static-auth-secret`` of a coturn server (``use-auth-secret``) and each
  request receives a short-lived ``username``/``credential`` pair computed as
  in the coturn REST API:

      username   = "<expiry-unix-timestamp>:<user-id>"
      credential = base64(HMAC-SHA1(secret, username))

* Fallback mode — **static credentials** (``SIH_TURN_USERNAME`` /
  ``SIH_TURN_CREDENTIAL``) for a TURN server that does not support the REST
  API. Less safe, and clearly reported as such.

If no TURN server is configured, the API reports ``turn_configured: false`` and
the clients still get STUN. Calls between peers on the same network or with
permissive NATs then work; calls that need a relay fail with a truthful
"could not connect" state instead of pretending to be connected.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

DEFAULT_STUN_URLS = ("stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302")
DEFAULT_TURN_TTL_SECONDS = 3600


def _split_env(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def stun_urls() -> tuple[str, ...]:
    return _split_env("SIH_STUN_URLS", DEFAULT_STUN_URLS)


def turn_urls() -> tuple[str, ...]:
    return _split_env("SIH_TURN_URLS")


def turn_ttl_seconds() -> int:
    try:
        value = int(os.environ.get("SIH_TURN_TTL_SECONDS", DEFAULT_TURN_TTL_SECONDS))
    except (TypeError, ValueError):
        value = DEFAULT_TURN_TTL_SECONDS
    # A coturn REST credential must have a future timestamp; keep it short-lived
    # but long enough to survive several ICE restarts within one call.
    return min(86400, max(300, value))


def ice_transport_policy() -> str:
    policy = (os.environ.get("SIH_ICE_TRANSPORT_POLICY") or "all").strip().lower()
    return policy if policy in ("all", "relay") else "all"


def turn_mode() -> str:
    if turn_urls() and (os.environ.get("SIH_TURN_SECRET") or "").strip():
        return "ephemeral"
    if turn_urls() and (os.environ.get("SIH_TURN_USERNAME") or "").strip():
        return "static"
    return "none"


def _ephemeral_credentials(user_id, ttl: int) -> tuple[str, str]:
    secret = (os.environ.get("SIH_TURN_SECRET") or "").strip()
    username = f"{int(time.time()) + ttl}:{user_id}"
    digest = hmac.new(secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode("ascii")


def ice_servers(user_id) -> list[dict]:
    """Build the ``iceServers`` array for one authenticated user.

    The credential (when present) is short-lived and bound to the requesting
    user id; it is returned over HTTPS only to an authenticated session.
    """
    servers: list[dict] = []
    stun = stun_urls()
    if stun:
        servers.append({"urls": list(stun)})
    urls = turn_urls()
    if urls:
        mode = turn_mode()
        if mode == "ephemeral":
            username, credential = _ephemeral_credentials(user_id, turn_ttl_seconds())
            servers.append({"urls": list(urls), "username": username, "credential": credential})
        elif mode == "static":
            servers.append({
                "urls": list(urls),
                "username": (os.environ.get("SIH_TURN_USERNAME") or "").strip(),
                "credential": (os.environ.get("SIH_TURN_CREDENTIAL") or "").strip(),
            })
    return servers


def describe() -> dict:
    """Secret-free summary for /api/health and the portal diagnostics panel."""
    mode = turn_mode()
    return {
        "stun_configured": bool(stun_urls()),
        "turn_configured": mode != "none",
        "turn_mode": mode,
        "turn_url_count": len(turn_urls()),
        "ice_transport_policy": ice_transport_policy(),
        "ephemeral_credentials": mode == "ephemeral",
        "credential_ttl_seconds": turn_ttl_seconds() if mode != "none" else None,
    }
