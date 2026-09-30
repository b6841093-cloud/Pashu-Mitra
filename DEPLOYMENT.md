# Pashu-Shield production deployment

## Services

The checked-in `render.yaml` defines:

- Flask/Gunicorn backend and static frontend;
- FastAPI/Uvicorn ML service;
- a persistent disk mounted at `/var/data` for SQLite; and
- health checks at `/api/health` and `/health`.

The SIP/RTP PBX is deliberately separate from Render. See `voice/README.md`.

## Required backend configuration

- `SIH_SECRET_KEY`: long random JWT signing key (Render generates it).
- `SIH_DB_PATH`: persistent database file; Render uses `/var/data/animal_health.db`.
- `SIH_ML_BACKEND`: actual reachable HTTPS **base** URL for the ML service, without `/api`. Missing, malformed, or loopback URLs in production disable only ML calls with controlled errors; they do not fall back to localhost. Trailing slashes are normalized.
- `IVR_PHONE_NUMBER=7382210251`.
- `IVR_PROVIDER_MODE=MOCK` until a SIP/PBX integration is provisioned.
- `IVR_WEBHOOK_SECRET`: long random HMAC secret shared only with the PBX adapter.
- `IVR_PSTN_CONNECTED=false` until the real-phone acceptance gate passes.

See `.env.example` for optional routing, weather, CORS, and model-path values. Do not commit a populated `.env` file.

## Database behavior

`backend/database.py` reads `SIH_DB_PATH`, enables foreign keys, WAL, a busy timeout, and normal synchronous mode. Importing the WSGI application runs additive migrations. A filesystem lock serializes migration/seed initialization across Gunicorn workers. Existing tables and rows are retained; a fresh path receives the existing seed/demo records.

SQLite remains a single-host persistent database. Do not scale the backend across independent hosts sharing no common filesystem. Back up the persistent disk, monitor disk capacity, and rehearse restoration. For multi-host horizontal scale, migrate to a server database rather than putting SQLite on an unsafe network filesystem.

## Local production-like startup

```bash
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r ml-backend/requirements.txt

# terminal 1
cd ml-backend
../.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000

# terminal 2
cd backend
SIH_SECRET_KEY='replace-me' \
IVR_WEBHOOK_SECRET='replace-me' \
SIH_DB_PATH='/absolute/persistent/path/animal_health.db' \
SIH_ML_BACKEND='http://127.0.0.1:8000' \
../.venv/bin/gunicorn app:app --bind 0.0.0.0:5001 --workers 2 --timeout 120
```

Use a TLS-terminating reverse proxy or managed platform endpoint in production. Never use Flask debug mode in production.

## Validation endpoints

- backend: `GET /api/health`
- public IVR configuration: `GET /api/ivr/info`
- ML service status: `GET /`
- ML liveness: `GET /health` (200 while the process is alive; inspect the model-loading flags)
- ML compatibility readiness: `GET /api/health` (503 if any required artifact is unavailable)
- ML prediction: `POST /api/predict`
- ML outbreak detection: `POST /api/outbreak-detection`
- ML original metrics: `GET /api/model-performance`
- ML existing forecast: `POST /api/forecast`
- ML existing geographic clustering: `POST /api/cluster`

The actual FastAPI entrypoint is `ml-backend/main.py`, object `app`. Render uses root directory `ml-backend`, build command `pip install -r requirements.txt`, start command `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --timeout-keep-alive 120`, and health-check path `/health`. Startup never retrains/replaces the committed models. Leave `ML_MODEL_DIR` blank/unset for the bundled artifacts; relative overrides are anchored to `ml-backend`. No ML CORS configuration is required for Flask-to-ML traffic.

`/api/ivr/info` must remain honest: MOCK mode and an unverified installation report `pstn_connected: false`.

## ML repair verification (local, 2026-09-30)

These are results from this checkout, **not a claim that the remote Render services have been redeployed**. No actual deployed ML/backend URLs or Render deployment access were supplied, and the repository has no GitHub deployment records containing them.

| Check | Observed result |
|---|---|
| `GET /` | PASS — HTTP 200; service/status/running message/health link |
| `GET /health` | PASS — HTTP 200; `models_ready: true`, `model_loaded: true`, all four artifacts present |
| `GET /api/health` | PASS — HTTP 200; readiness compatibility retained |
| `POST /api/predict` | PASS — HTTP 200; real Random Forest inference and saved scaler |
| `POST /api/outbreak-detection` | PASS — HTTP 200; real Isolation Forest inference |
| `GET /api/model-performance` | PASS — HTTP 200; unchanged saved metrics |
| `POST /api/forecast` | PASS — HTTP 200; existing algorithm preserved |
| `POST /api/cluster` | PASS — HTTP 200; actual coordinate-based DBSCAN |
| Invalid input / unavailable models | PASS — controlled 400/422 input errors and 503 artifact/inference errors; no invented predictions |
| Flask -> ML | PASS locally — authenticated government prediction, outbreak, metrics, and cluster routes made real HTTP requests to the running ML server |
| Render command and shell wrapper | PASS locally — Uvicorn bound `0.0.0.0` on the supplied `PORT`; wrapper also tested from repository root with relative `ML_MODEL_DIR=models` |
| Dependency compatibility | PASS — `pip check` found no broken requirements |
| Artifact integrity | PASS — SHA-256 of all three models and `metrics.json` unchanged from the original commit |
| Remote Render deployment | NOT VERIFIED — redeploy and test the actual public URLs |

The ML unit suite contains 24 passing tests; the backend run contains 72 passing tests, including all 56 pre-existing feature/helpline/regression tests, 12 new configuration/error tests, and 4 real ML HTTP integration tests. Twelve additional live ML HTTP checks covered all application routes and controlled invalid input. The original frontend, SQLite database, and model artifacts were not modified.

Tested environment: Python 3.11.2, FastAPI 0.142.2, Uvicorn 0.54.0, NumPy 2.4.6, Pandas 3.0.6, scikit-learn 1.9.1 (matches serialization metadata), SciPy 1.17.1, Joblib 1.6.0, and Pydantic 2.13.5. Existing dependency ranges were retained apart from the serialization-compatible scikit-learn pin and the explicit SciPy requirement; no blanket upgrade was made to dependency declarations.

For the exact real inference request and production curl checks, see `DEPLOYMENT_GUIDE.md`. Local test commands (with the ML server running on port 8000) are:

```bash
.venv/bin/pip install -r backend/requirements.txt -r ml-backend/requirements-test.txt
.venv/bin/python -m unittest discover -s ml-backend -p 'test_*.py' -v

# Use a disposable database; these suites create and update application records.
mkdir -p .venv/verification
TEST_DIR=$(mktemp -d "$PWD/.venv/verification/tests.XXXXXX")
cd backend
SIH_DB_PATH="$TEST_DIR/test.db" \
SIH_SECRET_KEY='local-regression-only-not-for-production' \
IVR_WEBHOOK_SECRET='local-regression-webhook-not-for-production' \
SIH_ML_BACKEND='http://127.0.0.1:8000' \
SIH_TEST_ML_URL='http://127.0.0.1:8000' \
../.venv/bin/python -m unittest test_all_features test_regression test_helpline test_ml_service -v
```

`SIH_TEST_ML_URL` is an opt-in **test** setting, not a deployment variable. The production backend must use `SIH_ML_BACKEND` with its actual remote URL.
