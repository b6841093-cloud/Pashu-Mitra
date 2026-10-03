# Farmer OTP login (mobile number + SMS OTP)

Farmers (`role = owner`) now sign in with their **registered mobile number** and a
**six-digit OTP delivered by SMS** through the installed
[Android SMS Gateway™ (capcom6)](https://github.com/capcom6/android-sms-gateway)
app running in **Cloud Server** mode.

Veterinarian, Government and Laboratory logins continue to use the existing
password flow, and every existing farmer account, animal, herd, case,
prescription, lab report and notification is untouched.

---

## 1. What changed

| Layer | File | Change |
|---|---|---|
| SMS gateway client | `backend/sms_gateway.py` *(new)* | Official capcom6 Cloud/Local Server REST client: Basic auth, documented `textMessage.text` + `phoneNumbers` payload, timeout, safe error mapping, no credential/OTP logging |
| OTP service | `backend/otp_service.py` *(new)* | CSPRNG six-digit codes, salted + peppered PBKDF2 hashes, 5-minute expiry, 5 attempts, single-use atomic consumption, 60-second resend cooldown, per-mobile / per-IP / per-mobile-failure rate limits, anti-enumeration responses |
| Database | `backend/database.py` | Additive `otp_codes` + `otp_request_log` tables and indexes (`ensure_otp_tables`, part of `SCHEMA`) |
| API | `backend/app.py` | `GET /api/auth/farmer/config`, `POST /api/auth/farmer/request-otp`, `POST /api/auth/farmer/resend-otp`, `POST /api/auth/farmer/verify-otp`, `POST /api/admin/sms-gateway/test`; `/api/health` and `/api/admin/sms-log` now report secret-free gateway status |
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
  "message": "If this mobile number is registered, an OTP has been sent.",
  "expires_in": 300,
  "resend_after": 60
}
```
Errors: `400 INVALID_MOBILE`, `429 COOLDOWN_ACTIVE` / `RATE_LIMITED` (with
`retry_after`), `502 SMS_GATEWAY_UNAVAILABLE` / `SMS_GATEWAY_AUTH_FAILED` /
`SMS_GATEWAY_REJECTED`, `503 SMS_GATEWAY_NOT_CONFIGURED`.

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
`password_fallback_enabled`.

### `POST /api/admin/sms-gateway/test` (role `govt`)
Sends one **fixed-text** test SMS so a deployment team can verify real delivery
without exposing OTPs. Body `{"mobile": "…"}`.

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

* 200/201/202 → the gateway accepted (queued) the message; `id`/`state` are read
  from the response and logged.
* 401/403 → `SMS_GATEWAY_AUTH_FAILED`, 429/5xx → `SMS_GATEWAY_UNAVAILABLE`
  (retryable), other 4xx → `SMS_GATEWAY_REJECTED`. The scrubbed remote reason is
  logged, never the message body.
* Requests use `SMS_GATEWAY_TIMEOUT` (default 15 s). Optional documented fields
  (`simNumber`, `ttl`, `priority`) are only sent when configured; nothing is
  invented.
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
| `SMS_GATEWAY_BASE_URL` | yes | `https://api.sms-gate.app/3rdparty/v1` |
| `SMS_GATEWAY_USERNAME` | yes | Cloud Server credentials shown in the Android app |
| `SMS_GATEWAY_PASSWORD` | yes | (secret, `sync: false`) |
| `SMS_GATEWAY_DEVICE_ID` | no | Only if messages must go to one specific handset |
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
| `FARMER_PASSWORD_FALLBACK` | no | Default `true`; set `false` for OTP-only farmer login |
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
2. **UI rollback** — set `FARMER_PASSWORD_FALLBACK=true` (default) and share
   `https://pashu-mitra-smoky.vercel.app/#/login/owner/password`; farmers can log
   in with their existing passwords immediately.
3. **Gateway rollback** — set `SMS_GATEWAY_MODE=DISABLED`; OTP endpoints then
   return `503` with the fallback flag instead of pretending to send.

---

## 7. Deployment steps

1. In the Android SMS Gateway app: enable **Cloud Server**, tap **Online**, and
   copy the Basic-auth username/password.
2. In the Render dashboard → `pashu-shield-backend` → Environment, add
   `SMS_GATEWAY_MODE=CLOUD`, `SMS_GATEWAY_BASE_URL=https://api.sms-gate.app/3rdparty/v1`,
   `SMS_GATEWAY_USERNAME`, `SMS_GATEWAY_PASSWORD`, and confirm `OTP_PEPPER` exists
   (`render.yaml` generates it; if it was already deployed without it, add a
   random 32+ character value).
3. Deploy the branch (`main` after merge). `render.yaml` also carries the new keys
   for blueprint-based deploys; secrets stay `sync: false`.
4. Verify configuration and delivery:
   ```bash
   curl -s https://pashu-shield-backend-hjgr.onrender.com/api/health | jq .sms_gateway
   # → {"mode":"CLOUD","configured":true,"usable":true}

   curl -s https://pashu-shield-backend-hjgr.onrender.com/api/auth/farmer/config | jq
   ```
5. Government-only real delivery test:
   ```bash
   curl -s -X POST .../api/admin/sms-gateway/test \
     -H "Authorization: Bearer <govt-token>" -H 'Content-Type: application/json' \
     -d '{"mobile":"<your test handset>"}'
   ```
   `delivered: true` means the gateway queued the SMS for the Android device.
6. End-to-end farmer login: open
   `https://pashu-mitra-smoky.vercel.app/#/login/owner`, enter a registered farmer
   mobile (seeded demo: `9800000001`), receive the SMS, enter the code, confirm
   the farmer dashboard loads with the existing animals/cases.
7. Optionally set `FARMER_PASSWORD_FALLBACK=false` once OTP delivery is proven.

---

## 8. Tests

```bash
cd backend
../backend/.venv/bin/python -m unittest test_farmer_otp_login -v   # 43 tests
../backend/.venv/bin/python -m unittest test_regression test_all_features -v

cd ../   # repository root
node --test frontend/tests/otp_login_ui.test.mjs                  # 8 UI tests
node --check frontend/app.js && node --check frontend/sw.js
```

The OTP suite stubs the SMS gateway and covers: valid OTP, incorrect OTP,
malformed OTP, expired OTP, replayed OTP, attempt limit/lock, cooldown, resend,
per-mobile and per-IP rate limits, gateway unavailability/auth failure/not
configured, unknown numbers, other roles, no plaintext storage, single-use
consumption, log redaction, config/health secrecy, and preservation of
Vet/Govt/Lab password login plus farmer livestock/case access.

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
