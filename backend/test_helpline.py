import json
import os
import re
import sys
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from app import app, make_token
import database
import weather
from ivr_config import get_ivr_settings
from ivr_security import sign_webhook_payload
from ivr_service import list_vet_availability, recover_stale_sessions


class TestHelplineRestoration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        app.testing = True
        cls.client = app.test_client()
        conn = database.get_db()
        cls.owner = dict(conn.execute("SELECT * FROM users WHERE email='rajesh@example.com'").fetchone())
        cls.vet = dict(conn.execute("SELECT * FROM users WHERE email='vet1@example.com'").fetchone())
        cls.govt = dict(conn.execute("SELECT * FROM users WHERE email='govt@example.com'").fetchone())
        conn.close()
        cls.owner_token = make_token(cls.owner)
        cls.vet_token = make_token(cls.vet)
        cls.govt_token = make_token(cls.govt)

    def auth(self, token):
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def signed_post(self, path, payload):
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        timestamp = str(int(time.time()))
        secret = os.environ["IVR_WEBHOOK_SECRET"]
        return self.client.post(
            path,
            data=raw,
            content_type="application/json",
            headers={
                "X-IVR-Timestamp": timestamp,
                "X-IVR-Signature": sign_webhook_payload(secret, timestamp, raw),
            },
        )

    def inbound(self, caller="9800000001"):
        response = self.signed_post(
            "/api/ivr/calls/inbound",
            {"caller_number": caller, "provider_call_id": f"mock-{uuid.uuid4().hex}"},
        )
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()

    def submit_completed_report(self, symptoms="fever and reduced eating", provider_id=None):
        return self.signed_post(
            "/api/ivr/report",
            {
                "mobile": "9800000001",
                "provider_call_id": provider_id or f"report-{uuid.uuid4().hex}",
                "language": "mr",
                "district": "Pune",
                "village": "Wagholi",
                "animal_id": 1,
                "symptoms": symptoms,
                "duration": "2 days",
                "severity": "High",
                "affected_count": 1,
                "farmer_observations": "Animal is not eating",
            },
        )

    def test_01_helpline_number(self):
        self.assertEqual(get_ivr_settings().phone_number, "7382210251")

    def test_02_e164_and_info_are_honest(self):
        response = self.client.get("/api/ivr/info")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["helpline_e164"], "+917382210251")
        self.assertFalse(data["pstn_connected"])

    def test_03_frontend_click_to_call(self):
        text = Path("../frontend/app.js").read_text(encoding="utf-8")
        self.assertIn("tel:+917382210251", text)
        self.assertIn("getIvrInfo", text)

    def test_04_demo_account_details_visible_on_auth(self):
        text = Path("../frontend/app.js").read_text(encoding="utf-8")
        self.assertIn("Demo Account", text)
        self.assertIn("Username:", text)
        self.assertIn("Password:", text)
        self.assertGreaterEqual(text.count("demoAccountBox(role)"), 3)

    def test_05_demo_login(self):
        """Farmers sign in with the mobile + OTP flow (no password login)."""
        refused = self.client.post("/api/auth/login",
                                   json={"identifier": "rajesh@example.com",
                                         "password": "password123"})
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.get_json()["code"], "FARMER_OTP_REQUIRED")

        # The OTP path logs the same seeded demo farmer in. SMS is mocked: the
        # stub captures the message, which is how the code is read here.
        sent = []

        def fake_send(to_e164, text, **kwargs):
            sent.append(text)
            return {"delivered": True, "simulated": False, "mode": "CLOUD",
                    "message_id": "helpline-stub", "state": "Pending"}

        import sms_gateway
        with patch.object(sms_gateway, "send_text_message", fake_send), \
                patch.dict(os.environ, {
                    "SMS_GATEWAY_MODE": "CLOUD",
                    "SMS_GATEWAY_BASE_URL": "https://api.sms-gate.app/3rdparty/v1",
                    "SMS_GATEWAY_USERNAME": "test-user",
                    "SMS_GATEWAY_PASSWORD": "test-pass"}):
            self.assertEqual(self.client.post("/api/auth/farmer/request-otp",
                                              json={"mobile": "9800000001"}).status_code, 200)
            code = re.search(r"\b(\d{6})\b", sent[-1]).group(1)
            verified = self.client.post("/api/auth/farmer/verify-otp",
                                        json={"mobile": "9800000001", "otp": code})
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified.get_json()["user"]["role"], "owner")

    def test_06_existing_role_login(self):
        response = self.client.post("/api/auth/login", json={"identifier": "vet1@example.com", "password": "password123"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["user"]["role"], "vet")

    def test_07_registration_with_language(self):
        """Staff keep password signup; farmers create the profile via OTP."""
        suffix = uuid.uuid4().hex[:8]
        response = self.client.post("/api/auth/register", json={
            "full_name": "Helpline Registration Test", "mobile": f"91{suffix[:8]}",
            "email": f"helpline-{suffix}@example.com", "password": "secret12",
            # A non-vet staff role: registering a vet here would add an
            # AVAILABLE veterinarian and change the IVR routing assertions
            # that later tests in this suite depend on.
            "confirm_password": "secret12", "role": "lab", "district": "Pune",
            "preferred_language": "te",
        })
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertEqual(response.get_json()["user"]["preferred_language"], "te")

        # The farmer password signup route is closed...
        refused = self.client.post("/api/auth/register", json={
            "full_name": "Farmer Registration Test", "mobile": f"92{suffix[:8]}",
            "email": f"helpline-farmer-{suffix}@example.com", "password": "secret12",
            "confirm_password": "secret12", "role": "owner", "district": "Pune",
        })
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.get_json()["code"], "FARMER_OTP_SIGNUP_REQUIRED")

    def test_08_farmer_identification(self):
        data = self.inbound()
        self.assertTrue(data["farmer_identified"])
        self.assertEqual(data["farmer"]["id"], self.owner["id"])

    def test_09_known_language_is_reused(self):
        data = self.inbound()
        self.assertEqual(data["language"], "mr")
        self.assertNotEqual(data["next_stage"], "LANGUAGE_REQUIRED")

    def test_10_unknown_language_is_requested(self):
        data = self.inbound("+919100000001")
        self.assertFalse(data["farmer_identified"])
        self.assertEqual(data["next_stage"], "LANGUAGE_REQUIRED")

    def test_11_known_region_is_reused(self):
        data = self.inbound()
        self.assertEqual(data["district"], "Pune")
        self.assertEqual(data["location_source"], "PROFILE_LOCATION")

    def test_12_unknown_region_is_requested(self):
        data = self.inbound("+919100000002")
        response = self.signed_post(f"/api/ivr/calls/{data['call_id']}/input", {"dtmf": "2"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["next_stage"], "REGION_REQUIRED")

    def test_13_regional_veterinarian_routing(self):
        conn = database.get_db()
        conn.execute("UPDATE vet_availability SET status='AVAILABLE', current_call_id=NULL, busy_since=NULL")
        conn.commit(); conn.close()
        data = self.inbound()
        response = self.signed_post(f"/api/ivr/calls/{data['call_id']}/input", {"dtmf": "1"})
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        routed = response.get_json()
        self.assertEqual(routed["status"], "ROUTING")
        conn = database.get_db()
        vet = conn.execute("SELECT district FROM users WHERE id=?", (routed["vet_id"],)).fetchone()
        conn.close()
        self.assertEqual(vet["district"], "Pune")

    def test_14_language_matching(self):
        conn = database.get_db()
        row = conn.execute("SELECT id FROM users WHERE email='telugu-vet@example.com'").fetchone()
        if not row:
            password_hash, salt = database.hash_password("password123")
            vet_id = conn.execute(
                "INSERT INTO users (full_name,mobile,email,password_hash,salt,role,specialization,preferred_language,village,block,district,state) VALUES (?,?,?,?,?,'vet','Livestock Medicine','te','Pune','Haveli','Pune','Maharashtra')",
                ("Dr Telugu", "9800000099", "telugu-vet@example.com", password_hash, salt),
            ).lastrowid
        else:
            vet_id = row["id"]
        conn.execute("INSERT OR REPLACE INTO vet_availability (vet_id,status,supported_languages,updated_at) VALUES (?,'AVAILABLE','[\"te\"]',datetime('now'))", (vet_id,))
        conn.execute("UPDATE vet_availability SET supported_languages='[\"en\",\"mr\",\"hi\"]', status='AVAILABLE' WHERE vet_id=?", (self.vet["id"],))
        conn.commit(); conn.close()
        data = self.inbound("+919100000003")
        call_id = data["call_id"]
        self.signed_post(f"/api/ivr/calls/{call_id}/input", {"language": "te"})
        self.signed_post(f"/api/ivr/calls/{call_id}/input", {"district": "Pune", "village": "Pune"})
        routed = self.signed_post(f"/api/ivr/calls/{call_id}/input", {"menu_option": "1"}).get_json()
        self.assertEqual(routed["vet_id"], vet_id)
        self.assertIn("language_match", routed["routing"]["reasons"])

    def test_15_availability_check(self):
        conn = database.get_db()
        conn.execute("UPDATE vet_availability SET status='OFFLINE', current_call_id=NULL, busy_since=NULL WHERE vet_id=?", (self.vet["id"],))
        conn.commit()
        rows = list_vet_availability(conn)
        conn.close()
        selected = next(row for row in rows if row["vet_id"] == self.vet["id"])
        self.assertEqual(selected["effective_status"], "OFFLINE")

    def test_16_stale_busy_recovery(self):
        data = self.inbound()
        conn = database.get_db()
        conn.execute("UPDATE helpline_calls SET status='ROUTING', vet_id=?, last_activity_at=datetime('now','-2 hours') WHERE call_id=?", (self.vet["id"], data["call_id"]))
        conn.execute("UPDATE vet_availability SET status='BUSY', current_call_id=?, busy_since=datetime('now','-2 hours') WHERE vet_id=?", (data["call_id"], self.vet["id"]))
        conn.commit()
        self.assertEqual(recover_stale_sessions(conn), 1)
        availability = conn.execute("SELECT status,current_call_id FROM vet_availability WHERE vet_id=?", (self.vet["id"],)).fetchone()
        call = conn.execute("SELECT status FROM helpline_calls WHERE call_id=?", (data["call_id"],)).fetchone()
        conn.close()
        self.assertEqual(availability["status"], "AVAILABLE")
        self.assertIsNone(availability["current_call_id"])
        self.assertEqual(call["status"], "PARTIAL")

    def test_17_no_vet_fallback(self):
        conn = database.get_db()
        conn.execute("UPDATE vet_availability SET status='OFFLINE', current_call_id=NULL, busy_since=NULL")
        conn.commit(); conn.close()
        data = self.inbound()
        response = self.signed_post(f"/api/ivr/calls/{data['call_id']}/input", {"menu_option": "1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "SURVEY_STARTED")
        self.assertEqual(response.get_json()["fallback_reason"], "NO_AVAILABLE_VETERINARIAN")
        conn = database.get_db(); conn.execute("UPDATE vet_availability SET status='AVAILABLE'"); conn.commit(); conn.close()

    def test_18_automatic_survey_preserves_answers(self):
        data = self.inbound("+919100000004")
        call_id = data["call_id"]
        self.signed_post(f"/api/ivr/calls/{call_id}/input", {"language": "hi"})
        self.signed_post(f"/api/ivr/calls/{call_id}/input", {"district": "Pune", "village": "Wagholi"})
        response = self.signed_post(f"/api/ivr/calls/{call_id}/input", {"menu_option": "2"})
        answers = {
            "animal_name": "Gauri", "species": "Cattle", "breed": "Gir", "age": "4",
            "sex": "Female", "symptoms": "fever", "duration": "one day", "severity": "High",
            "affected_count": "1", "vaccination_status": "Not Provided", "previous_treatment": "No",
            "medicines_used": "None", "farmer_observations": "not eating", "additional_information": "None",
        }
        for _ in range(20):
            body = response.get_json()
            if body["status"] == "SURVEY_COMPLETED":
                break
            field = body["current_question"]
            response = self.signed_post(f"/api/ivr/calls/{call_id}/input", {"field": field, "value": answers.get(field, "Not Provided")})
        result = response.get_json()
        self.assertEqual(result["status"], "SURVEY_COMPLETED")
        self.assertEqual(result["survey_data"]["symptoms"], "fever")
        self.assertEqual(result["report"]["status"], "PARTIAL")

    def test_19_automatic_report(self):
        response = self.submit_completed_report("sudden fever and coughing")
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        self.assertTrue(response.get_json()["report"]["report_no"].startswith("HLPR-"))
        self.assertIsNone(response.get_json()["report"]["structured_summary"]["diagnosis"])

    def test_20_case_creation_uses_existing_system(self):
        response = self.submit_completed_report("swollen leg and fever")
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertIsNotNone(data["report"]["case_id"])
        self.assertEqual(data["case"]["reported_through"], "HELPLINE")

    def test_21_veterinarian_notification(self):
        response = self.submit_completed_report("new eye discharge")
        report_no = response.get_json()["report"]["report_no"]
        conn = database.get_db()
        count = conn.execute("SELECT COUNT(*) c FROM notifications WHERE message LIKE ?", (f"%{report_no}%",)).fetchone()["c"]
        conn.close()
        self.assertGreater(count, 0)

    def test_22_government_visibility(self):
        response = self.client.get("/api/ivr/reports", headers=self.auth(self.govt_token))
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.get_json()), 0)

    def test_23_gis_includes_helpline_cases(self):
        response = self.client.get("/api/govt/geo", headers=self.auth(self.govt_token))
        self.assertEqual(response.status_code, 200)
        pune = next(item for item in response.get_json() if item["district"] == "Pune")
        self.assertGreaterEqual(pune["helpline_cases"], 1)

    def test_24_duplicate_detection_flags_without_deleting(self):
        symptoms = f"duplicate fever cough {uuid.uuid4().hex[:6]}"
        first = self.submit_completed_report(symptoms)
        second = self.submit_completed_report(symptoms)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second.get_json()["report"]["status"], "DUPLICATE_FLAGGED")
        self.assertIsNotNone(second.get_json()["report"]["duplicate_of"])

    def test_25_partial_call_preservation(self):
        data = self.inbound()
        response = self.signed_post(f"/api/ivr/calls/{data['call_id']}/events", {"event": "hangup"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "PARTIAL")
        self.assertEqual(response.get_json()["farmer_id"], self.owner["id"])

    def test_26_existing_web_reporting(self):
        response = self.client.post(
            "/api/cases", json={"animal_id": 1, "symptoms": "web report regression", "severity": "Low"},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["reported_through"], "Mobile App")

    def test_27_ml_endpoints_and_health_exist(self):
        source = Path("../ml-backend/main.py").read_text(encoding="utf-8")
        for route in ("/health", "/api/predict", "/api/outbreak-detection", "/api/model-performance"):
            self.assertIn(route, source)

    def test_28_existing_weather_endpoint(self):
        cached = {
            "temperature": 26.0, "rainfall": 1.0, "humidity": 70.0,
            "source": "test observation", "status": "cached_fresh", "is_stale": False,
            "district": "Pune", "lat": 18.52, "lng": 73.85, "recorded_at": "2026-09-30T00:00",
        }
        with patch.object(weather, "fetch_district_weather", return_value=cached):
            response = self.client.get("/api/weather/Pune", headers=self.auth(self.owner_token))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["source"], "test observation")

    def test_29_security_401_403_and_webhook_auth(self):
        self.assertEqual(self.client.get("/api/ivr/reports").status_code, 401)
        lab = self.client.post("/api/auth/login", json={"identifier": "lab@example.com", "password": "password123"}).get_json()["token"]
        self.assertEqual(self.client.get("/api/ivr/reports", headers=self.auth(lab)).status_code, 403)
        unsigned = self.client.post("/api/ivr/calls/inbound", json={"caller_number": "9800000001"})
        self.assertEqual(unsigned.status_code, 401)

    def test_30_mock_ivr_is_explicit(self):
        data = self.inbound()
        self.assertEqual(data["provider_mode"], "MOCK")
        self.assertIn(data["instruction"]["action"], {"MOCK_GATHER", "MENU_REQUIRED"})

    def test_31_production_configuration(self):
        render = Path("../render.yaml").read_text(encoding="utf-8")
        requirements = Path("requirements.txt").read_text(encoding="utf-8").lower()
        self.assertIn("SIH_DB_PATH", render)
        self.assertIn("/var/data", render)
        self.assertIn("IVR_PSTN_CONNECTED", render)
        self.assertIn("gunicorn", requirements)

    def test_32_backend_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["database"], "ok")

    def test_33_helpline_analytics(self):
        response = self.client.get("/api/ivr/analytics", headers=self.auth(self.govt_token))
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertGreater(data["total_calls"], 0)
        self.assertIn("calls_by_language", data)

    def test_34_mock_bridge_postcall_pipeline(self):
        conn = database.get_db()
        conn.execute("UPDATE vet_availability SET status='AVAILABLE', current_call_id=NULL, busy_since=NULL")
        conn.commit(); conn.close()
        call = self.inbound()
        call_id = call["call_id"]
        routed = self.signed_post(f"/api/ivr/calls/{call_id}/input", {"menu_option": "1"})
        self.assertEqual(routed.get_json()["status"], "ROUTING")
        connected = self.signed_post(f"/api/ivr/calls/{call_id}/events", {"event": "bridge_connected"})
        self.assertEqual(connected.get_json()["status"], "VET_CONNECTED")
        self.signed_post(
            f"/api/ivr/calls/{call_id}/events",
            {"event": "transcript", "text": "Gauri has high fever for 2 days. Follow up tomorrow."},
        )
        ended = self.signed_post(f"/api/ivr/calls/{call_id}/events", {"event": "hangup"})
        data = ended.get_json()
        self.assertEqual(data["status"], "COMPLETED")
        self.assertIsNotNone(data["report"]["case_id"])
        self.assertIsNone(data["report"]["structured_summary"]["diagnosis"])


if __name__ == "__main__":
    unittest.main()
