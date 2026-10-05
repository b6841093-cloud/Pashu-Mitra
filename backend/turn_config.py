"""ICE (STUN/TURN) configuration for the WebRTC web-calling feature.

STUN alone discovers a peer's public address but cannot relay media when both
peers sit behind symmetric NAT or a restrictive firewall; those calls need a
TURN relay. This module never ships a permanent TURN credential to the browser:

* Mode 1 — **ephemeral credentials** (self-hosted coturn): set
  ``SIH_TURN_SECRET`` to the ``static-auth-secret`` of a coturn server
  (``use-auth-secret``) and each request receives a short-lived
  ``username``/``credential`` pair computed as in the coturn REST API:

      username   = "<expiry-unix-timestamp>:<user-id>"
      credential = base64(HMAC-SHA1(secret, username))

* Mode 2 — **static credentials** (managed provider such as Metered):
  ``SIH_TURN_URLS`` + ``SIH_TURN_USERNAME`` + ``SIH_TURN_CREDENTIAL`` for a TURN
  server that does not implement the coturn REST API. This is a first-class
  mode, not a degraded one — ``SIH_TURN_SECRET`` must be **absent or empty**,
  because a non-empty secret wins the mode selection and the backend would then
  hand the browser coturn-style credentials that a managed provider rejects.

Mode selection: URLs first (no ``turn:``/``turns:`` URL ⇒ ``turn_mode: none``
whatever the credentials say), then a non-empty ``SIH_TURN_SECRET`` ⇒
``ephemeral``, then a complete username+credential pair ⇒ ``static``.

If no TURN server is configured, the API reports ``turn_configured: false`` and
the clients still get STUN. Calls between peers on the same network or with
permissive NATs then work; calls that need a relay fail with a truthful
"could not connect" state instead of pretending to be connected.

Deployment notes (read before debugging a deployed ``turn_mode: none``):

* The environment is read on **every call**, never cached at import time, so a
  running process always reflects the variables it was started with. Render
  only injects a variable into the process it belongs to — setting
  ``SIH_TURN_*`` on the frontend project (Vercel) or on the ML service does
  nothing for this API, and an existing process must be restarted/redeployed
  before it can see a new value.
* ``SIH_TURN_URLS`` accepts a JSON array
  (``["turn:a:3478","turn:a:3478?transport=tcp"]``) or a comma/whitespace/
  newline-separated string (``turn:a:3478,turns:a:5349``); one layer of
  surrounding quotes is tolerated (``"turn:a:3478"``).
* Only ``turn:`` / ``turns:`` entries count — anything else is ignored and
  reported, so a wrong scheme cannot make the health endpoint claim TURN works.
* An empty or absent ``SIH_TURN_URLS`` means "no TURN", whatever the credential
  variables say. ``describe()`` reports which of the four variables is
  ``missing`` / ``empty`` / ``set`` (never their values) plus a machine-readable
  ``turn_config_issue``, which is what makes an unconfigured deployment
  self-diagnosing instead of silently falling back to ``turn_mode: none``.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time

DEFAULT_STUN_URLS = ("stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302")
DEFAULT_TURN_TTL_SECONDS = 3600

# Reported by describe() as missing/empty/set — names only, never values.
TURN_ENV_KEYS = ("SIH_TURN_URLS", "SIH_TURN_USERNAME", "SIH_TURN_CREDENTIAL", "SIH_TURN_SECRET")
_TURN_SCHEMES = ("turn:", "turns:")
_DELIMITERS = re.compile(r"[,\s]+")
# JSON-ish punctuation that survives a hand-pasted array (see ``_clean_token``).
# It never occurs inside a real TURN URL, so stripping it from the *ends* of a
# token is always safe; the scheme check that follows is the real gate.
_TOKEN_NOISE = re.compile(r"^[\[\]{}\"',;]+|[\[\]{}\"',;]+$")


def _unquote(raw: str) -> str:
    """Strip whitespace and one layer of surrounding quotes.

    ``SIH_TURN_URLS="turn:host:3478"`` (pasted from a dashboard, a ``.env`` file
    or a shell export) is the same URL as without the quotes; without this the
    quotes would be baked into the ICE server list and the TURN URL would never
    match. A JSON array pasted with outer quotes (``'["turn:a:3478"]'``)
    survives the stripping as well.
    """
    value = (raw or "").strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
    return value


def _clean_token(part: str) -> str:
    """Trim one entry of a pasted list to a bare URL.

    A deployment operator pastes ``SIH_TURN_URLS`` from a dashboard or this
    README. The two shapes that matter are a JSON array and a plain delimited
    list; both are handled by ``_split_env``. This covers the shape that falls
    between them — an *almost*-JSON array (a trailing comma, single quotes, a
    bracket left in place). Every delimiter-separated token is stripped of
    whitespace plus the surrounding ``[]{}"'`` / ``;`` punctuation that JSON
    would otherwise have consumed, so a near-miss paste still produces usable
    ``turn:`` URLs instead of silently degrading to ``turn_url_count: 0``.
    """
    return _TOKEN_NOISE.sub("", (part or "").strip()).strip()


def _split_env(name: str, default: tuple[str, ...] = ()) -> tuple[str, ...]:
    """Parse an env var as either a JSON array or a delimited string.

    Supported formats (both accepted; the JSON array is tried first):

    * JSON array — safest for TURN URLs because it is unambiguous and preserves
      query strings such as ``?transport=tcp`` intact.
    * Comma / whitespace / newline separated string — the original format.

    One layer of surrounding quotes is stripped first (see ``_unquote``), and an
    array that is *almost* valid JSON still parses token by token (see
    ``_clean_token``). Entries are returned as written; the caller decides which
    schemes are usable.
    """
    raw = _unquote(os.environ.get(name) or "")
    if not raw:
        return default
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None
        if isinstance(parsed, list):
            return tuple(item for item in (_clean_token(str(each)) for each in parsed) if item)
    return tuple(item for item in (_clean_token(part) for part in _DELIMITERS.split(raw)) if item)


def stun_urls() -> tuple[str, ...]:
    return _split_env("SIH_STUN_URLS", DEFAULT_STUN_URLS)


def _turn_url_candidates() -> tuple[str, ...]:
    return _split_env("SIH_TURN_URLS")


def turn_urls() -> tuple[str, ...]:
    """The configured entries a browser can actually use."""
    return tuple(url for url in _turn_url_candidates() if url.lower().startswith(_TURN_SCHEMES))


def turn_urls_ignored() -> int:
    """How many entries were dropped because they are not ``turn:``/``turns:``."""
    return sum(1 for url in _turn_url_candidates() if not url.lower().startswith(_TURN_SCHEMES))


def env_state(name: str) -> str:
    """``missing`` | ``empty`` | ``set`` for one variable — never its value."""
    if name not in os.environ:
        return "missing"
    return "set" if (os.environ.get(name) or "").strip() else "empty"


def turn_ttl_seconds() -> int:
    try:
        value = int(_unquote(os.environ.get("SIH_TURN_TTL_SECONDS", str(DEFAULT_TURN_TTL_SECONDS))))
    except (TypeError, ValueError):
        value = DEFAULT_TURN_TTL_SECONDS
    # A coturn REST credential must have a future timestamp; keep it short-lived
    # but long enough to survive several ICE restarts within one call.
    return min(86400, max(300, value))


def ice_transport_policy() -> str:
    policy = (os.environ.get("SIH_ICE_TRANSPORT_POLICY") or "all").strip().lower()
    return policy if policy in ("all", "relay") else "all"


def turn_mode() -> str:
    """``none`` | ``ephemeral`` | ``static`` — see the module docstring.

    ``static`` needs no secret: URLs + username + credential are complete on
    their own, which is what a managed TURN provider (Metered) requires.
    """
    urls = turn_urls()
    if not urls:
        return "none"
    if (os.environ.get("SIH_TURN_SECRET") or "").strip():
        return "ephemeral"
    if ((os.environ.get("SIH_TURN_USERNAME") or "").strip()
            and (os.environ.get("SIH_TURN_CREDENTIAL") or "").strip()):
        return "static"
    return "none"


def turn_config_issue() -> str | None:
    """Machine-readable reason why TURN is unusable, or ``None`` when it is fine.

    * ``turn_urls_missing`` — ``SIH_TURN_URLS`` is absent or empty (the
      credential variables cannot help: the URL gate comes first).
    * ``turn_urls_unusable`` — set, but it contains no usable ``turn:``/
      ``turns:`` entry (empty JSON array, wrong scheme, placeholder text).
    * ``turn_credentials_missing`` — the URLs are fine, but neither the
      coturn secret nor a complete username+credential pair is set.

    This is what turns "silently fell back to turn_mode: none" into a named,
    checkable condition in ``/api/health``.
    """
    if not turn_urls():
        state = env_state("SIH_TURN_URLS")
        return "turn_urls_unusable" if state == "set" else "turn_urls_missing"
    if turn_mode() == "none":
        return "turn_credentials_missing"
    return None


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
    """Secret-free summary for /api/health and the portal diagnostics panel.

    Reports no values, lengths, prefixes or hashes — only which variables exist
    and whether they are empty, plus the resulting mode and why it is not
    active. ``credential_ttl_seconds`` is the configured TTL for ephemeral mode
    (``None`` otherwise), exactly as before.
    """
    mode = turn_mode()
    urls = turn_urls()
    return {
        "stun_configured": bool(stun_urls()),
        "turn_configured": mode != "none",
        "turn_mode": mode,
        "turn_url_count": len(urls),
        "turn_config_issue": turn_config_issue(),
        "turn_env": {name: env_state(name) for name in TURN_ENV_KEYS},
        "turn_urls_ignored": turn_urls_ignored(),
        "ice_transport_policy": ice_transport_policy(),
        "ephemeral_credentials": mode == "ephemeral",
        "credential_ttl_seconds": turn_ttl_seconds() if mode == "ephemeral" else None,
    }
