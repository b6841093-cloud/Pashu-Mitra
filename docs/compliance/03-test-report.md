# Pashu-Shield — Compliance Test Report

**Date:** 2026-10-05 · **Branch:** `arena/01a10b85-pashu-shield-updated`
**Baseline:** `00-baseline.md` · **Gap matrix:** `01-gap-matrix.md`

> **Rule observed (programme §62): no result is claimed unless it was actually executed.**
> Anything not run in this environment is stated as **NOT EXECUTED**, with the reason and
> the command needed to run it later.

---

## 1. Summary

| Suite | Tests | Passed | Failed | Skipped | Status |
|---|---:|---:|---:|---:|---|
| Backend — pre-existing suites (9) | 277 | 277 | 0 | 4 | ✅ PASS |
| Backend — new compliance suite | 54 | 54 | 0 | 0 | ✅ PASS |
| **Backend total** | **331** | **331** | **0** | **4** | ✅ |
| Frontend — existing suites | 50 | 48 | 0 | 2 | ✅ (matches baseline) |
| **Grand total** | **381** | **379** | **0** | **6** | ✅ |

**Regression verdict: 0 regressions.** Every suite that passed at baseline still passes,
and `test_helpline.py` — which failed 21/34 at baseline — now passes 34/34 after a
harness fix that did not weaken a single product assertion.

---

## 2. Backend — executed

Command used (this is the reproducible entry point):
```bash
bash backend/run_tests.sh
```

| Suite | Tests | Result |
|---|---:|---|
| `test_regression.py` | 10 | **OK** |
| `test_role_auth.py` | 30 | **OK** |
| `test_farmer_otp_login.py` | 60 | **OK** |
| `test_webcalling.py` | 66 | **OK** |
| `test_demo_account.py` | 34 | **OK** |
| `test_clerk_login.py` | 15 | **OK** |
| `test_helpline.py` | 34 | **OK** (was 21 failures at baseline) |
| `test_all_features.py` | 12 | **OK** |
| `test_ml_service.py` | 16 | **OK** (4 skipped — model-file dependent) |
| `test_compliance.py` | 54 | **OK** (new) |

### 2.1 New compliance suite — what it proves

| Area | Tests | Key evidence |
|---|---:|---|
| Security headers (GIGW C1.2d) | 6 | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` all present; CSP is **report-only**; `Server` header suppressed; HSTS only on secure requests |
| Safe errors (GIGW C1.2c) | 5 | API 404 returns safe JSON; HTML 404 renders with `role="alert"`; a deliberately crashing route yields a 500 with **no** exception text, **no** `Traceback`, **no** `RuntimeError`; handlers registered for all 11 statuses |
| Feedback validation (GuDApps 4.4) | 6 | Rating range, comment length, optional-email format, unknown-category fallback, non-dict rejection, normalisation/trim |
| Feedback API (GIGW Q11) | 6 | Reference number issued (`FB-YYYYMMDD-XXXXXX`), reference trackable, unknown reference → 404, invalid → 422 with field errors, rate limit enforced, **free text and email never logged** |
| Upload security (GuDApps 4.5) | 11 | Executable extensions, **double extensions** (`report.pdf.exe`), multi-extension, path traversal, allow-list, empty/degenerate names, **magic-byte sniffing** (a shell script claiming `image/png` is rejected), genuine PNG/PDF accepted, oversize rejected |
| Frontend markup (WCAG/GIGW) | 16 | Skip link is the **first** focusable element; live regions in initial HTML; landmarks; `lang` + metadata; **zoom not blocked**; **orientation not locked**; `noopener noreferrer`; brand palette and font stack unchanged; reduced motion; focus visible; print stylesheet; routes registered; **no invented owner information** |
| Zero regression | 4 | All 21 sacred API routes still exist; farmer login is still **OTP-only** (no password route); **TURN credentials never returned to the client**; service-worker cache versioned |

---

## 3. Frontend — executed

```bash
node --test "frontend/tests/"*.test.mjs
```

| | Baseline | After changes |
|---|---:|---:|
| Tests | 50 | 50 |
| Passed | 48 | **48** |
| Failed | 0 | **0** |
| Skipped | 2 | 2 |

The four suites (`otp_login_ui`, `demo_account_ui`, `webcall_ui`, `webcall_browser`) load
`app.js` in a sandboxed VM with a DOM stub. They continued to pass **unchanged** after the
shell, `render()`, `toast()` and `isPublic()` modifications — evidence that the global
shell is genuinely additive.

---

## 4. Live server verification — executed

Server: `gunicorn app:app --bind 0.0.0.0:5001 --worker-class gthread`

| # | Check | Result |
|---|---|---|
| 1 | Security headers on `/api/health` | ✅ All present (see §2.1) |
| 2 | `/` serves the new shell | ✅ `pm-skip-link`, `pmLivePolite`, `org-config.js`, `shell.js`, `info-pages.js`, `main-content` all present |
| 3 | New assets return 200 | ✅ `org-config.js`, `shell.js`, `info-pages.js`, `style.css`, `app.js`, `sw.js`, `manifest.json` |
| 4 | API 404 safe body | ✅ `{"error":"We could not find that page or record.","reference":"…","status":404}` — no traceback |
| 5 | HTML 404 safe page | ✅ status 404, contains "Page not found" + `role="alert"`, **no** `Traceback`, **no** `Werkzeug` |
| 6 | Feedback valid submission | ✅ `201` → `{"ok":true,"reference":"FB-20261005-C01F5A","status":"RECEIVED"}` |
| 7 | Feedback invalid submission | ✅ `422` → field-level errors for `rating` and `comments` |
| 8 | Feedback reference lookup | ✅ `200` → `{"reference":"FB-20261005-657B13","status":"RECEIVED",…}` |
| 9 | `/api/health` WebRTC contract intact | ✅ `signaling: flask-socketio`, `socketio_path: /socket.io`, `stun_configured: true` |
| 10 | Farmer auth contract intact | ✅ `auth.farmer.login: mobile_otp`, `password_login_enabled: false` |

⚠ Note: `turn_configured` is `false` in this sandbox because TURN environment variables are
not set. That is **configuration**, not a regression — the value is env-driven.

---

## 5. NOT EXECUTED — environment limitations

These were **not run**. No score is claimed for any of them.

| Check | Reason | How to run |
|---|---|---|
| **Lighthouse** (Performance ≥ 85, Accessibility) | No Chrome/Chromium binary; no network to fetch the CLI | `npx lighthouse http://localhost:5001/ --form-factor=mobile --only-categories=performance,accessibility` |
| **axe-core** (target: 0 critical/serious) | No headless browser | `npx @axe-core/cli http://localhost:5001/` |
| **pa11y** | No browser | `npx pa11y --standard WCAG2AA http://localhost:5001/` |
| **W3C HTML validation** | No network to `validator.w3.org` | Upload `index.html` to `validator.w3.org` |
| **Broken-link crawl** | Requires a crawler over a live authenticated session | `npx linkinator http://localhost:5001/ --recurse` |
| **OWASP ZAP baseline** | ZAP not installed | `zap-baseline.py -t http://localhost:5001/` |
| **Dependency audit** (`pip-audit`) | Not installed | `pip install pip-audit && pip-audit -r backend/requirements.txt` |
| **Browser compatibility** (Chrome/Firefox/Edge/Safari) | No browsers in sandbox | Manual / BrowserStack |
| **Screen reader** (NVDA/JAWS/VoiceOver) | No assistive technology, no GUI | Manual |
| **Keyboard-only walkthrough** | No interactive browser session | Manual — see the checklist in §7 |
| **200% zoom / 320px reflow / print / CSS-off** | No browser | Manual |
| **WebRTC two-peer call** | Needs two peers + media devices + TURN | `node backend/tests/webrtc/two_peer_call.mjs` |
| **Real SMS OTP delivery** | Requires SMS gateway credentials/device | Manual with credentials |
| **IVR / PSTN call** | Requires telephony provider | Manual with credentials |
| **ML backend runtime** | Service not started in this run | `cd ml-backend && ./start.sh` |

---

## 6. Defects found and fixed during this round

| ID | Defect | Severity | Fix | Verified |
|---|---|---|---|---|
| **F-B1** | `test_helpline.py` depends on an env var that `.env.example` ships empty → 21/34 failures in a clean checkout | High (blocks CI) | `os.environ.setdefault` with a labelled test value | ✅ 34/34 |
| **F-B2** | Tests mutate the git-tracked DB; OTP cooldowns leak between runs | Medium | `backend/run_tests.sh` isolates and restores the DB | ✅ 10/10 suites, `git status` clean |
| **F-C1** | Manifest locked orientation to portrait-primary (WCAG 1.3.4) | Medium | Key removed | ✅ test_65 |
| **F-C2** | `.field input:focus { outline:none }` left no visible focus (WCAG 2.4.7) | High (a11y) | 3px focus ring added | ✅ test_70 |
| **F-C3** | Toast never announced to assistive tech (WCAG 4.1.3) | High (a11y) | Static live regions + `announce()` | ✅ test_61 |
| **F-C4** | Single static `<title>` across 33 routes (WCAG 2.4.2) | Medium | Per-route metadata | ✅ live |
| **F-C5** | Unhandled exceptions could expose tracebacks | High (security) | Safe handlers + correlation ids | ✅ test_10–14 |

---

## 7. Manual test checklist (for the next environment)

These are the checks a human must run. They are **not** marked as done.

### 7.1 Keyboard-only
- [ ] Tab from page load lands on **Skip to main content**
- [ ] Skip link reveals on focus and jumps to `#main-content`
- [ ] Farmer OTP flow completable with keyboard only (mobile → code → submit)
- [ ] Staff login completable with keyboard only
- [ ] Accessibility bar: A- / A / A+, high contrast, reduce motion all reachable
- [ ] Footer links reachable; tab order is logical
- [ ] Feedback form: error summary receives focus, links jump to the offending field
- [ ] WebRTC controls (call, accept, reject, mute, end) all operable by keyboard
- [ ] No keyboard trap in any dialog; `Esc` closes and restores focus

### 7.2 Screen reader
- [ ] Page title announced per route
- [ ] Toast/loading/success/error announced
- [ ] OTP state (sending / sent / expired / error) announced
- [ ] Call state changes announced
- [ ] Landmarks (banner / main / contentinfo) navigable
- [ ] Headings form a logical hierarchy

### 7.3 Visual / responsive
- [ ] 320 / 360 / 375 / 390 / 414 / 480 / 768 / 1024 / 1280 / 1440 px
- [ ] Portrait and landscape
- [ ] 200% text zoom — no loss of content or function
- [ ] Text-spacing overrides (WCAG 1.4.12) — no clipping
- [ ] Print preview (A4) — no navigation clutter, tables intact
- [ ] CSS disabled — content still readable and in order
- [ ] High-contrast mode on and off
- [ ] `prefers-reduced-motion` honoured
- [ ] Touch targets ≥ 44×44 px on all primary controls

### 7.4 Colour & contrast
- [ ] Measure every text/background pair (target ≥ 4.5:1, large text ≥ 3:1)
- [ ] Measure focus indicators and UI component boundaries (≥ 3:1)
- [ ] Verify no status is conveyed by colour alone
- [ ] Record every tint adjustment in the format required by exemption 4.3

---

## 8. Reproduction

```bash
# Backend (isolated, restores the tracked database on exit)
bash backend/run_tests.sh

# Frontend
node --test "frontend/tests/"*.test.mjs

# Live server
cd backend && gunicorn app:app --bind 0.0.0.0:5001 --worker-class gthread \
  --workers 1 --threads 100 --timeout 120
```
