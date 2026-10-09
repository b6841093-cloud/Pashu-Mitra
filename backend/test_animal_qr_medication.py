"""Animal QR lookup, medication history, timestamps and authorization tests."""
from __future__ import annotations

import io
import os
import time
import unittest
from unittest import mock

from PIL import Image

from app import app, make_token
import database
import compliance_security


def _png_bytes(size=8, color=(255, 0, 0)):
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (0, 128, 0)).save(buf, format="JPEG")
    return buf.getvalue()


class TestAnimalQrMedicationHistory(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()
        cls.client = app.test_client()
        conn = database.get_db()
        cls.owner = dict(conn.execute("SELECT * FROM users WHERE email='rajesh@example.com'").fetchone())
        cls.owner2 = dict(conn.execute("SELECT * FROM users WHERE email='sunita@example.com'").fetchone())
        cls.vet = dict(conn.execute("SELECT * FROM users WHERE role='vet' LIMIT 1").fetchone())
        animal = conn.execute(
            "SELECT * FROM animals WHERE owner_id=? ORDER BY id LIMIT 1", (cls.owner["id"],)
        ).fetchone()
        cls.animal = dict(animal)
        other = conn.execute(
            "SELECT * FROM animals WHERE owner_id=? ORDER BY id LIMIT 1", (cls.owner2["id"],)
        ).fetchone()
        cls.other_animal = dict(other) if other else None
        conn.close()
        cls.owner_token = make_token(cls.owner)
        cls.owner2_token = make_token(cls.owner2)
        cls.vet_token = make_token(cls.vet)

    def auth(self, token, json_ct=True):
        headers = {"Authorization": f"Bearer {token}"}
        if json_ct:
            headers["Content-Type"] = "application/json"
        return headers

    # ----- QR -----
    def test_qr_valid_lookup(self):
        resp = self.client.get(
            f"/api/animals/{self.animal['id']}/qr", headers=self.auth(self.owner_token)
        )
        self.assertEqual(resp.status_code, 200)
        qr = resp.get_json()
        self.assertTrue(qr["qr_payload"].startswith("PASHU:ANIMAL:"))
        self.assertNotIn("@", qr["qr_payload"])
        self.assertNotIn("password", qr["qr_payload"].lower())
        self.assertTrue(qr["qr_image"].startswith("data:image/png;base64,"))
        lookup = self.client.get(
            f"/api/animals/lookup-qr?payload={qr['qr_payload']}",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.get_json()["id"], self.animal["id"])

    def test_qr_invalid_empty_and_sample(self):
        empty = self.client.get("/api/animals/lookup-qr?payload=", headers=self.auth(self.owner_token))
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(empty.get_json().get("code"), "INVALID_QR")
        sample = self.client.get(
            "/api/animals/lookup-qr?payload=PASHU:SAMPLE:abc",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(sample.status_code, 400)
        self.assertEqual(sample.get_json().get("code"), "INVALID_QR")
        jwtish = self.client.get(
            "/api/animals/lookup-qr?payload=aaa.bbb.ccc" + ("x" * 40),
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(jwtish.status_code, 400)
        self.assertEqual(jwtish.get_json().get("code"), "INVALID_QR")

    def test_qr_unknown_animal(self):
        resp = self.client.get(
            "/api/animals/lookup-qr?code=MH-XXX-999999",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json().get("code"), "ANIMAL_NOT_FOUND")

    def test_qr_unauthorized_farmer(self):
        resp = self.client.get(
            f"/api/animals/lookup-qr?code={self.animal['animal_code']}",
            headers=self.auth(self.owner2_token),
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.get_json().get("code"), "UNAUTHORIZED")

    def test_qr_manual_animal_id_fallback(self):
        resp = self.client.get(
            f"/api/animals/lookup-qr?code={self.animal['animal_code']}",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["animal_code"], self.animal["animal_code"])
        by_id = self.client.get(
            f"/api/animals/lookup-qr?animal_id={self.animal['id']}",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(by_id.status_code, 200)
        self.assertEqual(by_id.get_json()["id"], self.animal["id"])

    def test_qr_post_lookup(self):
        resp = self.client.post(
            "/api/animals/lookup-qr",
            json={"payload": self.animal["animal_code"]},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["id"], self.animal["id"])

    # ----- medication history -----
    def test_create_medication_record(self):
        resp = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            json={
                "medication_name": "Oxytetracycline",
                "dosage": "10 ml",
                "frequency": "Once daily",
                "administered_at": "2026-10-08 18:15:00",
                "notes": "Farmer-administered dose",
                "reason": "Fever",
            },
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()
        self.assertEqual(data["medication_name"], "Oxytetracycline")
        self.assertEqual(data["source"], "farmer")
        self.assertFalse(data["is_veterinarian_record"])
        self.assertTrue(data["created_at"])
        self.assertEqual(data["administered_at"], "2026-10-08 18:15:00")
        self.assertNotEqual(data["administered_at"], data["created_at"])
        self.assertIn("photos", data)
        self._created_med_id = data["id"]

    def test_upload_valid_photograph(self):
        create = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            data={
                "medication_name": "Meloxicam pack",
                "administered_at": "2026-10-09 10:30:00",
                "photos": (io.BytesIO(_png_bytes()), "packaging.png"),
            },
            headers=self.auth(self.owner_token, json_ct=False),
        )
        self.assertEqual(create.status_code, 201, create.get_data(as_text=True)[:400])
        med = create.get_json()
        self.assertGreaterEqual(len(med["photos"]), 1)
        photo = med["photos"][0]
        img = self.client.get(photo["url"], headers=self.auth(self.owner_token, json_ct=False))
        self.assertEqual(img.status_code, 200)
        self.assertTrue(img.data.startswith(b"\x89PNG"))
        self.assertEqual(img.headers.get("X-Content-Type-Options"), "nosniff")

    def test_reject_invalid_file(self):
        resp = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            data={
                "medication_name": "Bad file",
                "photos": (io.BytesIO(b"MZ\x90\x00this-is-not-an-image"), "payload.exe"),
            },
            headers=self.auth(self.owner_token, json_ct=False),
        )
        self.assertIn(resp.status_code, (400, 415))
        self.assertEqual(resp.get_json().get("code"), "UPLOAD_REJECTED")

    def test_reject_oversized_file(self):
        with mock.patch.object(compliance_security, "UPLOAD_MAX_BYTES", 200):
            resp = self.client.post(
                f"/api/animals/{self.animal['id']}/medications",
                data={
                    "medication_name": "Huge file",
                    "photos": (io.BytesIO(_png_bytes() + b"\x00" * 400), "big.png"),
                },
                headers=self.auth(self.owner_token, json_ct=False),
            )
        self.assertEqual(resp.status_code, 413)
        self.assertEqual(resp.get_json().get("code"), "UPLOAD_REJECTED")

    def test_chronological_history(self):
        aid = self.animal["id"]
        self.client.post(
            f"/api/animals/{aid}/medications",
            json={"medication_name": "Older dose", "administered_at": "2026-10-01 08:00:00"},
            headers=self.auth(self.owner_token),
        )
        time.sleep(0.05)
        self.client.post(
            f"/api/animals/{aid}/medications",
            json={"medication_name": "Newer dose", "administered_at": "2026-10-09 20:00:00"},
            headers=self.auth(self.owner_token),
        )
        listing = self.client.get(f"/api/animals/{aid}/medications", headers=self.auth(self.owner_token))
        self.assertEqual(listing.status_code, 200)
        names = [m["medication_name"] for m in listing.get_json()]
        self.assertLess(names.index("Newer dose"), names.index("Older dose"))

    def test_edit_permitted_farmer_record(self):
        created = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            json={"medication_name": "Editable", "notes": "v1", "administered_at": "2026-10-07 09:00:00"},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(created.status_code, 201)
        med_id = created.get_json()["id"]
        created_at = created.get_json()["created_at"]
        time.sleep(1.05)
        updated = self.client.put(
            f"/api/animals/{self.animal['id']}/medications/{med_id}",
            json={"medication_name": "Editable", "notes": "v2"},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(updated.status_code, 200)
        body = updated.get_json()
        self.assertEqual(body["notes"], "v2")
        self.assertTrue(body["updated_at"])
        self.assertNotEqual(body["updated_at"], created_at)

    def test_prevent_cross_farmer_access(self):
        listing = self.client.get(
            f"/api/animals/{self.animal['id']}/medications",
            headers=self.auth(self.owner2_token),
        )
        self.assertEqual(listing.status_code, 403)
        photo = self.client.get(
            f"/api/animals/{self.animal['id']}/medications/1/photos/1",
            headers=self.auth(self.owner2_token, json_ct=False),
        )
        self.assertEqual(photo.status_code, 403)

    def test_preserve_veterinarian_authored_records(self):
        created = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            json={"medication_name": "Clinical antibiotic", "administered_at": "2026-10-06 11:00:00"},
            headers=self.auth(self.vet_token),
        )
        self.assertEqual(created.status_code, 201)
        med = created.get_json()
        self.assertEqual(med["source"], "vet")
        self.assertTrue(med["is_veterinarian_record"])
        blocked = self.client.put(
            f"/api/animals/{self.animal['id']}/medications/{med['id']}",
            json={"notes": "farmer overwrite"},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.get_json().get("code"), "VET_RECORD_LOCKED")

    def test_new_records_receive_server_timestamps(self):
        before = time.strftime("%Y-%m-%d")
        resp = self.client.post(
            f"/api/animals/{self.animal['id']}/medications",
            json={"medication_name": "Stamp check"},
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.get_json()
        self.assertTrue(data["created_at"])
        self.assertTrue(data["recorded_at"])
        self.assertTrue(data["administered_at"])
        self.assertTrue(data["created_at"].startswith(before) or data["created_at"][:10] >= before)
        animal = self.client.get(f"/api/animals/{self.animal['id']}", headers=self.auth(self.owner_token))
        self.assertEqual(animal.status_code, 200)
        self.assertTrue(animal.get_json().get("created_at"))

    def test_legacy_records_without_event_time_render_safely(self):
        listing = self.client.get(
            f"/api/animals/{self.animal['id']}/medications",
            headers=self.auth(self.owner_token),
        )
        self.assertEqual(listing.status_code, 200)
        for row in listing.get_json():
            self.assertIn("created_at", row)
            # Missing historical event times stay null/derived — never invented past dates.
            if not row.get("administered_at") and not row.get("start_date"):
                self.assertIsNone(row.get("event_at"))

    def test_unauthenticated_qr_and_medications_rejected(self):
        self.assertEqual(self.client.get("/api/animals/lookup-qr?code=MH-PUN-000001").status_code, 401)
        self.assertEqual(
            self.client.post(f"/api/animals/{self.animal['id']}/medications", json={"medication_name": "X"}).status_code,
            401,
        )


if __name__ == "__main__":
    unittest.main()
