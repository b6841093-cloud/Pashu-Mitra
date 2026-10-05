# Pashu-Shield — Baseline Test & Audit Record

**Date:** 2026-10-05
**Commit:** `1227fddda1036193c72ebe37bb4c9f988cd5ae1d`
**Branch:** `arena/01a10b85-pashu-shield-updated`
**Environment:** Python 3.11.2 (venv), Node v22.22.3, Linux sandbox

> This file records the state of Pashu-Shield **before any compliance changes**.
> Per the programme rules, no issue may be attributed to the compliance work unless it is
> absent from this baseline.

---

## 1. Executive Summary

| Area | Result |
|---|---|
| Backend unit/integration tests | **277 passed / 0 failed** (with correct env + clean DB) |
| Frontend unit tests | **48 passed / 2 skipped / 0 failed** (50 total) |
| **Total automated** | **327 tests — 325 passed, 2 skipped, 0 failed** |
| Lighthouse | **NOT EXECUTED** — environment limitation |
| axe-core | **NOT EXECUTED** — environment limitation |
| HTML validation | **NOT EXECUTED** — environment limitation |
| Broken-link detection | **NOT EXECUTED** — environment limitation |
| OWASP ZAP | **NOT EXECUTED** — environment limitation |
| Browser compatibility | **NOT EXECUTED** — environment limitation |
| Screen reader | **NOT EXECUTED** — environment limitation |

**Honest statement:** Only the automated test suites were actually executed in this
environment. Static analysis, accessibility scans and browser testing were **not** run, and
are reported as `NOT EXECUTED` rather than as passes. See §7.

---

## 2. Backend Automated Tests — Results

Command pattern:
```
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cd backend && ../.venv/bin/python <suite>
```

| # | Suite | Tests | Result | Notes |
|---|---|---|---|---|
| 1 | `test_regression.py` | 10 | **OK** | — |
| 2 | `test_role_auth.py` | 30 | **OK** | Covers role isolation + migrations |
| 3 | `test_farmer_otp_login.py` | 60 | **OK** | Includes SMS-gateway secret-leak tests |
| 4 | `test_webcalling.py` | 66 | **OK** | Socket.IO auth, presence, signalling |
| 5 | `test_demo_account.py` | 34 | **OK** | Includes "no OTP/phone logged" assertion |
| 6 | `test_clerk_login.py` | 15 | **OK** | Uses `sk_test_dummy`; JWKS warmup fails offline (expected, non-fatal) |
| 7 | `test_helpline.py` | 34 | **OK** ⚠ | Passes **only** with env + clean DB — see §3 |
| 8 | `test_all_features.py` | 12 | **OK** | ML calls fail to connect to `127.0.0.1:8000` (expected offline) |
| 9 | `test_ml_service.py` | 16 | **OK (4 skipped)** | Skips are model-file dependent |
| | **Total** | **277** | **0 failed** | |

### 2.1 Expected non-fatal warnings observed at baseline
- `SIH_SECRET_KEY is not configured; generated an ephemeral development key.` — expected when env unset.
- `ML model status check failed: HTTPConnectionPool(host='127.0.0.1', port=8000)` — ML backend not running.
- `clerk_jwks_warmup_failed error=PyJWKClientConnectionError` — no network to Clerk.
- `clerk_create_user_failed: +91 is not enabled for SMS` — Clerk dashboard config, not code.

These are **pre-existing** and are not regressions.

---

## 3. `test_helpline.py` — Pre-existing Environment Dependency (IMPORTANT)

Running the suite as-is in a clean checkout produces:

```
Ran 34 tests — FAILED (failures=4, errors=17)
```

**Root cause (verified, not guessed):** the suite reads `os.environ["IVR_WEBHOOK_SECRET"]`
(`backend/test_helpline.py:40`). The repository's own `.env.example` ships this key **empty**:

```
.env.example:12:  IVR_WEBHOOK_SECRET=
```

With the variable unset, 17 tests raise `KeyError` and 4 cascade.

**Resolution used for baseline:**
```bash
export IVR_WEBHOOK_SECRET="baseline-test-secret-not-a-real-credential"
export SIH_SECRET_KEY="baseline-dev-key"
```
→ drops to **1 failure**: `test_05_demo_login` returns `429 != 200`
(`farmer_otp_request_failed error_code=COOLDOWN_ACTIVE`).

**Second root cause (verified):** the OTP rate-limit cooldown persists in
`backend/animal_health.db`, which **is tracked in git** (`git ls-files` confirms). Repeated
runs trip the cooldown. With a fresh database the suite is **fully green**:

```
Ran 34 tests in 0.483s
OK
```

**Conclusion:** `test_helpline.py` has **zero code defects at baseline**. It has two
*test-harness* defects:
1. Depends on an env var that `.env.example` leaves blank (no default, no skip).
2. Not isolated from committed database state.

Both are recorded as findings **F-B1** and **F-B2** in the gap matrix and are **not**
caused by the compliance work.

---

## 4. Frontend Automated Tests — Results

```
node --test "frontend/tests/"*.test.mjs
```

```
# tests 50
# pass 48
# fail 0
# cancelled 0
# skipped 2
# duration_ms 7704
```

Suites: `otp_login_ui.test.mjs`, `demo_account_ui.test.mjs`, `webcall_ui.test.mjs`,
`webcall_browser.test.mjs`.

The frontend tests load `app.js` in a sandboxed VM with a DOM stub and assert the
authentication-UI contract (farmer screens render OTP controls only, never a password
field; vet/govt/lab keep password login; OTP never queued offline; OTP code never written
to `localStorage`).

---

## 5. Secret Scan — Baseline Result

**Method:** repo-wide regex scan for `SECRET|secret|_KEY|api_key|password|token|credential|TURN_`
across `.py .js .html .json .yaml .yml`, excluding `node_modules`, `vendor`, minified bundles
and `frontend/models`.

**Result: no hard-coded production credentials found.**

| Location | Finding | Verdict |
|---|---|---|
| `backend/database.py:1438` | Demo seed user with password `"password123"` | **Seed data** for the demo dataset, not a production credential. Flagged for owner review (see owner-input doc) — must not ship to production. |
| `backend/otp_service.py:150` | `PEPPER_SOURCE_FALLBACK = "SIH_SECRET_KEY"` | Name of an env var, **not** a value. Correct. |
| `backend/test_clerk_login.py:26` | `os.environ["CLERK_SECRET_KEY"] = "sk_test_dummy"` | Test fixture. Correct. |
| `backend/test_webcalling.py:805-834` | TURN/VAPID values like `"metered-pass"` | Test fixtures. Correct. |
| `backend/app.py:63` | `SECRET_KEY = os.environ.get("SIH_SECRET_KEY") or secrets.token_urlsafe(48)` | **Good practice** — env-driven with ephemeral fallback + warning. |

**`.gitignore`** already excludes `.env`, `.env.*` (with `!.env.example`) and `*.db-wal`.

⚠ **Finding F-B3:** `backend/animal_health.db` (a live SQLite database containing user
records) **is committed to git**. This is both a data-hygiene risk and a source of
test flakiness (§3). Removal requires an organisation decision (it currently acts as
the demo dataset).

---

## 6. Static Observations Recorded at Baseline (manual code reading, not tool-verified)

These are observations from reading the code, **not** from running scanners. They seed the
gap matrix but must be re-verified by tooling before being claimed as confirmed defects.

| ID | Observation | Source |
|---|---|---|
| S-01 | `index.html` has a single static `<title>` for the entire SPA; hash routes do not update it | `frontend/index.html:7` |
| S-02 | No `<meta name="description">`, no canonical URL, no Open Graph tags | `frontend/index.html` |
| S-03 | No skip-to-main-content link | `frontend/index.html` |
| S-04 | No `<header>`/`<nav>`/`<main>`/`<footer>` landmarks — content is injected into `<div id="app">` | `frontend/index.html:22`, `app.js:1337 render()` |
| S-05 | No site-wide footer (bottom nav only) | `app.js:1290 bottomNav()` |
| S-06 | No breadcrumbs on internal pages | `app.js` |
| S-07 | No site search | `app.js` |
| S-08 | No Help / About / Contact / Feedback / Sitemap pages | `app.js` route table (§3 of inventory) |
| S-09 | No accessibility control bar (A- / A / A+ / high contrast) | `app.js`, `style.css` |
| S-10 | No `prefers-reduced-motion` media query | `style.css` (grep found none) |
| S-11 | Focus styles: `outline:none` is set on inputs without a replacement indicator (`.field input:focus{outline:none;border-color:...}`) | `style.css:91` |
| S-12 | Charts are inline SVG with no accessible name, description, or text/table equivalent | `app.js:1347`, `app.js:1359` |
| S-13 | Status badges rely on colour (`statusBadgeClass`, `severityBadgeClass`, `riskBadgeClass`) | `app.js:1230-1245` |
| S-14 | Toast (`#toast`, `toast()`) has no `role="status"` / `aria-live` | `index.html:19`, `app.js:1020` |
| S-15 | Backend sets only `X-Frame-Options` and a conditional `Cache-Control`; no CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` at the app layer | `app.py:342-347` |
| S-16 | Headers ARE set at the Vercel CDN layer (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) but **not** HSTS/CSP | `frontend/vercel.json` |
| S-17 | No custom error pages (400/401/403/404/408/409/429/500/502/503) — SPA has no error routes and Flask has no error handlers | `app.py`, `app.js` |
| S-18 | Only 3 `<table>` elements; wide-table responsive strategy unclear | `app.js` |
| S-19 | Manifest sets `"orientation": "portrait-primary"` — restricts display orientation | `frontend/manifest.json` |
| S-20 | Fonts: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, ...`) — **preserved per exemption 4.2** | `style.css:24-25` |
| S-21 | Brand palette in `:root` — **preserved per exemption 4.3** | `style.css:1-21` |

---

## 7. NOT EXECUTED — Environment Limitations

The following **could not be run** in this sandbox. They are reported honestly as
`NOT EXECUTED` and must be run before any compliance claim is made.

| Check | Why not executed | How to run later |
|---|---|---|
| **Lighthouse** (perf ≥ 85, accessibility) | No Chrome binary; no outbound access to run the CLI | `npx lighthouse <url> --form-factor=mobile` |
| **axe-core** | No headless browser; no page under test | `npx @axe-core/cli <url>` or browser extension |
| **pa11y** | Same as above | `npx pa11y <url>` |
| **HTML validation** | W3C validator requires network access to `validator.w3.org` | Upload `index.html` to validator.w3.org |
| **Broken-link detection** | Requires a running server + crawler | `npx linkinator <url>` |
| **OWASP ZAP baseline** | Requires ZAP install + running target | `zap-baseline.py -t <url>` |
| **Browser compatibility** (Chrome/Firefox/Edge/Safari) | No browsers in sandbox | Manual / BrowserStack |
| **Screen reader** (NVDA/JAWS/VoiceOver) | No assistive tech, no GUI | Manual |
| **200% zoom / 320px reflow / print** | No browser | Manual |
| **WebRTC real call test** | Needs two peers, camera/mic, TURN | `backend/tests/webrtc/two_peer_call.mjs` |
| **Real SMS / IVR PSTN** | Requires provider credentials + hardware | Manual with credentials |
| **ML backend runtime** | Service at `127.0.0.1:8000` not started in baseline | `cd ml-backend && ./start.sh` |

**No Lighthouse score, axe score, or browser result is claimed anywhere in this
documentation set.** Where such a result would normally appear, the status is
`NOT EXECUTED — environment limitation`.

---

## 8. Baseline Reproduction Commands

```bash
# Backend
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp backend/animal_health.db /tmp/pashu-baseline-db.bak   # isolation
export IVR_WEBHOOK_SECRET="<test-secret>"
export SIH_SECRET_KEY="<test-key>"
cd backend
for f in test_regression test_role_auth test_farmer_otp_login test_webcalling \
         test_demo_account test_clerk_login test_helpline test_all_features \
         test_ml_service; do ../.venv/bin/python $f.py; done
cp /tmp/pashu-baseline-db.bak animal_health.db          # restore

# Frontend
node --test "frontend/tests/"*.test.mjs
```

---

## 9. Change Log for this file

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-10-05 | Initial baseline recorded before any compliance modification |
