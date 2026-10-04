#!/usr/bin/env python3
"""Generate the VAPID key pair used for Web Push (incoming-call notifications).

The keys printed here are exactly the two values the deployment needs:

    VAPID_PUBLIC_KEY    base64url, uncompressed P-256 point (87 characters)
    VAPID_PRIVATE_KEY   base64url, raw 32-byte P-256 scalar (43 characters)

They are accepted by the deployed stack as-is:
``push_service.py`` passes the private key to ``pywebpush.webpush()``, which
calls ``py_vapid.Vapid.from_string()`` — that understands this raw/base64url
form as well as a PEM/DER string.

Usage::

    python3 backend/tools/vapid_keys.py            # prints a fresh pair
    python3 backend/tools/vapid_keys.py --pem      # also print the PEM form

Both values are secrets except the public key, which the browser fetches from
``GET /api/push/vapid-key``. Nothing is written to disk here; copy the private
key into the platform's environment settings (Render dashboard, ``sync: false``)
and never into Git.

Generating a *new* pair invalidates every existing subscription: browsers hold
a subscription bound to the application server key, so after rotating keys each
device must press "Enable call notifications" again.
"""
from __future__ import annotations

import argparse
import sys

try:
    from py_vapid import Vapid02
    from py_vapid.utils import b64urlencode
    from cryptography.hazmat.primitives import serialization
except ImportError:  # pragma: no cover - operator-facing error
    print(
        "py_vapid/cryptography are not installed. Install the backend requirements first:\n"
        "    pip install -r backend/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(2)


def generate() -> tuple[str, str, str]:
    """Return (public base64url, private base64url, private PEM)."""
    vapid = Vapid02()
    vapid.generate_keys()
    public_raw = vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    private_raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    private_pem = vapid.private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return b64urlencode(public_raw), b64urlencode(private_raw), private_pem


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate VAPID keys for Web Push.")
    parser.add_argument("--pem", action="store_true", help="also print the private key in PEM form")
    args = parser.parse_args()

    public_key, private_key, private_pem = generate()

    # Self-check: the deployment loads the private key through pywebpush's
    # from_string() path and must derive the same public key we print.
    from py_vapid import Vapid02 as Vapid
    reloaded = Vapid.from_string(private_key)
    derived = b64urlencode(
        reloaded.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    if derived != public_key:
        print("KEY GENERATION FAILED: the derived public key does not match.", file=sys.stderr)
        return 1

    print("VAPID_PUBLIC_KEY=" + public_key)
    print("VAPID_PRIVATE_KEY=" + private_key)
    print("VAPID_CLAIM_EMAIL=mailto:admin@example.org   # set this to a real contact address")
    if args.pem:
        print()
        print("# PEM form (only if a tool needs it):")
        print(private_pem)
    print()
    print("# Self-check passed: the private key reloads into the same public key.")
    print("# Set the two keys in the Render dashboard (sync: false). Never commit them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
