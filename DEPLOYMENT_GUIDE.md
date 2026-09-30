# Pashu-Shield deployment guide

## Recommended topology

```text
Browser
  -> Vercel static frontend
     -> /api/* external rewrite
        -> Render Flask/Gunicorn backend
           -> persistent SQLite disk at /var/data
           -> existing Render FastAPI/Uvicorn ML service
```

Do not deploy the current Flask backend as a Vercel Function. It writes to SQLite, while a Vercel Function has no durable writable application filesystem. The frontend is suitable for Vercel; the Flask backend needs the persistent Render disk configured in `render.yaml`, or a future migration to a managed server database.

The SIP/RTP PBX is a separate external service. See `voice/README.md`. A deployed web application does not by itself establish PSTN service.

## 1. ML service on Render

If the ML service is already deployed, retain it and record its public HTTPS URL, for example:

```text
https://pashu-shield-ml.onrender.com
```

Validate it before connecting the backend (replace the placeholder with the actual service URL):

```bash
ML=https://YOUR-ML-SERVICE.onrender.com
curl -f "$ML/"
curl -f "$ML/health"
curl -f "$ML/api/health"
```

The root returns HTTP 200 with `service: Pashu-Shield ML Backend`, `status: ok`, a running message, and `health: /health`. It does not run inference.

`/health` is a liveness endpoint: HTTP 200 means the web process is alive, **not** that ML is ready. Check `models_ready`, `model_loaded`, `artifacts_loaded`, and `unavailable_artifacts` in its JSON. `/api/health` retains the existing readiness contract: HTTP 200 only when all artifacts are available, otherwise HTTP 503. A working deployment should have both `models_ready: true` and `model_loaded: true`.

For a new service, use:

| Setting | Value |
|---|---|
| Root directory | `ml-backend` |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --timeout-keep-alive 120` |
| Health check | `/health` |
| Python | `3.11` (as configured in `render.yaml`) |

Render provides `PORT`; do not replace it with a fixed production port. The optional `./start.sh` wrapper executes the same Uvicorn command, resolves its own directory, and requires `PORT` (local example: `PORT=8000 ./ml-backend/start.sh` with Uvicorn on `PATH`). **Neither startup command trains or replaces models.** The explicit training utility is still present but is not a deployment step.

The required original artifacts are `ml-backend/models/rf_model.pkl`, `scaler.pkl`, `iso_model.pkl`, and `metrics.json`. Leave `ML_MODEL_DIR` unset/blank to use them. Relative overrides are resolved against `ml-backend`, not the process working directory; absolute paths are supported. All three serialized estimators record scikit-learn `1.9.1`, which is pinned in ML requirements. Do not upgrade it independently or substitute newly trained models to fix a path error. Artifact failures are logged with the real filename/cause; affected inference endpoints return 503, never fabricated predictions. A failed artifact does not disable other independently loaded models.

No ML CORS variable is required for the current server-to-server topology. Only if direct browser-to-ML access is enabled, set `ML_CORS_ORIGINS` (or `APP_BASE_URL`) to comma-separated trusted frontend origins. Do not use a wildcard for authenticated production access.

## 2. Flask backend on Render

If the ML service already exists, create only the backend service manually instead of applying the full Blueprint and duplicating ML.

| Setting | Value |
|---|---|
| Runtime | Python |
| Root directory | `backend` |
| Build command | `pip install --upgrade pip && pip install -r requirements.txt` |
| Start command | `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120 --access-logfile - --error-logfile -` |
| Health check | `/api/health` |

Attach a persistent disk:

| Setting | Value |
|---|---|
| Name | `pashu-shield-sqlite` |
| Mount path | `/var/data` |
| Size | 1 GB or larger |

Required backend environment variables:

```env
SIH_SECRET_KEY=<long-random-secret>
IVR_WEBHOOK_SECRET=<different-long-random-secret>
SIH_DB_PATH=/var/data/animal_health.db
SIH_ML_BACKEND=https://YOUR-ML-SERVICE.onrender.com
IVR_PHONE_NUMBER=7382210251
IVR_PROVIDER_MODE=MOCK
IVR_PSTN_CONNECTED=false
```

Generate independent secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Do not append `/api` to `SIH_ML_BACKEND`. Trailing slashes are normalized. In production (`FLASK_ENV=production` or Render's `RENDER=true`), missing/malformed/loopback ML URLs are logged and ML requests return controlled errors instead of silently connecting to localhost. The rest of the Flask application remains available. Do not put either secret in Vercel frontend settings or source code.

After deployment, validate:

```bash
curl -f https://YOUR-BACKEND.onrender.com/api/health
curl -f https://YOUR-BACKEND.onrender.com/api/ivr/info
```

`/api/ivr/info` must show `7382210251`, `+917382210251`, and `pstn_connected: false` until a real carrier/PBX acceptance test is complete.

### Using the Render Blueprint

The root `render.yaml` defines both backend and ML services. Use it for a fresh two-service deployment. Set the prompted `SIH_ML_BACKEND` to the full public HTTPS URL after the ML service is created. If ML already exists, manual backend creation avoids creating a duplicate service.

SQLite remains a single-host database. Do not scale the backend to independent hosts unless the data layer is migrated to a managed database.

## 3. Static frontend on Vercel

The frontend is plain static HTML/CSS/JavaScript and needs no build framework.

In Vercel:

1. Import the GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Other`.
4. Leave the output directory as `.`.
5. Deploy.

`frontend/vercel.json` supplies security/cache headers and proxies the frontend's relative `/api/*` requests to Render. Before deploying, replace this default destination if the actual Render backend URL differs:

```json
{
  "source": "/api/:path*",
  "destination": "https://pashu-shield-backend.onrender.com/api/:path*"
}
```

No `VITE_API_URL` or `VITE_ML_API_URL` is used: this is not a Vite build. The browser uses same-origin `/api` paths, and Vercel performs the external rewrite. This avoids exposing secrets and avoids browser CORS for normal application requests.

The bundled offline Whisper model and ONNX runtime make the static frontend approximately 82 MB. Monitor the Vercel plan's static deployment and bandwidth limits. The model is fetched only when voice reporting initializes.

## 4. End-to-end validation

Set the deployed URLs and run:

```bash
ML=https://YOUR-ML-SERVICE.onrender.com
BACKEND=https://YOUR-BACKEND.onrender.com
FRONTEND=https://YOUR-APP.vercel.app

curl -f "$ML/"
curl -f "$ML/health"
curl -f "$ML/api/health"
curl -f "$ML/api/model-performance"
curl -f "$BACKEND/api/health"
curl -f "$BACKEND/api/ivr/info"
curl -f "$FRONTEND/api/health"
curl -f "$FRONTEND/api/ivr/info"
```

The last two requests prove the Vercel-to-Render rewrite works. All URL values above are placeholders; use the actual service addresses, not the examples.

### Verify every existing ML API with real inference

```bash
curl -f -X POST "$ML/api/predict" -H 'Content-Type: application/json' -d '{
  "disease": "FMD", "district": "Pune", "time_range": "14",
  "animal_population": 10000, "affected_animals": 120,
  "new_cases": 35, "deaths": 2, "vaccination_coverage": 0.65,
  "temperature": 30, "rainfall": 12, "humidity": 70,
  "animal_density": 150, "previous_cases": 20, "cases_growth_rate": 0.75
}'

curl -f -X POST "$ML/api/outbreak-detection" -H 'Content-Type: application/json' \
  -d '{"district":"Pune","new_cases":1000,"cases_growth_rate":5,"deaths":100}'

curl -f -X POST "$ML/api/forecast" -H 'Content-Type: application/json' \
  -d '{"historical_cases":[10,12,18],"horizon":3}'

curl -f -X POST "$ML/api/cluster" -H 'Content-Type: application/json' -d '{
  "cases": [
    {"case_no":"VERIFY-1","lat":18.52,"lng":73.85,"district":"Pune","disease":"FMD"},
    {"case_no":"VERIFY-2","lat":18.53,"lng":73.86,"district":"Pune","disease":"FMD"}
  ], "eps_km":45, "min_samples":2
}'

# Missing required fields must return 422, not 500 or a fabricated prediction.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$ML/api/predict" \
  -H 'Content-Type: application/json' -d '{}'
```

With the unchanged committed artifacts, the prediction request above was verified locally as:

```json
{
  "risk_score": 1.9,
  "probability": 0.019,
  "risk_level": "Low Risk",
  "confidence": 0.864,
  "predicted_cases": 61,
  "prediction_horizon_days": 14,
  "model_version": "v1.0"
}
```

This is a subset of the actual response, not a substitute response generated by the server. Independent deserialization of the saved scaler/Random Forest produced the same probability. The outbreak request returned `outbreak_detected: true`, `severity: Moderate`, and `anomaly_score: -0.068` from the saved Isolation Forest. Forecast values were `[21, 23, 26]`; coordinate-based clustering returned one two-case cluster using `DBSCAN (haversine)`.

API paths and response fields are retained. Input validation rejects nonfinite numbers, negative counts, invalid coverage/humidity/coordinates, and nonpositive clustering/forecast parameters with controlled 4xx responses. Empty historical data retains its existing 400 response. Forecasts are not newly limited to an arbitrary one-year horizon; only invalid values and calendar/numeric overflow are rejected. Runtime artifact/inference failures return honest 503 errors and are logged. `/docs` and `/openapi.json` describe the real request schemas.

### Verify the deployed Flask -> ML connection

Using an existing authenticated government account, obtain its bearer token through the normal login flow in your own local environment. Do not put credentials/tokens in source, public frontend variables, or support messages. With that token in your local `GOVT_TOKEN` shell variable:

```bash
curl -f "$BACKEND/api/govt/ai/status" -H "Authorization: Bearer $GOVT_TOKEN"
curl -f "$BACKEND/api/govt/ai/predict?district=Pune&disease=FMD" -H "Authorization: Bearer $GOVT_TOKEN"
curl -f "$BACKEND/api/govt/ai/outbreak?district=Pune" -H "Authorization: Bearer $GOVT_TOKEN"
curl -f "$BACKEND/api/govt/clusters" -H "Authorization: Bearer $GOVT_TOKEN"
```

Status must report `online: true`; its HTTP 200 alone is not sufficient. The Flask status endpoint verifies `/api/health` readiness and successful metrics retrieval before claiming online. Prediction must return HTTP 200 with a real probability and `features_used`; outbreak must return HTTP 200 with a boolean `outbreak_detected`. The local verification exercised these authenticated Flask routes against the running ML HTTP service with no inference mocks. Remote connectivity remains unverified until the actual deployed URLs are tested.

For an already-created/manual Render service, explicitly update its root/build/start/health settings to the ML table above; editing `render.yaml` alone may not update that service. Redeploy the repaired code to the existing ML service (do not create a duplicate), set the backend's actual `SIH_ML_BACKEND`, redeploy the backend, and run these checks. A root 200 only proves the route exists, not model readiness, real inference, or deployed backend connectivity.

Test authentication through Vercel:

```bash
curl -f -X POST "$FRONTEND/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"rajesh@example.com","password":"password123"}'
```

Then verify in a browser:

- owner, veterinarian, government, and laboratory login;
- registration and demo account details;
- animal, case, prescription, vaccination, laboratory, and notification flows;
- GIS, weather, analytics, ML prediction, and outbreak detection;
- manual and offline Whisper reporting; and
- the native `tel:+917382210251` click-to-call link.

## 5. Security and operational checks

- Never commit `.env`, JWT/HMAC secrets, SIP credentials, or carrier credentials.
- Keep `IVR_PROVIDER_MODE=MOCK` and `IVR_PSTN_CONNECTED=false` until lawful telecom provisioning and real-phone testing are complete.
- Point PBX webhooks directly at the Render backend and retain HMAC verification.
- Back up `/var/data/animal_health.db` and rehearse restoration.
- Do not use `/tmp` as the production database path.
- Do not configure browser-facing code with `localhost`.
- Restrict ML CORS to known production origins if direct browser calls are enabled.

See `DEPLOYMENT.md`, `.env.example`, and `voice/README.md` for the full environment and telecom boundaries.
