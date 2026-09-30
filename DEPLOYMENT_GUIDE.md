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

Validate it before connecting the backend:

```bash
curl -f https://YOUR-ML-SERVICE.onrender.com/health
```

The response must report `status: ok` and `models_ready: true`.

For a new service, use:

| Setting | Value |
|---|---|
| Root directory | `ml-backend` |
| Build command | `pip install --upgrade pip && pip install -r requirements.txt && chmod +x start.sh` |
| Start command | `./start.sh` |
| Health check | `/health` |

`start.sh` uses the checked-in model artifacts and only trains when required artifacts are absent. `main.py` resolves the model directory relative to its own location, not the process working directory.

Set `APP_BASE_URL` (or `ML_CORS_ORIGINS`) to the Vercel production origin if direct browser-to-ML access is ever enabled. The current frontend reaches ML through the Flask backend, so backend-to-ML requests do not depend on browser CORS.

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

Do not append `/api` to `SIH_ML_BACKEND`. Do not put either secret in Vercel frontend settings or source code.

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

curl -f "$ML/health"
curl -f "$BACKEND/api/health"
curl -f "$BACKEND/api/ivr/info"
curl -f "$FRONTEND/api/health"
curl -f "$FRONTEND/api/ivr/info"
```

The last two requests prove the Vercel-to-Render rewrite works.

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
