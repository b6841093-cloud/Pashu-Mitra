"""Flask ML configuration/error regressions and opt-in real HTTP integration tests.

Run against a live ML server with SIH_TEST_ML_URL set to its base URL. Always
set SIH_DB_PATH to a disposable database when running this or existing tests.
"""
import os
import unittest
from unittest.mock import Mock, patch

import requests

import app as backend
import database


class MLConfigurationTests(unittest.TestCase):
    def test_local_default_is_development_only(self):
        with patch.dict(os.environ, {"SIH_ML_BACKEND": "", "FLASK_ENV": "development", "RENDER": "false"}):
            self.assertEqual(backend.resolve_ml_backend(), "http://127.0.0.1:8000")

    def test_missing_production_url_is_not_localhost(self):
        for production_env in [{"FLASK_ENV": "production", "RENDER": "false"},
                               {"FLASK_ENV": "", "RENDER": "true"}]:
            with self.subTest(env=production_env), patch.dict(os.environ, {"SIH_ML_BACKEND": "", **production_env}), \
                    self.assertLogs(backend.app.logger, level="ERROR"):
                self.assertIsNone(backend.resolve_ml_backend())

    def test_loopback_and_unspecified_production_urls_are_rejected(self):
        for url in ["http://localhost:8000", "http://127.0.0.1:8000", "http://[::1]:8000", "http://0.0.0.0:8000"]:
            with self.subTest(url=url), patch.dict(os.environ, {"FLASK_ENV": "production", "SIH_ML_BACKEND": url}), \
                    self.assertLogs(backend.app.logger, level="ERROR"):
                self.assertIsNone(backend.resolve_ml_backend())

    def test_deployed_base_url_is_normalized(self):
        with patch.dict(os.environ, {"SIH_ML_BACKEND": " https://ml.example.invalid/ ", "FLASK_ENV": "production"}):
            self.assertEqual(backend.resolve_ml_backend(), "https://ml.example.invalid")

    def test_invalid_base_urls_are_rejected(self):
        for url in ["ml.example.invalid", "https://ml.example.invalid/api", "ftp://ml.example.invalid",
                    "https://ml.example.invalid?key=value", "http://user:password@ml.example.invalid",
                    "http://ml.example.invalid:bad-port"]:
            with self.subTest(url=url), patch.dict(os.environ, {"SIH_ML_BACKEND": url}), \
                    self.assertLogs(backend.app.logger, level="ERROR"):
                self.assertIsNone(backend.resolve_ml_backend())


class MLFailureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = backend.app.test_client()
        conn = database.get_db()
        user = dict(conn.execute("SELECT * FROM users WHERE role='govt' LIMIT 1").fetchone())
        conn.close()
        cls.headers = {"Authorization": f"Bearer {backend.make_token(user)}"}

    def test_unconfigured_ml_returns_503_without_attempting_localhost(self):
        with patch.object(backend, "ML_BACKEND", None), patch.object(backend.requests, "post") as post:
            result, status = backend._ml_post("/api/predict", {})
        self.assertEqual(status, 503)
        self.assertIn("SIH_ML_BACKEND", result["error"])
        post.assert_not_called()

    def test_transport_failure_is_503_not_a_fake_prediction(self):
        with patch.object(backend, "ML_BACKEND", "https://ml.example.invalid"), \
                patch.object(backend.requests, "post", side_effect=requests.ConnectionError("Unreachable")), \
                self.assertLogs(backend.app.logger, level="WARNING"):
            result, status = backend._ml_post("/api/predict", {})
        self.assertEqual(status, 503)
        self.assertNotIn("probability", result)

    def test_non_json_response_is_502_not_a_server_crash(self):
        response = Mock()
        response.json.side_effect = ValueError("HTML instead of JSON")
        with patch.object(backend, "ML_BACKEND", "https://ml.example.invalid"), \
                patch.object(backend.requests, "post", return_value=response), \
                self.assertLogs(backend.app.logger, level="WARNING"):
            result, status = backend._ml_post("/api/predict", {})
        self.assertEqual(status, 502)
        self.assertIn("invalid JSON", result["error"])

    def test_service_error_status_is_preserved(self):
        response = Mock(status_code=503)
        response.json.return_value = {"detail": "AI model unavailable"}
        with patch.object(backend, "ML_BACKEND", "https://ml.example.invalid"), \
                patch.object(backend.requests, "post", return_value=response):
            result, status = backend._ml_post("/api/predict", {})
        self.assertEqual(status, 503)
        self.assertEqual(result, {"detail": "AI model unavailable"})

    def test_status_does_not_claim_online_for_a_503_metrics_response(self):
        readiness = Mock()
        readiness.json.return_value = {"models_ready": True}
        response = Mock()
        response.raise_for_status.side_effect = requests.HTTPError("503 Model metrics unavailable")
        with patch.object(backend, "ML_BACKEND", "https://ml.example.invalid"), \
                patch.object(backend.requests, "get", side_effect=[readiness, response]), \
                self.assertLogs(backend.app.logger, level="WARNING"):
            status = self.client.get("/api/govt/ai/status", headers=self.headers)
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.get_json()["online"])

    def test_status_checks_model_readiness_not_just_metrics_availability(self):
        readiness = Mock()
        readiness.json.return_value = {"models_ready": False}
        with patch.object(backend, "ML_BACKEND", "https://ml.example.invalid"), \
                patch.object(backend.requests, "get", return_value=readiness) as get, \
                self.assertLogs(backend.app.logger, level="WARNING"):
            status = self.client.get("/api/govt/ai/status", headers=self.headers)
        self.assertEqual(status.get_json(), {"online": False})
        get.assert_called_once_with("https://ml.example.invalid/api/health", timeout=5)

    def test_status_is_offline_when_not_configured(self):
        with patch.object(backend, "ML_BACKEND", None):
            response = self.client.get("/api/govt/ai/status", headers=self.headers)
        self.assertEqual(response.get_json(), {"online": False})


@unittest.skipUnless(os.environ.get("SIH_TEST_ML_URL"), "Set SIH_TEST_ML_URL to run real ML HTTP integration")
class RealMLConnectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = backend.app.test_client()
        conn = database.get_db()
        user = dict(conn.execute("SELECT * FROM users WHERE role='govt' LIMIT 1").fetchone())
        conn.close()
        cls.headers = {"Authorization": f"Bearer {backend.make_token(user)}"}
        cls.url = os.environ["SIH_TEST_ML_URL"].rstrip("/")

    def test_real_flask_prediction_forwarding(self):
        with patch.object(backend, "ML_BACKEND", self.url):
            response = self.client.get("/api/govt/ai/predict?district=Pune&disease=FMD", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()
        self.assertIn("probability", result)
        self.assertIn("features_used", result)
        self.assertEqual(result["model_version"], "v1.0")
        # Verify the forwarded result equals a direct, real ML HTTP inference
        # with the exact database/weather-derived features used by Flask.
        payload = {**result["features_used"], "district": "Pune", "disease": "FMD", "time_range": "14"}
        direct = requests.post(self.url + "/api/predict", json=payload, timeout=15)
        self.assertEqual(direct.status_code, 200, direct.text)
        self.assertEqual({key: value for key, value in result.items() if key != "features_used"}, direct.json())

    def test_real_flask_outbreak_forwarding(self):
        with patch.object(backend, "ML_BACKEND", self.url):
            response = self.client.get("/api/govt/ai/outbreak?district=Pune", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertIsInstance(response.get_json()["outbreak_detected"], bool)

    def test_real_flask_metrics_forwarding(self):
        with patch.object(backend, "ML_BACKEND", self.url):
            response = self.client.get("/api/govt/ai/status", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["online"])
        self.assertEqual(response.get_json()["model"], "Random Forest")

    def test_real_flask_clustering_forwarding(self):
        with patch.object(backend, "ML_BACKEND", self.url):
            response = self.client.get("/api/govt/clusters", headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        clusters = response.get_json()["clusters"]
        self.assertGreater(len(clusters), 0)
        self.assertTrue(all(cluster["method"] == "DBSCAN (haversine)" for cluster in clusters))


if __name__ == "__main__":
    unittest.main()
