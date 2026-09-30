from fastapi import FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from pathlib import Path
import pandas as pd
import numpy as np
import joblib
import json
import logging
import math
import os
import warnings
from datetime import datetime, timedelta
from sklearn.cluster import DBSCAN
from sklearn.exceptions import InconsistentVersionWarning
from sklearn.utils.validation import check_is_fitted

logger = logging.getLogger(__name__)
app = FastAPI(title="Livestock Health Surveillance AI & Decision Support API")

BASE_DIR = Path(__file__).resolve().parent


def resolve_model_dir():
    # Blank overrides use the bundled artifacts; relative overrides are anchored
    # to this file, never to Render's/process's working directory.
    configured = (os.environ.get("ML_MODEL_DIR") or "").strip()
    path = Path(configured).expanduser() if configured else BASE_DIR / "models"
    return (path if path.is_absolute() else BASE_DIR / path).resolve()


MODEL_DIR = resolve_model_dir()
configured_origins = [
    origin.strip() for origin in (
        os.environ.get("ML_CORS_ORIGINS") or os.environ.get("APP_BASE_URL") or ""
    ).split(",") if origin.strip()
]
# Normal application requests go through Flask, so no browser CORS is needed
# unless an operator explicitly configures trusted origins.
if configured_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization"],
    )

FEATURE_COLS = [
    "animal_population", "affected_animals", "new_cases", "deaths",
    "vaccination_coverage", "temperature", "rainfall", "humidity",
    "animal_density", "previous_cases", "cases_growth_rate"
]
OUTBREAK_FEATURE_COLS = ["new_cases", "cases_growth_rate", "deaths"]


def load_models():
    """Load only the existing trained artifacts, retaining any that are usable."""
    loaded = []
    for filename, feature_cols, named_features in (
        ("rf_model.pkl", FEATURE_COLS, False),
        ("scaler.pkl", FEATURE_COLS, True),
        ("iso_model.pkl", OUTBREAK_FEATURE_COLS, True),
    ):
        path = MODEL_DIR / filename
        try:
            with warnings.catch_warnings():
                # Unsupported sklearn deserialization must not silently serve
                # predictions. requirements.txt matches the serialized version.
                warnings.simplefilter("error", InconsistentVersionWarning)
                model = joblib.load(path)
            check_is_fitted(model)
            if model.n_features_in_ != len(feature_cols):
                raise ValueError(f"Unexpected feature count in {filename}")
            if named_features and list(model.feature_names_in_) != feature_cols:
                raise ValueError(f"Unexpected feature order in {filename}")
            loaded.append(model)
        except Exception:
            logger.exception("Failed to load trained artifact %s", path)
            loaded.append(None)

    model_metrics = None
    try:
        with (MODEL_DIR / "metrics.json").open(encoding="utf-8") as f:
            candidate = json.load(f)
        if not isinstance(candidate, dict):
            raise ValueError("Model metrics must be a JSON object")
        accuracy = candidate.get("accuracy")
        if not isinstance(accuracy, (int, float)) or not math.isfinite(accuracy) or not 0 <= accuracy <= 1:
            raise ValueError("Model metrics must contain a finite accuracy between 0 and 1")
        # Reject non-standard NaN/Infinity anywhere in the metrics response.
        json.dumps(candidate, allow_nan=False)
        model_metrics = candidate
    except Exception:
        logger.exception("Failed to load trained artifact %s", MODEL_DIR / "metrics.json")

    return (*loaded, model_metrics)


rf_model, scaler, iso_model, metrics = load_models()


@app.get("/")
async def root():
    return {
        "service": "Pashu-Shield ML Backend",
        "status": "ok",
        "message": "ML backend is running",
        "health": "/health",
    }


@app.get("/health")
async def health():
    # Liveness only: no inference and no disk access on health-check requests.
    artifacts = {
        "rf_model.pkl": rf_model is not None,
        "scaler.pkl": scaler is not None,
        "iso_model.pkl": iso_model is not None,
        "metrics.json": metrics is not None,
    }
    return {
        "status": "ok",
        "service": "pashu-shield-ml",
        "models_ready": all(artifacts.values()),
        "model_loaded": all(artifacts[name] for name in ("rf_model.pkl", "scaler.pkl", "iso_model.pkl")),
        "model": metrics.get("model") if metrics is not None else None,
        "artifacts_loaded": artifacts,
        "unavailable_artifacts": [name for name, loaded in artifacts.items() if not loaded],
    }


@app.get("/api/health")
async def api_health():
    # Preserve the existing compatibility endpoint's readiness/503 behavior.
    status = await health()
    if not status["models_ready"]:
        raise HTTPException(status_code=503, detail="One or more trained model artifacts are unavailable.")
    return status


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request, exc):
    # Invalid JSON numbers (NaN/Infinity) must produce a controlled 422, not
    # another serialization exception while rendering the validation errors.
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            {"detail": exc.errors()},
            custom_encoder={float: lambda value: value if math.isfinite(value) else str(value)},
        ),
    )


class APIRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, str_strip_whitespace=True)


class PredictRequest(APIRequest):
    disease: str = Field(min_length=1)
    district: str = Field(min_length=1)
    time_range: str = Field(min_length=1)
    animal_population: float = Field(ge=0)
    affected_animals: float = Field(ge=0)
    new_cases: float = Field(ge=0)
    deaths: float = Field(ge=0)
    vaccination_coverage: float = Field(ge=0, le=1)
    temperature: float
    rainfall: float = Field(ge=0)
    humidity: float = Field(ge=0, le=100)
    animal_density: float = Field(ge=0)
    previous_cases: float = Field(ge=0)
    cases_growth_rate: float = Field(ge=-1)

@app.post("/api/predict")
async def predict_risk(req: PredictRequest):
    if rf_model is None or scaler is None or metrics is None:
        raise HTTPException(status_code=503, detail="AI model unavailable — prediction cannot be generated.")
    
    # Create feature array
    input_data = pd.DataFrame([{
        "animal_population": req.animal_population,
        "affected_animals": req.affected_animals,
        "new_cases": req.new_cases,
        "deaths": req.deaths,
        "vaccination_coverage": req.vaccination_coverage,
        "temperature": req.temperature,
        "rainfall": req.rainfall,
        "humidity": req.humidity,
        "animal_density": req.animal_density,
        "previous_cases": req.previous_cases,
        "cases_growth_rate": req.cases_growth_rate
    }])
    
    try:
        # Preserve the trained feature order and the existing preprocessing.
        input_scaled = scaler.transform(input_data[FEATURE_COLS])
        if not np.isfinite(input_scaled).all() or np.any(np.abs(input_scaled) > np.finfo(np.float32).max):
            raise ValueError("Scaled input exceeds the trained model's float32 range")
        prob = float(rf_model.predict_proba(input_scaled)[0][1])
        if not math.isfinite(prob) or not 0 <= prob <= 1:
            raise RuntimeError("Trained risk model returned an invalid probability")
        predicted_cases = int(req.new_cases * (1 + req.cases_growth_rate))
    except (ValueError, OverflowError) as exc:
        logger.warning("Prediction input could not be processed: %s", exc)
        raise HTTPException(status_code=422, detail="Input values are outside the model's supported numeric range.") from exc
    except Exception as exc:
        logger.exception("Trained risk model inference failed")
        raise HTTPException(status_code=503, detail="Trained risk model inference failed; check ML service logs.") from exc
    risk_score = round(prob * 100, 1)
    
    if risk_score > 60:
        risk_level = "High Risk"
    elif risk_score > 30:
        risk_level = "Moderate Risk"
    else:
        risk_level = "Low Risk"
        
    trend = "Increasing" if req.cases_growth_rate > 0.1 else ("Stable" if req.cases_growth_rate > -0.1 else "Decreasing")
    
    # Calculate feature importances based on this prediction
    importances = rf_model.feature_importances_
    features_impact = []
    for i, col in enumerate(FEATURE_COLS):
        features_impact.append({
            "factor": col.replace("_", " ").title(),
            "impact": round(float(importances[i]), 3),
            "value": float(input_data[col][0])
        })
    
    # Sort and take top 4
    features_impact.sort(key=lambda x: x["impact"], reverse=True)
    top_factors = features_impact[:4]
    
    # Dynamic recommended actions
    actions = []
    if risk_level == "High Risk":
        actions.append("Immediate Veterinary inspection")
        actions.append("Implement quarantine measures")
    if req.vaccination_coverage < 0.6:
        actions.append("Initiate emergency vaccination campaign")
    if req.cases_growth_rate > 0.5:
        actions.append("Enhanced active surveillance")
    if not actions:
        actions = ["Routine monitoring", "Promote biosecurity awareness"]
        
    try:
        horizon = int(req.time_range) if req.time_range.isdecimal() else 14
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Prediction horizon is outside the supported integer range.") from exc
        
    return {
        "disease": req.disease,
        "district": req.district,
        "risk_score": risk_score,
        "probability": round(float(prob), 3),
        "risk_level": risk_level,
        "confidence": metrics["accuracy"],
        "trend": trend,
        "predicted_cases": predicted_cases,
        "prediction_horizon_days": horizon,
        "top_risk_factors": top_factors,
        "recommended_actions": actions,
        "model_version": "v1.0"
    }

@app.get("/api/model-performance")
async def model_performance():
    if metrics is None:
        raise HTTPException(status_code=503, detail="Model metrics not found.")
    return metrics

class OutbreakRequest(APIRequest):
    new_cases: float = Field(ge=0)
    cases_growth_rate: float = Field(ge=-1)
    deaths: float = Field(ge=0)
    district: str = Field(min_length=1)

@app.post("/api/outbreak-detection")
async def detect_outbreak(req: OutbreakRequest):
    if iso_model is None:
        raise HTTPException(status_code=503, detail="Isolation Forest model unavailable.")
        
    input_data = pd.DataFrame([{
        "new_cases": req.new_cases,
        "cases_growth_rate": req.cases_growth_rate,
        "deaths": req.deaths
    }])
    
    try:
        # IsolationForest uses float32 internally; reject overflowing inputs
        # before conversion rather than letting them silently become infinity.
        if np.any(np.abs(input_data.to_numpy()) > np.finfo(np.float32).max):
            raise ValueError("Input exceeds the trained model's float32 range")
        # iso_model returns -1 for anomaly, 1 for normal.
        prediction = iso_model.predict(input_data[OUTBREAK_FEATURE_COLS])[0]
        score = iso_model.decision_function(input_data[OUTBREAK_FEATURE_COLS])[0]
        if prediction not in (-1, 1) or not math.isfinite(score):
            raise RuntimeError("Trained outbreak model returned an invalid result")
    except (ValueError, OverflowError) as exc:
        logger.warning("Outbreak input could not be processed: %s", exc)
        raise HTTPException(status_code=422, detail="Input values are outside the model's supported numeric range.") from exc
    except Exception as exc:
        logger.exception("Trained outbreak model inference failed")
        raise HTTPException(status_code=503, detail="Trained outbreak model inference failed; check ML service logs.") from exc
    is_anomaly = prediction == -1
    
    severity = "Normal"
    if is_anomaly:
        severity = "High" if score < -0.1 else "Moderate"
        
    return {
        "outbreak_detected": bool(is_anomaly),
        "severity": severity,
        "anomaly_score": round(float(score), 3),
        "case_growth": req.cases_growth_rate,
        "affected_districts": [req.district] if is_anomaly else []
    }

class ForecastRequest(APIRequest):
    historical_cases: list[float]
    horizon: int = Field(ge=1)

@app.post("/api/forecast")
async def forecast(req: ForecastRequest):
    if not req.historical_cases:
        raise HTTPException(status_code=400, detail="No historical cases provided.")
    if any(value < 0 for value in req.historical_cases):
        raise HTTPException(status_code=422, detail="Historical case counts must be nonnegative.")
        
    if len(req.historical_cases) < 2:
        trend = 0
    else:
        trend = (req.historical_cases[-1] - req.historical_cases[0]) / len(req.historical_cases)
        
    forecast_points = []
    last_val = req.historical_cases[-1]
    
    base_date = datetime.now()
    try:
        base_date + timedelta(days=req.horizon)
    except OverflowError as exc:
        raise HTTPException(status_code=422, detail="Forecast horizon exceeds the supported calendar range.") from exc

    for i in range(req.horizon):
        next_val = max(0, last_val + trend)
        if not math.isfinite(next_val):
            raise HTTPException(status_code=422, detail="Forecast values exceed the supported numeric range.")
        forecast_points.append({
            "date": (base_date + timedelta(days=i+1)).strftime("%Y-%m-%d"),
            "predicted_cases": int(round(next_val))
        })
        last_val = next_val
        
    return {
        "forecast": forecast_points
    }

# ==================== REAL SPATIOTEMPORAL CLUSTERING (DBSCAN) ====================
DISTRICT_BASE_COORDS = {
    "Pune": [18.5204, 73.8567],
    "Satara": [17.6805, 74.0183],
    "Aurangabad": [19.8762, 75.3433],
    "Nagpur": [21.1458, 79.0882],
    "Nashik": [20.0110, 73.7903],
    "Nanded": [19.1383, 77.3210],
    "Latur": [18.4088, 76.5604],
    "Solapur": [17.6599, 75.9064],
    "Kolhapur": [16.7050, 74.2433],
    "Ahmednagar": [19.0952, 74.7496],
}

class CaseItem(APIRequest):
    case_no: Optional[str] = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    district: Optional[str] = "Unknown"
    disease: Optional[str] = "Unspecified"
    severity: Optional[str] = "Medium"
    created_at: Optional[str] = None

class ClusterRequest(APIRequest):
    districts: Optional[List[str]] = None
    cases: Optional[List[CaseItem]] = None
    eps_km: Optional[float] = Field(default=45.0, gt=0)
    min_samples: Optional[int] = Field(default=2, ge=1)

@app.post("/api/cluster")
async def spatiotemporal_clustering(req: ClusterRequest):
    """Real spatiotemporal disease clustering using scikit-learn DBSCAN with Haversine distance metric.
    Replaces random mock data with actual coordinate and case density analysis."""
    
    clusters = []
    
    # 1. If actual cases with coordinates are provided, perform real DBSCAN
    if req.cases and len(req.cases) >= 1:
        points = []
        valid_cases = []
        for c in req.cases:
            if c.lat is not None and c.lng is not None and not (c.lat == 0 and c.lng == 0):
                points.append([c.lat, c.lng])
                valid_cases.append(c)
                
        if len(points) >= (req.min_samples or 2):
            # Convert lat/lng to radians for Haversine metric
            kms_per_radian = 6371.0088
            epsilon = (req.eps_km or 45.0) / kms_per_radian
            coords_rad = np.radians(points)
            
            try:
                db = DBSCAN(eps=epsilon, min_samples=(req.min_samples or 2), metric="haversine").fit(coords_rad)
            except (ValueError, OverflowError) as exc:
                logger.warning("Clustering input could not be processed: %s", exc)
                raise HTTPException(status_code=422, detail="Clustering parameters are outside the supported numeric range.") from exc
            except Exception as exc:
                logger.exception("DBSCAN clustering failed")
                raise HTTPException(status_code=503, detail="Clustering failed; check ML service logs.") from exc
            labels = db.labels_
            
            unique_labels = set(labels)
            for lab in unique_labels:
                if lab == -1:
                    continue  # Noise / isolated points
                cluster_cases = [valid_cases[i] for i, l in enumerate(labels) if l == lab]
                c_lats = [c.lat for c in cluster_cases]
                c_lngs = [c.lng for c in cluster_cases]
                
                c_centroid_lat = float(np.mean(c_lats))
                c_centroid_lng = float(np.mean(c_lngs))
                
                districts_set = sorted(list(set([c.district for c in cluster_cases if c.district])))
                primary_district = districts_set[0] if districts_set else "Multiple"
                diseases_set = sorted(list(set([c.disease for c in cluster_cases if c.disease])))
                has_high_sev = any((c.severity or "").lower() in ("high", "critical") for c in cluster_cases)
                
                # Real risk assessment based on cluster density and severity
                if len(cluster_cases) >= 5 or has_high_sev:
                    risk = "High Risk"
                elif len(cluster_cases) >= 2:
                    risk = "Moderate Risk"
                else:
                    risk = "Low Risk"
                    
                dates = [c.created_at for c in cluster_cases if c.created_at]
                latest_date = max(dates) if dates else datetime.now().strftime("%Y-%m-%d")
                
                clusters.append({
                    "cluster_id": f"CLUST-GEO-{lab + 101}",
                    "district": primary_district,
                    "districts": districts_set,
                    "lat": round(c_centroid_lat, 4),
                    "lng": round(c_centroid_lng, 4),
                    "cases": len(cluster_cases),
                    "diseases": diseases_set,
                    "risk_level": risk,
                    "latest_case": latest_date[:10],
                    "method": "DBSCAN (haversine)"
                })
        elif len(points) > 0:
            # Singleton cluster
            c0 = valid_cases[0]
            clusters.append({
                "cluster_id": "CLUST-GEO-101",
                "district": c0.district or "Pune",
                "districts": [c0.district or "Pune"],
                "lat": round(c0.lat, 4),
                "lng": round(c0.lng, 4),
                "cases": len(valid_cases),
                "diseases": [c0.disease or "Unspecified"],
                "risk_level": "Moderate Risk" if (c0.severity or "").lower() in ("high", "critical") else "Low Risk",
                "latest_case": (c0.created_at or datetime.now().strftime("%Y-%m-%d"))[:10],
                "method": "Direct Location Cluster"
            })
            
    # 2. Backwards-compatible fallback when caller queries only district list
    if not clusters:
        target_districts = req.districts if req.districts else ["Pune", "Satara", "Nashik"]
        for i, dist in enumerate(target_districts):
            name = dist.title()
            if name in DISTRICT_BASE_COORDS:
                lat, lng = DISTRICT_BASE_COORDS[name]
                clusters.append({
                    "cluster_id": f"CLUST-DIST-{i+101}",
                    "district": name,
                    "districts": [name],
                    "lat": lat,
                    "lng": lng,
                    "cases": 1,
                    "diseases": ["FMD", "HS"],
                    "risk_level": "Moderate Risk" if i == 0 else "Low Risk",
                    "latest_case": datetime.now().strftime("%Y-%m-%d"),
                    "method": "District Coordinates"
                })
                
    return {"clusters": clusters, "algorithm": "DBSCAN", "eps_km": req.eps_km or 45.0}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
