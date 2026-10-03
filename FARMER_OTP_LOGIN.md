# Farmer OTP login (mobile number + SMS OTP)

Farmers (`role = owner`) now sign in with their **registered mobile number** and a
**six-digit OTP delivered by SMS** through the installed
[Android SMS Gateway™ (capcom6)](https://github.com/capcom6/android-sms-gateway)
app running in **Cloud Server** mode.

Veterinarian, Government and Laboratory logins continue to use the existing
password flow, and every existing farmer account, animal, herd, case,
prescription, lab report and notification is untouched.

> **Update — role-specific authentication restored.**
> Farmer authentication is now **OTP-only with no password fallback**: the
> `FARMER_PASSWORD_FALLBACK` environment variable, the `#/login/owner/password`
> screen and the farmer password login/registration routes have been removed
> (farmers get `403 FARMER_OTP_REQUIRED` / `FARMER_OTP_SIGNUP_REQUIRED`).
> Farmers can also **create their profile** through the same OTP flow
> (`POST /api/auth/farmer/register` after `verify-otp` returns
> `registration_required: true`). Vet / Government / Laboratory authentication
> is unchanged. See [`AUTH_ROLES_RESTORED.md`](AUTH_ROLES_RESTORED.md) for the
> change report; the sections below that mention a password fallback describe
> the earlier release and are kept for the delivery/rollback history.

---

## 1. What changed

| Layer | File | Change |
|---|---|---|
| SMS gateway client | `backend/sms_gateway.py` *(new)* | Official capcom6 Cloud/Local Server REST client: Basic auth, documented `textMessage.text` + `phoneNumbers` payload, connect/read timeouts, URL normalisation, message-status and device-listing helpers, structured error categories, safe error mapping, no credential/OTP logging |
| OTP service | `backend/otp_service.py` *(new)* | CSPRNG six-digit codes, salted + peppered PBKDF2 hashes, 5-minute expiry, 5 attempts, single-use atomic consumption, 60-second resend cooldown, per-mobile / per-IP / per-mobile-failure rate limits, anti-enumeration responses |
| Database | `backend/database.py` | Additive `otp_codes` + `otp_request_log` tables and indexes (`ensure_otp_tables`, part of `SCHEMA`), plus additive gateway-diagnostics columns (message id/state, HTTP status, error category, pepper fingerprint) |
| API | `backend/app.py` | `GET /api/auth/farmer/config`, `POST /api/auth/farmer/request-otp`, `POST /api/auth/farmer/resend-otp`, `POST /api/auth/farmer/verify-otp`, `POST /api/admin/sms-gateway/test`, `GET /api/admin/otp-diagnostics`; `/api/health` and `/api/admin/sms-log` now report secret-free gateway status |
| Notification SMS | `backend/sms_service.py` | Optional `SMS_PROVIDER_MODE=GATEWAY` adapter that routes the existing notification queue through the same gateway (opt-in; default behaviour unchanged) |
| Phone normalisation | `backend/ivr_config.py` | `normalize_indian_number` also accepts the national `0`-prefixed form (`09800000001`) |
| Farmer login UI | `frontend/app.js`, `frontend/style.css` | Mobile-number OTP screen (send → verify → resend countdown → change number), loading/success/error states, localisation for English / मराठी / हिन्दी / తెలుగు; password form kept as a fallback route `#/login/owner/password` |
| Offline cache | `frontend/sw.js` | Service-worker cache bumped to `pashumitra-v2` so farmers receive the new bundle |
| Tests | `backend/test_farmer_otp_login.py`, `frontend/tests/otp_login_ui.test.mjs` | Backend flow/security tests and frontend UI-contract tests |
| Config | `.env.example`, `render.yaml`, `.gitignore` | New environment variables, no secrets in Git |

No ML code, ML models, or unrelated dashboard screens were modified.

---

## 2. API

### `POST /api/auth/farmer/request-otp`
```json
{ "mobile": "9800000001" }
```
`200` (identical body for registered and unknown numbers — no account enumeration):
```json
{
  "ok": true,
  "message": "If this mobile number is registered, an OTP has been sent. It is valid for 5 minutes.",
  "delivery_confirmed": false,
  "expires_in": 300,
  "resend_after": 60
}
```
`delivery_confirmed` is always `false`: the endpoint reports that the *request
was accepted*. When the number belongs to a farmer the SMS is submitted to the
gateway; when it does not, no SMS is dispatched at all — the response is the
same on purpose (no account enumeration) and the UI uses the same conditional
wording, so a delivery is never claimed without evidence.

Errors: `400 INVALID_MOBILE`, `429 COOLDOWN_ACTIVE` / `RATE_LIMITED` (with
`retry_after`), `502 SMS_GATEWAY_UNAVAILABLE` / `SMS_GATEWAY_AUTH_FAILED` /
`SMS_GATEWAY_REJECTED`, `503 SMS_GATEWAY_NOT_CONFIGURED` /
`OTP_PEPPER_UNSTABLE` (a stable `OTP_PEPPER` is missing in production, which
would make every issued code unverifiable).

### `POST /api/auth/farmer/resend-otp`
Same contract; always enforces the 60-second cooldown.

### `POST /api/auth/farmer/verify-otp`
```json
{ "mobile": "9800000001", "otp": "123456" }
```
`200` with exactly the existing password-login shape:
```json
{ "token": "<JWT HS256>", "user": { "id": 1, "role": "owner", ... }, "login_method": "otp" }
```
Errors: `400 INVALID_MOBILE` / `INVALID_OTP_FORMAT`, `401 OTP_INVALID` /
`OTP_EXPIRED` / `OTP_ALREADY_USED`, `429 OTP_LOCKED` / `RATE_LIMITED`.

### `GET /api/auth/farmer/config`
Public, non-secret UI settings: `otp_login_enabled`, `otp_length`,
`otp_ttl_seconds`, `resend_cooldown_seconds`, `max_attempts`,
`password_login_enabled` (always `false`), `signup_enabled`, `helpline`.

### `POST /api/admin/sms-gateway/test` (role `govt`)
Sends one **fixed-text** test SMS so a deployment team can verify real delivery
without exposing OTPs. Body `{"mobile": "…"}`. The response reports the raw
gateway HTTP status, the queued message id/state and an immediate
`status_check` (`Pending` → `Processed` → `Sent` → `Delivered`/`Failed`):
`accepted: true` means *queued*, never delivered.

### `GET /api/admin/otp-diagnostics?mobile=…&live=1&events=5`
Access: a `govt` JWT **or** the `X-Diag-Token` header matching `OTP_DIAG_TOKEN`
(falls back to `IVR_WEBHOOK_SECRET`). Returns a secret-free trace of the OTP
flow: pepper source/stability/fingerprint match, database path/mount
configuration, whether the mobile is a registered farmer, the latest OTP row
(status, attempts, expiry, age, gateway mode/state/message id/HTTP status,
send-error code/category), the last events, and — with `live=1` — the gateway
device list and the real message state. `findings` turns that into
plain-language causes (no OTP row, rotated pepper, send failure, no device,
message still `Pending`, …). No OTP, hash, credential or full phone number is
ever returned.

The OTP value is never returned by any endpoint, never written to a log, and
never stored in `localStorage` — verification state lives only in SQLite.

---

## 3. Android SMS Gateway integration

Verified against the official documentation
(<https://docs.sms-gate.app/getting-started/public-cloud-server/>,
<https://docs.sms-gate.app/features/sending-messages/>):

```
POST https://api.sms-gate.app/3rdparty/v1/messages
Authorization: Basic <username>:<password>
Content-Type: application/json

{
  "textMessage": { "text": "PashuMitra: 123456 is your login OTP. ..." },
  "phoneNumbers": ["+919800000001"],
  "deviceId": "…"            // only when SMS_GATEWAY_DEVICE_ID is set
}
```

* 200/201/202 → the gateway **queued** the message; `id`/`state` (and the raw
  HTTP status) are stored on the OTP row and logged. Queued is *not* delivered:
  the documented lifecycle is `Pending` → `Processed` → `Sent` →
  `Delivered`/`Failed`, and a message stays `Pending` until a handset picks it
  up (the public cloud server rejects messages still pending after 24 h). Use
  `GET /3rdparty/v1/messages/{id}` (admin diagnostics `live=1`, or
  `sms_gateway.get_message_status`) to obtain delivery evidence — the app never
  guesses `Delivered`.
* A 2xx that already carries a terminal `Failed` state is treated as a
  rejection, never as success.
* 401/403 → `SMS_GATEWAY_AUTH_FAILED`, 429 → `SMS_GATEWAY_UNAVAILABLE`
  (`RATE_LIMIT`), 503 + `QueueLimitExceeded` → `SMS_GATEWAY_UNAVAILABLE`
  (`QUEUE_LIMIT`), other 5xx → `SMS_GATEWAY_UNAVAILABLE` (`SERVER`), 400 →
  `SMS_GATEWAY_REJECTED` (`INVALID_REQUEST`). Each error carries a stable
  `code`, a coarse `category`, the raw gateway HTTP status and a *scrubbed*
  remote reason — never the message body, credentials or full number.
* Requests use `SMS_GATEWAY_TIMEOUT` (read, default 15 s) and
  `SMS_GATEWAY_CONNECT_TIMEOUT` (default 5 s). Optional documented fields
  (`simNumber`, `ttl`, `priority`) are only sent when configured; nothing is
  invented.
* Device routing: with `SMS_GATEWAY_DEVICE_ID` unset the cloud server picks a
  device **at random from the account**, so an old handset can take the
  dispatch. Set `SMS_GATEWAY_DEVICE_ID` to the OTP handset (list the account's
  devices with `GET /3rdparty/v1/devices`).
* For LAN mode, set `SMS_GATEWAY_BASE_URL=http://<device-ip>:8080` (the client
  then posts to the documented `/message` path) and
  `SMS_GATEWAY_ALLOW_INSECURE=true`.
* `SMS_GATEWAY_MODE=MOCK` simulates delivery for local development **only** and is
  refused when the process is production (`RENDER=true` or `FLASK_ENV=production`)
  unless `SMS_GATEWAY_ALLOW_MOCK=true` is set deliberately. MOCK is never reported
  as a real delivery (`delivered=false`).

Credentials are read from the environment only — never returned by an API, logged,
placed in the frontend bundle, or committed.

---

## 4. OTP security controls

| Control | Implementation |
|---|---|
| Code generation | `secrets.randbelow(10**6)`, zero-padded to six digits (uniform) |
| Storage | `PBKDF2-HMAC-SHA256(code, pepper ‖ per-row salt, 50 000 iterations)` — plaintext is never stored |
| Expiry | 5 minutes (`OTP_TTL_SECONDS`), enforced server side; expired rows are marked `EXPIRED` |
| Attempts | 5 per OTP (`OTP_MAX_ATTEMPTS`), then the OTP is `LOCKED` and even the correct code is refused |
| Resend cooldown | 60 seconds (`OTP_RESEND_COOLDOWN_SECONDS`), reported as `retry_after` |
| Rate limits | per mobile 5 requests / 15 min, per client IP 20 requests / hour, per mobile 10 failed verifications / 15 min |
| Single use | `UPDATE otp_codes SET status='USED' … WHERE id=? AND status='ACTIVE'` with a `rowcount == 1` check — two concurrent verifies can never both succeed |
| Supersede | Issuing a new OTP marks all earlier `ACTIVE` OTPs for that account `INVALIDATED` |
| Enumeration | Unknown numbers, unregistered numbers and non-farmer (vet/govt/lab) numbers all receive the same `200` body and no SMS; verification failures return the same generic codes |
| Role safety | Only `role='owner'` rows are ever issued an OTP; a defensive role check runs again after verification |
| State | Server side only (SQLite); the browser keeps no OTP state |
| Logging | Codes and full phone numbers never appear in logs (tested); phone numbers are masked in audit events |
| Audit | `OTP_REQUESTED`, `OTP_RESENT`, `OTP_VERIFY_FAILED`, `OTP_ROLE_REJECTED`, `LOGIN` (method `otp`) are written to `audit_events` with masked numbers |

Residual, documented risks: (a) response timing differs slightly between
registered and unknown numbers; (b) the OTP is sent as plain SMS (carrier/handset
exposure is inherent to SMS OTP); (c) `MOCK` mode does not deliver anything — it
exists for local development only.

---

## 5. Environment variables (Render → backend service)

| Variable | Required | Value / notes |
|---|---|---|
| `SMS_GATEWAY_MODE` | yes | `CLOUD` |
| `SMS_GATEWAY_CONNECT_TIMEOUT` | no | Default `5` s (TCP connect) |
| `SMS_GATEWAY_TTL_SECONDS` / `SMS_GATEWAY_PRIORITY` | recommended | `300` / `100` for OTPs (drop stale codes, bypass device rate limits) |
| `OTP_DIAG_TOKEN` | recommended | Shared secret for `GET /api/admin/otp-diagnostics` |
| `SMS_GATEWAY_BASE_URL` | yes | `https://api.sms-gate.app/3rdparty/v1` |
| `SMS_GATEWAY_USERNAME` | yes | Cloud Server credentials shown in the Android app |
| `SMS_GATEWAY_PASSWORD` | yes | (secret, `sync: false`) |
| `SMS_GATEWAY_DEVICE_ID` | recommended | Pin the handset that sends OTPs (otherwise the cloud chooses randomly) |
| `SMS_GATEWAY_TIMEOUT` | no | Default `15` seconds |
| `SMS_GATEWAY_SIM_NUMBER` / `SMS_GATEWAY_TTL_SECONDS` / `SMS_GATEWAY_PRIORITY` | no | Omitted from the request when blank |
| `SMS_GATEWAY_ALLOW_INSECURE` | no | `true` only for a trusted-LAN `http://` local server |
| `SMS_GATEWAY_ALLOW_MOCK` | no | Keep unset/`false` in production |
| `OTP_PEPPER` | yes | Random secret for OTP hashing (Render `generateValue: true`) |
| `OTP_TTL_SECONDS` | no | Default `300` |
| `OTP_MAX_ATTEMPTS` | no | Default `5` |
| `OTP_RESEND_COOLDOWN_SECONDS` | no | Default `60` |
| `OTP_MOBILE_MAX_REQUESTS` / `OTP_MOBILE_RATE_WINDOW_SECONDS` | no | Defaults `5` / `900` |
| `OTP_IP_MAX_REQUESTS` / `OTP_IP_RATE_WINDOW_SECONDS` | no | Defaults `20` / `3600` |
| `OTP_DEV_PRINT_CODE` | no | Dev only; prints MOCK OTPs to the server log. Ignored in production |
| ~~`FARMER_PASSWORD_FALLBACK`~~ | — | **Removed.** Farmer auth is OTP-only; staff keep password login |
| `OTP_REGISTRATION_TOKEN_TTL_SECONDS` | no | Lifetime of the OTP-verified farmer signup token (default `900`) |
| `SMS_PROVIDER_MODE` | no | Existing notification queue: `MOCK` (default) / `TWILIO` / `GATEWAY` |

No Vercel change is needed: `/api/*` already rewrites to the Render backend, and
the new routes live under that prefix.

---

## 6. Database change and rollback

Migration is additive and idempotent — it runs automatically when the app boots
(`init_db()` → `ensure_otp_tables`) and creates only:

* `otp_codes` — issued OTPs (hash, salt, attempts, status, expiry, purpose);
* `otp_request_log` — rate-limiting/audit trail.

No existing table, column, row, ID, or relationship is altered. Rows older than
7 days are pruned opportunistically.

Manual pre-migration check / backup (Render shell):

```bash
sqlite3 /var/data/animal_health.db ".backup /var/data/animal_health.db.bak-$(date +%F)"
```

Rollback:

1. **Code rollback** — redeploy the previous revision. The extra tables are
   ignored by the old code, so nothing breaks. To remove them explicitly:
   ```sql
   DROP TABLE IF EXISTS otp_request_log;
   DROP TABLE IF EXISTS otp_codes;
   ```
2. **UI rollback** — there is no farmer password screen any more. The only
   farmer entry point is `#/login/owner` (mobile OTP); if the gateway is down,
   fix `SMS_GATEWAY_*` / `OTP_PEPPER` and reload. Existing farmer passwords were
   deliberately left in the database (never read) so a future decision to
   re-enable password login would not require a migration.
3. **Gateway rollback** — set `SMS_GATEWAY_MODE=DISABLED`; OTP endpoints then
   return `503` with the fallback flag instead of pretending to send.

---

## 7. Deployment steps

1. In the Android SMS Gateway app: enable **Cloud Server**, tap **Online**, and
   copy the Basic-auth username/password. Keep the app running (FCM/SSE or the
   15-minute polling fallback) and grant the SMS permission.
2. In the Render dashboard → `pashu-shield-backend` → Environment, add
   `SMS_GATEWAY_MODE=CLOUD`, `SMS_GATEWAY_BASE_URL=https://api.sms-gate.app/3rdparty/v1`,
   `SMS_GATEWAY_USERNAME`, `SMS_GATEWAY_PASSWORD`, and confirm `OTP_PEPPER` exists
   (`render.yaml` generates it; if it was already deployed without it, add a
   random 32+ character value) — without a stable pepper every issued OTP is
   unverifiable and OTP login is refused with `OTP_PEPPER_UNSTABLE`.
   Also confirm `SIH_DB_PATH=/var/data/animal_health.db` and that the Render
   disk is attached: on an ephemeral path the SQLite file (and every in-flight
   OTP) is wiped on each deploy/restart.
3. Pin the OTP handset:
   ```bash
   curl -s -u "$SMS_GATEWAY_USERNAME:$SMS_GATEWAY_PASSWORD" \
     https://api.sms-gate.app/3rdparty/v1/devices | jq
   # copy the "id" of the phone that must send the OTPs
   ```
   and set `SMS_GATEWAY_DEVICE_ID` to it (recommended: `SMS_GATEWAY_TTL_SECONDS=300`,
   `SMS_GATEWAY_PRIORITY=100`).
3. Deploy the branch (`main` after merge). `render.yaml` also carries the new keys
   for blueprint-based deploys; secrets stay `sync: false`.
4. Deploy, then verify configuration and delivery evidence:
   ```bash
   curl -s https://pashu-shield-backend-hjgr.onrender.com/api/health | jq '.sms_gateway, .farmer_otp_login'
   # → mode CLOUD, usable true, pepper_stable true, persistent_mount_configured true

   curl -s https://pashu-shield-backend-hjgr.onrender.com/api/auth/farmer/config | jq

   # Trace one real attempt (registered farmer mobile):
   curl -s "https://pashu-shield-backend-hjgr.onrender.com/api/admin/otp-diagnostics?mobile=<10-digit>&live=1" \
     -H "X-Diag-Token: $OTP_DIAG_TOKEN" | jq '.findings, .latest_otp, .live_checks'
   # → findings name the exact cause; latest_otp.gateway_state must move
   #   Pending → Sent/Delivered for a real delivery.
   ```
5. Government-only real delivery test:
   ```bash
   curl -s -X POST .../api/admin/sms-gateway/test \
     -H "Authorization: Bearer <govt-token>" -H 'Content-Type: application/json' \
     -d '{"mobile":"<your test handset>"}'
   ```
   `accepted: true` means the gateway queued the SMS for a handset; the returned
   `status_check.state` (`Pending`/`Processed`/`Sent`/`Delivered`/`Failed`) is
   the evidence. There is no "delivered" claim on acceptance.
6. End-to-end farmer login: open
   `https://pashu-mitra-smoky.vercel.app/#/login/owner`, enter a registered farmer
   mobile (seeded demo: `9800000001`), receive the SMS, enter the code, confirm
   the farmer dashboard loads with the existing animals/cases.
7. (No fallback flag to disable — farmer auth is OTP-only by design.)

---

## 8. Tests

```bash
cd backend
../backend/.venv/bin/python -m unittest test_farmer_otp_login -v   # 60 tests
../backend/.venv/bin/python -m unittest test_regression test_all_features -v

cd ../   # repository root
node --test frontend/tests/otp_login_ui.test.mjs                  # 11 UI tests
node --check frontend/app.js && node --check frontend/sw.js
```

The OTP suite stubs the SMS gateway at the HTTP boundary (the real client still
builds the request, so the endpoint, Basic auth, payload and timeout are
covered) and asserts: valid OTP login, incorrect/replayed/expired/locked OTP,
attempt limits, cooldown, resend, per-mobile and per-IP rate limits, gateway
auth/server/rate-limit/queue-limit/validation failures (each must return
502/503 and retire the row as `SEND_FAILED` — never `200`), queued-message
evidence (message id/state/HTTP status recorded, `delivery_confirmed: false`),
unknown numbers and other roles, no plaintext storage, single-use consumption,
pepper-rotation diagnosis (`pepper_mismatch`), mobile-number normalisation
equivalence, production refusal of an ephemeral pepper, the guarded
diagnostics endpoint, the additive schema migration, log redaction and
config/health secrecy, plus preservation of Vet/Govt/Lab password login and
farmer livestock/case access.

**Real SMS delivery has not been verified from this environment** — no gateway
credentials or Android handset were available. Step 4/5 above is the pending
external verification.

---

## 9. Local development

```bash
cd backend
SMS_GATEWAY_MODE=MOCK OTP_DEV_PRINT_CODE=true SIH_SECRET_KEY=dev \
  .venv/bin/python app.py
```
With `OTP_DEV_PRINT_CODE=true` the mock OTP is printed to the console (never in
production) so the flow can be exercised without a handset. `curl` example:

```bash
curl -s -X POST http://127.0.0.1:5001/api/auth/farmer/request-otp \
  -H 'Content-Type: application/json' -d '{"mobile":"9800000001"}'
curl -s -X POST http://127.0.0.1:5001/api/auth/farmer/verify-otp \
  -H 'Content-Type: application/json' -d '{"mobile":"9800000001","otp":"<from log>"}'
```

---

## 10. Prototype demo account (fixed OTP)

For demonstrations that must not depend on real SMS delivery, the farmer login
screen can show a **Demo Account** box (`9999999999` / `123456`). It is gated
behind an explicit `DEMO_MODE` flag that ships as `false`, reuses the ordinary
OTP row, JWT and role claims, and covers the farmer role only.

See **[DEMO_ACCOUNT.md](DEMO_ACCOUNT.md)** for how to enable it on a prototype
deployment and how to disable it before public production use.
