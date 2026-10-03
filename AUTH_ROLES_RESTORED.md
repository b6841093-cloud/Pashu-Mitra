# Role-specific authentication restored — change report

**Branch:** `arena/01a10209-pashu-shield-updated` (from `main` @ `c24beda`)
**Date:** 2026-10-03
**Scope:** authentication only. No dashboard, ML, IVR/helpline, reporting or data
change beyond what is listed below.

---

## 1. What the Git history actually shows

| Ref | What it is | Auth behaviour in it |
|---|---|---|
| `c24beda` (`main`, our base) | merge of PR #8 | Farmer OTP login; **Vet/Govt/Lab password login intact**; farmer password form kept as a fallback |
| `37375ec` (PR #7) | "farmer mobile OTP login via capcom6 SMS gateway" | added the farmer OTP flow |
| `129e23d` (PR #8) | OTP delivery evidence + 401 diagnostics | hardened the OTP flow |
| `d0c26c8` — `arena/01a101b4-pashu-shield-updated` (**PR #9, closed, never merged**) | "Replace email/password auth with mobile-OTP-only login for every role" | **the change that forced every role onto OTP**: `/api/auth/login` and `/api/auth/register` returned **410 Gone**, all four portals rendered one OTP screen |

**Key finding:** PR #9 was closed on 2026-10-03 13:52:48Z without being merged,
so `main` **never contained the 410 / OTP-for-everyone code**. I verified this by
fetching the branch and diffing it (`git diff main origin/arena/01a101b4-pashu-shield-updated`
shows the 410 handlers only on that unmerged branch). Branch
`origin/arena/01a101b4-pashu-shield-updated` is left untouched and must **not** be
deployed; `main` is the correct production branch.

So "undo the OTP-for-everyone change" resolves to: keep `main`'s farmer OTP work
(PR #7/#8) and make the role split exact — OTP **only** for farmers, the original
password flow **only** for Vet/Govt/Lab. That is what this branch implements, plus
regression tests that fail if the 410 change is ever re-applied.

Original (pre-OTP, verified in `Bdb08d3` / `84ca423` / `ce22bba` and in
`ad89c3a`, the initial commit) staff flows that are preserved verbatim:

* `POST /api/auth/login` — `identifier` (email **or** mobile) + `password` → JWT.
* `POST /api/auth/register` — `full_name, mobile, email, password, confirm_password, role`
  with `role ∈ {owner, vet, govt, lab}`, password length ≥ 6, mismatch checks,
  duplicate 409 — **public self-registration for every role, exactly as before**
  (`git show bdb08d3:backend/app.py`). No administrator-provisioning requirement
  existed for staff roles in this repository, so none was invented; seeded staff
  accounts (`ensure_govt_and_stock`, `ensure_lab_user`, `seed`) are untouched.

---

## 2. Final authentication contract

| Role | Login | Signup / profile creation | Password |
|---|---|---|---|
| `owner` (Farmer / Animal Owner) | `POST /api/auth/farmer/request-otp` → `POST /api/auth/farmer/verify-otp` | `request-otp` with `intent=signup` → `verify-otp` (`registration_required`) → `POST /api/auth/farmer/register` | none, ever (no fallback) |
| `vet`, `govt`, `lab` | `POST /api/auth/login` (email or mobile + password) | `POST /api/auth/register` (original fields/validation) | yes (unchanged hashes) |

Enforcement is server-side:

* `POST /api/auth/login` verifies the password first and then refuses farmers with
  `403 FARMER_OTP_REQUIRED` (`login_method: mobile_otp`) — a correct legacy
  password cannot mint a farmer session, and the refusal tells an attacker
  nothing they did not already have to know.
* `POST /api/auth/register` refuses `role=owner` with
  `403 FARMER_OTP_SIGNUP_REQUIRED` before any password field is validated.
* `/api/auth/login` and `/api/auth/register` are **not** 410 for staff roles;
  `test_11b` in the new suite locks that in.
* Role claims come from the database row (`make_token`); the JWT is never built
  from client input. Farmer signup always writes `role='owner'` regardless of a
  `role` field in the body (covered by `test_04`).

### Farmer profile creation (new, OTP-verified)

1. `POST /api/auth/farmer/request-otp {"mobile": ..., "intent": "signup"}` —
   identical rate limits, 60 s cooldown and neutral response as login; a number
   with no account now really receives an OTP row (`user_id = NULL`).
2. `POST /api/auth/farmer/verify-otp` — returns `registration_required: true`
   plus a **single-use, 15-minute HMAC token bound to the verified number**
   (no JWT).
3. `POST /api/auth/farmer/register` — consumes the token inside the same
   `BEGIN IMMEDIATE` transaction as the uniqueness check and the `INSERT`;
   creates the farmer with `full_name, mobile, village, block, district,
   preferred_language, email?` and returns the normal farmer JWT.
   Validation errors do **not** spend the token; a successful call (or a login
   for a number that gained an account in between) does.
4. A staff mobile number can never enter this flow (role check at verify time).

### Preserved farmer OTP security controls (unchanged)

6-digit CSPRNG code, PBKDF2-salted + peppered hash, 5-minute expiry, 5 attempts,
single use with atomic consumption, 60 s resend cooldown, per-mobile/per-IP
request limits, per-mobile verify-failure limit, older-OTP invalidation,
anti-enumeration responses, `delivery_confirmed: false` (queued ≠ delivered),
`SMS_GATEWAY_*` / `OTP_PEPPER` readiness guards, and the govt-only
`POST /api/admin/sms-gateway/test` + `GET /api/admin/otp-diagnostics` tools.

---

## 3. Modified files

### Backend

| File | Change |
|---|---|
| `backend/app.py` | role routing on `/api/auth/login` + `/api/auth/register`; `/api/auth/farmer/config` advertises OTP-only; `intent` handling on request/resend OTP; `registration_required` response on verify; new `POST /api/auth/farmer/register`; `/api/health` reports the role split; removed `_farmer_password_fallback_allowed` |
| `backend/otp_service.py` | `allow_unregistered` signup OTPs (`user_id = NULL`); signup branch in `verify_otp`; HMAC registration tokens (`issue`/`verify`/`consume`, single-use, pepper-signed); no password-fallback wording in the 503 message |
| `backend/database.py` | `otp_codes.user_id/role` migrated to nullable (one-time rebuild that copies every column, keeps the `status` CHECK, is idempotent); additive `registration_token_hash` / `registration_used_at`; `otp_only_credentials()`; `find_user_by_mobile()` |
| `backend/test_farmer_otp_login.py` | 3 assertions updated to the OTP-only contract (farmer password login now 403; config no longer exposes a fallback flag) |
| `backend/test_role_auth.py` | **new** 30-test role-authentication regression suite |
| `backend/test_helpline.py` | 2 tests updated: `test_05_demo_login` now exercises farmer mobile-OTP login, `test_07_registration_with_language` uses a staff role (registering a vet changed IVR vet-availability and broke a later routing test) |

### Frontend

| File | Change |
|---|---|
| `frontend/app.js` | `#/login/owner` = OTP only; `#/register/owner` = OTP + profile step (full name, village, block, district, optional email, preferred language); `#/login/owner/password` reduced to a redirect (no password form, no link to it); `loginForm()` no longer takes a farmer-fallback option; new i18n keys in en/mr/hi/te; Vet/Govt/Lab screens untouched |
| `frontend/sw.js` | cache bumped `pashumitra-v3` → `pashumitra-v4` so clients pick up the new bundle |
| `frontend/tests/otp_login_ui.test.mjs` | 11 → 13 tests: farmer signup screen, staff screens contain no OTP fields, no farmer password route/screen, profile endpoint wired |

### Config / docs

`.env.example` (fallback var removed, `OTP_REGISTRATION_TOKEN_TTL_SECONDS` added),
`render.yaml` (same), `DEPLOYMENT.md`, `FARMER_OTP_LOGIN.md` (update banner + corrected
sections), `OTP_DELIVERY_INCIDENT_REPORT.md` (historical note), `.gitignore`
(`backend/test_role_auth.db*`).

**Untouched:** nothing else. No database column was dropped, no password hash
migrated or reset, no user recreated, no Vercel/Render routing or other service
configuration changed, and branch `origin/arena/01a101b4-pashu-shield-updated`
(PR #9) was not modified or deployed.

---

## 4. Tests executed

Environment: Python 3.11 + Flask 3.1.3 in a throwaway venv, Node 22, each suite
against its own SQLite file; SMS gateway stubbed (`sms_gateway.send_text_message`
replaced) so **no real SMS** is sent. `IVR_WEBHOOK_SECRET` set (the helpline suite
needs it).

| Suite | Base `c24beda` | This branch |
|---|---|---|
| `backend/test_role_auth.py` *(new)* | — | **30 OK** |
| `backend/test_farmer_otp_login.py` | 60 OK | **60 OK** |
| `backend/test_regression.py` | 10 OK | **10 OK** |
| `backend/test_all_features.py` | 12 OK | **12 OK** |
| `backend/test_helpline.py` | 34 run, **1 pre-existing failure** | 34 run, **same 1 pre-existing failure** |
| `backend/test_ml_service.py` | 16 run, **1 pre-existing failure**, 4 skipped | identical |
| `node --test frontend/tests/*.test.mjs` | 11 pass | **13 pass** |

Pre-existing failures (reproduced on the unmodified base commit, unrelated to auth):

1. `test_helpline.test_04_demo_account_details_visible_on_auth` — asserts the
   literal `"Username:"`/`"Password:"` strings in `frontend/app.js`; the earlier
   farmer-OTP release (PR #7) changed the farmer demo box to a mobile number, so
   the literal no longer exists. Left as-is (not an auth regression).
2. `test_ml_service.test_status_checks_model_readiness_not_just_metrics_availability`
   — needs the ML service on `:8000`.

> Without `IVR_WEBHOOK_SECRET` the helpline suite additionally errors in
> `signed_post` (`KeyError`), which is a test-environment requirement, not a
> product failure.

### What the new suite covers (criteria map)

1 farmer OTP request + verify (`test_01`) · 2 profile after phone verification
(`test_03`, `test_04`, `test_04b`, `test_05`) · 3 no farmer password fallback
(`test_06`, `test_07`, `test_08`) · 4–6 Vet/Govt/Lab original password login
(`test_09`, `test_10`, `test_11`) · 7 staff registration rules (`test_12`,
`test_13`, `test_14`) · 8 wrong credentials rejected (`test_15`, `test_16`) ·
9 OTP replay/expiry/limits (`test_17`–`test_21`) · 10 token claims + dashboard
permissions (`test_22`, `test_23`) · 11 existing records/data intact
(`test_24`, `test_25`, `test_25b`) · 12 unrelated features (helpline, diseases,
ML status, lab queue, case reporting, farmer dashboards) (`test_26`, `test_27`).
Plus `test_11b`: the password routes must never answer 410/404 again.

### Manual end-to-end verification (real HTTP, mock gateway)

Server: `flask run --host 0.0.0.0 --port 5056`, `SMS_GATEWAY_MODE=MOCK`,
`OTP_DEV_PRINT_CODE=true` (dev-only flag; **off** in the preview server and never
active in production).

| Check | Result |
|---|---|
| `GET /api/health` | `farmer.login=mobile_otp`, `farmer.password_login=false`, `staff_login_method=password`, `staff_self_register_roles=[vet,govt,lab]` |
| `POST /api/auth/login` vet / govt / lab | `200` each, role claim matches |
| `POST /api/auth/login` with farmer number + correct password | `403 FARMER_OTP_REQUIRED` |
| `POST /api/auth/register` vet (original fields) | `201` |
| `POST /api/auth/register` `role=owner` | `403 FARMER_OTP_SIGNUP_REQUIRED` |
| Farmer signup: `request-otp {intent:signup}` → `verify-otp` | `200`, `registration_required=true`, token issued |
| `POST /api/auth/farmer/register` | `201`, role `owner`, `preferred_language` stored |
| `GET /api/owner/summary` with that token | `200`; `GET /api/vet/summary` → `403` |
| Replay the registration token | `401 REGISTRATION_TOKEN_INVALID` |
| Replay the used OTP | `401 OTP_ALREADY_USED` |

**Mock vs. real SMS:** every automated and manual check above uses the stub/mock
gateway. A mocked 2xx is *queued, not delivered* — the API still answers
`delivery_confirmed: false`, and a failing mock dispatch returns `502`/`503`
without leaving a usable OTP (asserted by `test_02`). Real delivery was **not**
verified here: it requires a capcom6 device and the `SMS_GATEWAY_*` credentials
in Render, and can be confirmed with the govt-only
`POST /api/admin/sms-gateway/test`.

---

## 5. Deployment steps

1. Merge this branch into `main` of `h6362794-sketch/Pashu-Shield-updated`
   (the repository this checkout is configured for; the
   `dbharath653-code/Pashu-Shield-updated` URL in the request does not resolve —
   that account has only contributed PRs #1–#3 to this repository).
2. Render (backend) redeploys from `main` automatically. No new environment
   variable is required; `OTP_PEPPER` + `OTP_DIAG_TOKEN` must already be set
   (`render.yaml` uses `generateValue`). `FARMER_PASSWORD_FALLBACK` may be
   deleted from the Render dashboard — it is no longer read.
3. The first boot migrates `otp_codes` (nullable `user_id`/`role`, two new
   columns). It is additive and idempotent; user ids, profiles, roles, password
   hashes and all related records are preserved (asserted by `test_25`/`test_25b`
   and by a rehearsal against a copy of the committed database).
4. Vercel (frontend) redeploys the static bundle; `sw.js` cache v4 replaces the
   stale one. No `frontend/vercel.json` change.
5. Post-deploy smoke: `GET /api/health` shows the `auth` block; vet login works;
   farmer `#/login/owner` shows the OTP screen with no password link.
6. **Do not deploy `arena/01a101b4-pashu-shield-updated` (PR #9).**

---

## 6. Remaining blockers / notes

* **Real SMS delivery is unverified** in this environment (mock gateway only) —
  see above.
* The farmer **password hashes are still in the database and are never read**;
  removing them was explicitly avoided (no column drops, no resets, so a future
  policy decision would not need a data migration).
* Farmers whose stored mobile number is missing or wrong cannot log in until an
  operator corrects it (unchanged from the previous release).
* Staff accounts remain publicly self-registerable **because that is the original
  behaviour** discovered in Git history. If the intention is now to restrict
  Vet/Govt/Lab signup to administrators, that is a policy change, not a restore,
  and should be requested separately.
* The two pre-existing test failures listed in §4 are unrelated to authentication
  and were left untouched.
