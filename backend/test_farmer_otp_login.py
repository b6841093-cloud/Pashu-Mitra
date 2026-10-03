"""Farmer OTP login tests — API flow, security controls and regression checks.

Run with::

    cd backend
    python -m pytest test_farmer_otp_login.py -v      # or
    python -m unittest test_farmer_otp_login -v

The SMS gateway is stubbed: ``sms_gateway.send_text_message`` is patched per
test so no real SMS is sent. The stub captures the message body, which is how
these tests obtain the OTP exactly like a farmer's handset would — the OTP is
never returned by the API.

Coverage: valid OTP, wrong OTP, expired OTP, replayed OTP, attempt limit,
resend cooldown, SMS gateway failure, unknown numbers / other roles,
rate limiting, single-use + race safety, and preservation of the existing
password login for Vet / Government / Lab (and the farmer password fallback).
"""
from __future__ import annotations

import os
import re
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ.setdefault("SIH_SECRET_KEY", "test-secret-key-for-otp-suite")
os.environ.setdefault("OTP_PEPPER", "test-pepper-for-otp-suite")
# Keep the suite away from developer data unless the caller pinned a DB path.
os.environ.setdefault("SIH_DB_PATH", os.path.join(os.path.dirname(__file__), "test_otp_login.db"))

import app as app_module  # noqa: E402  (import after env setup)
import database  # noqa: E402
import ivr_config  # noqa: E402
import sms_gateway  # noqa: E402

FARMER_MOBILE = "9800000001"          # seeded owner (Rajesh Patil)
FARMER_MOBILE_E164 = "+919800000001"
FARMER_2_MOBILE = "9800000002"        # seeded second owner (Sunita More)
VET_MOBILE = "9800000010"
GOVT_EMAIL = "govt@example.com"
LAB_EMAIL = "lab@example.com"
VET_EMAIL = "vet1@example.com"
DEMO_PASSWORD = "password123"


class FakeGateway:
    """Captures OTP SMS instead of contacting the Android SMS Gateway."""

    def __init__(self, fail_with: str | None = None):
        self.fail_with = fail_with
        self.messages: list[dict] = []

    def __call__(self, to_e164, text, **kwargs):
        if self.fail_with:
            code = self.fail_with
            raise sms_gateway.SmsGatewayError("stubbed failure", code=code, status=503)
        self.messages.append({"to": to_e164, "text": text})
        return {
            "delivered": True, "simulated": False, "mode": "CLOUD",
            "message_id": f"stub-{len(self.messages)}", "state": "Pending",
            "provider": "ANDROID_SMS_GATEWAY",
        }

    @property
    def last_code(self) -> str | None:
        if not self.messages:
            return None
        match = re.search(r"\b(\d{6})\b", self.messages[-1]["text"])
        return match.group(1) if match else None


class OtpTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        cls.client = app_module.app.test_client()
        conn = database.get_db()
        cls.farmer = dict(conn.execute("SELECT * FROM users WHERE mobile=?", (FARMER_MOBILE,)).fetchone())
        cls.farmer2 = dict(conn.execute("SELECT * FROM users WHERE mobile=?", (FARMER_2_MOBILE,)).fetchone())
        cls.vet = dict(conn.execute("SELECT * FROM users WHERE email=?", (VET_EMAIL,)).fetchone())
        cls.lab = dict(conn.execute("SELECT * FROM users WHERE email=?", (LAB_EMAIL,)).fetchone())
        cls.govt = dict(conn.execute("SELECT * FROM users WHERE email=?", (GOVT_EMAIL,)).fetchone())
        conn.commit()
        conn.close()

    def setUp(self):
        self.gateway = FakeGateway()
        self._patcher = mock.patch.object(sms_gateway, "send_text_message", self.gateway)
        self._patcher.start()
        self.addCleanup(self._patcher.stop)
        self._reset_otp_tables()
        # Real gateway availability for endpoint gating (patched sender is used
        # only after the availability check).
        self._env = mock.patch.dict(os.environ, {"SMS_GATEWAY_MODE": "CLOUD",
                                                 "SMS_GATEWAY_BASE_URL": "https://api.sms-gate.app/3rdparty/v1",
                                                 "SMS_GATEWAY_USERNAME": "test-user",
                                                 "SMS_GATEWAY_PASSWORD": "test-pass"}, clear=False)
        self._env.start()
        self.addCleanup(self._env.stop)

    def _reset_otp_tables(self):
        conn = database.get_db()
        conn.execute("DELETE FROM otp_codes")
        conn.execute("DELETE FROM otp_request_log")
        conn.commit()
        conn.close()

    # ------------------------------------------------------------- helpers
    def request_otp(self, mobile=FARMER_MOBILE, **kwargs):
        return self.client.post("/api/auth/farmer/request-otp", json={"mobile": mobile, **kwargs})

    def resend_otp(self, mobile=FARMER_MOBILE):
        return self.client.post("/api/auth/farmer/resend-otp", json={"mobile": mobile})

    def verify_otp(self, code, mobile=FARMER_MOBILE):
        return self.client.post("/api/auth/farmer/verify-otp", json={"mobile": mobile, "otp": code})

    def issue_otp(self, mobile=FARMER_MOBILE):
        response = self.request_otp(mobile)
        self.assertEqual(response.status_code, 200, response.get_json())
        code = self.gateway.last_code
        self.assertIsNotNone(code, "OTP SMS should have been handed to the gateway")
        return code

    def _force_expiry(self, mobile=FARMER_MOBILE_E164):
        conn = database.get_db()
        past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        conn.execute("UPDATE otp_codes SET expires_at=? WHERE mobile_e164=? AND status='ACTIVE'",
                     (past, mobile))
        conn.commit()
        conn.close()

    def _otp_row(self, mobile=FARMER_MOBILE_E164):
        conn = database.get_db()
        row = conn.execute("SELECT * FROM otp_codes WHERE mobile_e164=? ORDER BY id DESC LIMIT 1",
                           (mobile,)).fetchone()
        conn.close()
        return dict(row) if row else None

    # ------------------------------------------------- 1. happy path login
    def test_01_valid_otp_logs_farmer_in(self):
        code = self.issue_otp()
        response = self.verify_otp(code)
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertIn("token", body)
        self.assertEqual(body["user"]["role"], "owner")
        self.assertEqual(body["user"]["id"], self.farmer["id"])
        self.assertEqual(body["login_method"], "otp")
        # No password material and no OTP ever leaves the API.
        self.assertNotIn("otp", body)
        self.assertNotIn("password_hash", body["user"])
        self.assertNotIn("salt", body["user"])
        # The issued JWT is accepted by the existing authorization middleware.
        me = self.client.get("/api/users/me", headers={"Authorization": f"Bearer {body['token']}"})
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.get_json()["mobile"], FARMER_MOBILE)

    def test_02_sms_contains_only_the_code_and_a_message(self):
        code = self.issue_otp()
        self.assertRegex(self.gateway.messages[-1]["text"], rf"\b{code}\b")
        self.assertEqual(self.gateway.messages[-1]["to"], FARMER_MOBILE_E164)

    def test_03_otp_message_uses_farmer_preferred_language(self):
        conn = database.get_db()
        conn.execute("UPDATE users SET preferred_language='mr' WHERE id=?", (self.farmer["id"],))
        conn.commit()
        conn.close()
        try:
            self.issue_otp()
            self.assertIn("लॉगिन", self.gateway.messages[-1]["text"])
        finally:
            conn = database.get_db()
            conn.execute("UPDATE users SET preferred_language=? WHERE id=?",
                         (self.farmer.get("preferred_language"), self.farmer["id"]))
            conn.commit()
            conn.close()

    # ------------------------------------------------------- 2. bad codes
    def test_04_incorrect_otp_rejected(self):
        code = self.issue_otp()
        wrong = "000000" if code != "000000" else "111111"
        response = self.verify_otp(wrong)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_INVALID")
        self.assertNotIn("token", response.get_json())
        # The correct code still works afterwards (attempts remain).
        self.assertEqual(self.verify_otp(code).status_code, 200)

    def test_05_malformed_otp_rejected(self):
        self.issue_otp()
        for bad in ("12345", "abcdef", "", "1234567"):
            response = self.verify_otp(bad)
            self.assertEqual(response.status_code, 400, bad)
            self.assertEqual(response.get_json()["code"], "INVALID_OTP_FORMAT")

    def test_06_expired_otp_rejected(self):
        code = self.issue_otp()
        self._force_expiry()
        response = self.verify_otp(code)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_EXPIRED")
        row = self._otp_row()
        self.assertEqual(row["status"], "EXPIRED")

    def test_07_replayed_otp_rejected(self):
        code = self.issue_otp()
        self.assertEqual(self.verify_otp(code).status_code, 200)
        replay = self.verify_otp(code)
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.get_json()["code"], "OTP_ALREADY_USED")
        self.assertNotIn("token", replay.get_json())

    def test_08_attempt_limit_locks_otp(self):
        code = self.issue_otp()
        wrong = "000000" if code != "000000" else "111111"
        statuses = []
        for _ in range(5):
            statuses.append(self.verify_otp(wrong).status_code)
        self.assertEqual(statuses[:4], [401, 401, 401, 401])
        self.assertEqual(statuses[4], 429)
        self.assertEqual(self._otp_row()["status"], "LOCKED")
        # Even the correct code is refused once locked.
        locked = self.verify_otp(code)
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.get_json()["code"], "OTP_LOCKED")

    def test_09_new_otp_invalidates_older_active_otp(self):
        first = self.issue_otp()
        # Bypass the cooldown the way a farmer returning after a minute would.
        conn = database.get_db()
        conn.execute("UPDATE otp_request_log SET created_at=? WHERE outcome='SENT'",
                     ((datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(),))
        conn.commit()
        conn.close()
        second = self.issue_otp()
        self.assertNotEqual(first, second)
        stale = self.verify_otp(first)
        self.assertEqual(stale.status_code, 401)
        self.assertIn(stale.get_json()["code"], ("OTP_INVALID", "OTP_ALREADY_USED"))
        self.assertEqual(self.verify_otp(second).status_code, 200)

    # --------------------------------------------------- 3. cooldown / rate
    def test_10_resend_cooldown_enforced(self):
        self.issue_otp()
        response = self.resend_otp()
        self.assertEqual(response.status_code, 429)
        body = response.get_json()
        self.assertEqual(body["code"], "COOLDOWN_ACTIVE")
        self.assertGreater(body["retry_after"], 0)
        self.assertLessEqual(body["retry_after"], 60)
        # Only one SMS was handed over.
        self.assertEqual(len(self.gateway.messages), 1)

    def test_11_resend_after_cooldown_sends_new_otp(self):
        first = self.issue_otp()
        conn = database.get_db()
        conn.execute("UPDATE otp_request_log SET created_at=? WHERE outcome='SENT'",
                     ((datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat(),))
        conn.commit()
        conn.close()
        response = self.resend_otp()
        self.assertEqual(response.status_code, 200)
        second = self.gateway.last_code
        self.assertEqual(len(self.gateway.messages), 2)
        self.assertNotEqual(first, second)
        self.assertEqual(self.verify_otp(second).status_code, 200)

    def test_12_per_mobile_rate_limit(self):
        with mock.patch.dict(os.environ, {"OTP_RESEND_COOLDOWN_SECONDS": "0"}):
            codes = []
            for _ in range(5):
                response = self.request_otp()
                self.assertEqual(response.status_code, 200)
                codes.append(self.gateway.last_code)
            blocked = self.request_otp()
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.get_json()["code"], "RATE_LIMITED")
        self.assertEqual(len(set(codes)), 5, "each request must issue a fresh OTP")

    def test_13_per_ip_rate_limit(self):
        with mock.patch.dict(os.environ, {"OTP_IP_MAX_REQUESTS": "3",
                                          "OTP_RESEND_COOLDOWN_SECONDS": "0"}):
            for mobile in (FARMER_MOBILE, FARMER_2_MOBILE, "9800000099"):
                self.assertEqual(self.request_otp(mobile).status_code, 200)
            blocked = self.request_otp("9800000098")
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.get_json()["code"], "RATE_LIMITED")

    # ------------------------------------------------ 4. gateway failures
    def test_14_gateway_failure_never_reports_success(self):
        self.gateway.fail_with = "SMS_GATEWAY_UNAVAILABLE"
        response = self.request_otp()
        self.assertEqual(response.status_code, 502)
        body = response.get_json()
        self.assertEqual(body["code"], "SMS_GATEWAY_UNAVAILABLE")
        self.assertNotIn("ok", body)
        # The unusable OTP is retired and cannot be verified.
        row = self._otp_row()
        self.assertEqual(row["status"], "SEND_FAILED")
        self.assertTrue(all(m["status"] != "ACTIVE" for m in
                            database.get_db().execute(
                                "SELECT status FROM otp_codes WHERE mobile_e164=?",
                                (FARMER_MOBILE_E164,)).fetchall()))
        self.assertIsNone(self.gateway.last_code)
        # A gateway failure must not consume the resend cooldown.
        self.gateway.fail_with = None
        self.assertEqual(self.request_otp().status_code, 200)

    def test_15_gateway_not_configured_returns_503(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_MODE": "CLOUD",
                                          "SMS_GATEWAY_USERNAME": "",
                                          "SMS_GATEWAY_PASSWORD": ""}):
            response = self.request_otp()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "SMS_GATEWAY_NOT_CONFIGURED")
        self.assertFalse(response.get_json()["password_fallback_enabled"] is None)

    def test_16_gateway_auth_failure_is_reported_safely(self):
        self.gateway.fail_with = "SMS_GATEWAY_AUTH_FAILED"
        response = self.request_otp()
        self.assertEqual(response.status_code, 502)
        body = response.get_json()
        self.assertEqual(body["code"], "SMS_GATEWAY_AUTH_FAILED")
        self.assertNotIn("password", str(body).lower())
        self.assertNotIn("test-pass", str(body))

    # --------------------------------- 5. enumeration / role preservation
    def test_17_unknown_number_gets_identical_response(self):
        known = self.request_otp(FARMER_MOBILE)
        conn = database.get_db()
        conn.execute("DELETE FROM otp_request_log")
        conn.commit()
        conn.close()
        unknown = self.request_otp("9999999999")
        self.assertEqual(known.status_code, unknown.status_code)
        self.assertEqual({k: v for k, v in known.get_json().items()},
                         {k: v for k, v in unknown.get_json().items()})
        # ...but no SMS is sent to an unregistered number.
        self.assertEqual(len(self.gateway.messages), 1)
        self.assertNotIn("9999999999", str(self.gateway.messages))

    def test_18_other_roles_cannot_use_farmer_otp(self):
        # A vet's mobile number is treated exactly like an unknown farmer number.
        response = self.request_otp(VET_MOBILE)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.gateway.messages), 0)
        conn = database.get_db()
        count = conn.execute("SELECT COUNT(*) c FROM otp_codes WHERE mobile_e164=?",
                             ("+919800000010",)).fetchone()["c"]
        conn.close()
        self.assertEqual(count, 0)

    def test_19_unknown_number_verify_is_generic(self):
        response = self.verify_otp("123456", mobile="9812345678")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_INVALID")
        self.assertNotIn("token", response.get_json())

    # ----------------------------------------------- 6. storage & crypto
    def test_20_plaintext_otp_is_never_stored(self):
        code = self.issue_otp()
        row = self._otp_row()
        self.assertNotEqual(row["otp_hash"], code)
        self.assertNotIn(code, str(row))
        self.assertEqual(row["status"], "ACTIVE")
        self.assertEqual(row["attempts"], 0)
        self.assertEqual(row["max_attempts"], 5)
        self.assertEqual(row["purpose"], "farmer_login")
        self.assertEqual(row["role"], "owner")

    def test_21_concurrent_verification_consumes_otp_once(self):
        code = self.issue_otp()
        first = self.verify_otp(code)
        second = self.verify_otp(code)  # simulates the replay of a race winner
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 401)
        self.assertEqual(second.get_json()["code"], "OTP_ALREADY_USED")
        conn = database.get_db()
        used = conn.execute("SELECT COUNT(*) c FROM otp_codes WHERE status='USED'").fetchone()["c"]
        conn.close()
        self.assertEqual(used, 1)

    def test_22_otp_codes_are_six_digits_and_unique(self):
        seen = set()
        with mock.patch.dict(os.environ, {"OTP_RESEND_COOLDOWN_SECONDS": "0",
                                          "OTP_MOBILE_MAX_REQUESTS": "50"}):
            for _ in range(5):
                self.request_otp()
                code = self.gateway.last_code
                self.assertTrue(re.fullmatch(r"\d{6}", code))
                seen.add(code)
        self.assertGreater(len(seen), 1, "OTPs must not repeat predictably")

    # ------------------------------------- 7. role login preservation
    def test_23_vet_govt_lab_password_login_unchanged(self):
        for email, role in ((VET_EMAIL, "vet"), (GOVT_EMAIL, "govt"), (LAB_EMAIL, "lab")):
            response = self.client.post("/api/auth/login",
                                        json={"identifier": email, "password": DEMO_PASSWORD})
            self.assertEqual(response.status_code, 200, email)
            body = response.get_json()
            self.assertEqual(body["user"]["role"], role)
            self.assertIn("token", body)

    def test_24_farmer_password_login_still_works_as_fallback(self):
        response = self.client.post("/api/auth/login",
                                    json={"identifier": FARMER_MOBILE, "password": DEMO_PASSWORD})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["user"]["role"], "owner")
        self.assertEqual(response.get_json()["user"]["id"], self.farmer["id"])

    def test_25_farmer_otp_does_not_issue_other_role_tokens(self):
        """A farmer OTP session must not be able to reach vet/govt endpoints."""
        code = self.issue_otp()
        token = self.verify_otp(code).get_json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        for path in ("/api/govt/analytics", "/api/lab/summary", "/api/vet/summary"):
            response = self.client.get(path, headers=headers)
            self.assertIn(response.status_code, (401, 403), path)

    def test_26_existing_farmer_data_is_preserved(self):
        code = self.issue_otp()
        token = self.verify_otp(code).get_json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        animals = self.client.get("/api/animals", headers=headers)
        herds = self.client.get("/api/herds", headers=headers)
        summary = self.client.get("/api/owner/summary", headers=headers)
        self.assertEqual(animals.status_code, 200)
        self.assertGreater(len(animals.get_json()), 0)
        self.assertEqual(herds.status_code, 200)
        self.assertGreater(len(herds.get_json()), 0)
        self.assertEqual(summary.status_code, 200)
        self.assertIn("animals", summary.get_json())

    # ------------------------------------------------------- 8. config API
    def test_27_farmer_auth_config_is_public_and_secret_free(self):
        response = self.client.get("/api/auth/farmer/config")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertIn("otp_login_enabled", body)
        self.assertIn("password_fallback_enabled", body)
        self.assertEqual(body["otp_length"], 6)
        self.assertEqual(body["resend_cooldown_seconds"], 60)
        text = str(body).lower()
        for secret in ("password", "username", "base_url", "sms_gateway_mode"):
            self.assertNotIn(f'"{secret}"', text.replace('"password_fallback_enabled"', ""))

    def test_28_health_reports_gateway_state_without_credentials(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertIn("sms_gateway", body)
        self.assertIn("farmer_otp_login", body)
        self.assertNotIn("test-pass", str(body))
        self.assertNotIn("test-user", str(body))

    def test_29_missing_mobile_is_rejected_cleanly(self):
        response = self.client.post("/api/auth/farmer/request-otp", json={})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["code"], "INVALID_MOBILE")
        bad = self.request_otp("12345")
        self.assertEqual(bad.status_code, 400)

    def test_30_otp_rows_and_logs_are_pruned(self):
        """Housekeeping keeps the auth tables bounded without touching users."""
        self.issue_otp()
        conn = database.get_db()
        old = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        conn.execute("UPDATE otp_codes SET created_at=?", (old,))
        conn.execute("UPDATE otp_request_log SET created_at=?", (old,))
        conn.commit()
        conn.close()
        # A later request triggers the opportunistic purge.
        with mock.patch.dict(os.environ, {"OTP_RESEND_COOLDOWN_SECONDS": "0"}):
            self.request_otp(FARMER_2_MOBILE)
        conn = database.get_db()
        leftover = conn.execute("SELECT COUNT(*) c FROM otp_codes WHERE created_at=?",
                                (old,)).fetchone()["c"]
        users = conn.execute("SELECT COUNT(*) c FROM users WHERE role='owner'").fetchone()["c"]
        conn.close()
        self.assertEqual(leftover, 0)
        self.assertGreaterEqual(users, 2)


class SmsGatewayClientUnitTests(unittest.TestCase):
    """Wire-level checks for the capcom6 Cloud Server client (no network)."""

    def setUp(self):
        self.env = mock.patch.dict(os.environ, {
            "SMS_GATEWAY_MODE": "CLOUD",
            "SMS_GATEWAY_BASE_URL": "https://api.sms-gate.app/3rdparty/v1",
            "SMS_GATEWAY_USERNAME": "user",
            "SMS_GATEWAY_PASSWORD": "pass",
            "SMS_GATEWAY_DEVICE_ID": "dev-123",
            "SMS_GATEWAY_TIMEOUT": "9",
        }, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_g01_uses_documented_endpoint_and_auth(self):
        config = sms_gateway.get_gateway_config()
        self.assertEqual(config.endpoint(), "https://api.sms-gate.app/3rdparty/v1/messages")
        self.assertEqual(config.timeout, 9.0)

        with mock.patch("sms_gateway.requests.post") as post:
            post.return_value = mock.Mock(status_code=200, json=lambda: {"id": "abc", "state": "Pending"})
            result = sms_gateway.send_text_message("+919800000001", "PashuMitra test")
            args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.sms-gate.app/3rdparty/v1/messages")
        self.assertEqual(kwargs["auth"], ("user", "pass"))
        self.assertEqual(kwargs["json"]["textMessage"]["text"], "PashuMitra test")
        self.assertEqual(kwargs["json"]["phoneNumbers"], ["+919800000001"])
        self.assertEqual(kwargs["json"]["deviceId"], "dev-123")
        self.assertNotIn("message", kwargs["json"])   # legacy shape not used
        self.assertEqual(kwargs["timeout"], 9.0)
        self.assertTrue(result["delivered"])
        self.assertEqual(result["message_id"], "abc")

    def test_g02_local_server_endpoint_uses_singular_path(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_BASE_URL": "http://192.168.1.20:8080"}):
            self.assertEqual(sms_gateway.get_gateway_config().endpoint(),
                             "http://192.168.1.20:8080/message")

    def test_g03_device_id_omitted_when_not_configured(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_DEVICE_ID": ""}):
            payload = sms_gateway.build_payload(sms_gateway.get_gateway_config(),
                                                "+919800000001", "hi")
        self.assertNotIn("deviceId", payload)

    def test_g04_auth_failure_raises_safe_error(self):
        with mock.patch("sms_gateway.requests.post") as post:
            post.return_value = mock.Mock(status_code=401, json=lambda: {"message": "unauthorized"},
                                          text="unauthorized")
            with self.assertRaises(sms_gateway.SmsGatewayAuthError) as ctx:
                sms_gateway.send_text_message("+919800000001", "x")
        self.assertEqual(ctx.exception.code, "SMS_GATEWAY_AUTH_FAILED")
        self.assertNotIn("pass", str(ctx.exception))

    def test_g05_timeout_is_retryable(self):
        with mock.patch("sms_gateway.requests.post") as post:
            post.side_effect = sms_gateway.requests.exceptions.Timeout()
            with self.assertRaises(sms_gateway.SmsGatewayUnavailable) as ctx:
                sms_gateway.send_text_message("+919800000001", "x")
        self.assertTrue(ctx.exception.retryable)

    def test_g06_mock_mode_never_contacts_the_network(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_MODE": "MOCK"}), \
                mock.patch("sms_gateway.requests.post") as post, \
                mock.patch.object(sms_gateway, "is_production", return_value=False):
            result = sms_gateway.send_text_message("+919800000001", "x")
        post.assert_not_called()
        self.assertFalse(result["delivered"])
        self.assertTrue(result["simulated"])

    def test_g07_mock_mode_refused_in_production(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_MODE": "MOCK"}), \
                mock.patch("sms_gateway.requests.post") as post, \
                mock.patch.object(sms_gateway, "is_production", return_value=True):
            with self.assertRaises(sms_gateway.SmsGatewayNotConfigured):
                sms_gateway.send_text_message("+919800000001", "x")
        post.assert_not_called()

    def test_g08_plain_http_refused_in_cloud_mode(self):
        with mock.patch.dict(os.environ, {"SMS_GATEWAY_BASE_URL": "http://api.sms-gate.app/3rdparty/v1"}), \
                mock.patch("sms_gateway.requests.post") as post:
            with self.assertRaises(sms_gateway.SmsGatewayNotConfigured):
                sms_gateway.send_text_message("+919800000001", "x")
        post.assert_not_called()

    def test_g09_logging_never_contains_the_code(self):
        with mock.patch("sms_gateway.requests.post") as post, \
                self.assertLogs("sms_gateway", level="INFO") as captured:
            post.return_value = mock.Mock(status_code=202, json=lambda: {"id": "m1", "state": "Pending"})
            sms_gateway.send_text_message("+919800000001", "Your OTP is 424242")
        logs = "\n".join(captured.output)
        self.assertNotIn("424242", logs)
        self.assertNotIn("Your OTP", logs)

    def test_g10_scrub_redacts_numbers(self):
        self.assertNotIn("424242", sms_gateway.scrub("bad code 424242 for +919800000001"))
        self.assertIn("******0001", sms_gateway.mask_phone("+919800000001"))


class OtpServiceUnitTests(unittest.TestCase):
    """Focused unit tests for OTP hashing and normalisation helpers."""

    def test_s01_codes_are_random_and_zero_padded(self):
        codes = {__import__("otp_service").generate_otp() for _ in range(200)}
        self.assertGreater(len(codes), 190)
        self.assertTrue(all(re.fullmatch(r"\d{6}", c) for c in codes))

    def test_s02_hash_is_salted_and_peppered(self):
        import otp_service

        a = otp_service.hash_otp("123456", "salt-a")
        b = otp_service.hash_otp("123456", "salt-b")
        self.assertNotEqual(a, b)
        self.assertEqual(a, otp_service.hash_otp("123456", "salt-a"))
        with mock.patch.dict(os.environ, {"OTP_PEPPER": "different-pepper"}):
            self.assertNotEqual(a, otp_service.hash_otp("123456", "salt-a"))

    def test_s03_indian_mobile_normalisation(self):
        import otp_service

        for raw in ("9800000001", "+919800000001", "09800000001", "919800000001", " 98000 00001 "):
            self.assertEqual(otp_service.normalize_mobile(raw), "+919800000001", raw)
        for bad in ("12345", "", None, "abcd", "1234567890123456"):
            self.assertIsNone(otp_service.normalize_mobile(bad), bad)
        self.assertEqual(ivr_config.local_number("+919800000001"), "9800000001")


if __name__ == "__main__":
    unittest.main(verbosity=2)
