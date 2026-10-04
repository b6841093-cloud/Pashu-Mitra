"""Farmer phone-OTP login through Clerk — token exchange tests.

Run with::

    cd backend
    python -m pytest test_clerk_login.py -v

Clerk itself is not contacted: session tokens are signed with a local RSA key
and the JWKS client / Backend API are patched.
"""
from __future__ import annotations

import base64
import os
import time
import unittest
from unittest import mock

os.environ.setdefault("SIH_SECRET_KEY", "test-secret-key-for-clerk-suite")
os.environ.setdefault("OTP_PEPPER", "test-pepper-for-clerk-suite")
os.environ.setdefault("SIH_DB_PATH", os.path.join(os.path.dirname(__file__), "test_clerk_login.db"))

HOST = "test-app-12.clerk.accounts.dev"
PK = "pk_test_" + base64.b64encode(f"{HOST}$".encode()).decode().rstrip("=")
os.environ["CLERK_PUBLISHABLE_KEY"] = PK
os.environ["CLERK_SECRET_KEY"] = "sk_test_dummy"

import jwt  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import rsa  # noqa: E402

import app as app_module  # noqa: E402
import clerk_auth  # noqa: E402
import database  # noqa: E402
import env_file  # noqa: E402

FARMER_MOBILE = "9800000001"   # seeded owner
VET_MOBILE = "9800000010"      # seeded vet
NEW_MOBILE = "9811122233"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJwks:
    def get_signing_key_from_jwt(self, token):
        return mock.Mock(key=_KEY.public_key())

    def get_signing_keys(self):
        return []


def make_session_token(phone=None, *, key=_KEY, iss=f"https://{HOST}", exp_in=60, sub="user_1"):
    now = int(time.time())
    claims = {"sub": sub, "iss": iss, "iat": now, "nbf": now, "exp": now + exp_in,
              "azp": "http://localhost:5001"}
    if phone:
        claims["phone"] = phone
    return jwt.encode(claims, key, algorithm="RS256")


class ClerkLoginTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(database.DB_PATH + suffix)
            except OSError:
                pass
        database.init_db()
        cls.client = app_module.app.test_client()

    def setUp(self):
        patcher = mock.patch.object(clerk_auth, "_jwks_client", return_value=_FakeJwks())
        patcher.start()
        self.addCleanup(patcher.stop)

    def exchange(self, token):
        return self.client.post("/api/auth/farmer/clerk", json={"token": token})

    def test_publishable_key_decodes_to_frontend_api(self):
        self.assertEqual(clerk_auth.frontend_api_host(PK), HOST)
        self.assertIsNone(clerk_auth.frontend_api_host("pk_test_!!!"))

    def test_config_exposes_public_key_only(self):
        data = self.client.get("/api/auth/farmer/config").get_json()
        self.assertTrue(data["phone_auth"]["enabled"])
        self.assertEqual(data["phone_auth"]["publishable_key"], PK)
        self.assertNotIn("sk_test", str(data))

    def test_existing_farmer_logs_in(self):
        res = self.exchange(make_session_token("+91" + FARMER_MOBILE))
        self.assertEqual(res.status_code, 200, res.get_json())
        body = res.get_json()
        self.assertEqual(body["user"]["role"], "owner")
        claims = jwt.decode(body["token"], app_module.SECRET_KEY, algorithms=["HS256"])
        self.assertEqual(claims["role"], "owner")

    def test_new_number_goes_to_signup_then_registers(self):
        res = self.exchange(make_session_token("+91" + NEW_MOBILE))
        body = res.get_json()
        self.assertTrue(body["registration_required"], body)
        self.assertEqual(body["mobile"], NEW_MOBILE)
        reg = self.client.post("/api/auth/farmer/register", json={
            "registration_token": body["registration_token"],
            "full_name": "Phone Farmer", "district": "Pune"})
        self.assertIn(reg.status_code, (200, 201), reg.get_json())
        self.assertEqual(reg.get_json()["user"]["role"], "owner")
        # Single use.
        again = self.client.post("/api/auth/farmer/register", json={
            "registration_token": body["registration_token"],
            "full_name": "Phone Farmer", "district": "Pune"})
        self.assertEqual(again.status_code, 401)

    def test_staff_number_rejected(self):
        res = self.exchange(make_session_token("+91" + VET_MOBILE))
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("token", res.get_json())

    def test_forged_expired_and_wrong_issuer_tokens_rejected(self):
        phone = "+91" + FARMER_MOBILE
        for token in (make_session_token(phone, key=_OTHER_KEY),
                      make_session_token(phone, exp_in=-120),
                      make_session_token(phone, iss="https://evil.example"),
                      "not-a-jwt", ""):
            res = self.exchange(token)
            self.assertIn(res.status_code, (400, 401), token)
            self.assertNotIn("token", res.get_json())

    def test_non_indian_number_rejected(self):
        res = self.exchange(make_session_token("+15555550100"))
        self.assertEqual(res.status_code, 400)

    def test_phone_looked_up_via_backend_api_when_claim_missing(self):
        fake = mock.Mock(status_code=200)
        fake.json.return_value = {
            "primary_phone_number_id": "p2",
            "phone_numbers": [
                {"id": "p1", "phone_number": "+919999999999", "verification": {"status": "unverified"}},
                {"id": "p2", "phone_number": "+91" + FARMER_MOBILE, "verification": {"status": "verified"}},
            ],
        }
        with mock.patch.object(clerk_auth._http, "get", return_value=fake) as get:
            res = self.exchange(make_session_token(None, sub="user_abc"))
        self.assertEqual(res.status_code, 200, res.get_json())
        self.assertIn("/users/user_abc", get.call_args[0][0])

    def test_error_messages_never_name_the_provider(self):
        for token in ("", make_session_token("+91" + FARMER_MOBILE, key=_OTHER_KEY)):
            self.assertNotIn("clerk", self.exchange(token).get_json()["error"].lower())

    def test_disabled_without_keys(self):
        with mock.patch.dict(os.environ, {"CLERK_SECRET_KEY": ""}):
            self.assertEqual(self.client.get("/api/auth/farmer/config").get_json()["phone_auth"],
                             {"enabled": False})
            self.assertEqual(self.exchange(make_session_token("+91" + FARMER_MOBILE)).status_code, 503)


class PhoneStartTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app_module.app.test_client()

    def _resp(self, status, payload):
        r = mock.Mock(status_code=status, headers={"content-type": "application/json"})
        r.json.return_value = payload
        return r

    def test_creates_missing_user_without_password(self):
        with mock.patch.object(clerk_auth._http, "get", return_value=self._resp(200, [])),              mock.patch.object(clerk_auth._http, "post", return_value=self._resp(200, {"id": "u"})) as post:
            res = self.client.post("/api/auth/farmer/phone-start", json={"mobile": NEW_MOBILE})
        self.assertEqual(res.status_code, 200)
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["phone_number"], ["+91" + NEW_MOBILE])
        self.assertTrue(body["skip_password_requirement"])

    def test_existing_user_not_recreated(self):
        with mock.patch.object(clerk_auth._http, "get", return_value=self._resp(200, [{"id": "u"}])),              mock.patch.object(clerk_auth._http, "post") as post:
            res = self.client.post("/api/auth/farmer/phone-start", json={"mobile": FARMER_MOBILE})
        self.assertEqual(res.status_code, 200)
        post.assert_not_called()

    def test_country_not_enabled_is_503_without_provider_name(self):
        err = self._resp(403, {"errors": [{"code": "unsupported_country_code"}]})
        with mock.patch.object(clerk_auth._http, "get", return_value=self._resp(200, [])),              mock.patch.object(clerk_auth._http, "post", return_value=err):
            res = self.client.post("/api/auth/farmer/phone-start", json={"mobile": NEW_MOBILE})
        self.assertEqual(res.status_code, 503)
        self.assertNotIn("clerk", res.get_json()["error"].lower())

    def test_invalid_mobile(self):
        res = self.client.post("/api/auth/farmer/phone-start", json={"mobile": "123"})
        self.assertEqual(res.status_code, 400)


class EnvFileTest(unittest.TestCase):
    def test_parse_line(self):
        self.assertEqual(env_file._parse_line('A="x y"'), ("A", "x y"))
        self.assertEqual(env_file._parse_line("export B=1 # note"), ("B", "1"))
        self.assertIsNone(env_file._parse_line("# comment"))
        self.assertEqual(env_file._parse_line("C="), ("C", ""))


if __name__ == "__main__":
    unittest.main()
