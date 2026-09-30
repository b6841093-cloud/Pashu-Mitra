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
- `SIH_ML_BACKEND`: reachable HTTPS URL for the ML service.
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
- ML: `GET /health`
- ML compatibility health: `GET /api/health`

`/api/ivr/info` must remain honest: MOCK mode and an unverified installation report `pstn_connected: false`.
