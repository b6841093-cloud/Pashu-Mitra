# Farmer OTP delivery & verification failure — diagnosis, fixes and deployment

**Incident:** production farmer OTP login — `GET /api/auth/farmer/config` → 200,
`POST /api/auth/farmer/request-otp` → 200, no SMS received, then
`POST /api/auth/farmer/verify-otp` → 401.

**Backend:** `https://pashu-shield-backend-hjgr.onrender.com` ·
**Frontend:** `https://pashu-mitra-smoky.vercel.app`

---

## 1. TL;DR

Two independent defects, both in the gap between *"the gateway queued something"*
and *"the farmer is logged in"*:

1. **Delivery was never verified — and the UI claimed it anyway.**
   `request-otp` correctly returned 502/503 when the gateway *rejected* a
   message, but a **200 only means "accepted by the request handler"**. It is
   also the response for a number that is *not a registered farmer* (no SMS is
   dispatched at all — deliberately, to prevent account enumeration) and for a
   message the gateway merely **queued** (`state: "Pending"`, which the Android
   handset may never send). Nothing recorded the gateway message id/state, so no
   one could tell which had happened, while the farmer UI printed
   *"OTP sent to +91 …"* unconditionally.
2. **The 401 had no instrumentation.** `verify-otp` collapsed every cause
   (no row, wrong code, expired, locked, superseded, send-failed, rotated
   pepper) into a generic `OTP_INVALID`/`OTP_EXPIRED` with no reason code, no
   gateway metadata on the row and no way to see whether the number was even a
   registered farmer. A rotated or per-process pepper — which makes *every*
   valid OTP fail — looked exactly like a mistyped code.

Both legs are now instrumented end-to-end, the misleading UI copy is gone, and a
single protected call (`GET /api/admin/otp-diagnostics?mobile=…&live=1`) reports
the exact cause for a given number, including the gateway's real message state.

> **Evidence limit (stated honestly):** this sandbox has no outbound network
> access to either Render or `api.sms-gate.app` (TLS connections are refused), so
> *the single production cause could not be read directly from here*. Everything
> below is derived from the repository code, the official gateway contract and
> the four log lines you supplied; §6 is the one-command check that closes it.

---

## 2. Requirement 1 — does request-OTP report false success?

**Before:** *no for gateway failures, yes for everything else.*

| Situation | Old behaviour | Verdict |
|---|---|---|
| Gateway HTTP 401/403/429/5xx/4xx | `OtpError` → **502/503**, OTP row retired as `SEND_FAILED`, no OTP in the response | correct |
| Gateway timeout / connection error | **502** (`SMS_GATEWAY_UNAVAILABLE`) | correct |
| Gateway 2xx with `state: "Failed"` | **200** — reported as accepted | **fixed**: now a rejection |
| Mobile not a registered farmer | **200** + UI says *"OTP sent to +91 …"* — no SMS was ever dispatched | **fixed**: neutral wording + `delivery_confirmed: false` + audit/log evidence |
| Gateway queued the SMS (`Pending`) | **200** + UI says *"OTP sent to +91 …"* | **fixed**: wording is conditional; the message id/state are stored and can be polled |
| MOCK mode | refused in production; in dev returned `simulated: true` but the UI still said "sent" | **fixed**: wording is conditional; health/diagnostics report the mode |

So: the route did **not** turn gateway *errors* into success, but it did return a
200 that the UI rendered as a delivery claim in cases where nothing (or nothing
provable) was sent. That is the "OTP was sent but no SMS arrived" experience.

## 3. Requirement 2 — gateway contract audit

Checked against the official documentation
([cloud server](https://docs.sms-gate.app/getting-started/public-cloud-server/),
[sending messages](https://docs.sms-gate.app/features/sending-messages/),
[status tracking](https://docs.sms-gate.app/features/status-tracking/),
[multi-device](https://docs.sms-gate.app/features/multi-device/)).

| Item | Official contract | Project implementation | Status |
|---|---|---|---|
| URL (cloud) | `POST https://api.sms-gate.app/3rdparty/v1/messages` | same; **new:** any base-URL shape (`https://api.sms-gate.app`, `…/3rdparty/v1`, `…/3rdparty/v1/messages`) is normalised to the canonical URL | ✅ / fixed |
| URL (LAN local server) | `POST http://<device-ip>:8080/message` | detected from the URL (LAN/local hosts → `/message`); `SMS_GATEWAY_ALLOW_INSECURE=true` still required in CLOUD mode | ✅ |
| Basic auth | `Authorization: Basic <user>:<pass>` | `requests` `auth=(user, password)` (never logged, never in URLs) | ✅ |
| Body | `{"textMessage":{"text":…},"phoneNumbers":[…]}` + optional `deviceId`, `simNumber`, `ttl`, `priority` | identical; optional fields only sent when configured; legacy `{"message":…}` shape not used | ✅ |
| Timeouts | — | **new:** `(connect, read)` tuple; `SMS_GATEWAY_TIMEOUT` (15 s) + `SMS_GATEWAY_CONNECT_TIMEOUT` (5 s) | improved |
| Response parsing | 2xx = queued (`id`, `state`); states `Pending → Processed → Sent → Delivered/Failed`; `GET /3rdparty/v1/messages/{id}` for status; `GET /3rdparty/v1/devices` for devices | **new:** parses dict/list, treats a 2xx `Failed` as rejection, stores `id`/`state`/HTTP status, adds `get_message_status()` and `list_devices()` (whitelisted, credential-free) | improved |
| Device ID | optional; **omitted ⇒ the server routes randomly across all devices of the account**; a message stays `Pending` until a device picks it up (cloud rejects messages pending > 24 h) | `SMS_GATEWAY_DEVICE_ID` only when set; **new:** a one-time warning + health flag (`device_pinned`) + diagnostics finding when unset, and the exact list command to obtain the id | ✅ / improved |

Notable operational facts surfaced by the audit (all plausible causes of "no
SMS"):

* `accepted`/202 is **not** delivery; a message can sit `Pending` for up to 24 h
  and be silently dropped. Queue limits return HTTP 503 `QueueLimitExceeded`.
* An unregistered/offline device is invisible unless `/devices` is checked.
* Priorities ≥ 100 bypass the handset's own delay/rate-limit queue (recommended
  for OTPs); device-side limits can otherwise delay a code past its 5-minute TTL.
* Devices with FCM disabled fall back to SSE or 15-minute polling.

## 4. Requirement 3 — safe, structured diagnostics

**Never logged or returned:** credentials, `Authorization` headers, OTP codes,
hashes/salts, full phone numbers (masked to `********1234`). All remote error
text passes through `scrub()` (digit runs ≥ 4 redacted).

Added structured log events (stdlib `logging`, key=value so Render can filter):

| Event | Fields |
|---|---|
| `sms_gateway_accepted` | `http_status`, `recipient` (masked), `message_id`, `message_state`, `device_pinned`, `note=queued_not_delivered` |
| `sms_gateway_submission_failed` | `code`, `category`, `http_status`, `recipient`, `reason` (scrubbed), `retryable`, `user_action` |
| `otp_sms_submitted` / `otp_sms_submission_failed` | `user_id`, `mode`, `simulated`, `accepted`, `message_id`, `message_state`, `device_pinned`, `error_code`, `category`, `gateway_http_status` |
| `otp_verify_failed` | `error_code`, `reason`, `recipient`, `otp_row_status`, `otp_row_age_seconds`, `attempts`, `attempts_max`, `attempts_remaining`, `pepper_source`, `pepper_stable` |
| `farmer_otp_request_accepted` / `…_failed` / `…_verify_failed` | same identifiers at the API layer, with `dispatch=submitted_to_gateway` or `not_dispatched` |
| `otp_pepper_mismatch` | stored vs current fingerprint + `user_action` |

Error categories are stable and non-secret: `NOT_CONFIGURED`, `AUTH`,
`RATE_LIMIT`, `QUEUE_LIMIT`, `SERVER`, `REJECTED`, `INVALID_REQUEST`,
`TIMEOUT`, `CONNECTIVITY`.

Message status is persisted per OTP row (`gateway_message_id`, `gateway_state`,
`gateway_http_status`, `gateway_device_configured`, `send_error_code`,
`send_error_category`) and per request-log row — so support can look a message
up provider-side (`GET /3rdparty/v1/messages/{id}`) instead of guessing.

## 5. Requirements 4 & 5 — tracing the 401, one DB, one normalisation

`verify-otp` now computes an internal `reason` (logged + audited, **never**
returned to the client, so enumeration protection is unchanged):

| Reason | Meaning | Likely when |
|---|---|---|
| `no_otp_row` | no `otp_codes` row for that `mobile_e164` + purpose | mobile is not a registered farmer, **or** the row was lost (ephemeral DB / restart before the persistent disk was attached) |
| `status=INVALIDATED` | a newer OTP superseded this one | farmer requested twice |
| `status=SEND_FAILED` | the gateway rejected the send; no code ever left the server | gateway misconfigured/offline at request time |
| `code_mismatch` | row was ACTIVE and in time, but the submitted code did not match | no SMS arrived (queued/Pending) so the farmer guessed or reused a code — **the only cause consistent with "200 + no SMS" when the number is registered** |
| `pepper_mismatch` | the row's pepper fingerprint ≠ this process ⇒ the pepper was rotated or is per-process | `OTP_PEPPER` not set (ephemeral) with `gunicorn --workers 2`, or the secret was regenerated on redeploy — **makes every valid OTP fail** |
| `expired` | past the 5-minute TTL | slow handset/typing |
| `attempts_exhausted` / `locked` | 5 wrong codes | guesswork after a missing SMS (429, not 401) |
| `role_mismatch` | row does not belong to a farmer | defensive |
| `failure_limit` | 10 failed verifications / 15 min | abuse protection |

Each OTP row now stores a truncated HMAC **pepper fingerprint** (not the pepper),
so `pepper_mismatch` is provable rather than inferred.

Checked and unchanged-by-design:

* **Expiry** — 5 min TTL enforced server-side (row marked `EXPIRED`).
* **Hashing/pepper** — PBKDF2-HMAC-SHA256, per-row salt, server pepper. New
  guard: in production an **ephemeral pepper is refused** (`503
  OTP_PEPPER_UNSTABLE`) instead of issuing codes that cannot verify; `/api/health`
  and `/api/auth/farmer/config` expose `pepper_stable` (boolean, no value).
* **Normalisation** — request and verification both call the same
  `ivr_config.normalize_indian_number`, store/query `+91XXXXXXXXXX`, and the
  lookup also handles the 10-digit stored form. `09800000001`, `9800000001`,
  `+919800000001` all resolve to one row (tested).
* **Latest-code invalidation, single use, attempt limits, rate limits, cooldowns**
  — unchanged and re-tested.
* **One database** — both legs use `database.get_db()` → the same `DB_PATH`
  (`SIH_DB_PATH`). `render.yaml` points it at the disk mount
  (`/var/data/animal_health.db`); the new health fields
  `database_path_configured` / `persistent_mount_configured` report whether that
  is actually true on the running service (an ephemeral path silently deletes
  in-flight OTPs on every deploy/restart/spin-down — Render disks also require a
  paid instance type).
* **Vet / Government / Lab** and the farmer password fallback are untouched
  (regression-tested).

## 6. Root cause and how to confirm it in one command

The log triad is fully explained by **"the code never reached the farmer, and
the failure was not observable"**:

* request-otp 200 ⇒ the request was accepted (gateway queued it **or** the
  number is not a registered farmer — both return 200 by design);
* no SMS ⇒ the gateway never handed it to a handset (device offline/unregistered,
  unpinned random device selection, missing SIM/SMS permission, or device queue
  limits) **or** nothing was dispatched because the number is not a registered
  farmer;
* verify-otp 401 ⇒ no valid row matched the submitted code; the row state now
  tells you exactly which of the two happened.

After deploying this branch, one call disambiguates everything:

```bash
curl -s "https://pashu-shield-backend-hjgr.onrender.com/api/admin/otp-diagnostics?mobile=<10-digit>&live=1" \
  -H "X-Diag-Token: $OTP_DIAG_TOKEN" | jq '.findings, .latest_otp, .live_checks, .database, .otp'
```

| `findings` says… | Root cause | Fix |
|---|---|---|
| *No farmer (role=owner) account matches this mobile* | tested number is not registered in production | test with a seeded farmer (e.g. `9800000001`) or register the farmer; delivery is fine |
| *No OTP row was ever written* | row lost (ephemeral DB) or request never reached this DB | attach the Render disk + `SIH_DB_PATH=/var/data/animal_health.db`, redeploy |
| *pepper fingerprint differs* / health shows `pepper_stable: false` | rotated/per-process pepper | set a stable `OTP_PEPPER` (32+ random chars) and redeploy |
| *gateway rejected the last OTP send (…)` | SMS_GATEWAY_* credentials/config | re-copy the app's Cloud Server username/password into Render |
| *account lists no devices* | handset never connected/registered | open the app → Cloud Server → Online |
| `latest_otp.gateway_state = Pending` (or message still `Pending`) | queued, never sent by a handset | bring the handset online, grant SMS permission, and pin `SMS_GATEWAY_DEVICE_ID` |
| `gateway_state = Sent/Delivered` but no SMS | carrier/handset side | check the number/SIM/DND, then resend |
| `latest_otp.status = SEND_FAILED` with reason `SEND_FAILED` | send failed at request time | see the error code/category in the same payload |

## 7. Files changed

| File | Change |
|---|---|
| `backend/sms_gateway.py` | URL normalisation for every real-world base-URL shape; `(connect, read)` timeouts; honest `accepted` vs `delivered` semantics (2xx `Failed` rejected, `delivery_state`, `http_status`); stable error `category` + raw `upstream_status`; `get_message_status()` and `list_devices()` (whitelisted, credential-free); unpinned-device warning; masked/scrubbed structured logging |
| `backend/otp_service.py` | Pepper source/stability/fingerprint helpers; production refusal of an ephemeral pepper (`OTP_PEPPER_UNSTABLE`); gateway metadata + pepper fingerprint persisted per row; internal `reason` for every verification failure; `otp_login_status()` readiness; secret-free `diagnostics()` |
| `backend/database.py` | Additive, idempotent diagnostics columns for `otp_codes` and `otp_request_log` (no existing table/column/data touched) |
| `backend/app.py` | Neutral, non-enumerable OTP responses (`delivery_confirmed: false`); exact readiness error codes; structured dispatch/verify logs with reasons; `GET /api/admin/otp-diagnostics` (govt JWT or `OTP_DIAG_TOKEN`); `/api/health` gains pepper/database/device-pinning flags; admin gateway test returns real status evidence |
| `backend/sms_service.py` | Notification adapter uses `accepted` and masks recipients in logs |
| `backend/test_farmer_otp_login.py` | +17 regression tests (gateway failure matrix, queued-not-delivered, valid/invalid/replay verification, pepper mismatch, pepper-stability guard, normalisation equivalence, guarded diagnostics, `Pending` evidence, migration) — 43 → **60** |
| `frontend/app.js` | Conditional delivery wording in en/mr/hi/te; no "OTP sent to …" claim (including the 429/cooldown path); "SMS not received?" guidance; `OTP_PEPPER_UNSTABLE` mapped to the unavailable message |
| `frontend/tests/otp_login_ui.test.mjs` | +2 tests asserting the copy never claims delivery — 9 → **11** |
| `.env.example`, `render.yaml` | New `SMS_GATEWAY_CONNECT_TIMEOUT`, `OTP_DIAG_TOKEN`; recommended `SMS_GATEWAY_TTL_SECONDS=300`, `SMS_GATEWAY_PRIORITY=100`; device-pinning guidance |
| `FARMER_OTP_LOGIN.md`, `OTP_DELIVERY_INCIDENT_REPORT.md` | Updated contract/ops documentation and this report |

No mock OTP bypass was added, no OTP is ever returned or logged in production
(the dev-only `OTP_DEV_PRINT_CODE` aid is unchanged and ignored under
`RENDER`/`FLASK_ENV=production`), and no credential is read from anywhere except
the Render environment.

## 8. Tests run

```bash
cd backend
.venv/bin/python -m unittest test_farmer_otp_login -v     # 60 tests, OK
.venv/bin/python -m unittest test_regression test_all_features  # 22 tests, OK
.venv/bin/python -m unittest discover -p "test_*.py"      # 132 tests: same 6 failures/17 errors as the untouched baseline

cd ..
node --check frontend/app.js && node --check frontend/sw.js
node --test frontend/tests/otp_login_ui.test.mjs          # 11 tests, OK
```

The pre-existing `test_helpline` / `test_ml_service` failures were verified to be
**identical on the untouched `HEAD`** (same test names, same counts) — they are
unrelated to this change (IVR/webhook env + the ML service not running locally).

New coverage highlights: gateway 401/403/429/5xx/400/503-queue/timeout each
return 502/503, retire the row as `SEND_FAILED` and record code/category/HTTP
status; a queued message is reported as `accepted`, never `delivered`, with the
message id/state stored; valid/wrong/replayed codes; `pepper_mismatch` after a
pepper rotation; production refusal of an ephemeral pepper; identical bodies for
registered/unknown numbers; the diagnostics endpoint rejects wrong tokens and
leaks neither codes nor full numbers; a live `Pending` state is surfaced as a
finding; the additive migration is re-runnable.

Also verified end-to-end locally (MOCK gateway, temp DB, `0.0.0.0:5001`):
config → request-otp (registered *and* unknown give the same conditional 200) →
wrong code 401 (`reason=code_mismatch` in the log, nothing leaked) → correct code
200 + JWT → replay 401 `OTP_ALREADY_USED` → cooldown 429 → guarded diagnostics.

## 9. Deployment steps (Render + Vercel)

1. **Rotate/confirm `OTP_PEPPER`.** Keep it stable across deploys (Render
   `generateValue: true` is fine). If the service predates it, set a random
   32+ character value. Without it, OTP login is refused with
   `OTP_PEPPER_UNSTABLE` instead of failing silently.
2. **Confirm the persistent disk.** `SIH_DB_PATH=/var/data/animal_health.db` and
   the `pashu-shield-sqlite` disk mounted at `/var/data` (Render disks need a
   paid instance type; a free instance has an ephemeral filesystem, which
   destroys in-flight OTPs on restart).
3. **Set the gateway variables** (Render → `pashu-shield-backend` →
   Environment, never in Git): `SMS_GATEWAY_MODE=CLOUD`,
   `SMS_GATEWAY_BASE_URL=https://api.sms-gate.app/3rdparty/v1`,
   `SMS_GATEWAY_USERNAME`, `SMS_GATEWAY_PASSWORD`,
   `SMS_GATEWAY_CONNECT_TIMEOUT=5`, and (recommended)
   `SMS_GATEWAY_TTL_SECONDS=300`, `SMS_GATEWAY_PRIORITY=100`,
   plus `OTP_DIAG_TOKEN=<random 32+ chars>` for diagnostics.
4. **Pin the sending handset:**
   ```bash
   curl -s -u "$SMS_GATEWAY_USERNAME:$SMS_GATEWAY_PASSWORD" \
     https://api.sms-gate.app/3rdparty/v1/devices | jq
   ```
   copy the `id` of the phone that must send the OTPs into
   `SMS_GATEWAY_DEVICE_ID`; in the Android app make sure Cloud Server is
   **Online** and the SMS permission is granted.
5. **Deploy** `main` (this branch merged) — Render restarts with 2 Gunicorn
   workers; the additive migration runs automatically and creates only the new
   columns (no existing farmer data is touched).
6. **Verify (in this order):**
   ```bash
   curl -s .../api/health | jq '.sms_gateway, .farmer_otp_login'      # usable, pepper_stable, persistent_mount_configured
   curl -s .../api/auth/farmer/config | jq
   curl -s -X POST .../api/admin/sms-gateway/test -H "Authorization: Bearer <govt>" \
     -H 'Content-Type: application/json' -d '{"mobile":"<your handset>"}' | jq
   #   accepted=true → check .status_check.state moves Pending → Sent/Delivered
   curl -s ".../api/admin/otp-diagnostics?mobile=<farmer>&live=1" -H "X-Diag-Token: $OTP_DIAG_TOKEN" | jq
   ```
   Then a real farmer login on the Vercel app: send → receive → verify.
7. Only after a real SMS is confirmed, optionally set
   `FARMER_PASSWORD_FALLBACK=false`.

No Vercel change is required: `frontend/vercel.json` already proxies `/api/*` to
the Render service; only a redeploy of the static frontend is needed for the new
wording (the service worker cache version can be bumped if a stale bundle shows
old text).

## 10. Residual risks / follow-ups

* The production cause must still be read from the new diagnostics output (this
  sandbox has no route to the live services) — expected: "number not registered"
  or "message still `Pending`".
* `delivery_confirmed` is intentionally always `false`; delivery evidence is the
  gateway message state, polled on demand. If you want automatic alerts, add a
  small scheduled job that polls `GET /3rdparty/v1/messages/{id}` for rows in
  `Pending`/`Sent` older than N minutes, or register gateway webhooks
  (`sms:sent` / `sms:failed`) against a signed endpoint.
* SMS OTP is inherently plaintext over the carrier; the code is never stored
  or logged in plaintext.
