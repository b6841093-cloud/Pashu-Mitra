"""Role-specific authentication regression suite.

Covers the restored authentication contract end to end:

* Farmer / Animal Owner  — mobile number + SMS OTP **only** (login and profile
  creation). No password login, no password signup, no password fallback.
* Veterinarian / Government / Laboratory — the original email-or-mobile +
  password login and the original password signup, unchanged.

Run with::

    cd backend
    python -m unittest test_role_auth -v

SMS is mocked: ``sms_gateway.send_text_message`` is replaced by
:class:`FakeGateway`, so no real SMS leaves the process. The mock captures the
message the gateway would have sent, which is how the tests read the OTP — the
API never returns it. A mocked "accepted" dispatch is deliberately *not* treated
as delivery: the suite asserts that the API keeps
``delivery_confirmed = false`` (queued ≠ delivered) and that a failing gateway
never produces a session.

Criterion map (see the change report):

 1  farmer OTP request + verify .................. test_01, test_02
 2  farmer profile after phone verification ...... test_03, test_04, test_05
 3  no farmer password fallback .................. test_06, test_07, test_08
 4  vet original login ........................... test_09
 5  govt original login .......................... test_10
 6  lab original login ........................... test_11
 7  non-farmer registration rules ................ test_12, test_13, test_14
 8  incorrect credentials rejected ............... test_15, test_16
 9  OTP replay / expiry / rate limits ............ test_17 .. test_21
10  token claims + dashboard permissions ......... test_22, test_23
11  existing records and data intact ............. test_24, test_25
12  unrelated features still work ................ test_26, test_27
"""
from __future__ import annotations

import os
import re
import sqlite3
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

os.environ.setdefault("SIH_SECRET_KEY", "test-secret-key-for-role-auth-suite")
os.environ.setdefault("OTP_PEPPER", "test-pepper-for-role-auth-suite")
os.environ.setdefault("SIH_DB_PATH",
                      os.path.join(os.path.dirname(__file__), "test_role_auth.db"))

import app as app_module  # noqa: E402  (import after env setup)
import database  # noqa: E402
import sms_gateway  # noqa: E402

FARMER_MOBILE = "9800000001"          # seeded owner (Rajesh Patil)
FARMER_MOBILE_E164 = "+919800000001"
# Accounts created by this suite are unique per run so the throwaway database
# can be reused without collisions; tearDownClass removes them again.
RUN_TAG = f"{int(time.time()) % 100000:05d}"
SUITE_EMAIL_PREFIX = f"roleauth-{RUN_TAG}-"


def suite_mobile(index: int) -> str:
    return f"97{RUN_TAG}{index:03d}"


NEW_FARMER_MOBILE = suite_mobile(1)       # not registered anywhere
SIGNUP_ONLY_MOBILE = suite_mobile(2)      # used for the registration-token tests
VET_EMAIL, VET_MOBILE = "vet1@example.com", "9800000010"
GOVT_EMAIL, GOVT_MOBILE = "govt@example.com", "9800000020"
LAB_EMAIL, LAB_MOBILE = "lab@example.com", "9800000030"
STAFF_PASSWORD = "password123"


class FakeGateway:
    """Mock SMS gateway: captures the message instead of sending an SMS."""

    def __init__(self):
        self.messages: list[dict] = []
        self.fail_with: str | None = None

    def __call__(self, to_e164, text, **kwargs):
        if self.fail_with:
            raise sms_gateway.SmsGatewayError("stubbed failure", code=self.fail_with, status=503)
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


class RoleAuthTestCase(unittest.TestCase):
    """Every test starts from the same seeded database and a mocked gateway."""

    @classmethod
    def setUpClass(cls):
        database.init_db()
        cls.client = app_module.app.test_client()
        conn = database.get_db()
        cls.staff = {}
        for role, email in (("vet", VET_EMAIL), ("govt", GOVT_EMAIL), ("lab", LAB_EMAIL)):
            cls.staff[role] = dict(conn.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone())
        cls.farmer = dict(conn.execute("SELECT * FROM users WHERE mobile=?", (FARMER_MOBILE,)).fetchone())
        cls.baseline = cls._snapshot(conn)
        conn.close()

    @staticmethod
    def _snapshot(conn) -> dict:
        users = [dict(row) for row in conn.execute(
            "SELECT id, full_name, mobile, email, role, district FROM users ORDER BY id").fetchall()]
        counts = {
            table: conn.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
            for table in ("herds", "animals", "cases", "audit_events")
        }
        return {"users": users, "counts": counts}

    @classmethod
    def tearDownClass(cls):
        """Remove the throwaway accounts this suite created (keeps the test DB
        reusable without touching seeded users or their data)."""
        conn = database.get_db()
        ids = [row["id"] for row in conn.execute(
            "SELECT id FROM users WHERE email LIKE ? OR mobile LIKE ? "
            "OR email LIKE '%@mobile.pashumitra.local'",
            (f"{SUITE_EMAIL_PREFIX}%", f"97{RUN_TAG}%")).fetchall()]
        # Remove every row that references the throwaway accounts, in FK order:
        # walk the schema instead of hard-coding table names.
        tables = [row["name"] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        dependents = []
        for table in tables:
            for fk in conn.execute(f"PRAGMA foreign_key_list({table})").fetchall():
                if fk["table"] == "users":
                    dependents.append((table, fk["from"]))
        for table, column in dependents:
            for user_id in ids:
                conn.execute(f"DELETE FROM {table} WHERE {column}=?", (user_id,))
        for user_id in ids:
            conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.execute("DELETE FROM otp_codes")
        conn.execute("DELETE FROM otp_request_log")
        conn.commit()
        conn.close()

    def setUp(self):
        self.gateway = FakeGateway()
        self._gateway_patch = mock.patch.object(sms_gateway, "send_text_message", self.gateway)
        self._gateway_patch.start()
        self.addCleanup(self._gateway_patch.stop)
        # A gateway that is configured and reachable is what gates the OTP
        # endpoints; the patched sender above only replaces the HTTP call.
        self._env = mock.patch.dict(os.environ, {
            "SMS_GATEWAY_MODE": "CLOUD",
            "SMS_GATEWAY_BASE_URL": "https://api.sms-gate.app/3rdparty/v1",
            "SMS_GATEWAY_USERNAME": "test-user",
            "SMS_GATEWAY_PASSWORD": "test-pass",
        }, clear=False)
        self._env.start()
        self.addCleanup(self._env.stop)
        conn = database.get_db()
        conn.execute("DELETE FROM otp_codes")
        conn.execute("DELETE FROM otp_request_log")
        conn.commit()
        conn.close()

    # ------------------------------------------------------------- helpers
    def request_otp(self, mobile=FARMER_MOBILE, **extra):
        return self.client.post("/api/auth/farmer/request-otp", json={"mobile": mobile, **extra})

    def verify_otp(self, code, mobile=FARMER_MOBILE):
        return self.client.post("/api/auth/farmer/verify-otp", json={"mobile": mobile, "otp": code})

    def issue_otp(self, mobile=FARMER_MOBILE, **extra) -> str:
        response = self.request_otp(mobile, **extra)
        self.assertEqual(response.status_code, 200, response.get_json())
        code = self.gateway.last_code
        self.assertIsNotNone(code, "the mocked gateway should have received an OTP SMS")
        return code

    def farmer_login(self, mobile=FARMER_MOBILE) -> dict:
        code = self.issue_otp(mobile)
        response = self.verify_otp(code, mobile)
        self.assertEqual(response.status_code, 200, response.get_json())
        return response.get_json()

    def signup_farmer(self, mobile=NEW_FARMER_MOBILE, **profile) -> dict:
        code = self.issue_otp(mobile, intent="signup")
        verified = self.verify_otp(code, mobile)
        self.assertEqual(verified.status_code, 200, verified.get_json())
        body = verified.get_json()
        self.assertTrue(body.get("registration_required"))
        fields = {"full_name": "New Farmer", "district": "Nashik"}
        fields.update(profile)
        created = self.client.post("/api/auth/farmer/register",
                                   json={"registration_token": body["registration_token"], **fields})
        self.assertEqual(created.status_code, 201, created.get_json())
        return created.get_json()

    @staticmethod
    def claims(token) -> dict:
        return app_module.decode_token(token)

    # ------------------------------------------- 1. farmer OTP login (C1)
    def test_01_farmer_requests_and_verifies_an_otp(self):
        response = self.request_otp()
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertTrue(body["ok"])
        # A 200 means "request accepted" — never "the SMS arrived".
        self.assertFalse(body["delivery_confirmed"])
        self.assertEqual(len(self.gateway.messages), 1)
        self.assertEqual(self.gateway.messages[0]["to"], FARMER_MOBILE_E164)

        login = self.verify_otp(self.gateway.last_code)
        self.assertEqual(login.status_code, 200)
        payload = login.get_json()
        self.assertEqual(payload["login_method"], "otp")
        self.assertEqual(payload["user"]["id"], self.farmer["id"])
        self.assertEqual(payload["user"]["role"], "owner")
        self.assertNotIn("password_hash", payload["user"])
        self.assertNotIn("salt", payload["user"])

    def test_02_mock_dispatch_is_never_reported_as_delivery(self):
        """Mocked SMS success must stay distinguishable from real delivery."""
        self.gateway.fail_with = "SMS_GATEWAY_AUTH_FAILED"
        response = self.request_otp()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("token", response.get_json())
        self.assertIsNone(self.gateway.last_code)
        conn = database.get_db()
        active = conn.execute("SELECT COUNT(*) c FROM otp_codes WHERE status='ACTIVE'").fetchone()["c"]
        conn.close()
        self.assertEqual(active, 0, "a failed dispatch must not leave a usable OTP")

    # --------------------------------- 2. farmer profile creation (C2)
    def test_03_new_number_can_create_a_profile_after_verification(self):
        created = self.signup_farmer(village="Deolali", block="Nashik", preferred_language="mr")
        self.assertTrue(created["registered"])
        user = created["user"]
        self.assertEqual(user["role"], "owner")
        self.assertEqual(user["mobile"], NEW_FARMER_MOBILE)
        self.assertEqual(user["district"], "Nashik")
        self.assertEqual(user["preferred_language"], "mr")
        claims = self.claims(created["token"])
        self.assertEqual(claims["role"], "owner")
        self.assertEqual(claims["uid"], user["id"])
        # The new farmer is a normal farmer: OTP login works from now on.
        again = self.farmer_login(NEW_FARMER_MOBILE)
        self.assertEqual(again["user"]["id"], user["id"])

    def test_04_registration_requires_the_verified_number(self):
        """The profile endpoint trusts the signed token, not the request body."""
        code = self.issue_otp(SIGNUP_ONLY_MOBILE, intent="signup")
        verified = self.verify_otp(code, SIGNUP_ONLY_MOBILE).get_json()
        self.assertTrue(verified.get("registration_required"), verified)
        token = verified["registration_token"]

        # Forged / missing / tampered tokens are refused outright.
        for bad in ("", "not-a-token", token[:-2] + "aa"):
            response = self.client.post("/api/auth/farmer/register",
                                        json={"registration_token": bad, "full_name": "X Y",
                                              "district": "Pune"})
            self.assertEqual(response.status_code, 401, bad)
            self.assertEqual(response.get_json()["code"], "REGISTRATION_TOKEN_INVALID")

        # An incomplete profile is rejected without spending the token.
        incomplete = self.client.post("/api/auth/farmer/register",
                                      json={"registration_token": token, "full_name": "X Y"})
        self.assertEqual(incomplete.status_code, 400)
        self.assertEqual(incomplete.get_json()["code"], "MISSING_PROFILE_FIELDS")

        # A body-supplied role cannot turn this into a staff account.
        response = self.client.post("/api/auth/farmer/register",
                                    json={"registration_token": token, "full_name": "X Y",
                                          "district": "Pune", "role": "govt"})
        self.assertEqual(response.status_code, 201)
        created = response.get_json()
        self.assertEqual(created["user"]["role"], "owner")
        self.assertNotEqual(created["user"]["role"], "govt")

    def test_04b_registration_token_is_single_use(self):
        mobile = suite_mobile(5)
        code = self.issue_otp(mobile, intent="signup")
        token = self.verify_otp(code, mobile).get_json()["registration_token"]

        first = self.client.post("/api/auth/farmer/register",
                                 json={"registration_token": token, "full_name": "Single Use",
                                       "district": "Pune"})
        self.assertEqual(first.status_code, 201)
        replay = self.client.post("/api/auth/farmer/register",
                                  json={"registration_token": token, "full_name": "Replay",
                                        "district": "Pune"})
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.get_json()["code"], "REGISTRATION_TOKEN_INVALID")
        conn = database.get_db()
        dupes = conn.execute("SELECT COUNT(*) c FROM users WHERE mobile=?",
                             (mobile,)).fetchone()["c"]
        conn.close()
        self.assertEqual(dupes, 1)

    def test_05_signup_otp_is_single_use_and_still_scoped_to_farmers(self):
        code = self.issue_otp(suite_mobile(3), intent="signup")
        first = self.verify_otp(code, suite_mobile(3))
        self.assertEqual(first.status_code, 200)
        replay = self.verify_otp(code, suite_mobile(3))
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.get_json()["code"], "OTP_ALREADY_USED")

        # A staff mobile number can never start a farmer signup.
        staff_code = self.issue_otp(VET_MOBILE, intent="signup")
        blocked = self.verify_otp(staff_code, VET_MOBILE)
        self.assertEqual(blocked.status_code, 401)
        self.assertNotIn("token", blocked.get_json())

    # ------------------------------------- 3. no farmer password path (C3)
    def test_06_farmer_password_login_is_rejected_even_with_the_right_password(self):
        response = self.client.post("/api/auth/login",
                                    json={"identifier": FARMER_MOBILE, "password": STAFF_PASSWORD})
        self.assertEqual(response.status_code, 403)
        body = response.get_json()
        self.assertEqual(body["code"], "FARMER_OTP_REQUIRED")
        self.assertNotIn("token", body)

        by_email = self.client.post("/api/auth/login",
                                    json={"identifier": self.farmer["email"],
                                          "password": STAFF_PASSWORD})
        self.assertEqual(by_email.status_code, 403)
        self.assertEqual(by_email.get_json()["code"], "FARMER_OTP_REQUIRED")

    def test_07_farmer_password_signup_is_rejected(self):
        response = self.client.post("/api/auth/register", json={
            "full_name": "Password Farmer", "mobile": suite_mobile(4),
            "email": f"{SUITE_EMAIL_PREFIX}password-farmer@example.com",
            "password": STAFF_PASSWORD, "confirm_password": STAFF_PASSWORD, "role": "owner",
            "district": "Pune",
        })
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.get_json()["code"], "FARMER_OTP_SIGNUP_REQUIRED")
        conn = database.get_db()
        created = conn.execute("SELECT COUNT(*) c FROM users WHERE mobile=?",
                               (suite_mobile(4),)).fetchone()["c"]
        conn.close()
        self.assertEqual(created, 0, "the password endpoint must not create farmers")

    def test_08_farmer_config_advertises_otp_only(self):
        body = self.client.get("/api/auth/farmer/config").get_json()
        self.assertFalse(body["password_login_enabled"])
        self.assertTrue(body["signup_enabled"])
        self.assertNotIn("password_fallback_enabled", body)
        # No password screen is reachable from the farmer entry point.
        html = open(os.path.join(os.path.dirname(__file__), "..", "frontend", "app.js"),
                    encoding="utf-8").read()
        self.assertNotIn("#/login/owner/password", html)

    # ------------------------------- 4-6. original staff password login (C4-C6)
    def _assert_password_login(self, role, identifier):
        response = self.client.post("/api/auth/login",
                                    json={"identifier": identifier, "password": STAFF_PASSWORD})
        self.assertEqual(response.status_code, 200, role)
        body = response.get_json()
        self.assertEqual(body["user"]["role"], role)
        self.assertEqual(body["user"]["id"], self.staff[role]["id"])
        claims = self.claims(body["token"])
        self.assertEqual(claims["role"], role)
        self.assertEqual(claims["uid"], self.staff[role]["id"])
        return body["token"]

    def test_09_vet_logs_in_with_the_original_password_method(self):
        token = self._assert_password_login("vet", VET_EMAIL)
        # ...and also with the mobile number, exactly like before.
        by_mobile = self.client.post("/api/auth/login",
                                     json={"identifier": VET_MOBILE, "password": STAFF_PASSWORD})
        self.assertEqual(by_mobile.status_code, 200)

    def test_10_govt_logs_in_with_the_original_password_method(self):
        self._assert_password_login("govt", GOVT_EMAIL)

    def test_11_lab_logs_in_with_the_original_password_method(self):
        self._assert_password_login("lab", LAB_EMAIL)

    def test_11b_password_routes_are_not_410(self):
        """Regression guard: the retired-route (410) change must not come back."""
        login = self.client.post("/api/auth/login",
                                 json={"identifier": VET_EMAIL, "password": STAFF_PASSWORD})
        self.assertNotIn(login.status_code, (404, 410))
        wrong = self.client.post("/api/auth/login", json={})
        self.assertNotIn(wrong.status_code, (404, 410))
        register = self.client.post("/api/auth/register", json={"role": "vet"})
        self.assertNotIn(register.status_code, (404, 410))

    # ------------------------- 7. non-farmer registration rules (C7)
    def test_12_staff_registration_keeps_the_original_fields_and_validation(self):
        for index, role in enumerate(("vet", "govt", "lab"), start=10):
            response = self.client.post("/api/auth/register", json={
                "full_name": f"New {role}", "mobile": suite_mobile(index),
                "email": f"{SUITE_EMAIL_PREFIX}{role}@example.com", "password": STAFF_PASSWORD,
                "confirm_password": STAFF_PASSWORD, "role": role, "district": "Pune",
                "specialization": "Epidemiology",
            })
            self.assertEqual(response.status_code, 201, response.get_json())
            body = response.get_json()
            self.assertEqual(body["user"]["role"], role)
            self.assertIn("token", body)

    def test_13_staff_registration_validation_unchanged(self):
        base = {"full_name": "Test", "mobile": suite_mobile(20),
                "email": f"{SUITE_EMAIL_PREFIX}validation@example.com",
                "password": STAFF_PASSWORD, "confirm_password": STAFF_PASSWORD, "role": "vet"}
        # Missing fields
        response = self.client.post("/api/auth/register", json={"role": "vet"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing fields", response.get_json()["error"])
        # Short password
        response = self.client.post("/api/auth/register", json={**base, "password": "123",
                                                                "confirm_password": "123"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Password must be at least 6 characters")
        # Mismatched passwords
        response = self.client.post("/api/auth/register", json={**base, "confirm_password": "other"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Passwords do not match")
        # Unknown role is not a role
        response = self.client.post("/api/auth/register", json={**base, "role": "admin"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "Invalid role")
        # Duplicate account
        response = self.client.post("/api/auth/register", json={**base, "email": VET_EMAIL})
        self.assertEqual(response.status_code, 409)

    def test_14_registering_a_duplicate_mobile_is_refused(self):
        response = self.client.post("/api/auth/register", json={
            "full_name": "Dup", "mobile": VET_MOBILE,
            "email": f"{SUITE_EMAIL_PREFIX}duplicate@example.com",
            "password": STAFF_PASSWORD, "confirm_password": STAFF_PASSWORD, "role": "vet",
        })
        self.assertEqual(response.status_code, 409)

    # ------------------------------- 8. incorrect credentials (C8)
    def test_15_staff_login_rejects_wrong_credentials(self):
        for payload in (
            {"identifier": VET_EMAIL, "password": "wrong-password"},
            {"identifier": "nobody@example.com", "password": STAFF_PASSWORD},
            {"identifier": VET_EMAIL},
            {},
        ):
            response = self.client.post("/api/auth/login", json=payload)
            self.assertIn(response.status_code, (400, 401), payload)
            self.assertNotIn("token", response.get_json())

    def test_16_tampered_and_role_mismatched_tokens_are_refused(self):
        vet_token = self._assert_password_login("vet", VET_EMAIL)
        tampered = vet_token[:-3] + ("abc" if not vet_token.endswith("abc") else "def")
        response = self.client.get("/api/vet/summary", headers={"Authorization": f"Bearer {tampered}"})
        self.assertEqual(response.status_code, 401)
        # Correct token, wrong portal guard.
        response = self.client.get("/api/owner/summary", headers={"Authorization": f"Bearer {vet_token}"})
        self.assertEqual(response.status_code, 403)

    # ------------------------- 9. OTP replay / expiry / limits (C9)
    def test_17_replayed_otp_is_refused(self):
        code = self.issue_otp()
        self.assertEqual(self.verify_otp(code).status_code, 200)
        replay = self.verify_otp(code)
        self.assertEqual(replay.status_code, 401)
        self.assertEqual(replay.get_json()["code"], "OTP_ALREADY_USED")

    def test_18_expired_otp_is_refused(self):
        code = self.issue_otp()
        conn = database.get_db()
        past = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        conn.execute("UPDATE otp_codes SET expires_at=? WHERE mobile_e164=? AND status='ACTIVE'",
                     (past, FARMER_MOBILE_E164))
        conn.commit()
        conn.close()
        response = self.verify_otp(code)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["code"], "OTP_EXPIRED")

    def test_19_resend_cooldown_and_rate_limit_are_enforced(self):
        self.assertEqual(self.request_otp().status_code, 200)
        immediate = self.request_otp()
        self.assertEqual(immediate.status_code, 429)
        self.assertEqual(immediate.get_json()["code"], "COOLDOWN_ACTIVE")

        with mock.patch.dict(os.environ, {"OTP_RESEND_COOLDOWN_SECONDS": "0",
                                          "OTP_MOBILE_MAX_REQUESTS": "2"}):
            self.request_otp()
            limited = self.request_otp()
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.get_json()["code"], "RATE_LIMITED")

    def test_20_wrong_code_attempts_lock_the_otp(self):
        self.issue_otp()
        wrong_code = "000000" if self.gateway.last_code != "000000" else "111111"
        statuses = []
        for _ in range(5):
            statuses.append(self.verify_otp(wrong_code).status_code)
        self.assertIn(429, statuses, "repeated wrong codes must lock the OTP")
        conn = database.get_db()
        row = conn.execute("SELECT attempts, status FROM otp_codes WHERE mobile_e164=? "
                           "ORDER BY id DESC LIMIT 1", (FARMER_MOBILE_E164,)).fetchone()
        conn.close()
        self.assertLessEqual(int(row["attempts"]), 6)
        self.assertIn(row["status"], ("ACTIVE", "LOCKED"))

    def test_21_verify_failure_limit_blocks_guessing(self):
        with mock.patch.dict(os.environ, {"OTP_MAX_VERIFY_FAILURES": "3"}):
            for _ in range(3):
                self.verify_otp("424242")
            response = self.verify_otp("424242")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.get_json()["code"], "RATE_LIMITED")

    # ------------------- 10. token claims + dashboard permissions (C10)
    def test_22_each_role_gets_its_own_claims(self):
        farmer = self.farmer_login()
        self.assertEqual(self.claims(farmer["token"])["role"], "owner")
        for role, email in (("vet", VET_EMAIL), ("govt", GOVT_EMAIL), ("lab", LAB_EMAIL)):
            body = self.client.post("/api/auth/login",
                                    json={"identifier": email, "password": STAFF_PASSWORD}).get_json()
            claims = self.claims(body["token"])
            self.assertEqual(claims["role"], role)
            self.assertEqual(claims["uid"], self.staff[role]["id"])
            self.assertNotEqual(claims["role"], "owner")

    def test_23_dashboard_permissions_follow_the_role(self):
        tokens = {"owner": self.farmer_login()["token"]}
        for role, email in (("vet", VET_EMAIL), ("govt", GOVT_EMAIL), ("lab", LAB_EMAIL)):
            tokens[role] = self.client.post(
                "/api/auth/login", json={"identifier": email, "password": STAFF_PASSWORD}
            ).get_json()["token"]

        def status(role, path):
            return self.client.get(path, headers={"Authorization": f"Bearer {tokens[role]}"}).status_code

        self.assertEqual(status("owner", "/api/owner/summary"), 200)
        self.assertEqual(status("owner", "/api/vet/summary"), 403)
        self.assertEqual(status("vet", "/api/vet/summary"), 200)
        self.assertEqual(status("vet", "/api/owner/summary"), 403)
        self.assertEqual(status("govt", "/api/govt/analytics"), 200)
        self.assertEqual(status("govt", "/api/owner/summary"), 403)
        self.assertEqual(status("lab", "/api/lab/summary"), 200)
        self.assertEqual(status("lab", "/api/owner/summary"), 403)
        # A farmer OTP session must never reach a staff dashboard.
        self.assertEqual(status("owner", "/api/lab/queue"), 403)
        self.assertEqual(status("owner", "/api/govt/analytics"), 403)

    # --------------------- 11. existing records and data intact (C11)
    def test_24_existing_accounts_keep_id_role_profile_and_password(self):
        conn = database.get_db()
        for role in ("vet", "govt", "lab"):
            row = conn.execute("SELECT * FROM users WHERE id=?", (self.staff[role]["id"],)).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row["role"], role)
            self.assertEqual(row["email"], self.staff[role]["email"])
            self.assertEqual(row["mobile"], self.staff[role]["mobile"])
            self.assertTrue(row["password_hash"])
            self.assertEqual(row["password_hash"], self.staff[role]["password_hash"])
        farmer = conn.execute("SELECT * FROM users WHERE id=?", (self.farmer["id"],)).fetchone()
        self.assertEqual(farmer["role"], "owner")
        self.assertEqual(farmer["mobile"], FARMER_MOBILE)
        conn.close()

    def test_25_migration_is_idempotent_and_preserves_data(self):
        conn = database.get_db()
        before = self._snapshot(conn)
        conn.close()
        # Re-running every migration (as a second Gunicorn worker would) must not
        # touch users, herds, animals or cases.
        database.init_db()
        conn = database.get_db()
        after = self._snapshot(conn)
        code_columns = {row["name"]: row["notnull"] for row in
                        conn.execute("PRAGMA table_info(otp_codes)").fetchall()}
        conn.close()
        self.assertEqual(before["users"], after["users"])
        self.assertEqual(before["counts"], after["counts"])
        # Signup OTPs need a nullable user_id; older databases are migrated once.
        self.assertFalse(code_columns["user_id"])
        self.assertFalse(code_columns["role"])

    def test_25b_legacy_otp_table_is_migrated_without_losing_rows(self):
        """A pre-signup database has NOT NULL otp_codes.user_id/role.

        The migration rebuilds that table once; every existing OTP row must
        survive verbatim and the new constraints must allow signup OTPs.
        """
        legacy_path = os.path.join(os.path.dirname(__file__), "test_role_auth_legacy.db")
        if os.path.exists(legacy_path):
            os.remove(legacy_path)
        conn = sqlite3.connect(legacy_path)
        conn.row_factory = sqlite3.Row
        try:
            conn.executescript("""
                CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT,
                    mobile TEXT, email TEXT, password_hash TEXT, salt TEXT, role TEXT);
                INSERT INTO users (full_name, mobile, email, role)
                    VALUES ('Legacy Farmer', '9800000001', 'legacy@example.com', 'owner');
                CREATE TABLE otp_codes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    role TEXT NOT NULL,
                    mobile_e164 TEXT NOT NULL,
                    otp_hash TEXT NOT NULL,
                    otp_salt TEXT NOT NULL,
                    purpose TEXT NOT NULL DEFAULT 'farmer_login',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 5,
                    status TEXT NOT NULL DEFAULT 'ACTIVE'
                        CHECK(status IN ('ACTIVE','USED','INVALIDATED','EXPIRED','LOCKED','SEND_FAILED')),
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    consumed_at TEXT,
                    request_ip TEXT
                );
                INSERT INTO otp_codes (user_id, role, mobile_e164, otp_hash, otp_salt,
                                       status, created_at, expires_at)
                    VALUES (1, 'owner', '+919800000001', 'hash', 'salt', 'USED',
                            '2026-01-01T00:00:00+00:00', '2026-01-01T00:05:00+00:00');
            """)
            conn.commit()
            database.ensure_otp_tables(conn)
            columns = {row["name"]: row["notnull"] for row in
                       conn.execute("PRAGMA table_info(otp_codes)").fetchall()}
            rows = [dict(row) for row in conn.execute("SELECT * FROM otp_codes").fetchall()]
            # Re-running must be a no-op (two workers can boot together).
            database.ensure_otp_tables(conn)
        finally:
            conn.close()
            if os.path.exists(legacy_path):
                os.remove(legacy_path)

        self.assertFalse(columns["user_id"], "signup OTPs need a nullable user_id")
        self.assertFalse(columns["role"])
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["mobile_e164"], "+919800000001")
        self.assertEqual(row["status"], "USED")
        self.assertEqual(row["consumed_at"], None)
        self.assertEqual(row["otp_hash"], "hash")
        self.assertEqual(row["attempts"], 0)
        for column in ("registration_token_hash", "registration_used_at",
                       "gateway_message_id", "pepper_fingerprint"):
            self.assertIn(column, columns)

    # ------------------------ 12. unrelated features still work (C12)
    def test_26_health_ivr_and_disease_catalogue_still_work(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        body = health.get_json()
        self.assertEqual(body["service"], "pashu-shield-backend")
        self.assertEqual(body["auth"]["farmer"]["login"], "mobile_otp")
        self.assertFalse(body["auth"]["farmer"]["password_login"])
        self.assertEqual(body["auth"]["staff_login_method"], "password")
        self.assertEqual(sorted(body["auth"]["staff_self_register_roles"]), ["govt", "lab", "vet"])
        self.assertNotIn("password_fallback_enabled", body.get("farmer_otp_login", {}))
        self.assertNotIn("test-pass", str(body))

        ivr = self.client.get("/api/ivr/info")
        self.assertEqual(ivr.status_code, 200)
        self.assertTrue(ivr.get_json()["helpline_number"])

        vet_token = self.client.post("/api/auth/login", json={
            "identifier": VET_EMAIL, "password": STAFF_PASSWORD}).get_json()["token"]
        diseases = self.client.get("/api/diseases",
                                   headers={"Authorization": f"Bearer {vet_token}"})
        self.assertEqual(diseases.status_code, 200)
        self.assertTrue(len(diseases.get_json()) > 0)

    def test_27_disease_reporting_ml_and_lab_queue_still_work(self):
        farmer = self.farmer_login()
        owner_headers = {"Authorization": f"Bearer {farmer['token']}"}
        report = self.client.post("/api/cases", headers=owner_headers, json={
            "animal_id": self._first_animal_id(),
            "disease_suspected": "Foot and Mouth Disease",
            "symptoms": "Salivation and lameness",
            "severity": "HIGH",
        })
        self.assertEqual(report.status_code, 201, report.get_json())

        govt_token = self.client.post("/api/auth/login", json={
            "identifier": GOVT_EMAIL, "password": STAFF_PASSWORD}).get_json()["token"]
        govt_headers = {"Authorization": f"Bearer {govt_token}"}
        for path in ("/api/govt/ai/status", "/api/govt/trends"):
            response = self.client.get(path, headers=govt_headers)
            self.assertEqual(response.status_code, 200, path)

        lab_token = self.client.post("/api/auth/login", json={
            "identifier": LAB_EMAIL, "password": STAFF_PASSWORD}).get_json()["token"]
        queue = self.client.get("/api/lab/queue", headers={"Authorization": f"Bearer {lab_token}"})
        self.assertEqual(queue.status_code, 200)

        # Farmer records created through the OTP flow behave like any other
        # farmer: the new profile can list its (empty) herd and dashboard.
        created = self.signup_farmer(suite_mobile(30))
        headers = {"Authorization": f"Bearer {created['token']}"}
        self.assertEqual(self.client.get("/api/owner/summary", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/herds", headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/animals", headers=headers).status_code, 200)

    def _first_animal_id(self) -> int:
        conn = database.get_db()
        row = conn.execute("SELECT id FROM animals WHERE owner_id=? ORDER BY id LIMIT 1",
                           (self.farmer["id"],)).fetchone()
        conn.close()
        self.assertIsNotNone(row, "the seeded farmer must own at least one animal")
        return row["id"]


if __name__ == "__main__":
    unittest.main(verbosity=2)
