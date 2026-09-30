"""ML API regression tests using the checked-in trained artifacts, never fake inference."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib
import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

import main


PREDICT_INPUT = {
    "disease": "FMD",
    "district": "Pune",
    "time_range": "14",
    "animal_population": 10000,
    "affected_animals": 120,
    "new_cases": 35,
    "deaths": 2,
    "vaccination_coverage": 0.65,
    "temperature": 30,
    "rainfall": 12,
    "humidity": 70,
    "animal_density": 150,
    "previous_cases": 20,
    "cases_growth_rate": 0.75,
}
OUTBREAK_INPUT = {"district": "Pune", "new_cases": 1000, "cases_growth_rate": 5, "deaths": 100}
CLUSTER_INPUT = {
    "cases": [
        {"case_no": "TEST-1", "lat": 18.52, "lng": 73.85, "district": "Pune", "disease": "FMD"},
        {"case_no": "TEST-2", "lat": 18.53, "lng": 73.86, "district": "Pune", "disease": "FMD"},
    ],
    "eps_km": 45,
    "min_samples": 2,
}


class MLAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app, raise_server_exceptions=False)
        # Independently deserialize the original files to compare actual model
        # calculations with the API, rather than accepting plausible responses.
        cls.risk_model = joblib.load(main.BASE_DIR / "models/rf_model.pkl")
        cls.scaler = joblib.load(main.BASE_DIR / "models/scaler.pkl")
        cls.outbreak_model = joblib.load(main.BASE_DIR / "models/iso_model.pkl")

    def test_root_and_health_do_not_run_inference(self):
        with patch.object(main.rf_model, "predict_proba", side_effect=AssertionError("Unexpected inference")), \
                patch.object(main.iso_model, "predict", side_effect=AssertionError("Unexpected inference")), \
                patch.object(main.scaler, "transform", side_effect=AssertionError("Unexpected preprocessing")):
            root = self.client.get("/")
            health = self.client.get("/health")
        self.assertEqual(root.status_code, 200)
        self.assertEqual(root.json(), {
            "service": "Pashu-Shield ML Backend", "status": "ok",
            "message": "ML backend is running", "health": "/health",
        })
        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["models_ready"])
        self.assertTrue(health.json()["model_loaded"])
        self.assertEqual(health.json()["unavailable_artifacts"], [])

    def test_existing_readiness_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response.json()["model"], "Random Forest")

    def test_real_risk_inference_matches_original_artifacts(self):
        inputs = [PREDICT_INPUT, {
            **PREDICT_INPUT, "new_cases": 140, "affected_animals": 900,
            "vaccination_coverage": 0.15, "cases_growth_rate": 2,
            "animal_density": 450,
        }]
        scores = []
        for payload in inputs:
            with self.subTest(payload=payload):
                response = self.client.post("/api/predict", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                result = response.json()
                data = pd.DataFrame([{name: payload[name] for name in main.FEATURE_COLS}])
                expected = float(self.risk_model.predict_proba(self.scaler.transform(data))[0][1])
                self.assertEqual(result["probability"], round(expected, 3))
                self.assertEqual(result["risk_score"], round(expected * 100, 1))
                self.assertEqual(result["prediction_horizon_days"], 14)
                self.assertEqual(len(result["top_risk_factors"]), 4)
                self.assertEqual(result["confidence"], main.metrics["accuracy"])
                self.assertEqual(result["model_version"], "v1.0")
                json.dumps(result, allow_nan=False)
                scores.append(result["risk_score"])
        self.assertGreater(scores[1], scores[0])

    def test_real_outbreak_inference_matches_original_artifact(self):
        for payload in [OUTBREAK_INPUT, {"district": "Pune", "new_cases": 60, "cases_growth_rate": 1, "deaths": 20}]:
            with self.subTest(payload=payload):
                response = self.client.post("/api/outbreak-detection", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                data = pd.DataFrame([{name: payload[name] for name in main.OUTBREAK_FEATURE_COLS}])
                expected_detected = bool(self.outbreak_model.predict(data)[0] == -1)
                expected_score = round(float(self.outbreak_model.decision_function(data)[0]), 3)
                self.assertEqual(response.json()["outbreak_detected"], expected_detected)
                self.assertEqual(response.json()["anomaly_score"], expected_score)
                self.assertEqual(response.json()["affected_districts"], ["Pune"] if expected_detected else [])
                json.dumps(response.json(), allow_nan=False)

    def test_existing_model_performance_is_original_metrics(self):
        response = self.client.get("/api/model-performance")
        self.assertEqual(response.status_code, 200)
        original_metrics = json.loads((main.BASE_DIR / "models/metrics.json").read_text())
        self.assertEqual(response.json(), original_metrics)

    def test_existing_forecast(self):
        response = self.client.post("/api/forecast", json={"historical_cases": [10, 12, 18], "horizon": 3})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([point["predicted_cases"] for point in response.json()["forecast"]], [21, 23, 26])

    def test_forecast_keeps_existing_long_horizon_support(self):
        response = self.client.post("/api/forecast", json={"historical_cases": [10], "horizon": 366})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["forecast"]), 366)

    def test_existing_dbscan_on_actual_coordinates(self):
        response = self.client.post("/api/cluster", json=CLUSTER_INPUT)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["algorithm"], "DBSCAN")
        self.assertEqual(result["clusters"][0]["method"], "DBSCAN (haversine)")
        self.assertEqual(result["clusters"][0]["cases"], 2)
        self.assertAlmostEqual(result["clusters"][0]["lat"], 18.525)

    def test_openapi_preserves_all_existing_endpoints(self):
        response = self.client.get("/openapi.json")
        self.assertEqual(response.status_code, 200)
        paths = response.json()["paths"]
        for path in ["/", "/health", "/api/health", "/api/predict", "/api/outbreak-detection",
                     "/api/model-performance", "/api/forecast", "/api/cluster"]:
            self.assertIn(path, paths)
        self.assertEqual(self.client.get("/docs").status_code, 200)
        self.assertEqual(self.client.get("/redoc").status_code, 200)

    def test_missing_required_inputs_return_422(self):
        for path in ["/api/predict", "/api/outbreak-detection", "/api/forecast"]:
            with self.subTest(path=path):
                response = self.client.post(path, json={})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn("detail", response.json())

    def test_prediction_rejects_invalid_values(self):
        for field, value in [("new_cases", -1), ("vaccination_coverage", 1.1), ("humidity", 101),
                             ("district", " "), ("temperature", "NaN"), ("cases_growth_rate", -2)]:
            with self.subTest(field=field, value=value):
                response = self.client.post("/api/predict", json={**PREDICT_INPUT, field: value})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn("detail", response.json())

    def test_extreme_model_input_returns_422_instead_of_crashing(self):
        response = self.client.post("/api/predict", json={**PREDICT_INPUT, "cases_growth_rate": 1e300})
        self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post("/api/outbreak-detection", json={**OUTBREAK_INPUT, "cases_growth_rate": 1e300})
        self.assertEqual(response.status_code, 422, response.text)

    def test_nonfinite_json_validation_errors_are_serializable(self):
        examples = [
            ("/api/predict", {**PREDICT_INPUT, "temperature": float("nan")}),
            ("/api/outbreak-detection", {**OUTBREAK_INPUT, "new_cases": float("inf")}),
            ("/api/forecast", {"historical_cases": [float("nan")], "horizon": 3}),
            ("/api/cluster", {"cases": [{"lat": float("nan"), "lng": 73.85}]}),
        ]
        for path, payload in examples:
            with self.subTest(path=path):
                response = self.client.post(path, content=json.dumps(payload), headers={"Content-Type": "application/json"})
                self.assertEqual(response.status_code, 422, response.text)
                json.dumps(response.json(), allow_nan=False)

    def test_forecast_invalid_input_is_controlled(self):
        self.assertEqual(self.client.post("/api/forecast", json={"historical_cases": [], "horizon": 3}).status_code, 400)
        for payload in [{"historical_cases": [10], "horizon": -1}, {"historical_cases": [-1], "horizon": 3},
                        {"historical_cases": [10], "horizon": 10 ** 100},
                        {"historical_cases": [1e100, 1e308], "horizon": 3}]:
            self.assertEqual(self.client.post("/api/forecast", json=payload).status_code, 422)

    def test_cluster_invalid_input_is_controlled(self):
        for payload in [{**CLUSTER_INPUT, "eps_km": -2}, {**CLUSTER_INPUT, "min_samples": 0},
                        {**CLUSTER_INPUT, "eps_km": 1e-320},
                        {"cases": [{"lat": 91, "lng": 73.85}]}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/cluster", json=payload).status_code, 422)

    def test_missing_prediction_artifacts_return_503_and_honest_health(self):
        for name, filename in [("rf_model", "rf_model.pkl"), ("scaler", "scaler.pkl"), ("metrics", "metrics.json")]:
            with self.subTest(artifact=filename), patch.object(main, name, None):
                response = self.client.post("/api/predict", json=PREDICT_INPUT)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn("probability", response.json())
                health = self.client.get("/health")
                self.assertEqual(health.status_code, 200)
                self.assertFalse(health.json()["models_ready"])
                self.assertIn(filename, health.json()["unavailable_artifacts"])
                self.assertEqual(self.client.get("/api/health").status_code, 503)
                self.assertEqual(self.client.get("/").status_code, 200)

    def test_missing_outbreak_artifact_returns_503(self):
        with patch.object(main, "iso_model", None):
            self.assertEqual(self.client.post("/api/outbreak-detection", json=OUTBREAK_INPUT).status_code, 503)
            self.assertFalse(self.client.get("/health").json()["model_loaded"])
            # A missing outbreak model must not disable a loaded risk model.
            self.assertEqual(self.client.post("/api/predict", json=PREDICT_INPUT).status_code, 200)

    def test_missing_metrics_returns_503_not_fabricated_metrics(self):
        with patch.object(main, "metrics", None):
            self.assertEqual(self.client.get("/api/model-performance").status_code, 503)

    def test_inference_failure_is_logged_and_never_faked(self):
        with patch.object(main.rf_model, "predict_proba", side_effect=RuntimeError("Inference failure")), \
                self.assertLogs(main.logger, level="ERROR"):
            response = self.client.post("/api/predict", json=PREDICT_INPUT)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("probability", response.json())
        with patch.object(main.iso_model, "predict", side_effect=RuntimeError("Inference failure")), \
                self.assertLogs(main.logger, level="ERROR"):
            response = self.client.post("/api/outbreak-detection", json=OUTBREAK_INPUT)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("outbreak_detected", response.json())

    def test_cors_is_not_wildcard_for_default_server_to_server_usage(self):
        response = self.client.get("/health", headers={"Origin": "https://untrusted.invalid"})
        self.assertNotEqual(response.headers.get("access-control-allow-origin"), "*")


class ModelLoadingTests(unittest.TestCase):
    def test_model_paths_ignore_process_working_directory_and_blank_overrides(self):
        original_cwd = Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as directory:
                os.chdir(directory)
                for override in ["", " ", "models"]:
                    with self.subTest(override=override), patch.dict(os.environ, {"ML_MODEL_DIR": override}):
                        self.assertEqual(main.resolve_model_dir(), main.BASE_DIR / "models")
                with patch.dict(os.environ, {"ML_MODEL_DIR": directory}):
                    self.assertEqual(main.resolve_model_dir(), Path(directory).resolve())
        finally:
            os.chdir(original_cwd)

    def test_missing_artifact_is_logged_without_disabling_other_models(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for filename in ["rf_model.pkl", "iso_model.pkl", "metrics.json"]:
                (path / filename).symlink_to(main.BASE_DIR / "models" / filename)
            with patch.object(main, "MODEL_DIR", path), self.assertLogs(main.logger, level="ERROR") as logged:
                risk, scaler, outbreak, metrics = main.load_models()
            self.assertIsNotNone(risk)
            self.assertIsNone(scaler)
            self.assertIsNotNone(outbreak)
            self.assertIsNotNone(metrics)
            self.assertIn("scaler.pkl", "\n".join(logged.output))

    def test_corrupt_metrics_does_not_crash_health_or_model_loading(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            for filename in ["rf_model.pkl", "scaler.pkl", "iso_model.pkl"]:
                (path / filename).symlink_to(main.BASE_DIR / "models" / filename)
            (path / "metrics.json").write_text("[]")
            with patch.object(main, "MODEL_DIR", path), self.assertLogs(main.logger, level="ERROR"):
                risk, scaler, outbreak, metrics = main.load_models()
            self.assertTrue(all(model is not None for model in [risk, scaler, outbreak]))
            self.assertIsNone(metrics)

    def test_real_models_are_fitted_and_feature_order_matches(self):
        self.assertEqual(main.rf_model.n_features_in_, len(main.FEATURE_COLS))
        np.testing.assert_array_equal(main.scaler.feature_names_in_, main.FEATURE_COLS)
        np.testing.assert_array_equal(main.iso_model.feature_names_in_, main.OUTBREAK_FEATURE_COLS)


if __name__ == "__main__":
    unittest.main()
