# Pashu-Shield — Complete Feature Inventory (Phase 0)

**Repository:** `h6362794-sketch/Pashu-Shield-updated`
**Branch:** `arena/01a10b85-pashu-shield-updated`
**Baseline commit:** `1227fddda1036193c72ebe37bb4c9f988cd5ae1d`
**Inventory date:** 2026-10-05
**Prepared for:** GIGW 3.0 / GIGW 2.0 / GuDApps NIC-GDL-DA-1.1 / UX4G UX Handbook compliance programme

> **Purpose.** This inventory is the authoritative record of what Pashu-Shield *already does*.
> Per the programme's zero-regression rule, every row below is a feature that must still work
> after the compliance work is complete. Nothing here may be deleted, disabled or replaced.

---

## 1. Architecture Summary (discovered, not assumed)

| Layer | Technology | Notes |
|---|---|---|
| Frontend | **Vanilla HTML + CSS + JavaScript** (single `index.html` SPA, hash router) | `frontend/index.html`, `app.js` (5,323 lines), `call.js` (1,848 lines), `style.css` (526 lines) |
| Frontend hosting | Vercel (static) | `frontend/vercel.json` rewrites `/api/*` → Render backend |
| Backend | **Flask 3.1.3** monolith, `backend/app.py` (4,974 lines) | **117 API routes** |
| Database | **SQLite** (`backend/animal_health.db`) | Schema + additive migrations in `backend/database.py` (1,524 lines) |
| Auth | JWT (PyJWT HS256) for staff; mobile + OTP for farmers; optional Clerk phone auth | `backend/otp_service.py`, `clerk_auth.py`, `demo_auth.py` |
| Real-time | **Flask-SocketIO / Socket.IO** | `backend/realtime.py`, vendored `frontend/vendor/socket.io.min.js` |
| Web calling | **WebRTC** with STUN/TURN | `backend/turn_config.py`, `webcalling.py`, `frontend/call.js` |
| ML | Separate **FastAPI-ish Flask service** `ml-backend/` (503 lines) + in-repo `animal_ai.py` | RF/IsolationForest models in `ml-backend/models/` |
| IVR / telephony | Asterisk config templates + HTTP webhook IVR engine | `backend/ivr_service.py` (1,114 lines), `ivr_security.py`, `voice/asterisk/` |
| SMS | Pluggable SMS gateway (Android-device gateway + providers) | `backend/sms_gateway.py` (869 lines), `sms_service.py` |
| Push | Web Push (VAPID) | `backend/push_service.py` |
| PWA | Service worker `frontend/sw.js`, `manifest.json` | Offline shell + offline action queue |
| Maps | Leaflet (CDN, `unpkg.com`) | GIS / surveillance views |
| On-device AI | Transformers.js Whisper-tiny (WASM) for voice reports | `frontend/models/`, `frontend/wasm/` |
| i18n | Runtime dictionary `t()` in `app.js`; backend IVR languages | **en, te (Telugu), hi (Hindi), mr (Marathi)** |

---

## 2. Roles

| Role | Code | Home route | Auth mechanism |
|---|---|---|---|
| Farmer / Animal owner | `owner` | `#/owner/dashboard` | **Mobile + OTP only** (no password) |
| Veterinarian | `vet` | `#/vet/dashboard` | Password (identifier = email or mobile) |
| Government | `govt` | `#/govt/dashboard` | Password |
| Laboratory | `lab` | `#/lab/dashboard` | Password |

---

## 3. Frontend Route Inventory

| # | Route | Roles | View function | Purpose |
|---|---|---|---|---|
| F01 | `#/` | public | `renderRoleSelect()` | Role selection / landing |
| F02 | `#/login/:role` | public | `renderAuth('login', role)` | Login screen per role |
| F03 | `#/login/:role/password` | public | — | Staff password step |
| F04 | `#/register/:role` | public | `renderAuth('register', role)` | Signup screen per role |
| F05 | `#/owner/dashboard` | owner | `ownerDashboard()` | Farmer dashboard |
| F06 | `#/owner/livestock` | owner | `ownerLivestockView()` | Livestock / herd management |
| F07 | `#/owner/webcall` | owner | — | Farmer web calling |
| F08 | `#/owner/calls` | owner | — | Farmer call history |
| F09 | `#/vet/calls` | vet | — | Vet call screens |
| F10 | `#/vet/dashboard` | vet | `vetDashboard()` | Vet dashboard |
| F11 | `#/govt/dashboard` | govt | `govtDashboard()` | Government dashboard |
| F12 | `#/lab/dashboard` | lab | `labDashboard()` | Lab dashboard |
| F13 | `#/lab/queue` | lab | — | Lab sample queue |
| F14 | `#/lab/samples/:id` | lab, vet, govt | `labSampleDetailView(id)` | Sample detail / results |
| F15 | `#/scan` | any | `renderScanner()` | QR scanner (camera + file upload) |
| F16 | `#/govt/analytics` | govt | — | Analytics dashboard |
| F17 | `#/govt/gis` | govt | — | GIS map / surveillance |
| F18 | `#/govt/stock` | govt | — | Stock view |
| F19 | `#/govt/ai` | govt | — | AI prediction dashboard |
| F20 | `#/owner/herds` | owner | → redirects to `#/owner/livestock` | Legacy route preserved |
| F21 | `#/:role/herds/:id` | owner, vet, govt | `herdDetailView()` | Herd detail |
| F22 | `#/owner/herds/new` | owner | — | Create herd |
| F23 | `#/owner/animals/new` | owner | — | Add animal |
| F24 | `#/owner/report` | owner | — | Report disease (incl. voice) |
| F25 | `#/vet/reports` | vet | — | Vet reports |
| F26 | `#/vet/search` | vet | — | Vet search |
| F27 | `#/vet/vaccination/new` | vet | — | Record vaccination |
| F28 | `#/govt/trends` | govt | — | Trend analytics |
| F29 | `#/govt/blocks` | govt | — | Block-level view |
| F30 | `#/vet/advisories` | vet | — | Advisories |
| F31 | `#/govt/export` | govt | — | Data export |
| F32 | `#/notifications/settings` | any | — | Notification preferences |
| F33 | `#/govt/zoonotic` | govt | — | Zoonotic risk view |

**Frontend route count: 33.** All are hash routes on a single `index.html`.

---

## 4. Backend API Inventory (117 routes)

Legend: **A** = authenticated, **P** = public, **R** = role-restricted.

### 4.1 Infrastructure
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B001 | `/` | GET | P | Static frontend |
| B002 | `/api/health` | GET | P | Health / config probe |

### 4.2 Authentication & identity
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B003 | `/api/auth/register` | POST | P | Staff registration |
| B004 | `/api/auth/login` | POST | P | Staff (vet/govt/lab) password login |
| B005 | `/api/auth/farmer/config` | GET | P | Farmer OTP client config |
| B006 | `/api/auth/farmer/phone-start` | POST | P | Clerk phone-auth start |
| B007 | `/api/auth/farmer/clerk` | POST | P | Clerk phone-auth exchange |
| B008 | `/api/auth/farmer/request-otp` | POST | P | **Farmer OTP request** |
| B009 | `/api/auth/farmer/resend-otp` | POST | P | **Farmer OTP resend** |
| B010 | `/api/auth/farmer/verify-otp` | POST | P | **Farmer OTP verify** |
| B011 | `/api/auth/farmer/register` | POST | P | Farmer profile completion |
| B012 | `/api/users/me` | GET | A | Current user profile |

### 4.3 Herds & animals
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B013 | `/api/herds` | POST | A(owner) | Create herd |
| B014 | `/api/herds` | GET | A | List herds |
| B015 | `/api/animals` | POST | A | Add animal |
| B016 | `/api/animals` | GET | A | List animals |
| B017 | `/api/animals/<id>` | GET | A | Animal record |
| B018 | `/api/animals/<id>/qr` | GET | A | Animal QR code |
| B019 | `/api/animals/<id>/qr` | POST | A | Issue/reissue QR |
| B020 | `/api/animals/<id>/qr/revoke` | POST | A | Revoke QR |
| B021 | `/api/animals/lookup-qr` | GET | A | QR lookup |
| B022 | `/api/qr/decode` | POST | A | Decode uploaded QR image |
| B023 | `/api/animals/<id>/reproductive` | GET/POST | A | Reproductive records |
| B024 | `/api/animals/<id>/allergies` | GET/POST | A | Allergy records |
| B025 | `/api/animals/<id>/medications` | GET | A | Medication history |
| B026 | `/api/animals/<id>/deceased` | POST | A | Record animal death |

### 4.4 Cases (disease management)
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B027 | `/api/cases` | POST | A | Create disease case |
| B028 | `/api/cases` | GET | A | List cases |
| B029 | `/api/cases/<id>` | GET | A | Case detail |
| B030 | `/api/cases/<id>/visit` | POST | A(vet) | Record visit |
| B031 | `/api/cases/<id>/track` | GET | A | Case tracking / timeline |
| B032 | `/api/cases/<id>/treatment-responses` | GET/POST | A | Treatment response |
| B033 | `/api/cases/<id>/farmer-feedback` | GET/POST | A | Farmer feedback on case |

### 4.5 IVR / helpline
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B034 | `/api/ivr/info` | GET | P | Public helpline info |
| B035 | `/api/ivr/calls/inbound` | POST | **Webhook HMAC** | Inbound call |
| B036 | `/api/ivr/calls/<id>/input` | POST | **Webhook HMAC** | DTMF input |
| B037 | `/api/ivr/calls/<id>/events` | POST | **Webhook HMAC** | Call events |
| B038 | `/api/ivr/report` | POST | **Webhook HMAC** | IVR report submit |
| B039 | `/api/ivr/reports` | GET | A | List IVR reports |
| B040 | `/api/ivr/calls/<id>` | GET | A | Call session state |
| B041 | `/api/ivr/analytics` | GET | A(govt) | Helpline analytics |
| B042 | `/api/ivr/status` | GET | P | IVR status |

### 4.6 Vet
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B043 | `/api/vet/availability` | GET | A | Get availability |
| B044 | `/api/vet/reports` | GET | A(vet) | Vet reports |
| B045 | `/api/vets` | GET | A | List vets |
| B046 | `/api/vet/search` | GET | A | Search vets |
| B047 | `/api/prescriptions` | POST/GET | A | Prescriptions |
| B048 | `/api/vaccinations` | POST | A(vet) | Record vaccination |
| B049 | `/api/vet/summary` | GET | A(vet) | Vet dashboard summary |
| B050 | `/api/advisories` | GET | A | Advisories |

### 4.7 Laboratory
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B051 | `/api/samples` | POST | A | Create sample |
| B052 | `/api/samples` | GET | A | List samples |
| B053 | `/api/samples/<id>` | GET | A | Sample detail |
| B054 | `/api/samples/lookup-qr` | GET | A | Sample QR lookup |
| B055 | `/api/samples/<id>/transport` | POST | A | Transport state update |
| B056 | `/api/samples/<id>/receive` | POST | A(lab) | Receive at lab |
| B057 | `/api/samples/<id>/test` | POST | A(lab) | Start testing |
| B058 | `/api/samples/<id>/results` | POST | A(lab) | Enter results |
| B059 | `/api/lab/summary` | GET | A(lab) | Lab dashboard summary |
| B060 | `/api/lab/queue` | GET | A(lab) | Lab queue |
| B061 | `/api/lab/reports` | GET/POST | A(lab) | Lab reports |
| B062 | `/api/lab/reports/<id>/verify` | POST | A(lab) | Verify report |
| B063 | `/api/lab/requests` | POST | A | Lab test request |

### 4.8 Government / analytics / AI
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B064 | `/api/owner/summary` | GET | A(owner) | Farmer dashboard summary |
| B065 | `/api/govt/analytics` | GET | A(govt) | Govt analytics |
| B066 | `/api/govt/geo` | GET | A(govt) | Geo data |
| B067 | `/api/govt/clusters` | GET | A(govt) | DBSCAN clusters |
| B068 | `/api/govt/trends` | GET | A(govt) | Mortality/productivity trends |
| B069 | `/api/govt/export` | GET | A(govt) | Data export |
| B070 | `/api/govt/zoonotic` | GET | A(govt) | Zoonotic risk |
| B071 | `/api/govt/ai/districts` | GET | A(govt) | AI district list |
| B072 | `/api/govt/ai/predict` | GET | A(govt) | AI prediction |
| B073 | `/api/govt/ai/outbreak` | GET | A(govt) | Outbreak risk |
| B074 | `/api/govt/ai/status` | GET | A(govt) | ML service status |
| B075 | `/api/diseases` | GET | A | Disease catalogue |
| B076 | `/api/weather/<district>` | GET | A | Weather risk |
| B077 | `/api/campaigns` | GET/POST | A | Vaccination campaigns |
| B078 | `/api/farm-alerts` | GET | A | Farm alerts |
| B079 | `/api/farm-alerts/<id>/acknowledge` | POST | A | Acknowledge alert |
| B080 | `/api/farm-alerts/<id>/resolve` | POST | A | Resolve alert |
| B081 | `/api/national/surveillance` | GET | A | National surveillance |
| B082 | `/api/national/alerts` | GET/POST | A | National alerts |
| B083 | `/api/audit-logs` | GET | A | Audit log |
| B084 | `/api/animals/<id>/ai-assessment` | GET | A | Per-animal AI assessment |
| B085 | `/api/herds/<id>/intelligence` | GET | A | Herd intelligence |

### 4.9 Web calling (WebRTC + Socket.IO)
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B086 | `/api/webcall/config` | GET | A | ICE/TURN config |
| B087 | `/api/webcall/calls` | POST | A | Initiate call |
| B088 | `/api/webcall/calls/current` | GET | A | Current call |
| B089 | `/api/webcall/calls/history` | GET | A | Call history |
| B090 | `/api/webcall/calls/<id>` | GET | A | Call detail |
| B091 | `/api/webcall/calls/<id>/accept` | POST | A(vet) | Accept |
| B092 | `/api/webcall/calls/<id>/reject` | POST | A(vet) | Reject |
| B093 | `/api/webcall/calls/<id>/cancel` | POST | A | Cancel |
| B094 | `/api/webcall/calls/<id>/end` | POST | A | End |
| B095 | `/api/webcall/calls/<id>/connecting` | POST | A | State: connecting |
| B096 | `/api/webcall/calls/<id>/connected` | POST | A | State: connected |
| B097 | `/api/webcall/calls/<id>/failed` | POST | A | State: failed |
| B098 | `/api/webcall/calls/<id>/signals` | GET | A | Signal queue |
| B099 | `/api/webcall/presence` | POST | A(vet) | Presence heartbeat |
| B100 | `/api/webcall/availability` | GET | A | Availability |
| B101 | `/api/webcall/summary` | GET | A | Webcall summary |

### 4.10 Notifications, sync, admin
| # | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|
| B102 | `/api/notifications` | GET | A | Notifications list |
| B103 | `/api/sync/queue` | POST | A | Offline action sync |
| B104 | `/api/push/subscribe` | POST | A | Push subscribe |
| B105 | `/api/push/unsubscribe` | POST | A | Push unsubscribe |
| B106 | `/api/push/vapid-key` | GET | A | VAPID public key |
| B107 | `/api/admin/sms-log` | GET | A(admin) | SMS log |
| B108 | `/api/admin/sms-gateway/test` | POST | A(admin) | SMS gateway test |
| B109 | `/api/admin/otp-diagnostics` | GET | A(admin) | OTP diagnostics |

*(Remaining routes to 117 are static-serving and internal helpers; all enumerated routes above are preserved verbatim.)*

---

## 5. Form Inventory

| # | Form | Route | Key fields | Validation |
|---|---|---|---|---|
| FR01 | Role select | `#/` | role | — |
| FR02 | Staff login | `#/login/:role` | identifier, password | client + server |
| FR03 | Staff register | `#/register/:role` | name, email/mobile, password, confirm, role, district | client + server |
| FR04 | Farmer OTP mobile | `#/login/owner` | mobile (10-digit) | client + server |
| FR05 | Farmer OTP code | `#/login/owner` | 6-digit OTP, resend timer | client + server + attempt limit |
| FR06 | Farmer profile | `#/login/owner` | name, district, village | server |
| FR07 | Create herd | `#/owner/herds/new` | name, species, location | server |
| FR08 | Add animal | `#/owner/animals/new` | tag, species, breed, age, sex | server |
| FR09 | Report disease | `#/owner/report` | animal, symptoms, severity, **voice note** | server |
| FR10 | Case visit | case detail | findings, diagnosis, treatment | server |
| FR11 | Treatment response | case detail | response, notes | server |
| FR12 | Farmer feedback | case detail | rating, comment | server |
| FR13 | Prescription | case detail | drugs, dosage, duration | server |
| FR14 | Vaccination | `#/vet/vaccination/new` | vaccine, date, animal/herd | server |
| FR15 | Sample collection | lab flow | sample type, animal | server |
| FR16 | Sample results | `#/lab/samples/:id` | test results, values | server |
| FR17 | Report verify | `#/lab/samples/:id` | verification | server |
| FR18 | Reproductive record | animal record | dates, status | server |
| FR19 | Allergy record | animal record | drug class | server |
| FR20 | Campaign create | campaigns | name, dates, district | server |
| FR21 | Notification settings | `#/notifications/settings` | channel prefs | server |
| FR22 | Vet availability | vet dashboard | available/unavailable | server |

**Form submission handlers in `app.js`: 71.**

---

## 6. Tables, Charts, Modals, Uploads

| Type | Count | Location / notes |
|---|---|---|
| Data tables (`<table>`) | 3 | `app.js` — lab queue, govt trends, analytics |
| Charts (`barChart`, `pieChart`, inline SVG) | 7 | `app.js:1347` `barChart()`, `app.js:1359` `pieChart()` — rendered as **inline SVG** |
| Modals / dialogs | 4 | Campaign manage, case actions, QR, confirmation |
| File uploads | 1 | QR image upload (`#/scan`, `accept="image/*" capture="environment"`), decoded via FileReader → `/api/qr/decode` |
| QR generation | server-side | Pillow + qrcode, `/api/animals/<id>/qr` |

---

## 7. External Integrations

| Integration | Purpose | Status | Config source |
|---|---|---|---|
| **WebRTC / STUN / TURN** | Vet↔farmer web calling | Configurable | `backend/turn_config.py`, `SIH_TURN_URLS`, `SIH_TURN_USERNAME`, `SIH_TURN_CREDENTIAL` |
| **Socket.IO** | Call signalling, presence | Active | `backend/realtime.py` |
| **SMS gateway** | OTP delivery, alerts | Configurable | `backend/sms_gateway.py` |
| **IVR / Asterisk (PSTN)** | Helpline voice calls | Templates provided | `voice/asterisk/*.conf.example` |
| **Clerk** | Optional phone auth | **Optional, feature-flagged** | `backend/clerk_auth.py`, `CLERK_SECRET_KEY` |
| **ML backend** | Disease prediction, clustering | Active (separate service) | `ml-backend/`, `ML_SERVICE_URL` |
| **Web Push (VAPID)** | Browser notifications | Configurable | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| **Leaflet CDN** | Maps | Active | `unpkg.com` |
| **Transformers.js / Whisper** | On-device voice→text | Active (WASM, local) | `frontend/models/`, `frontend/wasm/` |
| **Open-Meteo weather** | Weather risk | Active | `backend/weather.py` |
| **India Portal / DigiLocker / Aadhaar / SSO / MyGov / MyScheme / MeriPehchaan** | GIGW 3.0 Q22 | **NOT CONFIGURED** | Owner action |

---

## 8. Authentication Flows

| Flow | Steps | Notes |
|---|---|---|
| **Farmer OTP** | enter mobile → `request-otp` → receive SMS → enter 6-digit code → `verify-otp` → (new user) profile step → JWT | Mobile-only identity; **no password**. Resend cooldown + attempt limits. Offline queue disabled for OTP calls. OTP/phone never written to `localStorage`. |
| **Staff password** | identifier (email or mobile) + password → JWT | Roles vet/govt/lab |
| **Clerk phone** | optional, feature-flagged | Only used when configured |
| **Demo farmer** | prototype convenience, **off by default** | `demo_auth.py` logs a loud banner when enabled |

**Session:** JWT HS256, `TOKEN_EXP_HOURS = 12`, signed with `SIH_SECRET_KEY`.

---

## 9. Languages

**Supported:** English (`en`), Telugu (`te`), Hindi (`hi`), Marathi (`mr`).
Declared in `backend/ivr_config.py` (`SUPPORTED_LANGUAGES`, `LANGUAGE_NAMES`).
Frontend strings resolved via `t()` / `ft()` in `app.js`.

---

## 10. Notifications

| Channel | Mechanism | Notes |
|---|---|---|
| In-app | `/api/notifications` | Polled list view |
| Web Push | VAPID / `push_service.py` | Fires when vet portal not in foreground |
| SMS | `sms_service.py` | Urgent alerts (`send_sms_urgent`) |

---

## 11. Existing Test Coverage

| Suite | File | Tests | Baseline result |
|---|---|---|---|
| Regression | `backend/test_regression.py` | 10 | PASS |
| Role auth | `backend/test_role_auth.py` | 30 | PASS |
| Farmer OTP login | `backend/test_farmer_otp_login.py` | 60 | PASS |
| Web calling | `backend/test_webcalling.py` | 66 | PASS |
| Demo account | `backend/test_demo_account.py` | 34 | PASS |
| Clerk login | `backend/test_clerk_login.py` | 15 | PASS |
| Helpline / IVR | `backend/test_helpline.py` | 34 | PASS (requires env — see baseline) |
| All features | `backend/test_all_features.py` | 12 | PASS |
| ML service | `backend/test_ml_service.py` | 16 | PASS (4 skipped) |
| **Frontend OTP UI** | `frontend/tests/otp_login_ui.test.mjs` | — | PASS |
| **Frontend demo UI** | `frontend/tests/demo_account_ui.test.mjs` | — | PASS |
| **Frontend web call UI** | `frontend/tests/webcall_ui.test.mjs` | — | PASS |
| **Frontend web call browser** | `frontend/tests/webcall_browser.test.mjs` | — | PASS |
| **Deploy check** | `backend/tests/deploy/deploy_check.mjs` | — | manual |
| **WebRTC 2-peer** | `backend/tests/webrtc/two_peer_call.mjs` | — | manual |
| **TURN ephemeral** | `backend/tests/webrtc/local_turn_ephemeral.mjs` | — | manual |

---

## 12. Verification Method Legend

| Code | Method |
|---|---|
| **AT** | Automated test (existing suite) |
| **MT** | Manual test (browser walkthrough) |
| **KB** | Keyboard-only test |
| **SR** | Screen-reader test |
| **AL** | Automated accessibility scan (axe-core / pa11y) |
| **RS** | Responsive check at 320/360/375/390/414/480/768/1024/1280/1440 |
| **SC** | Security check (headers / input validation / authz) |
| **NEX** | **NOT EXECUTED** — environment limitation |
