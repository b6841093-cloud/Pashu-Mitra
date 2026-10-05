"""Real-time web calling — backend unit + integration tests (no browser needed).

Run with either::

    cd backend
    python -m unittest test_webcalling -v
    python -m pytest test_webcalling.py -v

What this suite does and does not prove
---------------------------------------
PROVES (against the real Flask app, real database and real Socket.IO server):
  * authentication/authorization on every call endpoint,
  * server-side routing (region, language, explicit availability, live lease),
  * the atomic answer guarantee (two simultaneous accepts cannot both win),
  * accurate lifecycle statuses/timestamps and the transition guards,
  * presence-lease expiry (a closed browser stops being "available"),
  * durable signaling relay + authorization, and payload validation,
  * call history scoping per role,
  * Web Push dispatch to the assigned veterinarian (via a stubbed push library).

DOES NOT PROVE: that audio flows between two browsers. That requires two real
browser engines and a real `RTCPeerConnection`; see
``tests/webrtc/README.md`` (Node-hosted real WebRTC peers) and
``frontend/tests/webcall_browser.test.mjs`` (Playwright two-browser test).
"""
from __future__ import annotations

import json
import os
import threading
import time
import unittest
from unittest import mock

os.environ.setdefault("SIH_SECRET_KEY", "test-secret-key-for-webcall-suite")
# Throwaway database; never the deployment DB.
os.environ.setdefault("SIH_DB_PATH", os.path.join(os.path.dirname(__file__), "test_webcalling.db"))
# Push runs inline so the assertions are deterministic.
os.environ.setdefault("SIH_WEBCALL_PUSH_SYNC", "1")
os.environ.setdefault("SIH_WEBCALL_SWEEPER", "false")

from app import app, make_token, socketio  # noqa: E402
import database  # noqa: E402
import push_service  # noqa: E402
import turn_config  # noqa: E402
import webcalling  # noqa: E402


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


class WebCallingTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        app.testing = True
        cls.client = app.test_client()
        conn = database.get_db()
        cls.owner = dict(conn.execute("SELECT * FROM users WHERE email='rajesh@example.com'").fetchone())
        cls.other_owner = dict(conn.execute("SELECT * FROM users WHERE email='sunita@example.com'").fetchone())
        cls.vet = dict(conn.execute("SELECT * FROM users WHERE email='vet1@example.com'").fetchone())
        cls.vet2 = dict(conn.execute("SELECT * FROM users WHERE email='vet2@example.com'").fetchone())
        cls.govt = dict(conn.execute("SELECT * FROM users WHERE email='govt@example.com'").fetchone())
        cls.lab = dict(conn.execute("SELECT * FROM users WHERE email='lab@example.com'").fetchone())
        conn.close()
        cls.owner_token = make_token(cls.owner)
        cls.other_owner_token = make_token(cls.other_owner)
        cls.vet_token = make_token(cls.vet)
        cls.vet2_token = make_token(cls.vet2)
        cls.govt_token = make_token(cls.govt)
        cls.lab_token = make_token(cls.lab)

    def setUp(self):
        conn = database.get_db()
        # Deterministic starting point for every test.
        conn.execute("UPDATE web_calls SET status='cancelled', ended_at=datetime('now') WHERE status NOT IN "
                     "('ended','rejected','cancelled','missed','busy','failed','expired')")
        conn.execute("DELETE FROM web_calls")
        conn.execute("DELETE FROM web_call_signals")
        conn.execute("DELETE FROM web_call_events")
        conn.execute("DELETE FROM vet_presence")
        conn.execute("DELETE FROM notifications WHERE type='call'")
        conn.execute("UPDATE vet_availability SET status='AVAILABLE', current_call_id=NULL")
        conn.commit()
        conn.close()

    # ---------------------------------------------------------------- helpers
    def make_vet_available(self, vet=None, languages=None):
        """Explicit availability (persistent) + a live presence lease."""
        vet = vet or self.vet
        token = self.vet_token if vet["id"] == self.vet["id"] else self.vet2_token
        resp = self.client.put(
            "/api/vet/availability",
            headers=_auth(token),
            json={"status": "AVAILABLE", "supported_languages": languages or ["en", "hi", "mr"]},
        )
        self.assertEqual(resp.status_code, 200, resp.get_json())
        resp = self.client.post("/api/webcall/presence", headers=_auth(token), json={"client": "unit-test"})
        self.assertEqual(resp.status_code, 200, resp.get_json())
        return resp.get_json()

    def start_call(self, token=None, **body):
        payload = {"language": "en", "reason": "animal_sick", "reason_note": "Cow with fever"}
        payload.update(body)
        return self.client.post(
            "/api/webcall/calls", headers=_auth(token or self.owner_token), json=payload
        )

    def live_call(self, accept=True):
        """Create a ringing call with vet1 as the assignee."""
        self.make_vet_available()
        resp = self.start_call()
        self.assertEqual(resp.status_code, 201, resp.get_json())
        call_id = resp.get_json()["call"]["call_id"]
        if accept:
            resp = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
            self.assertEqual(resp.status_code, 200, resp.get_json())
        return call_id


class TestWebCallingAuthz(WebCallingTestBase):
    def test_01_config_requires_authentication(self):
        self.assertEqual(self.client.get("/api/webcall/config").status_code, 401)

    def test_02_unauthenticated_cannot_start_a_call(self):
        resp = self.client.post("/api/webcall/calls", json={"language": "en", "reason": "animal_sick"})
        self.assertEqual(resp.status_code, 401)

    def test_03_only_farmers_can_start_calls(self):
        self.make_vet_available()
        for token in (self.vet_token, self.govt_token, self.lab_token):
            resp = self.start_call(token=token)
            self.assertEqual(resp.status_code, 403, resp.get_json())

    def test_04_farmer_identity_and_region_come_from_the_session(self):
        """A caller-supplied id/role/district is ignored; the token wins."""
        self.make_vet_available(self.vet)  # vet1: Pune, speaks en/hi/mr
        resp = self.start_call(
            caller_id=self.other_owner["id"], role="vet", district="Nashik", vet_id=self.vet2["id"]
        )
        self.assertEqual(resp.status_code, 201, resp.get_json())
        call = resp.get_json()["call"]
        self.assertEqual(call["caller"]["id"], self.owner["id"])
        self.assertEqual(call["district"], self.owner["district"])  # Pune, from the profile
        conn = database.get_db()
        row = conn.execute("SELECT * FROM web_calls WHERE call_id=?", (call["call_id"],)).fetchone()
        conn.close()
        self.assertEqual(row["caller_id"], self.owner["id"])
        self.assertEqual(row["caller_role"], "owner")
        self.assertEqual(row["vet_id"], self.vet["id"])

    def test_05_only_the_assigned_vet_can_accept(self):
        call_id = self.live_call(accept=False)
        # Another veterinarian.
        resp = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet2_token), json={})
        self.assertEqual(resp.status_code, 403, resp.get_json())
        # Wrong roles.
        for token in (self.owner_token, self.govt_token, self.lab_token):
            resp = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(token), json={})
            self.assertIn(resp.status_code, (403,), resp.get_json())
        # The assigned veterinarian still can.
        resp = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(resp.get_json()["call"]["status"], "accepted")

    def test_06_non_participant_cannot_read_a_call_or_its_signals(self):
        call_id = self.live_call()
        for token in (self.other_owner_token, self.vet2_token, self.lab_token):
            self.assertEqual(self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(token)).status_code, 403)
            self.assertEqual(
                self.client.get(f"/api/webcall/calls/{call_id}/signals", headers=_auth(token)).status_code, 403
            )
        self.assertEqual(self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.govt_token)).status_code, 200)
        self.assertEqual(self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.vet_token)).status_code, 200)

    def test_07_call_ids_are_not_guessable(self):
        call_id = self.live_call(accept=False)
        self.assertTrue(call_id.startswith("wc_"))
        self.assertGreaterEqual(len(call_id), 20)
        self.assertEqual(
            self.client.get("/api/webcall/calls/wc_does_not_exist", headers=_auth(self.owner_token)).status_code, 404
        )


class TestWebCallingLifecycle(WebCallingTestBase):
    def test_10_happy_path_records_accurate_state_and_timestamps(self):
        call_id = self.live_call(accept=False)
        conn = database.get_db()
        row = conn.execute("SELECT * FROM web_calls WHERE call_id=?", (call_id,)).fetchone()
        conn.close()
        self.assertEqual(row["status"], "ringing")
        self.assertIsNotNone(row["ringing_at"])
        self.assertIsNone(row["connected_at"])

        self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        self.client.post(f"/api/webcall/calls/{call_id}/connecting", headers=_auth(self.vet_token), json={})
        resp = self.client.post(
            f"/api/webcall/calls/{call_id}/connected", headers=_auth(self.owner_token), json={"media_confirmed": True}
        )
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(resp.get_json()["call"]["status"], "connected")

        resp = self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.vet_token), json={"reason": "HANGUP"})
        self.assertEqual(resp.status_code, 200, resp.get_json())
        call = resp.get_json()["call"]
        self.assertEqual(call["status"], "ended")
        self.assertIsNotNone(call["ended_at"])
        self.assertIsNotNone(call["connected_at"])
        conn = database.get_db()
        row = conn.execute("SELECT * FROM web_calls WHERE call_id=?", (call_id,)).fetchone()
        conn.close()
        self.assertEqual(row["ended_by"], self.vet["id"])
        self.assertIsInstance(row["duration_seconds"], int)

    def test_11_state_machine_rejects_invalid_transitions(self):
        self.make_vet_available()
        resp = self.start_call()
        call_id = resp.get_json()["call"]["call_id"]

        # Cannot confirm media before the veterinarian answers.
        resp = self.client.post(f"/api/webcall/calls/{call_id}/connected", headers=_auth(self.owner_token), json={})
        self.assertEqual(resp.status_code, 409, resp.get_json())
        self.assertEqual(resp.get_json()["call"]["status"], "ringing")

        # Unknown statuses cannot be produced by any request body.
        resp = self.client.post(
            f"/api/webcall/calls/{call_id}/connected",
            headers=_auth(self.vet_token),
            json={"status": "connected", "media_confirmed": True},
        )
        self.assertEqual(resp.status_code, 409)

    def test_12_two_simultaneous_answers_cannot_both_succeed(self):
        """Concurrent answers: the state transition happens exactly once.

        Repeated answers *by the assigned veterinarian* are idempotent (a double
        click must not fail), but any other account racing for the same call is
        refused, and the database records exactly one ACCEPTED transition.
        """
        self.make_vet_available()
        resp = self.start_call()
        call_id = resp.get_json()["call"]["call_id"]
        results: list[int] = []
        other_results: list[int] = []
        lock = threading.Lock()

        def worker(token, sink):
            client = app.test_client()
            r = client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(token), json={})
            with lock:
                sink.append(r.status_code)

        threads = [threading.Thread(target=worker, args=(self.vet_token, results)) for _ in range(4)]
        threads += [threading.Thread(target=worker, args=(self.vet2_token, other_results)) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 4)
        self.assertTrue(all(code in (200, 409) for code in results), results)
        self.assertIn(200, results)
        self.assertEqual(other_results, [403, 403])
        conn = database.get_db()
        accepted_events = conn.execute(
            "SELECT COUNT(*) c FROM web_call_events WHERE call_id=? AND event_type='ACCEPTED'", (call_id,)
        ).fetchone()["c"]
        row = conn.execute("SELECT status, accepted_at FROM web_calls WHERE call_id=?", (call_id,)).fetchone()
        conn.close()
        self.assertEqual(accepted_events, 1)
        self.assertEqual(row["status"], "accepted")
        self.assertIsNotNone(row["accepted_at"])

    def test_13_reject_and_cancel_produce_truthful_terminal_states(self):
        call_id = self.live_call(accept=False)
        resp = self.client.post(
            f"/api/webcall/calls/{call_id}/reject", headers=_auth(self.vet_token), json={"reason": "EMERGENCY_ON_ANOTHER_CALL"}
        )
        self.assertEqual(resp.status_code, 200, resp.get_json())
        self.assertEqual(resp.get_json()["call"]["status"], "rejected")
        # Rejecting twice must not rewrite history.
        resp = self.client.post(f"/api/webcall/calls/{call_id}/reject", headers=_auth(self.vet_token), json={})
        self.assertEqual(resp.status_code, 409)

        call_id = self.live_call(accept=False)
        resp = self.client.post(f"/api/webcall/calls/{call_id}/cancel", headers=_auth(self.owner_token), json={})
        self.assertEqual(resp.get_json()["call"]["status"], "cancelled")
        # Only the caller may cancel.
        call_id = self.live_call(accept=False)
        resp = self.client.post(f"/api/webcall/calls/{call_id}/cancel", headers=_auth(self.vet_token), json={})
        self.assertEqual(resp.status_code, 403)

    def test_14_ring_timeout_expires_the_call_and_stops_ringing(self):
        call_id = self.live_call(accept=False)
        conn = database.get_db()
        conn.execute(
            "UPDATE web_calls SET ring_timeout_seconds=1, ringing_at=datetime('now','-5 seconds') WHERE call_id=?",
            (call_id,),
        )
        conn.commit()
        expired = webcalling.expire_stale_calls(conn)
        conn.close()
        self.assertEqual(expired, 1)
        resp = self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.owner_token))
        call = resp.get_json()["call"]
        self.assertEqual(call["status"], "expired")
        self.assertEqual(call["end_reason"], "RING_TIMEOUT")
        # An expired call can no longer be answered.
        resp = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        self.assertEqual(resp.status_code, 409)

    def test_15_duplicate_answer_attempt_by_the_same_vet_is_idempotent(self):
        call_id = self.live_call(accept=False)
        first = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        second = self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.get_json()["call"]["status"], "accepted")

    def test_16_a_farmer_cannot_run_two_calls_at_once(self):
        call_id = self.live_call(accept=False)
        resp = self.start_call()
        self.assertEqual(resp.status_code, 409, resp.get_json())
        self.assertEqual(resp.get_json()["code"], "caller_busy")
        self.assertEqual(resp.get_json()["call"]["call_id"], call_id)

    def test_17_a_vet_already_on_a_call_is_not_routed_a_second_one(self):
        self.make_vet_available(self.vet)
        self.make_vet_available(self.vet2, languages=["en"])  # vet2 is Nashik + English
        first = self.start_call().get_json()["call"]["call_id"]
        self.client.post(f"/api/webcall/calls/{first}/accept", headers=_auth(self.vet_token), json={})

        # A second farmer must not be routed to the vet who is already talking.
        resp = self.start_call(token=self.other_owner_token)
        body = resp.get_json()
        self.assertEqual(body["call"]["status"], "ringing")
        self.assertEqual(body["call"]["vet"]["id"], self.vet2["id"])

        # With no other veterinarian online the answer is a truthful "unavailable".
        self.client.post(
            f"/api/webcall/calls/{body['call']['call_id']}/cancel",
            headers=_auth(self.other_owner_token), json={},
        )
        self.client.delete("/api/webcall/presence", headers=_auth(self.vet2_token))
        resp = self.start_call(token=self.other_owner_token)
        body = resp.get_json()
        self.assertEqual(body["call"]["status"], "missed")
        self.assertEqual(body["outcome"], "unavailable")
        self.assertIn("BUSY_WEB_CALL", body["skipped_codes"])
        self.assertIn("NO_LIVE_SESSION", body["skipped_codes"])
        self.assertEqual(body["call"]["status"], "missed")
        self.assertIsNone(body["call"]["connected_at"])
        self.assertIsNone(body["call"]["accepted_at"])

    def test_18_case_linking_is_verified_against_the_caller(self):
        self.make_vet_available()
        conn = database.get_db()
        own_case = conn.execute("SELECT id FROM cases WHERE owner_id=?", (self.owner["id"],)).fetchone()
        foreign_case = conn.execute("SELECT id FROM cases WHERE owner_id=?", (self.other_owner["id"],)).fetchone()
        if not foreign_case:
            animal = conn.execute("SELECT id, herd_id FROM animals WHERE owner_id=?", (self.other_owner["id"],)).fetchone()
            conn.execute(
                "INSERT INTO cases (case_no, animal_id, herd_id, owner_id, symptoms, severity, "
                "reported_through, status) VALUES ('CASE-TEST-WC-1', ?, ?, ?, 'test', 'Low', 'test', 'NEW')",
                (animal["id"], animal["herd_id"], self.other_owner["id"]),
            )
            conn.commit()
            foreign_case = conn.execute("SELECT id FROM cases WHERE owner_id=?", (self.other_owner["id"],)).fetchone()
        conn.close()
        resp = self.start_call(case_id=own_case["id"])
        self.assertEqual(resp.status_code, 201, resp.get_json())
        self.assertEqual(resp.get_json()["call"]["case_id"], own_case["id"])
        self.client.post(
            f"/api/webcall/calls/{resp.get_json()['call']['call_id']}/cancel", headers=_auth(self.owner_token), json={}
        )
        resp = self.start_call(case_id=foreign_case["id"])
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json()["code"], "case_not_authorized")

    def test_19_language_is_validated_and_used_for_routing(self):
        self.make_vet_available(self.vet, languages=["en"])  # vet1 does not speak Telugu here
        resp = self.start_call(language="te")
        body = resp.get_json()
        self.assertEqual(body["call"]["status"], "missed")
        self.assertIn("LANGUAGE_NOT_SUPPORTED", body["skipped_codes"])
        self.assertIn("language", body["message"].lower())

        resp = self.start_call(language="klingon")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_json()["code"], "bad_language")

    def test_20_bad_reason_and_oversized_note_are_rejected_or_trimmed(self):
        self.make_vet_available()
        resp = self.start_call(reason="<script>alert(1)</script>")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.get_json()["code"], "bad_reason")

        resp = self.start_call(reason_note="x" * 2000)
        self.assertEqual(resp.status_code, 201)
        conn = database.get_db()
        row = conn.execute("SELECT reason_note FROM web_calls WHERE call_id=?", (resp.get_json()["call"]["call_id"],)).fetchone()
        conn.close()
        self.assertEqual(len(row["reason_note"]), webcalling.MAX_REASON_NOTE)

    def test_21_creation_rate_limit_is_enforced(self):
        self.make_vet_available()
        for _ in range(webcalling.MAX_CALLS_PER_WINDOW):
            call_id = self.start_call().get_json()["call"]["call_id"]
            self.client.post(f"/api/webcall/calls/{call_id}/cancel", headers=_auth(self.owner_token), json={})
        resp = self.start_call()
        self.assertEqual(resp.status_code, 429, resp.get_json())
        self.assertEqual(resp.get_json()["code"], "rate_limited")


class TestWebCallingRoutingAndPresence(WebCallingTestBase):
    def test_30_no_live_session_means_no_route(self):
        """Explicit availability alone is not enough: a closed browser is offline."""
        self.client.put(
            "/api/vet/availability",
            headers=_auth(self.vet_token),
            json={"status": "AVAILABLE", "supported_languages": ["en"]},
        )
        resp = self.start_call()
        body = resp.get_json()
        self.assertEqual(body["call"]["status"], "missed")
        self.assertIn("NO_LIVE_SESSION", body["skipped_codes"])
        self.assertEqual(body["call"]["end_reason"], "NO_VET_AVAILABLE")

    def test_31_presence_lease_expires_and_the_vet_stops_being_available(self):
        self.make_vet_available()
        conn = database.get_db()
        state = webcalling.presence_state(conn, self.vet["id"])
        self.assertTrue(state["online"])
        # Simulate a closed browser / killed tab: the lease is not renewed.
        conn.execute("UPDATE vet_presence SET lease_expires_at=datetime('now','-1 seconds') WHERE vet_id=?", (self.vet["id"],))
        conn.commit()
        state = webcalling.presence_state(conn, self.vet["id"])
        self.assertFalse(state["online"])
        conn.close()
        resp = self.start_call()
        self.assertEqual(resp.get_json()["call"]["status"], "missed")
        self.assertIn("NO_LIVE_SESSION", resp.get_json()["skipped_codes"])

    def test_32_vet_going_offline_stops_routing(self):
        self.make_vet_available()
        resp = self.client.delete("/api/webcall/presence", headers=_auth(self.vet_token))
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()["online"])
        resp = self.start_call()
        self.assertEqual(resp.get_json()["call"]["status"], "missed")

    def test_33_explicit_availability_status_is_respected(self):
        self.make_vet_available()
        self.client.put(
            "/api/vet/availability", headers=_auth(self.vet_token), json={"status": "OFFLINE", "supported_languages": ["en"]}
        )
        self.client.post("/api/webcall/presence", headers=_auth(self.vet_token), json={})  # online but OFFLINE choice
        resp = self.start_call()
        body = resp.get_json()
        self.assertEqual(body["call"]["status"], "missed")
        self.assertIn("NOT_AVAILABLE:OFFLINE", body["skipped_reasons"])
        self.assertIn("NOT_AVAILABLE", body["skipped_codes"])

    def test_34_routing_prefers_same_district_then_language_match(self):
        """Documented policy: same district (+100) outranks a far-away vet."""
        # vet1 = Pune (same district as the caller), vet2 = Nashik.
        self.make_vet_available(self.vet)
        self.make_vet_available(self.vet2, languages=["en"])
        resp = self.start_call()
        call = resp.get_json()["call"]
        self.assertEqual(call["vet"]["id"], self.vet["id"])
        self.assertIn("same_region", call["routing"]["reasons"])
        self.assertEqual(call["routing"]["policy"], "district_language_load_v1")

    def test_35_a_vet_with_an_active_ivr_call_is_skipped(self):
        self.make_vet_available()
        conn = database.get_db()
        conn.execute(
            "UPDATE vet_availability SET status='BUSY', current_call_id='ivr-test-call' WHERE vet_id=?",
            (self.vet["id"],),
        )
        conn.commit()
        conn.close()
        resp = self.start_call()
        self.assertEqual(resp.get_json()["call"]["status"], "missed")

    def test_36_availability_snapshot_exposes_no_phone_numbers(self):
        self.make_vet_available()
        resp = self.client.get("/api/webcall/availability", headers=_auth(self.govt_token))
        self.assertEqual(resp.status_code, 200)
        payload = json.dumps(resp.get_json())
        self.assertNotIn("9800000010", payload)
        self.assertNotIn("mobile", payload)

    def test_37_assigned_vet_sees_the_caller_contact_only_while_live(self):
        call_id = self.live_call(accept=False)
        resp = self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.vet_token))
        self.assertEqual(resp.get_json()["call"]["caller"]["contact"], self.owner["mobile"])
        # A non-assigned vet never sees it (403 above); the caller's own view
        # never contains their own number back, and no vet number is ever sent.
        resp = self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.owner_token))
        self.assertNotIn("contact", resp.get_json()["call"]["caller"] or {})
        self.assertNotIn("contact", resp.get_json()["call"]["vet"] or {})
        self.client.post(f"/api/webcall/calls/{call_id}/reject", headers=_auth(self.vet_token), json={})
        resp = self.client.get(f"/api/webcall/calls/{call_id}", headers=_auth(self.vet_token))
        self.assertNotIn("contact", resp.get_json()["call"]["caller"] or {})


class TestWebCallingSignaling(WebCallingTestBase):
    def _offer(self):
        return {"type": "offer", "sdp": "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n"}

    def test_40_signals_are_stored_and_scoped_to_the_peer(self):
        call_id = self.live_call()
        conn = database.get_db()
        signal_id = webcalling.add_signal(conn, call_id, {"uid": self.owner["id"], "role": "owner"}, "offer", self._offer())
        self.assertIsInstance(signal_id, int)
        signals = webcalling.list_signals(conn, call_id, {"uid": self.vet["id"], "role": "vet"})
        conn.close()
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0]["from"], "peer")
        self.assertEqual(signals[0]["kind"], "offer")

        resp = self.client.get(
            f"/api/webcall/calls/{call_id}/signals?after={signal_id}", headers=_auth(self.vet_token)
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["signals"], [])

    def test_41_signaling_is_closed_before_accept_and_after_end(self):
        call_id = self.live_call(accept=False)
        conn = database.get_db()
        with self.assertRaises(webcalling.WebCallError) as ctx:
            webcalling.add_signal(conn, call_id, {"uid": self.owner["id"], "role": "owner"}, "offer", self._offer())
        self.assertEqual(ctx.exception.status_code, 409)
        conn.close()
        self.client.post(f"/api/webcall/calls/{call_id}/cancel", headers=_auth(self.owner_token), json={})

        call_id = self.live_call()
        self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.owner_token), json={})
        conn = database.get_db()
        with self.assertRaises(webcalling.WebCallError):
            webcalling.add_signal(conn, call_id, {"uid": self.owner["id"], "role": "owner"}, "ice", {"candidate": "x"})
        # Signals are deleted on terminal states (no lingering SDP/ICE data).
        remaining = conn.execute("SELECT COUNT(*) c FROM web_call_signals WHERE call_id=?", (call_id,)).fetchone()["c"]
        conn.close()
        self.assertEqual(remaining, 0)

    def test_42_non_participants_cannot_sign_and_bad_payloads_are_rejected(self):
        call_id = self.live_call()
        conn = database.get_db()
        with self.assertRaises(webcalling.WebCallError) as ctx:
            webcalling.add_signal(conn, call_id, {"uid": self.other_owner["id"], "role": "owner"}, "offer", self._offer())
        self.assertEqual(ctx.exception.status_code, 403)
        with self.assertRaises(webcalling.WebCallError) as ctx:
            webcalling.add_signal(conn, call_id, {"uid": self.owner["id"], "role": "owner"}, "evil_kind", {})
        self.assertEqual(ctx.exception.code, "bad_signal_kind")
        with self.assertRaises(webcalling.WebCallError) as ctx:
            webcalling.add_signal(
                conn, call_id, {"uid": self.owner["id"], "role": "owner"}, "offer", {"sdp": "x" * (webcalling.MAX_SIGNAL_BYTES + 1)}
            )
        self.assertEqual(ctx.exception.status_code, 413)
        conn.close()

    def test_43_signal_rate_limit(self):
        call_id = self.live_call()
        conn = database.get_db()
        for i in range(webcalling.MAX_SIGNALS_PER_MINUTE):
            conn.execute(
                "INSERT INTO web_call_signals (call_id, sender_id, kind, payload) VALUES (?,?,?,?)",
                (call_id, self.owner["id"], "ice", json.dumps({"i": i})),
            )
        conn.commit()
        self.assertTrue(webcalling.signal_rate_limited(conn, self.owner["id"]))
        self.assertFalse(webcalling.signal_rate_limited(conn, self.vet["id"]))
        conn.close()


class TestWebCallingSocketIO(WebCallingTestBase):
    """The socket layer: handshake authentication and event authorization."""

    def setUp(self):
        super().setUp()
        self.sockets = []

    def tearDown(self):
        for client in self.sockets:
            try:
                client.disconnect()
            except Exception:
                pass

    def connect(self, token):
        client = socketio.test_client(app, auth={"token": token} if token else None)
        self.sockets.append(client)
        return client

    def test_50_socket_requires_a_valid_token(self):
        self.assertFalse(self.connect(None).is_connected())
        self.assertFalse(self.connect("not-a-jwt").is_connected())

    def test_51_token_subject_must_exist(self):
        forged = make_token({"id": 999999, "role": "vet", "full_name": "Ghost"})
        self.assertFalse(self.connect(forged).is_connected())

    def test_52_vet_socket_gets_presence_and_call_events(self):
        vet_socket = self.connect(self.vet_token)
        self.assertTrue(vet_socket.is_connected())
        received = vet_socket.get_received()
        self.assertIn("session:ready", [event["name"] for event in received])
        self.assertIn("presence:ack", [event["name"] for event in received])

        resp = self.start_call()  # vet1 is online via the socket handshake
        self.assertEqual(resp.status_code, 201, resp.get_json())
        names = [event["name"] for event in vet_socket.get_received()]
        self.assertIn("call:incoming", names)
        self.assertIn("call:update", names)

    def test_53_events_go_only_to_the_assigned_vet(self):
        vet_socket = self.connect(self.vet_token)
        other_socket = self.connect(self.vet2_token)          # Nashik vet, online
        farmer_socket = self.connect(self.owner_token)
        govt_socket = self.connect(self.govt_token)
        for client in (vet_socket, other_socket, farmer_socket, govt_socket):
            client.get_received()

        resp = self.start_call()
        self.assertEqual(resp.status_code, 201)
        self.assertIn("call:incoming", [e["name"] for e in vet_socket.get_received()])
        self.assertEqual([], other_socket.get_received())
        self.assertEqual([], govt_socket.get_received())
        self.assertIn("call:update", [e["name"] for e in farmer_socket.get_received()])

    def test_54_socket_signaling_relays_between_participants_only(self):
        vet_socket = self.connect(self.vet_token)
        farmer_socket = self.connect(self.owner_token)
        intruder = self.connect(self.other_owner_token)
        resp = self.start_call()
        call_id = resp.get_json()["call"]["call_id"]
        self.client.post(f"/api/webcall/calls/{call_id}/accept", headers=_auth(self.vet_token), json={})
        for client in (vet_socket, farmer_socket, intruder):
            client.get_received()

        ack = farmer_socket.emit("call:signal", {"call_id": call_id, "kind": "offer", "payload": {"sdp": "v=0"}}, callback=True)
        self.assertTrue(ack["ok"], ack)
        vet_events = [e for e in vet_socket.get_received() if e["name"] == "call:signal"]
        self.assertEqual(len(vet_events), 1)
        self.assertEqual(vet_events[0]["args"][0]["kind"], "offer")
        self.assertEqual(vet_events[0]["args"][0]["from"], "peer")
        self.assertEqual([], [e for e in intruder.get_received() if e["name"] == "call:signal"])

        # The intruder cannot inject a signal into someone else's call.
        ack = intruder.emit("call:signal", {"call_id": call_id, "kind": "offer", "payload": {"sdp": "v=0"}}, callback=True)
        self.assertFalse(ack["ok"])
        self.assertEqual(ack["error"], "not_a_participant")
        self.assertEqual([], [e for e in farmer_socket.get_received() if e["name"] == "call:signal"])

    def test_55_disconnect_expires_the_lease(self):
        vet_socket = self.connect(self.vet_token)
        conn = database.get_db()
        self.assertTrue(webcalling.presence_state(conn, self.vet["id"])["online"])
        conn.close()
        vet_socket.disconnect()
        conn = database.get_db()
        self.assertFalse(webcalling.presence_state(conn, self.vet["id"])["online"])
        conn.close()

    def test_56_presence_heartbeat_requires_a_vet_role(self):
        farmer_socket = self.connect(self.owner_token)
        ack = farmer_socket.emit("presence:heartbeat", {}, callback=True)
        self.assertFalse(ack["ok"])
        vet_socket = self.connect(self.vet_token)
        ack = vet_socket.emit("presence:heartbeat", {}, callback=True)
        self.assertTrue(ack["ok"])
        self.assertIn("lease_expires_at", ack)


class TestWebCallingPushAndHistory(WebCallingTestBase):
    def test_60_incoming_call_pushes_to_the_assigned_vets_devices(self):
        self.make_vet_available()
        conn = database.get_db()
        conn.execute(
            "INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) "
            "VALUES (?,?,?,?,?)",
            (self.vet["id"], "https://push.example/endpoint-vet1", "p256dh-key", "auth-key", "unit-test"),
        )
        conn.commit()
        conn.close()

        sent: list[tuple] = []
        with mock.patch.object(push_service, "is_push_configured", lambda: True), \
             mock.patch.object(push_service, "push_notification",
                               lambda sub, payload, **kwargs: sent.append((sub, payload, kwargs)) or True):
            resp = self.start_call()
            self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(sent), 1)
        subscription, payload, push_options = sent[0]
        # A ringing call must be high-urgency and must expire with the ring window.
        self.assertEqual(push_options.get("urgency"), "high")
        self.assertGreaterEqual(int(push_options.get("ttl") or 0), 10)
        self.assertEqual(subscription["endpoint"], "https://push.example/endpoint-vet1")
        self.assertEqual(payload["type"], "incoming_call")
        self.assertEqual(payload["call_id"], resp.get_json()["call"]["call_id"])
        # No phone number may leak into a push payload (lock-screen preview).
        self.assertNotIn(self.owner["mobile"], json.dumps(payload))

    def test_61_in_app_notification_is_recorded_for_an_offline_vet(self):
        self.make_vet_available()
        self.start_call()
        conn = database.get_db()
        count = conn.execute(
            "SELECT COUNT(*) c FROM notifications WHERE user_id=? AND type='call'", (self.vet["id"],)
        ).fetchone()["c"]
        conn.close()
        self.assertEqual(count, 1)

    def test_62_history_is_scoped_per_role(self):
        call_id = self.live_call()
        self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.owner_token), json={})
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.owner_token))
        self.assertEqual(len(resp.get_json()["calls"]), 1)
        self.assertEqual(resp.get_json()["calls"][0]["call_id"], call_id)
        # A different farmer sees nothing.
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.other_owner_token))
        self.assertEqual(resp.get_json()["calls"], [])
        # The assigned vet sees it, vet2 does not.
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.vet_token))
        self.assertEqual(len(resp.get_json()["calls"]), 1)
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.vet2_token))
        self.assertEqual(resp.get_json()["calls"], [])
        # Government oversight sees it; the laboratory role is refused.
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.govt_token))
        self.assertEqual(len(resp.get_json()["calls"]), 1)
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.lab_token))
        self.assertEqual(resp.status_code, 403)

    def test_63_history_hides_contact_details_from_oversight(self):
        call_id = self.live_call()
        self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.owner_token), json={})
        resp = self.client.get("/api/webcall/calls/history", headers=_auth(self.govt_token))
        payload = json.dumps(resp.get_json())
        self.assertNotIn(self.owner["mobile"], payload)
        self.assertNotIn("contact", payload)

    def test_64_vet_summary_reports_answered_and_missed(self):
        call_id = self.live_call()
        self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.owner_token), json={})
        resp = self.client.get("/api/webcall/summary", headers=_auth(self.vet_token))
        stats = resp.get_json()["stats"]
        self.assertEqual(stats["total"], 1)
        self.assertEqual(stats["answered"], 1)


class TestWebCallingDoesNotBreakExistingFeatures(WebCallingTestBase):
    def test_70_ivr_configuration_and_routes_are_unchanged(self):
        self.assertEqual(self.client.get("/api/ivr/info").status_code, 200)
        info = self.client.get("/api/ivr/info").get_json()
        self.assertEqual(info["helpline_number"], "7382210251")
        self.assertFalse(info["pstn_connected"])
        self.assertEqual(info["provider_mode"], "MOCK")
        resp = self.client.get("/api/ivr/status", headers=_auth(self.govt_token))
        self.assertEqual(resp.status_code, 200)
        self.assertIn("setup_instructions", resp.get_json())

    def test_71_vet_availability_endpoint_still_works_for_the_ivr(self):
        resp = self.client.put(
            "/api/vet/availability",
            headers=_auth(self.vet_token),
            json={"status": "AVAILABLE", "supported_languages": ["en", "mr"]},
        )
        self.assertEqual(resp.status_code, 200)
        resp = self.client.get("/api/vet/availability", headers=_auth(self.vet_token))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()[0]["effective_status"], "AVAILABLE")

    def test_72_existing_endpoints_still_respond(self):
        for path in ("/api/health", "/api/users/me", "/api/animals", "/api/cases", "/api/notifications"):
            resp = self.client.get(path, headers=_auth(self.owner_token))
            self.assertEqual(resp.status_code, 200, (path, resp.get_json()))
        health = self.client.get("/api/health").get_json()
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["web_calling"]["signaling"], "flask-socketio")

    def test_73_web_calling_does_not_touch_helpline_call_records(self):
        conn = database.get_db()
        before = conn.execute("SELECT COUNT(*) c FROM helpline_calls").fetchone()["c"]
        conn.close()
        self.make_vet_available()
        call_id = self.live_call()
        self.client.post(f"/api/webcall/calls/{call_id}/end", headers=_auth(self.owner_token), json={})
        conn = database.get_db()
        after = conn.execute("SELECT COUNT(*) c FROM helpline_calls").fetchone()["c"]
        in_ivr = conn.execute("SELECT COUNT(*) c FROM vet_availability WHERE current_call_id IS NOT NULL").fetchone()["c"]
        conn.close()
        self.assertEqual(before, after)
        self.assertEqual(in_ivr, 0)


class TestWebCallingConfigAndHealth(WebCallingTestBase):
    def test_74_config_uses_public_backend_url_and_static_turn(self):
        env = {
            "SIH_PUBLIC_BACKEND_URL": "https://render.example.com",
            "SIH_STUN_URLS": '["stun:stun1.example.net:3478"]',
            "SIH_TURN_URLS": '["turn:global.relay.metered.ca:80","turn:global.relay.metered.ca:80?transport=tcp"]',
            "SIH_TURN_USERNAME": "metered-user",
            "SIH_TURN_CREDENTIAL": "metered-pass",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            resp = self.client.get("/api/webcall/config", headers=_auth(self.owner_token))
        self.assertEqual(resp.status_code, 200, resp.get_json())
        body = resp.get_json()
        self.assertEqual(body["signaling"]["url"], "https://render.example.com")
        self.assertEqual(body["signaling"]["offline_warning_seconds"], 10)
        self.assertEqual(body["ice"]["turn_mode"], "static")
        self.assertTrue(body["ice"]["turn_configured"])
        turn_entries = [entry for entry in body["ice_servers"] if entry["urls"][0].startswith("turn:")]
        self.assertEqual(len(turn_entries), 1)
        self.assertEqual(turn_entries[0]["urls"], [
            "turn:global.relay.metered.ca:80",
            "turn:global.relay.metered.ca:80?transport=tcp",
        ])
        self.assertEqual(turn_entries[0]["username"], "metered-user")
        self.assertEqual(turn_entries[0]["credential"], "metered-pass")

    def test_75_health_hides_turn_vapid_and_jwt_secrets(self):
        env = {
            "SIH_GUNICORN_WORKERS": "2",
            "SIH_REDIS_URL": "",
            "SIH_TURN_URLS": '["turn:relay.example.com:3478?transport=tcp"]',
            "SIH_TURN_USERNAME": "turn-user-secret",
            "SIH_TURN_CREDENTIAL": "turn-pass-secret",
            "VAPID_PUBLIC_KEY": "vapid-public-test",
            "VAPID_PRIVATE_KEY": "vapid-private-secret",
            "VAPID_CLAIM_EMAIL": "mailto:test@example.com",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200, resp.get_json())
        body = resp.get_json()
        web_calling = body["web_calling"]
        self.assertEqual(web_calling["signaling"], "flask-socketio")
        self.assertFalse(web_calling["worker_configuration_safe"])
        self.assertTrue(web_calling["push_configured"])
        self.assertTrue(web_calling["turn_configured"])
        self.assertEqual(web_calling["turn_mode"], "static")
        payload = json.dumps(body)
        self.assertNotIn("turn-user-secret", payload)
        self.assertNotIn("turn-pass-secret", payload)
        self.assertNotIn("vapid-private-secret", payload)
        self.assertNotIn(os.environ["SIH_SECRET_KEY"], payload)

    def test_76_vapid_public_key_reports_configured_and_unconfigured_states(self):
        with mock.patch.dict(os.environ, {
            "VAPID_PUBLIC_KEY": "",
            "VAPID_PRIVATE_KEY": "",
            "VAPID_CLAIM_EMAIL": "",
        }, clear=False):
            resp = self.client.get("/api/push/vapid-key", headers=_auth(self.owner_token))
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.get_json(), {"publicKey": None, "configured": False})

        with mock.patch.dict(os.environ, {
            "VAPID_PUBLIC_KEY": "test-public",
            "VAPID_PRIVATE_KEY": "test-private",
            "VAPID_CLAIM_EMAIL": "mailto:test@example.com",
        }, clear=False):
            resp = self.client.get("/api/push/vapid-key", headers=_auth(self.owner_token))
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.get_json(), {"publicKey": "test-public", "configured": True})

    def test_77_owner_availability_precheck_reports_routability_and_helpline(self):
        self.make_vet_available(self.vet, languages=["en", "mr"])
        with self.client as client:
            resp = client.get("/api/webcall/availability?language=te&reason=animal_sick", headers=_auth(self.owner_token))
        self.assertEqual(resp.status_code, 200, resp.get_json())
        body = resp.get_json()
        self.assertFalse(body["routable"])
        self.assertEqual(body["requested_language"], "te")
        self.assertIn("No veterinarian", body["message"])
        self.assertIn("LANGUAGE_NOT_SUPPORTED", body["skipped_codes"])
        self.assertEqual(body["helpline"]["number"], "7382210251")
        self.assertTrue(any(alt["code"] == "en" for alt in body["alternatives"]))

        resp = self.client.get("/api/webcall/availability?language=en&reason=animal_sick", headers=_auth(self.owner_token))
        self.assertEqual(resp.status_code, 200, resp.get_json())
        body = resp.get_json()
        self.assertTrue(body["routable"])
        self.assertEqual(body["selected_vet"]["vet_id"], self.vet["id"])

    def test_78_turn_diagnostics_explain_missing_or_partial_config(self):
        """The health/config payload must say *why* TURN is inactive.

        Regression guard for the deployed ``turn_mode: none`` that used to be
        indistinguishable from "this code has no TURN support": ``describe()``
        keeps the same ``turn_configured`` / ``turn_mode`` / ``turn_url_count``
        contract but now also names the variable that is missing or empty and
        the machine-readable ``turn_config_issue`` — without ever returning a
        credential value.
        """
        turn_keys = ("SIH_TURN_URLS", "SIH_TURN_USERNAME", "SIH_TURN_CREDENTIAL", "SIH_TURN_SECRET")
        saved = {key: os.environ[key] for key in turn_keys if key in os.environ}

        def without_turn_env():
            for key in turn_keys:
                os.environ.pop(key, None)

        try:
            # 1. Absent variables — the state of a deployment whose dashboard
            #    variables were never added to *this* service.
            without_turn_env()
            config = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()
            ice = config["ice"]
            self.assertFalse(ice["turn_configured"])
            self.assertEqual(ice["turn_mode"], "none")
            self.assertEqual(ice["turn_url_count"], 0)
            self.assertEqual(ice["turn_urls_ignored"], 0)
            self.assertEqual(ice["turn_config_issue"], "turn_urls_missing")
            self.assertEqual(ice["turn_env"], {key: "missing" for key in turn_keys})
            self.assertIsNone(ice["credential_ttl_seconds"])
            # STUN-only ICE servers: the browser still gets STUN, no TURN.
            self.assertEqual([entry for entry in config["ice_servers"] if "turn:" in entry["urls"][0]], [])
            # /api/health and /api/webcall/config read the same configuration.
            health = self.client.get("/api/health").get_json()["web_calling"]
            self.assertEqual(health["ice"], ice)
            self.assertEqual(health["turn_configured"], ice["turn_configured"])

            # 2. A variable that exists but is empty (blueprint `sync: false`
            #    key that was never filled in) is distinguishable from missing.
            without_turn_env()
            os.environ["SIH_TURN_URLS"] = ""
            ice = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()["ice"]
            self.assertEqual(ice["turn_env"]["SIH_TURN_URLS"], "empty")
            self.assertEqual(ice["turn_config_issue"], "turn_urls_missing")
            self.assertEqual(ice["turn_url_count"], 0)

            # 3. URLs but incomplete credentials: the URL gate is open, the
            #    credential gate is not.
            without_turn_env()
            os.environ["SIH_TURN_URLS"] = "turn:relay.example.org:3478"
            os.environ["SIH_TURN_USERNAME"] = "provider-user"
            ice = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()["ice"]
            self.assertEqual(ice["turn_mode"], "none")
            self.assertEqual(ice["turn_url_count"], 1)
            self.assertEqual(ice["turn_config_issue"], "turn_credentials_missing")

            # 4. Static provider mode with a quoted value (as pasted from a
            #    dashboard) works, and the quotes never reach the ICE list.
            without_turn_env()
            os.environ["SIH_TURN_URLS"] = '"turn:relay.example.org:3478"'
            os.environ["SIH_TURN_USERNAME"] = "provider-user"
            os.environ["SIH_TURN_CREDENTIAL"] = "provider-credential"
            config = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()
            self.assertTrue(config["ice"]["turn_configured"])
            self.assertEqual(config["ice"]["turn_mode"], "static")
            self.assertEqual(config["ice"]["turn_url_count"], 1)
            self.assertIsNone(config["ice"]["turn_config_issue"])
            turn_entries = [e for e in config["ice_servers"] if e["urls"][0].lower().startswith("turn:")]
            self.assertEqual(turn_entries[0]["urls"], ["turn:relay.example.org:3478"])

            # 5. A non-TURN scheme cannot fake `turn_configured: true`.
            without_turn_env()
            os.environ["SIH_TURN_URLS"] = "stun:stun.l.google.com:19302"
            os.environ["SIH_TURN_USERNAME"] = "provider-user"
            os.environ["SIH_TURN_CREDENTIAL"] = "provider-credential"
            ice = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()["ice"]
            self.assertFalse(ice["turn_configured"])
            self.assertEqual(ice["turn_url_count"], 0)
            self.assertEqual(ice["turn_urls_ignored"], 1)
            self.assertEqual(ice["turn_config_issue"], "turn_urls_unusable")

            # 6. The diagnostics never leak the credential values.
            payload = json.dumps(ice)
            self.assertNotIn("provider-user", payload)
            self.assertNotIn("provider-credential", payload)
        finally:
            without_turn_env()
            os.environ.update(saved)


class TestStaticTurnConfiguration(WebCallingTestBase):
    """Static (managed-provider) TURN — the Metered deployment configuration.

    The production backend runs Metered static credentials, i.e.
    ``SIH_TURN_URLS`` + ``SIH_TURN_USERNAME`` + ``SIH_TURN_CREDENTIAL`` with
    ``SIH_TURN_SECRET`` **absent**. These tests pin that contract so a later
    change cannot quietly require a coturn secret, drop a URL, or leak a
    credential through a public endpoint.
    """

    # The four endpoints Metered publishes for a project. Hostnames are public
    # (they are in every browser's ICE list); only the username/credential are
    # secret, and the values below are obviously fake placeholders.
    METERED_URLS = [
        "turn:global.relay.metered.ca:80",
        "turn:global.relay.metered.ca:80?transport=tcp",
        "turn:global.relay.metered.ca:443",
        "turns:global.relay.metered.ca:443?transport=tcp",
    ]
    METERED_JSON = json.dumps(METERED_URLS)
    TURN_KEYS = ("SIH_TURN_URLS", "SIH_TURN_USERNAME", "SIH_TURN_CREDENTIAL", "SIH_TURN_SECRET")

    def setUp(self):
        super().setUp()
        self._saved = {key: os.environ[key] for key in self.TURN_KEYS if key in os.environ}

    def tearDown(self):
        for key in self.TURN_KEYS:
            os.environ.pop(key, None)
        os.environ.update(self._saved)
        super().tearDown()

    def set_static_env(self, urls=None, username="provider-user", credential="provider-credential",
                       secret="__absent__"):
        """Configure static mode; ``secret="__absent__"`` leaves the var unset."""
        for key in self.TURN_KEYS:
            os.environ.pop(key, None)
        os.environ["SIH_TURN_URLS"] = self.METERED_JSON if urls is None else urls
        if username is not None:
            os.environ["SIH_TURN_USERNAME"] = username
        if credential is not None:
            os.environ["SIH_TURN_CREDENTIAL"] = credential
        if secret is not None and secret != "__absent__":
            os.environ["SIH_TURN_SECRET"] = secret

    # 1 ---------------------------------------------------------------------
    def test_79_missing_turn_urls_means_turn_is_not_configured(self):
        for key in self.TURN_KEYS:
            os.environ.pop(key, None)
        self.assertFalse(turn_config.turn_urls())
        self.assertEqual(turn_config.turn_mode(), "none")
        self.assertEqual(turn_config.turn_config_issue(), "turn_urls_missing")

        ice = self.client.get("/api/health").get_json()["web_calling"]
        self.assertFalse(ice["turn_configured"])
        self.assertEqual(ice["turn_mode"], "none")
        self.assertEqual(ice["turn_url_count"], 0)
        self.assertEqual(ice["turn_config_issue"], "turn_urls_missing")
        # ...even when the credentials are perfectly configured.
        self.set_static_env(urls="")
        self.assertFalse(turn_config.describe()["turn_configured"])
        self.assertEqual(turn_config.turn_config_issue(), "turn_urls_missing")

    # 2, 3, 4 ---------------------------------------------------------------
    def test_80_metered_static_configuration_reports_static_with_four_urls(self):
        self.set_static_env()
        summary = turn_config.describe()
        self.assertTrue(summary["turn_configured"])
        self.assertEqual(summary["turn_mode"], "static")
        self.assertEqual(summary["turn_url_count"], 4)
        self.assertEqual(summary["turn_urls_ignored"], 0)
        self.assertIsNone(summary["turn_config_issue"])
        self.assertFalse(summary["ephemeral_credentials"])
        self.assertIsNone(summary["credential_ttl_seconds"])
        self.assertTrue(summary["stun_configured"])
        self.assertEqual(summary["ice_transport_policy"], "all")

        web_calling = self.client.get("/api/health").get_json()["web_calling"]
        self.assertTrue(web_calling["turn_configured"])
        self.assertEqual(web_calling["turn_mode"], "static")
        self.assertEqual(web_calling["turn_url_count"], 4)
        self.assertIsNone(web_calling["turn_config_issue"])
        self.assertEqual(web_calling["ice"], summary)

        # The exact URLs reach the browser, in order, with the query strings intact.
        config = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()
        turn_entry = [e for e in config["ice_servers"] if e["urls"][0].startswith("turn")][0]
        self.assertEqual(turn_entry["urls"], self.METERED_URLS)
        self.assertEqual(turn_entry["username"], "provider-user")
        self.assertEqual(turn_entry["credential"], "provider-credential")

    # 5 ---------------------------------------------------------------------
    def test_81_comma_and_newline_separated_turn_urls_are_accepted(self):
        joined = ",".join(self.METERED_URLS)
        self.set_static_env(urls=joined)
        self.assertEqual(turn_config.turn_urls(), tuple(self.METERED_URLS))
        self.assertEqual(turn_config.describe()["turn_url_count"], 4)

        self.set_static_env(urls="\n".join(self.METERED_URLS))
        self.assertEqual(turn_config.describe()["turn_url_count"], 4)

        # Spaces around the delimiters, and one layer of surrounding quotes.
        self.set_static_env(urls=" " + " , ".join(self.METERED_URLS) + " ")
        self.assertEqual(turn_config.describe()["turn_url_count"], 4)
        self.set_static_env(urls='"' + self.METERED_URLS[0] + '"')
        self.assertEqual(turn_config.turn_urls(), (self.METERED_URLS[0],))

    # 6 ---------------------------------------------------------------------
    def test_82_invalid_entries_are_ignored_and_counted(self):
        self.set_static_env(urls="\n".join([
            self.METERED_URLS[0],
            "stun:stun.l.google.com:19302",     # STUN, not TURN
            "https://global.relay.metered.ca",  # no TURN scheme
            "<paste-your-turn-url-here>",       # placeholder left in place
            "",                                 # blank line: dropped, not counted
        ]))
        summary = turn_config.describe()
        self.assertEqual(summary["turn_url_count"], 1)
        # 3 wrong-scheme entries; the blank line never becomes a candidate.
        self.assertEqual(summary["turn_urls_ignored"], 3)
        self.assertEqual(turn_config.turn_urls(), (self.METERED_URLS[0],))
        self.assertTrue(summary["turn_configured"])

        # Every entry invalid => honest "not configured", never a false positive.
        self.set_static_env(urls="stun:stun.l.google.com:19302,https://relay.example.org")
        summary = turn_config.describe()
        self.assertFalse(summary["turn_configured"])
        self.assertEqual(summary["turn_mode"], "none")
        self.assertEqual(summary["turn_url_count"], 0)
        self.assertEqual(summary["turn_urls_ignored"], 2)
        self.assertEqual(summary["turn_config_issue"], "turn_urls_unusable")

    # 7 ---------------------------------------------------------------------
    def test_83_static_mode_never_requires_a_coturn_secret(self):
        # (a) SIH_TURN_SECRET absent — the Metered production setup.
        self.set_static_env(secret="__absent__")
        self.assertNotIn("SIH_TURN_SECRET", os.environ)
        self.assertEqual(turn_config.turn_mode(), "static")
        self.assertTrue(turn_config.describe()["turn_configured"])

        # (b) SIH_TURN_SECRET present but EMPTY — what a `sync: false`
        #     render.yaml key looks like before anyone pastes a value. It must
        #     not be mistaken for coturn mode and must not block static mode.
        self.set_static_env(secret="")
        self.assertEqual(turn_config.env_state("SIH_TURN_SECRET"), "empty")
        self.assertEqual(turn_config.turn_mode(), "static")
        self.assertEqual(turn_config.describe()["turn_url_count"], 4)

        # (c) ...and a whitespace-only secret is still "not set".
        self.set_static_env(secret="   ")
        self.assertEqual(turn_config.turn_mode(), "static")

        # (d) A real secret switches to ephemeral mode (documented precedence),
        #     so an operator who leaves both set gets coturn credentials, not a
        #     silent mixture. Asserted so the behaviour is explicit.
        self.set_static_env(secret="coturn-static-auth-secret")
        self.assertEqual(turn_config.turn_mode(), "ephemeral")
        self.assertTrue(turn_config.describe()["ephemeral_credentials"])
        config = self.client.get("/api/webcall/config", headers=_auth(self.owner_token)).get_json()
        turn_entry = [e for e in config["ice_servers"] if e["urls"][0].startswith("turn")][0]
        self.assertNotEqual(turn_entry["credential"], "provider-credential")
        self.assertRegex(turn_entry["username"], r"^\d+:\d+$")

    # 8 ---------------------------------------------------------------------
    def test_84_public_endpoints_never_expose_turn_credentials(self):
        self.set_static_env(username="super-secret-username", credential="super-secret-credential")
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        payload = health.get_data(as_text=True)
        self.assertNotIn("super-secret-username", payload)
        self.assertNotIn("super-secret-credential", payload)
        self.assertNotIn("coturn-static-auth-secret", payload)
        # Diagnostics are names + states only.
        ice = health.get_json()["web_calling"]["ice"]
        self.assertEqual(ice["turn_env"], {
            "SIH_TURN_URLS": "set", "SIH_TURN_USERNAME": "set",
            "SIH_TURN_CREDENTIAL": "set", "SIH_TURN_SECRET": "missing",
        })
        self.assertNotIn("username", ice)
        self.assertNotIn("credential", ice)
        self.assertNotIn("ice_servers", health.get_json()["web_calling"])

        # The ICE endpoint itself is not public.
        anon = self.client.get("/api/webcall/config")
        self.assertEqual(anon.status_code, 401)
        self.assertNotIn("super-secret-credential", anon.get_data(as_text=True))

    # 9 ---------------------------------------------------------------------
    def test_85_ice_credentials_reach_authenticated_browsers_only(self):
        self.set_static_env()

        for label, headers in (
            ("no header", {}),
            ("garbage token", {"Authorization": "Bearer not-a-jwt"}),
            ("malformed header", {"Authorization": "Basic abc"}),
        ):
            resp = self.client.get("/api/webcall/config", headers=headers)
            self.assertEqual(resp.status_code, 401, label)
            self.assertNotIn("provider-credential", resp.get_data(as_text=True))

        # A farmer and a vet — the two peers of a real call — both receive it.
        for token in (self.owner_token, self.vet_token):
            resp = self.client.get("/api/webcall/config", headers=_auth(token))
            self.assertEqual(resp.status_code, 200)
            turn_entry = [e for e in resp.get_json()["ice_servers"]
                          if e["urls"][0].lower().startswith("turn")][0]
            self.assertEqual(turn_entry["credential"], "provider-credential")
            self.assertEqual(resp.get_json()["ice_transport_policy"], "all")

    def test_86_a_near_json_paste_from_a_dashboard_still_yields_four_urls(self):
        """Operator tolerance: an *almost*-JSON array must not degrade to 0 URLs.

        A trailing comma or single quotes make ``json.loads`` fail; the
        delimiter fallback then still has to recover the URLs rather than report
        ``turn_url_count: 0`` and leave the deployment silently STUN-only.
        """
        for label, raw in (
            ("trailing comma", '["turn:global.relay.metered.ca:80","turn:global.relay.metered.ca:443",]'),
            ("single quotes", "['turn:global.relay.metered.ca:80','turn:global.relay.metered.ca:443']"),
            ("outer quotes kept", '"["turn:global.relay.metered.ca:80", "turn:global.relay.metered.ca:443"]"'),
        ):
            with self.subTest(shape=label):
                self.set_static_env(urls=raw)
                self.assertEqual(turn_config.turn_urls(),
                                 ("turn:global.relay.metered.ca:80", "turn:global.relay.metered.ca:443"))
                self.assertEqual(turn_config.describe()["turn_url_count"], 2)

        # A genuine non-array value is untouched by the trimming.
        self.set_static_env(urls="turn:global.relay.metered.ca:443?transport=tcp")
        self.assertEqual(turn_config.turn_urls(), ("turn:global.relay.metered.ca:443?transport=tcp",))


if __name__ == "__main__":
    unittest.main(verbosity=2)
