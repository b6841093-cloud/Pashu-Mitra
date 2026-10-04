#!/usr/bin/env python3
"""End-to-end Web Push delivery check against a running backend.

WHAT THIS PROVES
================
A real farmer call makes the backend send a *real* Web Push request to the
assigned veterinarian's stored subscription: VAPID-signed, `aes128gcm`
encrypted, to the exact endpoint that was subscribed — and dead subscriptions
are pruned. A stand-in "push service" (a local HTTP listener) takes the place of
FCM/Mozilla, so this proves the whole send path without a browser.

WHAT IT DOES NOT PROVE
======================
That a browser/OS actually displays the notification. That requires a real
browser with notification permission and a real push service (FCM/Mozilla
endpoint), which cannot be exercised from a headless build environment. The
repository's manual procedure (backend/tests/webrtc/README.md) covers it.

WHAT IT NEEDS
=============
* a running backend (local gunicorn or the deployed Render service),
* the SAME VAPID keys the backend was started with (it verifies the public key
  the backend serves matches),
* a veterinarian account and a farmer account (the demo number's fixed OTP by
  default, so the backend needs DEMO_MODE=true for that; otherwise set
  PM_FARMER_OTP to a freshly requested code).

Usage::

    PM_WEBCALL_URL=http://127.0.0.1:5001 \
    VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
    PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=... \
    python3 backend/tests/deploy/push_loopback_check.py

Exit codes: 0 pass, 1 failure, 2 skipped (configuration missing).
Tokens are never printed.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = (os.environ.get("PM_WEBCALL_URL") or "").rstrip("/")
VET = {"email": os.environ.get("PM_VET_EMAIL", ""), "password": os.environ.get("PM_VET_PASSWORD", "")}
FARMER = {"mobile": os.environ.get("PM_FARMER_MOBILE", "8341564042"), "otp": os.environ.get("PM_FARMER_OTP", "123456")}
PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
CLAIM = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:ops@example.org")
LANGUAGE = os.environ.get("PM_WEBCALL_LANGUAGE", "en")
PUSH_WAIT_SECONDS = float(os.environ.get("PM_PUSH_WAIT_SECONDS", "12"))

if not BASE:
    print("SKIPPED: set PM_WEBCALL_URL to a running backend")
    raise SystemExit(2)
if not (PUBLIC_KEY and PRIVATE_KEY):
    print("SKIPPED: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (the same pair the backend runs with)")
    raise SystemExit(2)
if not (VET["email"] and VET["password"]):
    print("SKIPPED: set PM_VET_EMAIL and PM_VET_PASSWORD")
    raise SystemExit(2)

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> bool:
    global checks
    checks += 1
    print(("  ✔ " if condition else "  ✘ ") + message)
    if not condition:
        failures.append(message)
    return condition


# --------------------------------------------------------------- stand-in push
received: list[dict] = []
responses: dict[str, int] = {"/accept": 201, "/gone": 410}


class PushStandIn(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802 - stdlib naming
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        received.append({
            "path": self.path,
            "authorization": self.headers.get("authorization", ""),
            "content_encoding": self.headers.get("content-encoding", ""),
            "ttl": self.headers.get("ttl", ""),
            "urgency": self.headers.get("urgency", ""),
            "bytes": len(body),
            "at": time.time(),
        })
        self.send_response(responses.get(self.path, 404))
        self.end_headers()

    def log_message(self, *args):  # keep the output readable
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), PushStandIn)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
ACCEPT_ENDPOINT = f"http://127.0.0.1:{port}/accept"
GONE_ENDPOINT = f"http://127.0.0.1:{port}/gone"
print(f"stand-in push service listening on 127.0.0.1:{port}")


# ------------------------------------------------------------------- http api
def api(path: str, method: str = "GET", body: dict | None = None, token: str | None = None):
    request = urllib.request.Request(BASE + path, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    data = None if body is None else json.dumps(body).encode()
    try:
        with urllib.request.urlopen(request, data=data, timeout=30) as response:
            raw = response.read().decode() or "{}"
            return response.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw[:200]}
        return exc.code, payload


def login_farmer() -> dict:
    # The demo account still follows the ordinary two-step OTP flow.
    api("/api/auth/farmer/request-otp", "POST", {"mobile": FARMER["mobile"], "intent": "login"})
    status, data = api("/api/auth/farmer/verify-otp", "POST", {"mobile": FARMER["mobile"], "otp": FARMER["otp"]})
    if status != 200:
        raise SystemExit(f"farmer login failed ({status}): {data.get('error')} — set PM_FARMER_OTP to a fresh code, "
                         "or run the backend with DEMO_MODE=true")
    return data


def browser_style_subscription(endpoint: str) -> dict:
    """A well-formed subscription, exactly like navigator.pushManager.subscribe()."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from py_vapid.utils import b64urlencode

    key = ec.generate_private_key(ec.SECP256R1())
    point = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": b64urlencode(point), "auth": b64urlencode(os.urandom(16))},
        "expirationTime": None,
    }


def wait_for_push(path: str, since: float, timeout: float = PUSH_WAIT_SECONDS) -> dict | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        for entry in received:
            if entry["path"] == path and entry["at"] >= since:
                return entry
        time.sleep(0.2)
    return None


def close_call(call_id: str, farmer_token: str) -> None:
    for verb in ("cancel", "end"):
        api(f"/api/webcall/calls/{call_id}/{verb}", "POST", {}, farmer_token)


def place_call(farmer_token: str, expected_vet_id) -> str | None:
    """Create a call and require that it really RINGS for the expected vet.

    A 200 (instead of 201) means the server found nobody routable: no
    veterinarian has a live availability + presence lease for this language, so
    no push can be expected and the check must say so instead of passing.
    """
    status, data = api("/api/webcall/calls", "POST",
                       {"language": LANGUAGE, "reason": "animal_sick", "notes": "push loopback check"}, farmer_token)
    call = data.get("call") or {}
    if status != 201 or call.get("status") != "ringing":
        print(f"  ! the call did not ring (HTTP {status}, status={call.get('status')!r}, "
              f"outcome={data.get('outcome')!r}, reason={data.get('message')!r})")
        check(False, "the call rings for the veterinarian under test")
        return None
    assigned = (call.get("vet") or {}).get("id")
    check(assigned == expected_vet_id, f"the call was routed to the veterinarian under test ({assigned})")
    return call.get("call_id")


try:
    print("\n▶ sign in and inspect the push configuration the browser would read")
    status, vet = api("/api/auth/login", "POST", {"identifier": VET["email"], "password": VET["password"]})
    if status != 200:
        raise SystemExit(f"vet login failed ({status}): {vet.get('error')}")
    vet_token = vet["token"]
    farmer = login_farmer()
    farmer_token = farmer["token"]

    status, key_info = api("/api/push/vapid-key", token=vet_token)
    check(status == 200 and key_info.get("configured") is True,
          f"the backend reports Web Push configured ({status})")
    check(key_info.get("publicKey") == PUBLIC_KEY,
          "the public key served to browsers matches the deployed VAPID_PUBLIC_KEY")

    status, _ = api("/api/push/subscribe", "POST", browser_style_subscription(ACCEPT_ENDPOINT))
    check(status == 401, "an unauthenticated subscription is rejected")

    print("\n▶ store two subscriptions for the veterinarian (one healthy, one dead)")
    status, _ = api("/api/push/subscribe", "POST", browser_style_subscription(ACCEPT_ENDPOINT), vet_token)
    check(status == 200, f"healthy subscription stored ({status})")
    status, _ = api("/api/push/subscribe", "POST", browser_style_subscription(GONE_ENDPOINT), vet_token)
    check(status == 200, f"second subscription stored ({status})")

    # The veterinarian must be routable: routing requires an explicit
    # AVAILABLE status AND a live presence lease, otherwise "no vet online" is
    # the honest answer and no push is sent. The portal gets the lease from the
    # Socket.IO heartbeat; this REST endpoint is the documented fallback for a
    # client whose sockets are blocked.
    api("/api/vet/availability", "PUT", {"status": "AVAILABLE", "supported_languages": ["en", "hi", "mr", "te"]}, vet_token)
    status, presence = api("/api/webcall/presence", "POST", {"client": "push_loopback_check"}, vet_token)
    check(status == 200 and presence.get("online") is True, f"the veterinarian holds a live presence lease ({status})")
    expected_vet_id = vet.get("user", {}).get("id")

    print("\n▶ a farmer's call sends real Web Push requests to both subscriptions")
    started = time.time()
    call_id = place_call(farmer_token, expected_vet_id)
    if call_id is None:
        check(False, "a call could be created for the test")
    else:
        healthy = wait_for_push("/accept", started)
        check(healthy is not None, "the healthy subscription received a push request")
        if healthy:
            check(healthy["authorization"].lower().startswith("vapid "),
                  "the request is VAPID-signed (Authorization: vapid …)")
            check(healthy["content_encoding"] == "aes128gcm",
                  f"the payload is encrypted with aes128gcm ({healthy['content_encoding']})")
            check(healthy["bytes"] > 0, f"the encrypted payload is non-empty ({healthy['bytes']} bytes)")
            check(healthy["ttl"].isdigit() and int(healthy["ttl"]) >= 10,
                  f"the TTL covers the ring window ({healthy['ttl']}s) so a stale call notification cannot surface later")
            check(healthy["urgency"].lower() == "high",
                  f"the push is high-urgency so the device is woken promptly ({healthy['urgency'] or 'unset'})")
        dead = wait_for_push("/gone", started)
        check(dead is not None, "the dead subscription was contacted")
        close_call(call_id, farmer_token)

        print("\n▶ the dead subscription is pruned and is not contacted again")
        time.sleep(0.5)
        started = time.time()
        call_id = place_call(farmer_token, expected_vet_id)
        if call_id:
            check(wait_for_push("/accept", started) is not None, "the healthy subscription still receives pushes")
            check(wait_for_push("/gone", started) is None, "the 410 subscription is no longer used (pruned)")
            close_call(call_id, farmer_token)

    print("\n▶ unsubscribing stops delivery")
    status, _ = api("/api/push/unsubscribe", "POST", {"endpoint": ACCEPT_ENDPOINT}, vet_token)
    check(status == 200, f"unsubscribe accepted ({status})")
    time.sleep(0.3)
    started = time.time()
    call_id = place_call(farmer_token, expected_vet_id)
    if call_id:
        check(wait_for_push("/accept", started) is None, "no push is sent to an unsubscribed endpoint")
        close_call(call_id, farmer_token)
finally:
    server.shutdown()

total = checks
print(f"\n{'-' * 68}")
if failures:
    print(f"FAIL — {len(failures)} of {total} checks failed:")
    for item in failures:
        print(f"  • {item}")
    raise SystemExit(1)
print(f"PASS — {total} checks: the backend sends real VAPID-signed, encrypted Web Push "
      "requests to live subscriptions and prunes dead ones.")
print("NOT COVERED: a real browser/OS displaying the notification (needs a device).")
