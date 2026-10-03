"""Prototype demo farmer account — gating, login flow and regression checks.

Run with::

    cd backend
    python -m pytest test_demo_account.py -v      # or
    python -m unittest test_demo_account -v

The SMS gateway is stubbed: ``sms_gateway.send_text_message`` is patched so no
real SMS is ever sent, and the stub also records every call. That is how the
suite proves the demo number is never messaged while a real farmer still is.

The test DB is a throwaway file and ``DEMO_MODE`` is toggled per test through
the environment, so the suite never depends on (or leaves behind) a real
deployment configuration.

Mapping to the acceptance criteria
----------------------------------
 3. 8341564042 + 123456 works when demo mode is enabled
 4. the demo farmer gets a valid farmer token and can open the dashboard
 5. repeated demo logins do not create duplicate accounts
 6. the fixed OTP is rejected when demo mode is disabled
 7. the fixed OTP does not work for other phone numbers
 8. vet / government / lab authentication is unchanged
 9. regular farmers still authenticate with a real SMS OTP
10. existing features and role permissions still work
Plus: no SMS for the demo number, no password login for the demo farmer,
explicit production opt-in, and nothing sensitive written to the logs.
"""
from __future__ import annotations

import os
import re
import unittest
from unittest import mock

os.environ.setdefault("SIH_SECRET_KEY", "test-secret-key-for-demo-suite")
os.environ.setdefault("OTP_PEPPER", "test-pepper-for-demo-suite")
os.environ.setdefault("SIH_DB_PATH", os.path.join(os.path.dirname(__file__), "test_demo_account.db"))
# Demo mode is OFF for the whole session unless a test switches it on.
os.environ["DEMO_MODE"] = "false"

import app as app_module  # noqa: E402  (import after env setup)
import database  # noqa: E402
import demo_auth  # noqa: E402
import otp_service  # noqa: E402
import sms_gateway  # noqa: E402

DEMO_MOBILE = "8341564042"
DEMO_MOBILE_E164 = "+918341564042"
DEMO_OTP = "123456"
PREVIOUS_DEMO_MOBILE = "9999999999"
FARMER_MOBILE = "9800000001"          # seeded owner (Rajesh Patil)
FARMER_2_MOBILE = "9800000002"        # seeded second owner (Sunita More)
FARMER_3_MOBILE = "9800000003"        # no account yet
VET_EMAIL = "vet1@example.com"
GOVT_EMAIL = "govt@example.com"
LAB_EMAIL = "lab@example.com"
STAFF_PASSWORD = "password123"

# Base environment for the fake gateway used by the *real* farmer OTP tests.
GATEWAY_ENV = {
    "SMS_GATEWAY_MODE": "CLOUD",
    "SMS_GATEWAY_BASE_URL": "https://api.sms-gate.app/3rdparty/v1",
    "SMS_GATEWAY_USERNAME": "test-user",
    "SMS_GATEWAY_PASSWORD": "test-pass",
}

# Rows a demo farmer can own, so the per-test cleanup can remove them.
DEMO_OWNED_TABLES = (
    ("animals", "owner_id"),
    ("herds", "owner_id"),
    ("cases", "owner_id"),
    ("cases", "vet_id"),
    ("case_updates", "updated_by"),
    ("notifications", "user_id"),
    ("audit_events", "actor_id"),
    ("otp_codes", "user_id"),
    ("farmer_feedback", "owner_id"),
    ("helpline_calls", "farmer_id"),
    ("helpline_reports", "farmer_id"),
    ("push_subscriptions", "user_id"),
)


class FakeGateway:
    """Records every OTP SMS instead of contacting the Android SMS Gateway."""

    def __init__(self):
        self.messages: list[dict] = []

    def __call__(self, to_e164, text, **kwargs):
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


class DemoAccountTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        cls.client = app_module.app.test_client()

    def setUp(self):
        self.gateway = FakeGateway()
        patcher = mock.patch.object(sms_gateway, "send_text_message", self.gateway)
        patcher.start()
        self.addCleanup(patcher.stop)
        # A production process must never silently accept the fixed OTP; the
        # suite runs in development mode unless a test says otherwise.
        self._env = mock.patch.dict(os.environ, {
            "RENDER": "", "FLASK_ENV": "", "APP_ENV": "",
            "DEMO_MODE": "false", "DEMO_MODE_ALLOW_PRODUCTION": "",
            "DEMO_FARMER_MOBILE": DEMO_MOBILE, "DEMO_FARMER_OTP": DEMO_OTP,
            **GATEWAY_ENV,
        }, clear=False)
        self._env.start()
        self.addCleanup(self._env.stop)
        self._reset_otp_tables()
        self._delete_demo_farmer()

    # ------------------------------------------------------------- helpers
    def demo_on(self, **extra):
        """Enable demo mode for the duration of the test."""
        os.environ["DEMO_MODE"] = "true"
        for key, value in extra.items():
            os.environ[key] = value

    def demo_off(self):
        os.environ["DEMO_MODE"] = "false"

    def _reset_otp_tables(self):
        conn = database.get_db()
        try:
            conn.execute("DELETE FROM otp_codes")
            conn.execute("DELETE FROM otp_request_log")
            conn.commit()
        finally:
            # Always close: an abandoned connection would keep a write lock on
            # the throwaway file and stall every following test.
            conn.close()

    def _delete_demo_farmer(self):
        """Remove the demo farmer and every row that references it.

        Test-only cleanup. Foreign keys are switched off on this throwaway
        connection so leftovers from an earlier test (a demo animal, a case,
        an audit row) cannot block the delete.
        """
        conn = database.get_db()
        try:
            conn.execute("PRAGMA foreign_keys = OFF")
            self._delete_owned_rows(conn, (DEMO_MOBILE, DEMO_MOBILE_E164))
            conn.execute("DELETE FROM users WHERE mobile IN (?, ?)",
                         (DEMO_MOBILE, DEMO_MOBILE_E164))
            conn.commit()
            conn.execute("PRAGMA foreign_keys = ON")
        finally:
            conn.close()

    def _delete_owned_rows(self, conn, mobiles):
        ids = [row["id"] for row in conn.execute(
            "SELECT id FROM users WHERE mobile IN (?, ?)", tuple(mobiles)).fetchall()]
        for user_id in ids:
            for table, column in DEMO_OWNED_TABLES:
                # Tolerate a column that a future schema revision drops.
                known = conn.execute(f"PRAGMA table_info({table})").fetchall()
                if column in {row["name"] for row in known}:
                    conn.execute(f"DELETE FROM {table} WHERE {column}=?", (user_id,))

    def _demo_farmer_rows(self) -> list[dict]:
        conn = database.get_db()
        try:
            rows = conn.execute(
                "SELECT * FROM users WHERE mobile IN (?, ?)", (DEMO_MOBILE, DEMO_MOBILE_E164)
            ).fetchall()
        finally:
            conn.close()
        return [dict(row) for row in rows]

    def _user_count(self, mobile) -> int:
        conn = database.get_db()
        try:
            count = conn.execute(
                "SELECT COUNT(*) AS c FROM users WHERE mobile IN (?, ?)",
                (mobile, f"+91{mobile}"),
            ).fetchone()["c"]
        finally:
            conn.close()
        return int(count)

    def request_otp(self, mobile=DEMO_MOBILE, **kwargs):
        return self.client.post("/api/auth/farmer/request-otp",
                                json={"mobile": mobile, **kwargs})

    def verify_otp(self, code, mobile=DEMO_MOBILE):
        return self.client.post("/api/auth/farmer/verify-otp",
                                json={"mobile": mobile, "otp": code})

    def auth(self, token):
        return {"Authorization": f"Bearer {token}"}

    # ================================================================
    # 3. the fixed code works for the demo number in demo mode
    # ================================================================
    def test_01_demo_number_and_fixed_otp_log_in_when_demo_mode_is_on(self):
        self.demo_on()
        self.assertTrue(demo_auth.demo_mode_enabled())

        response = self.request_otp()
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertTrue(response.get_json()["demo"])

        verified = self.verify_otp(DEMO_OTP)
        self.assertEqual(verified.status_code, 200, verified.get_json())
        body = verified.get_json()
        self.assertEqual(body["user"]["role"], "owner")
        self.assertEqual(body["user"]["mobile"], DEMO_MOBILE)
        self.assertEqual(body["login_method"], "otp")
        # Nothing secret is echoed back to the client.
        self.assertNotIn("otp", body)
        self.assertNotIn("password_hash", body["user"])
        self.assertNotIn("salt", body["user"])

    def test_01b_demo_fixed_code_precedes_hash_check_and_normalizes_mobile(self):
        self.demo_on()
        # A second Gunicorn worker or a redeploy can have a different pepper.
        # Demo verification must still match the fixed configured value, while
        # the OTP row continues to enforce request, expiry and single use.
        with mock.patch.dict(os.environ, {"OTP_PEPPER": "demo-request-worker-pepper"}):
            requested = self.request_otp("+91 (834) 156-4042")
        self.assertEqual(requested.status_code, 200, requested.get_json())
        self.assertTrue(requested.get_json()["demo"])

        with mock.patch.dict(os.environ, {"OTP_PEPPER": "demo-verify-worker-pepper"}):
            verified = self.verify_otp(DEMO_OTP, mobile="0091-834-156-4042")
        self.assertEqual(verified.status_code, 200, verified.get_json())
        self.assertEqual(verified.get_json()["user"]["mobile"], DEMO_MOBILE)
        self.assertEqual(verified.get_json()["user"]["role"], "owner")

    def test_01c_fixed_code_requires_a_demo_issued_request_row(self):
        # A real signup OTP created while demo mode was off must not become a
        # demo-code authorization merely because the flag is enabled later.
        with mock.patch.object(otp_service, "generate_otp", return_value="654321"):
            requested = self.request_otp(intent="signup")
        self.assertEqual(requested.status_code, 200, requested.get_json())
        self.assertFalse(requested.get_json()["demo"])

        self.demo_on()
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401)
        verified = self.verify_otp("654321")
        self.assertEqual(verified.status_code, 200, verified.get_json())
        self.assertTrue(verified.get_json()["registration_required"])

    def test_02_demo_number_never_receives_an_sms(self):
        self.demo_on()
        self.request_otp()
        # The gateway was never called: the demo number may be a real handset.
        self.assertEqual(self.gateway.messages, [])
        # And the API says so instead of claiming a delivery.
        body = self.request_otp().get_json()
        self.assertFalse(body["delivery_confirmed"])
        self.assertFalse(body["sms_sent"])
        self.assertIn("no SMS is sent", body["message"])

    def test_03_the_demo_code_is_stored_only_as_a_hash(self):
        self.demo_on()
        self.request_otp()
        conn = database.get_db()
        row = conn.execute(
            "SELECT * FROM otp_codes WHERE mobile_e164=? ORDER BY id DESC LIMIT 1",
            (DEMO_MOBILE_E164,),
        ).fetchone()
        conn.close()
        self.assertIsNotNone(row, "a normal OTP row must exist for the demo number")
        self.assertNotIn(DEMO_OTP, row["otp_hash"])
        self.assertNotEqual(row["otp_hash"], DEMO_OTP)
        self.assertTrue(row["otp_salt"])
        # It is a single-use, expiring row like any other OTP.
        self.assertEqual(row["status"], "ACTIVE")
        self.assertEqual(row["role"], "owner")
        self.assertIsNotNone(row["user_id"])

    def test_04_demo_login_uses_the_ordinary_verification_rules(self):
        self.demo_on()
        self.request_otp()
        # A wrong code is refused exactly as for a real farmer, and a replay of
        # the fixed code is refused once it has been consumed.
        wrong = "000000" if DEMO_OTP != "000000" else "111111"
        self.assertEqual(self.verify_otp(wrong).status_code, 401)
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 200)
        replay = self.verify_otp(DEMO_OTP)
        self.assertEqual(replay.status_code, 401)
        self.assertIn(replay.get_json()["code"], ("OTP_ALREADY_USED", "OTP_INVALID"))
        # A new request restores access — this is what a demo logout/login does.
        self.request_otp()
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 200)

    def test_05_demo_otp_expiry_is_still_enforced(self):
        from datetime import datetime, timedelta, timezone
        self.demo_on()
        self.request_otp()
        conn = database.get_db()
        past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        conn.execute("UPDATE otp_codes SET expires_at=? WHERE mobile_e164=? AND status='ACTIVE'",
                     (past, DEMO_MOBILE_E164))
        conn.commit()
        conn.close()
        response = self.verify_otp(DEMO_OTP)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_EXPIRED")

    def test_06_demo_login_needs_no_sms_gateway_configuration(self):
        # A prototype demo must work on a deployment with no SMS gateway at all.
        for key in GATEWAY_ENV:
            os.environ.pop(key, None)
        os.environ["SMS_GATEWAY_MODE"] = "MOCK"
        self.demo_on()
        response = self.request_otp()
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 200)

    def test_07_demo_config_is_advertised_only_in_demo_mode(self):
        disabled = self.client.get("/api/auth/farmer/config").get_json()
        self.assertEqual(disabled["demo"], {"enabled": False})
        self.assertNotIn(DEMO_OTP, str(disabled))
        self.assertNotIn(DEMO_MOBILE, str(disabled))

        self.demo_on()
        enabled = self.client.get("/api/auth/farmer/config").get_json()
        self.assertTrue(enabled["demo"]["enabled"])
        self.assertEqual(enabled["demo"]["mobile"], DEMO_MOBILE)
        self.assertEqual(enabled["demo"]["otp"], DEMO_OTP)
        # OTP login must be reported as available so the screen is usable.
        self.assertTrue(enabled["otp_login_enabled"])

    # ================================================================
    # 4. the demo session is a real farmer session
    # ================================================================
    def test_08_demo_farmer_gets_a_valid_farmer_token_and_dashboard(self):
        self.demo_on()
        self.request_otp()
        token = self.verify_otp(DEMO_OTP).get_json()["token"]

        me = self.client.get("/api/users/me", headers=self.auth(token))
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.get_json()["role"], "owner")
        self.assertEqual(me.get_json()["mobile"], DEMO_MOBILE)

        # The farmer dashboard and the screens behind it.
        for path in ("/api/owner/summary", "/api/animals", "/api/cases",
                     "/api/notifications", "/api/herds", "/api/prescriptions"):
            response = self.client.get(path, headers=self.auth(token))
            self.assertEqual(response.status_code, 200, f"{path}: {response.get_json()}")

        # The JWT is the normal one: same claims, same secret, same expiry.
        payload = app_module.decode_token(token)
        self.assertEqual(payload["role"], "owner")
        self.assertIn("exp", payload)
        self.assertEqual(payload["uid"], me.get_json()["id"])

    def test_09_demo_farmer_keeps_the_normal_farmer_permissions(self):
        self.demo_on()
        self.request_otp()
        token = self.verify_otp(DEMO_OTP).get_json()["token"]

        # Register an animal and file a health report for it — the core farmer
        # journeys, unchanged for the demo account.
        animal = self.client.post("/api/animals", headers=self.auth(token), json={
            "animal_name": "Demo Cow", "animal_type": "Cattle", "species": "Cattle",
            "breed": "Gir", "gender": "Female", "age": 4, "village": "Demo Village",
            "block": "Haveli", "district": "Pune",
        })
        self.assertEqual(animal.status_code, 201, animal.get_json())
        animal_id = animal.get_json()["id"]

        case = self.client.post("/api/cases", headers=self.auth(token), json={
            "animal_id": animal_id, "symptoms": "Fever", "severity": "Medium",
            "description": "Demo report", "reported_through": "Mobile App",
        })
        self.assertEqual(case.status_code, 201, case.get_json())
        self.assertEqual(self.client.get("/api/owner/summary",
                                         headers=self.auth(token)).get_json()["animals"], 1)

    def test_10_demo_token_is_still_role_isolated(self):
        self.demo_on()
        self.request_otp()
        token = self.verify_otp(DEMO_OTP).get_json()["token"]
        for path in ("/api/vet/summary", "/api/govt/analytics"):
            response = self.client.get(path, headers=self.auth(token))
            self.assertEqual(response.status_code, 403, path)
        # Creating a vet case or availability slot stays forbidden.
        response = self.client.put("/api/vet/availability", headers=self.auth(token),
                                   json={"available": True})
        self.assertEqual(response.status_code, 403)

    # ================================================================
    # 5. repeated logins never duplicate the account
    # ================================================================
    def test_11_repeated_demo_logins_reuse_one_account(self):
        self.demo_on()
        ids = set()
        for _ in range(3):
            # No cooldown wait: a presenter must be able to log out and back in.
            self.assertEqual(self.request_otp().status_code, 200)
            body = self.verify_otp(DEMO_OTP).get_json()
            self.assertEqual(body["user"]["role"], "owner")
            ids.add(body["user"]["id"])
        self.assertEqual(len(ids), 1, f"expected one demo farmer, got {ids}")
        self.assertEqual(self._user_count(DEMO_MOBILE), 1)
        # And the pre-existing seeded farmers are untouched.
        self.assertEqual(self._user_count(FARMER_MOBILE), 1)
        self.assertEqual(self._user_count(FARMER_2_MOBILE), 1)

    def test_12_demo_account_is_a_farmer_without_a_usable_password(self):
        self.demo_on()
        self.request_otp()
        self.verify_otp(DEMO_OTP)
        row = self._demo_farmer_rows()[0]
        self.assertEqual(row["role"], "owner")
        # Farmers are OTP-only: the password route must refuse the demo farmer.
        for password in ("password123", DEMO_OTP, "demo", "Demo Farmer"):
            response = self.client.post("/api/auth/login", json={
                "identifier": DEMO_MOBILE, "password": password,
            })
            self.assertIn(response.status_code, (401, 403), password)
            self.assertNotIn("token", response.get_json())
        # Nor may a farmer be created through the password signup route.
        signup = self.client.post("/api/auth/register", json={
            "full_name": "Demo", "mobile": DEMO_MOBILE, "email": "demo@example.com",
            "password": "password123", "confirm_password": "password123", "role": "owner",
            "district": "Pune",
        })
        self.assertEqual(signup.status_code, 403)
        self.assertEqual(signup.get_json()["code"], "FARMER_OTP_SIGNUP_REQUIRED")

    def test_13_demo_account_refuses_a_number_held_by_a_staff_account(self):
        # A vet must never be reachable through (or overwritten by) the demo
        # account. Point the demo number at a seeded vet and fail closed.
        self.demo_on(DEMO_FARMER_MOBILE="9800000010")
        response = self.request_otp("9800000010")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "DEMO_ACCOUNT_UNAVAILABLE")
        conn = database.get_db()
        role = conn.execute("SELECT role FROM users WHERE mobile='9800000010'").fetchone()["role"]
        conn.close()
        self.assertEqual(role, "vet")

    # ================================================================
    # 6. disabled demo mode rejects the fixed code
    # ================================================================
    def test_14_fixed_otp_is_rejected_when_demo_mode_is_off(self):
        self.demo_off()
        self.assertFalse(demo_auth.demo_mode_enabled())
        self.assertIsNone(demo_auth.demo_farmer_otp())

        response = self.verify_otp(DEMO_OTP)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_INVALID")
        self.assertNotIn("token", response.get_json())

        # The request endpoint behaves exactly as it always did for an unknown
        # number: no OTP row, no SMS, a generic answer.
        self.assertEqual(self.request_otp().status_code, 200)
        self.assertEqual(self.gateway.messages, [])
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401)
        self.assertEqual(self._demo_farmer_rows(), [])

    def test_15_using_the_demo_number_never_enables_the_fixed_code(self):
        # Demo mode is off but the number is requested anyway: nothing is
        # created and the fixed code stays invalid.
        self.demo_off()
        self.request_otp()
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401)
        self.assertEqual(self._demo_farmer_rows(), [])

    def test_15b_pending_demo_code_is_rejected_after_demo_mode_is_disabled(self):
        # Turning the flag off between request and verification must not let a
        # stored demo row fall through to the ordinary generated-code matcher.
        self.demo_on()
        self.assertTrue(self.request_otp().get_json()["demo"])
        self.demo_off()

        response = self.verify_otp(DEMO_OTP)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_INVALID")
        self.assertNotIn("token", response.get_json())

    def test_16_demo_mode_is_refused_on_a_production_process_without_opt_in(self):
        # A public deployment can never turn the fixed OTP on by accident.
        self.demo_on()
        os.environ["RENDER"] = "1"
        os.environ["FLASK_ENV"] = "production"
        self.assertFalse(demo_auth.demo_mode_enabled())
        self.assertEqual(demo_auth.demo_mode_status()["disabled_reason"],
                         demo_auth.DEMO_DISABLED_IN_PRODUCTION)
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401)
        # Health reports the state without ever exposing the number or the code.
        health = self.client.get("/api/health").get_json()
        self.assertFalse(health["demo_mode"]["enabled"])
        self.assertNotIn(DEMO_OTP, str(health))
        self.assertNotIn(DEMO_MOBILE, str(health))

        # The explicit second opt-in turns it on for the prototype deployment.
        self.demo_on(DEMO_MODE_ALLOW_PRODUCTION="true")
        self.assertTrue(demo_auth.demo_mode_enabled())
        self.assertEqual(self.request_otp().status_code, 200)
        self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 200)

    def test_17_unrecognised_demo_mode_values_are_treated_as_disabled(self):
        for value in ("", "0", "false", "no", "off", "maybe", "2"):
            os.environ["DEMO_MODE"] = value
            self.assertFalse(demo_auth.demo_mode_enabled(), value)
            self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401, value)

    def test_17b_a_misconfigured_demo_code_fails_closed(self):
        # A code that is not six digits could never be submitted, so nothing is
        # issued, nothing is advertised and the number is treated as ordinary.
        for bad in ("12345", "1234567", "abcdef", "  "):
            self.demo_on(DEMO_FARMER_OTP=bad)
            self.assertFalse(demo_auth.demo_login_configured(), bad)
            self.assertIsNone(demo_auth.demo_farmer_otp(), bad)
            self.assertEqual(demo_auth.public_demo_settings(), {"enabled": False}, bad)
            self.assertEqual(self.request_otp().status_code, 200, bad)
            self.assertEqual(self.gateway.messages, [], "no demo code may be issued")
            self.assertEqual(self.verify_otp(DEMO_OTP).status_code, 401, bad)
            self.assertEqual(self._demo_farmer_rows(), [], bad)

    # ================================================================
    # 7. the fixed code belongs to the demo number only
    # ================================================================
    def test_18_previous_demo_number_is_not_configured_or_fixed_code_enabled(self):
        self.demo_on()
        self.assertFalse(demo_auth.is_demo_farmer(PREVIOUS_DEMO_MOBILE))

        # Treat the former number like an ordinary signup number: its OTP is
        # generated and sent by the real SMS path, never the fixed demo path.
        with mock.patch.object(otp_service, "generate_otp", return_value="654321"):
            response = self.request_otp(PREVIOUS_DEMO_MOBILE, intent="signup")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertFalse(response.get_json()["demo"])
        self.assertEqual(self.gateway.last_code, "654321")
        self.assertEqual(self.verify_otp(DEMO_OTP, PREVIOUS_DEMO_MOBILE).status_code, 401)
        self.assertEqual(self._user_count(PREVIOUS_DEMO_MOBILE), 0)

    def test_18b_fixed_otp_never_works_for_another_number(self):
        self.demo_on()
        # A registered farmer's real SMS OTP: 123456 is not it.
        self.assertEqual(self.request_otp(FARMER_MOBILE).status_code, 200)
        real_code = self.gateway.last_code
        self.assertIsNotNone(real_code)
        self.assertNotEqual(real_code, DEMO_OTP)
        self.assertEqual(self.verify_otp(DEMO_OTP, FARMER_MOBILE).status_code, 401)
        # ...and their genuine code still works.
        self.assertEqual(self.verify_otp(real_code, FARMER_MOBILE).status_code, 200)

    def test_19_fixed_otp_is_not_issued_to_other_numbers(self):
        self.demo_on()
        for mobile in (FARMER_MOBILE, FARMER_2_MOBILE, FARMER_3_MOBILE, "9123456780"):
            self.request_otp(mobile, intent="signup")
            conn = database.get_db()
            row = conn.execute(
                "SELECT * FROM otp_codes WHERE mobile_e164=? ORDER BY id DESC LIMIT 1",
                (f"+91{mobile}",),
            ).fetchone()
            conn.close()
            if row is None:
                continue
            self.assertNotEqual(
                otp_service._constant_time_match(DEMO_OTP, row["otp_salt"], row["otp_hash"]),
                True, f"{mobile} must never be issued the fixed demo code")
        # No SMS was sent to any of them except the two registered farmers.
        messaged = {message["to"] for message in self.gateway.messages}
        self.assertNotIn(DEMO_MOBILE_E164, messaged)

    def test_20_the_fixed_code_is_configurable_and_still_scoped(self):
        self.demo_on(DEMO_FARMER_OTP="654321", DEMO_FARMER_MOBILE="8888888888")
        self.addCleanup(self._delete_user, "8888888888")
        self.assertFalse(demo_auth.is_demo_farmer(DEMO_MOBILE))
        self.assertTrue(demo_auth.is_demo_farmer("8888888888"))
        # The new number gets the new code, the documented one does not.
        self.assertEqual(self.request_otp("8888888888").status_code, 200)
        self.assertEqual(self.verify_otp("654321", "8888888888").status_code, 200)
        self.assertEqual(self.verify_otp(DEMO_OTP, "8888888888").status_code, 401)

    # ================================================================
    # 8. vet / government / lab authentication is untouched
    # ================================================================
    def test_21_staff_password_login_is_unchanged(self):
        for email in (VET_EMAIL, GOVT_EMAIL, LAB_EMAIL):
            response = self.client.post("/api/auth/login", json={
                "identifier": email, "password": STAFF_PASSWORD,
            })
            self.assertEqual(response.status_code, 200, email)
            body = response.get_json()
            self.assertIn("token", body)
            self.assertNotEqual(body["user"]["role"], "owner")
            # The session reaches that role's own screen.
            home = {"vet": "/api/vet/summary", "govt": "/api/govt/analytics",
                    "lab": "/api/lab/summary"}[body["user"]["role"]]
            self.assertEqual(
                self.client.get(home, headers=self.auth(body["token"])).status_code, 200, home)
            # ...and not the farmer dashboard.
            self.assertEqual(
                self.client.get("/api/owner/summary", headers=self.auth(body["token"])).status_code,
                403, email)

    def test_22_staff_signup_is_unchanged(self):
        unique = f"new.staff.{os.getpid()}@example.com"
        response = self.client.post("/api/auth/register", json={
            "full_name": "New Vet", "mobile": f"97{os.getpid() % 100000000:08d}",
            "email": unique, "password": STAFF_PASSWORD,
            "confirm_password": STAFF_PASSWORD, "role": "vet", "district": "Pune",
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertEqual(response.get_json()["user"]["role"], "vet")
        # Farmers are still refused on the same route.
        owner = self.client.post("/api/auth/register", json={
            "full_name": "Demo", "mobile": "9999999998", "email": "d2@example.com",
            "password": STAFF_PASSWORD, "confirm_password": STAFF_PASSWORD,
            "role": "owner", "district": "Pune",
        })
        self.assertEqual(owner.status_code, 403)

    def test_23_staff_cannot_use_the_farmer_otp_flow(self):
        self.demo_on()
        for mobile in ("9800000010", "9800000011", "9800000030"):
            self.request_otp(mobile)
        self.assertEqual(self.verify_otp(DEMO_OTP, "9800000010").status_code, 401)
        self.assertEqual(self.verify_otp(DEMO_OTP, "9800000030").status_code, 401)
        # A staff account can never be created or signed in through signup OTP.
        conn = database.get_db()
        roles = {row["mobile"]: row["role"] for row in
                 conn.execute("SELECT mobile, role FROM users WHERE role!='owner'").fetchall()}
        conn.close()
        self.assertTrue(roles)
        self.assertNotIn(DEMO_MOBILE, roles)

    # ================================================================
    # 9. real farmer SMS OTP authentication still works in demo mode
    # ================================================================
    def test_24_regular_farmer_uses_a_real_sms_otp_while_demo_mode_is_on(self):
        self.demo_on()
        for mobile in (FARMER_MOBILE, FARMER_2_MOBILE):
            self.assertEqual(self.request_otp(mobile).status_code, 200)
            code = self.gateway.last_code
            self.assertIsNotNone(code)
            self.assertNotEqual(code, DEMO_OTP)
            body = self.verify_otp(code, mobile).get_json()
            self.assertEqual(body["user"]["role"], "owner")
            self.assertEqual(body["user"]["mobile"], mobile)
        # Exactly two real SMS: the two real farmers, never the demo number.
        self.assertEqual(len(self.gateway.messages), 2)
        self.assertNotIn(DEMO_MOBILE_E164, {m["to"] for m in self.gateway.messages})

    def test_25_farmer_signup_by_real_otp_still_works_in_demo_mode(self):
        self.demo_on()
        mobile = "9800000004"
        response = self.request_otp(mobile, intent="signup")
        self.assertEqual(response.status_code, 200)
        code = self.gateway.last_code
        self.assertIsNotNone(code)
        verified = self.verify_otp(code, mobile)
        self.assertEqual(verified.status_code, 200)
        body = verified.get_json()
        self.assertTrue(body["registration_required"])
        created = self.client.post("/api/auth/farmer/register", json={
            "registration_token": body["registration_token"],
            "full_name": "Real Farmer", "district": "Nashik", "village": "Sinnar",
        })
        self.assertEqual(created.status_code, 201, created.get_json())
        self.assertEqual(created.get_json()["user"]["role"], "owner")
        # The account belongs to the verified number, not to the demo number.
        self.assertEqual(created.get_json()["user"]["mobile"], mobile)
        self.addCleanup(self._delete_user, mobile)

    def _delete_user(self, mobile):
        conn = database.get_db()
        try:
            conn.execute("PRAGMA foreign_keys = OFF")
            self._delete_owned_rows(conn, (mobile, f"+91{mobile}"))
            conn.execute("DELETE FROM users WHERE mobile=?", (mobile,))
            conn.commit()
        finally:
            conn.close()

    # ================================================================
    # 10. prototype-only safety
    # ================================================================
    def test_26_demo_mode_defaults_to_disabled(self):
        # The suite sets DEMO_MODE=false explicitly; an absent variable must
        # behave identically.
        os.environ.pop("DEMO_MODE", None)
        self.assertFalse(demo_auth.demo_mode_enabled())
        self.assertEqual(demo_auth.demo_mode_status()["disabled_reason"],
                         demo_auth.DEMO_DISABLED)
        health = self.client.get("/api/health").get_json()
        self.assertFalse(health["demo_mode"]["enabled"])
        self.assertEqual(health["demo_mode"]["requested"], False)

    def test_27_no_otp_token_or_phone_number_is_logged(self):
        self.demo_on()
        with self.assertLogs("app", level="DEBUG") as captured:
            self.request_otp()
            self.verify_otp(DEMO_OTP)
            self.verify_otp(DEMO_OTP)   # the rejected replay as well
        text = "\n".join(captured.output)
        self.assertNotIn(DEMO_OTP, text, "the fixed OTP must never be logged")
        self.assertNotIn(DEMO_MOBILE, text, "the full demo number must never be logged")
        self.assertIn("4042", text, "the masked number is still traceable")
        self.assertIn("dispatch=not_dispatched", text,
                      "demo request logs must not imply that an SMS gateway was called")

    def test_28_demo_state_is_reported_without_exposing_the_code(self):
        self.demo_on()
        health = self.client.get("/api/health").get_json()
        self.assertTrue(health["demo_mode"]["enabled"])
        self.assertTrue(health["demo_mode"]["production_process"] is False)
        self.assertNotIn(DEMO_OTP, str(health))
        self.assertNotIn(DEMO_MOBILE, str(health))
        # Farmer auth metadata is unchanged.
        self.assertEqual(health["auth"]["farmer"]["login"], "mobile_otp")
        self.assertFalse(health["auth"]["farmer"]["password_login"])
        self.assertEqual(health["auth"]["staff_login_method"], "password")

    def test_29_otp_diagnostics_still_work_for_the_demo_number(self):
        self.demo_on()
        self.request_otp()
        report = otp_service.diagnostics(DEMO_MOBILE)
        self.assertEqual(report["mobile_masked"], sms_gateway.mask_phone(DEMO_MOBILE_E164))
        self.assertTrue(report["owner_registered"])
        self.assertEqual(report["latest_otp"]["status"], "ACTIVE")
        self.assertNotIn(DEMO_OTP, str(report))
        self.assertNotIn(DEMO_MOBILE, str(report))


if __name__ == "__main__":  # pragma: no cover
    unittest.main(verbosity=2)
