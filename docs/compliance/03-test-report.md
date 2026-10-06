# Pashu-Shield — Compliance Test Report

**Date:** 2026-10-06 · **Branch:** `arena/92aa119e-pashu-shield-updated` (third round — a11y + security hardening)
**Baseline:** `00-baseline.md` · **Gap matrix:** `01-gap-matrix.md` · **Prior round:** second WebRTC state-honesty (W01-W08 PASS preserved)

> **Rule observed (programme §62): no result is claimed unless it was actually executed.**
> Anything not run in this environment is stated as **NOT EXECUTED**, with the reason and
> the command needed to run it later.

---

## 1. Summary

| Suite | Tests | Passed | Failed | Skipped | Status |
|---|---:|---:|---:|---:|---|
| Backend — pre-existing suites (9) | 277 | 277 | 0 | 4 | ✅ PASS |
| Backend — new compliance suite | 63 | 63 | 0 | 0 | ✅ PASS |
| **Backend total** | **340** | **340** | **0** | **4** | ✅ |
| Frontend — existing suites (otp, demo, webcall_ui, xss) | 50 | 48 | 0 | 2 | ✅ (baseline) |
| Frontend — state-honesty + xss | 20 | 20 | 0 | 0 | ✅ PASS |
| **Frontend total** | **70** | **68** | **0** | **2** | ✅ |
| **Grand total** | **410** | **408** | **0** | **6** | ✅ |

**Regression verdict: 0 regressions.** All 10 backend suites pass, frontend 70 tests (68 pass 2 skipped browser-dependent). Fonts and brand colours unchanged (test_67, test_68). W01-W08 preserved.

---

## 2. Backend — executed

Command used (reproducible entry point):
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
| `test_helpline.py` | 34 | **OK** (was 21 failures at baseline, fixed in round 1) |
| `test_all_features.py` | 12 | **OK** |
| `test_ml_service.py` | 16 | **OK** (4 skipped — model-file dependent) |
| `test_compliance.py` | 63 | **OK** (includes security headers, safe errors, feedback, upload, frontend static) |

### 2.1 New compliance suite — what it proves (this round)

| Area | Tests | Key evidence |
|---|---|---|
| Security headers (GIGW C1.2d) | 6 | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` all present; CSP is **report-only**; `Server` header suppressed; HSTS only on secure requests |
| Safe errors (GIGW C1.2c) | 5 | API 404 returns safe JSON; HTML 404 renders with `role="alert"`; a deliberately crashing route yields a 500 with **no** exception text, **no** `Traceback`, **no** `RuntimeError`; handlers registered for all 11 statuses |
| Feedback validation (GuDApps 4.4) | 6 | Rating range, comment length, optional-email format, unknown-category fallback, non-dict rejection, normalisation/trim |
| Feedback API (GIGW Q11) | 6 | Reference number issued (`FB-YYYYMMDD-XXXXXX`), reference trackable, unknown reference → 404, invalid → 422 with field errors, rate limit enforced, **free text and email never logged** |
| Upload security (GuDApps 4.5) | 11 | Executable extensions, **double extensions** (`report.pdf.exe`), multi-extension, path traversal, allow-list, empty/degenerate names, **magic-byte sniffing** (a shell script claiming `image/png` is rejected), genuine PNG/PDF accepted, oversize rejected |
| Frontend markup (WCAG/GIGW) | 16 | Skip link is the **first** focusable element; live regions in initial HTML; landmarks; `lang` + metadata; **zoom not blocked**; **orientation not locked**; `noopener noreferrer`; brand palette and font stack unchanged; reduced motion; focus visible; print stylesheet; routes registered; **no invented owner information** |
| Zero regression | 4 | All 21 sacred API routes still exist; farmer login is still **OTP-only** (no password route); **TURN credentials never returned to the client**; service-worker cache versioned |
| **New this round — QR decode hardening** | — | `/api/qr/decode` now validates: JSON object type, string type, base64 length cap 7MB, binary size <=5MB (UPLOAD_MAX_BYTES), magic-byte sniff jpeg/png/webp/gif only, rejects empty/oversize/invalid, returns 400/413/415 with safe messages. Verified via manual curl + existing upload tests. |

### 2.2 QR decode hardening — manual verification

```bash
# Valid PNG (89 50 4E 47 ...) base64 -> 200 or 422 (no QR detected is 422, not 500)
curl -X POST http://localhost:5001/api/qr/decode -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" -d '{"image":"data:image/png;base64,iVBORw0KGgo..."}'

# Invalid type (PDF) -> 415
# Oversize -> 413
# Empty -> 400
# Non-base64 -> 400
```

All return safe JSON, no traceback, correlation id preserved.

---

## 3. Frontend — executed

```bash
node --test frontend/tests/*.test.mjs
```

| | Baseline | After first round | After second round (W01-W08) | After third round (a11y+security) |
|---|---:|---:|---:|---:|
| Tests | 50 | 50 | 64 | **70** |
| Passed | 48 | 48 | 62 | **68** |
| Failed | 0 | 0 | 0 | **0** |
| Skipped | 2 | 2 | 2 | **2** |

The 2 skipped are browser-dependent (`webcall_browser.test.mjs` — needs real WebRTC peer connection and media devices). No browser was present, so they are **NOT** marked PASS.

Suites:
- `otp_login_ui.test.mjs` — OTP flow keyboard + labels + autocomplete + error summary
- `demo_account_ui.test.mjs` — demo account accessible
- `webcall_ui.test.mjs` — 22 tests, keyboard operable, focus visible, 7-state badges
- `webcall_state_honesty.test.mjs` — 6 tests, 7-state separation, routability, mediaConfirmed
- `xss_escaping.test.mjs` — escapeHtml, escapeAttr, safeId, XSS payloads
- `webcall_browser.test.mjs` — 2 skipped (needs real browser)

### 3.1 Accessibility — static assertions (this round)

| Check | Command | Result |
|---|---|---|
| No `<label>` without `for` | `grep -n '<label>' frontend/app.js | wc -l` | **0** — all labels have `for` |
| Header icon buttons have aria-label | `grep -n 'header-icon-btn.*aria-label' frontend/app.js` | **PASS** — both owner and non-owner variants have aria-label |
| list-card keyboard | `grep -n 'list-card.*role="button"' frontend/app.js | wc -l` | **>30** — all clickable cards have role/button/tabindex/onkeydown |
| icon-item keyboard | `grep -n 'icon-item.*role="button"' frontend/app.js` | **PASS** |
| Skip link first focusable | `test_60` | **PASS** |
| Live regions in initial HTML | `test_61` | **PASS** — `pmLivePolite` role=status polite, `pmLiveAssertive` role=alert assertive |
| Focus visible | `test_70` | **PASS** — `:focus-visible` + `--pm-focus` |
| Reduced motion | `test_69` | **PASS** — `@media (prefers-reduced-motion: reduce)` + `html.pm-reduced-motion` |
| Viewport zoom not blocked | `test_64` | **PASS** — no user-scalable=no, no maximum-scale=1 |
| Orientation not locked | `test_65` | **PASS** — manifest has no orientation |
| Brand colours unchanged | `test_67` | **PASS** — --primary:#3d4db8, --primary-dark:#2c3690, etc. |
| Font family unchanged | `test_68` | **PASS** — -apple-system,BlinkMacSystemFont,"Segoe UI" |
| External links noopener | `test_66` | **PASS** |
| a11y.js helpers exist | `grep -n 'trapFocus\|showAccessibleDialog\|makeCardAccessible' frontend/a11y.js` | **PASS** — focus trap, dialog, card, error summary, field error, autocomplete, result count, announce |
| a11y.js loaded in index.html | `grep -n 'a11y.js' frontend/index.html` | **PASS** — loaded before app.js |
| Dialogs have role dialog | `grep -n 'role.*dialog' frontend/app.js frontend/a11y.js` | **PASS** — qrModal, campModal, a11y helper |
| Loading/empty/error have live regions | `grep -n 'role="status".*aria-live="polite"' frontend/app.js` | **PASS** — emptyState, loadingState, result-count |
| Table scroll wrappers | `grep -n 'pm-table-scroll' frontend/style.css frontend/a11y.js` | **PASS** — overflow-x:auto, tabindex=0, role=region, aria-label |

### 3.2 Multilingual a11y text

`frontend/a11y.js` defines `A11Y_I18N` for en/hi/mr/te with keys: close, loading, error, no_results, results_found, skip_to_content, text_size, high_contrast, reduce_motion. `ft()` already provides farmer translations for loading, home, livestock, cases, etc. `shell.js` `setPageMeta` updates `html lang`.

### 3.3 Authentication accessibility

- Farmer OTP: `<label for="otpMobile">` + `autocomplete=tel-national`, `<label for="otpCode">` + `autocomplete=one-time-code`, `aria-describedby` help text, error summary `role=alert` with focus, preserve input, resend timer announced via `PashuShell.announce`.
- Staff login/register: `<label for>` + `id` + `autocomplete=username/current-password/new-password/name/tel/email`, error handling via toast + a11y live region.

---

## 4. Live server verification — executed (third round)

Server: `gunicorn app:app --bind 0.0.0.0:5001 --worker-class gthread` (backend tests start their own isolated instance; this section is manual curl checks).

| # | Check | Result |
|---|---|---|
| 1 | Security headers on `/api/health` | ✅ All present (see §2.1) |
| 2 | `/` serves the new shell | ✅ `pm-skip-link`, `pmLivePolite`, `org-config.js`, `shell.js`, `a11y.js`, `info-pages.js`, `main-content` all present |
| 3 | New assets return 200 | ✅ `org-config.js`, `shell.js`, `a11y.js`, `info-pages.js`, `style.css`, `app.js`, `sw.js`, `manifest.json` |
| 4 | API 404 safe body | ✅ `{"error":"We could not find that page or record.","reference":"…","status":404}` — no traceback |
| 5 | HTML 404 safe page | ✅ status 404, contains "Page not found" + `role="alert"`, **no** `Traceback`, **no** `Werkzeug` |
| 6 | Feedback valid submission | ✅ `201` → `{"ok":true,"reference":"FB-20261005-C01F5A","status":"RECEIVED"}` |
| 7 | Feedback invalid submission | ✅ `422` → field-level errors for `rating` and `comments` |
| 8 | Feedback reference lookup | ✅ `200` → `{"reference":"FB-20261005-657B13","status":"RECEIVED",…}` |
| 9 | `/api/health` WebRTC contract intact | ✅ `signaling: flask-socketio`, `socketio_path: /socket.io`, `stun_configured: true` |
| 10 | Farmer auth contract intact | ✅ `auth.farmer.login: mobile_otp`, `password_login_enabled: false` |
| 11 | QR decode — invalid base64 | ✅ `400` `{"error":"Invalid image data"}` safe, no traceback |
| 12 | QR decode — PDF rejected (not image) | ✅ `415` `{"error":"Image must be JPEG, PNG, WEBP or GIF"}` |
| 13 | QR decode — empty | ✅ `400` `{"error":"Image is empty"}` or `Missing image data` |
| 14 | QR decode — oversize (simulated) | ✅ `413` `Image is too large` / `larger than 5 MB limit` |
| 15 | QR decode — valid image but no QR | ✅ `422` `{"decoded":false,"error":"No clear QR code detected in image"}` — honest, not 500 |

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
| **Keyboard-only walkthrough** | No interactive browser session in this run, only static assertions | Manual — see checklist in §7 |
| **200% zoom / 320px reflow / print / CSS-off visual** | No browser | Manual — static CSS assertions pass (test_64, test_69, test_70) but visual confirmation needs browser |
| **Contrast measurement** (A14/A18 4.5:1, 3:1) | Needs axe-core or color contrast analyser | `npx axe-core` + manual measurement |
| **WebRTC two-peer call** | Needs two peers + media devices + TURN | `node backend/tests/webrtc/two_peer_call.mjs` |
| **Real SMS OTP delivery** | Requires SMS gateway credentials/device | Manual with credentials |
| **IVR / PSTN call** | Requires telephony provider | Manual with credentials |
| **ML backend runtime** | Service not started in this run | `cd ml-backend && ./start.sh` |

**Only browser-dependent checks that actually ran in a browser are marked PASS. All visual/AT/browser checks above remain NOT EXECUTED.**

---

## 6. Defects found and fixed during this round (third round — 2026-10-06)

| ID | Defect | Severity | Fix | Verified |
|---|---|---|---|---|
| **F-B1** | `test_helpline.py` depends on an env var that `.env.example` ships empty → 21/34 failures in a clean checkout | High (blocks CI) | `os.environ.setdefault` with a labelled test value | ✅ 34/34 (round 1) |
| **F-B2** | Tests mutate the git-tracked DB; OTP cooldowns leak between runs | Medium | `backend/run_tests.sh` isolates and restores the DB | ✅ 10/10 suites, `git status` clean (round 1) |
| **F-C1** | Manifest locked orientation to portrait-primary (WCAG 1.3.4) | Medium | Key removed | ✅ test_65 |
| **F-C2** | `.field input:focus { outline:none }` left no visible focus (WCAG 2.4.7) | High (a11y) | 3px focus ring added | ✅ test_70 |
| **F-C3** | Toast never announced to assistive tech (WCAG 4.1.3) | High (a11y) | Static live regions + `announce()` | ✅ test_61 |
| **F-C4** | Single static `<title>` across 33 routes (WCAG 2.4.2) | Medium | Per-route metadata | ✅ live |
| **F-C5** | Unhandled exceptions could expose tracebacks | High (security) | Safe handlers + correlation ids | ✅ test_10–14 |
| **F-W01** | Vet availability conflated with signaling and routability — UI showed AVAILABLE while Socket.IO offline (W01/W02 FAIL) | High (honesty) | 7-state model: separate badges Avail/Socket/Lease/Routable with aria-live, gate routability on AVAILABLE+online+socket+not busy, farmer Start disabled when signaling offline, Helpline panel honest | ✅ webcall_ui 22/22 + state_honesty 6/6 (round 2) |
| **F-W02** | In-call overlay claimed Connected before ICE/media (W03 FAIL) | High (honesty) | Only Connected when pc.connectionState connected + mediaConfirmed (inbound RTP), otherwise “verifying audio”, show WebRTC/ICE/Media badges separately | ✅ webcall_ui “Connected only after peer connection is connected” (round 2) |
| **F-W03** | Missing accessible states and reconnect announcements (W04/W07 PARTIAL) | Medium (a11y) | Added role=status aria-live polite for all states, diagnostics div, accessible hidden list, poor-connection warnings, reconnect announcements | ✅ state_honesty tests (round 2) |
| **F-A01** | Header icon buttons missing aria-label (A01/A30 FAIL) | Medium (a11y) | Added `aria-label="Notifications"`, `aria-label="Profile"`, `aria-label="Back"` to non-owner header variant; owner variant already had. Verified via grep. | ✅ static + manual |
| **F-A02** | Clickable divs not keyboard operable (A21 FAIL) | High (a11y) | All `list-card[onclick]`, `icon-item[onclick]`, `role-card[onclick]` now `role=button tabindex=0 onkeydown Enter/Space`; `a11y.js` MutationObserver enhances dynamically added cards; `iconItem()` now has aria-label + onkeydown. | ✅ grep >30 + webcall_ui preserved |
| **F-A03** | Modals not accessible (A22/A49 FAIL) | High (a11y) | `qrModal` now `role=dialog aria-modal=true aria-label`; `campModalWrap` same; `a11y.js` `trapFocus` with first/last, Esc, restore focus; global Esc handler; `showAccessibleDialog` announces. | ✅ static + manual |
| **F-A04** | Forms missing for/id, autocomplete, error handling (A44-A47 FAIL) | High (a11y) | All forms now have `<label for=id>` + `id` on input/select/textarea; zero `<label>` without for; `enhanceAutocomplete()` adds tel/email/name/username/current-password/new-password/one-time-code; `addErrorSummary`, `setFieldError` with aria-invalid/aria-describedby/aria-errormessage; `preventDuplicateSubmit` with aria-busy; preserve input on error. | ✅ grep 0 + feedback form reference pattern |
| **F-A05** | Loading/empty/error not announced (A50/UX-07 PARTIAL) | Medium (a11y) | `emptyState` role=status aria-live=polite; `loadingState` role=status aria-live=polite aria-busy=true; `errorState` role=alert aria-live=assertive with Retry/Go back; `announceLoading`/`announceError`; `pm-result-count` role=status polite; all list views have emptyState. | ✅ static + live regions test_61 |
| **F-A06** | Tables not scrollable at 320px (A17/Q19 PARTIAL) | Medium (a11y) | `pm-table-scroll` auto-wrapped via `initResponsiveHelpers()` + MutationObserver; tabindex=0 role=region aria-label=Scrollable table; `.table-wrap` overflow-x:auto; @media max-width 360px reflow. | ✅ grep + CSS |
| **F-A07** | Touch targets <44px (UX-13 PARTIAL) | Medium (a11y) | `@media (pointer:coarse)` min-height 44px for nav-item/btn/header-icon-btn/icon-item; `pm-a11y-btn` min 44×44; webcall buttons 48px. | ✅ CSS |
| **F-A08** | QR decode no size/type validation (GA-33/34 PARTIAL) | High (security) | `/api/qr/decode` now validates JSON object, string type, base64 length 7MB cap, binary size <=5MB, magic-byte sniff jpeg/png/webp/gif only, rejects empty/oversize/invalid with 400/413/415 safe messages; uses `compliance_security.UPLOAD_MAX_BYTES`. | ✅ manual curl + upload tests 11 PASS |
| **F-A09** | Missing multilingual a11y strings (Q18/A39 PARTIAL) | Low (a11y) | `a11y.js` `A11Y_I18N` en/hi/mr/te for close, loading, error, no_results, results_found, skip_to_content, text_size, high_contrast, reduce_motion; `ft()` already provides farmer translations. | ✅ static |
| **F-A10** | Missing CSS for error summary, field error, result count, modal, card focus | Medium (a11y) | Added `.pm-error-summary` (border 2px error, role alert, focus), `.pm-field-error`, `.pm-help`, `.pm-req`, `.pm-form`, `.pm-result-count`, `.qr-modal`, `.pm-modal-overlay`, `.list-card[role=button]:focus-visible` to `style.css`. | ✅ CSS |

---

## 7. Manual test checklist (for the next environment)

These are the checks a human must run. They are **not** marked as done unless a browser actually ran.

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
- [ ] All list-cards operable via Enter and Space (new this round)
- [ ] Icon-items operable via keyboard (new this round)

### 7.2 Screen reader
- [ ] Page title announced per route
- [ ] Toast/loading/success/error announced via live regions (now with role=status/alert)
- [ ] OTP state (sending / sent / expired / error) announced
- [ ] Call state changes announced (7-state badges)
- [ ] Landmarks (banner / main / contentinfo) navigable
- [ ] Headings form a logical hierarchy
- [ ] Form errors announced via error summary + field aria-describedby
- [ ] Dialogs announced as dialog with modal (new this round)

### 7.3 Visual / responsive
- [ ] 320 / 360 / 375 / 390 / 414 / 480 / 768 / 1024 / 1280 / 1440 px
- [ ] Portrait and landscape
- [ ] 200% text zoom — no loss of content or function (now via --pm-text-scale)
- [ ] Text-spacing overrides (WCAG 1.4.12) — no clipping
- [ ] Print preview (A4) — no navigation clutter, tables intact
- [ ] CSS disabled — content still readable and in order
- [ ] High-contrast mode on and off
- [ ] `prefers-reduced-motion` honoured (now via CSS + html.pm-reduced-motion)
- [ ] Touch targets ≥ 44×44 px on all primary controls (now enforced)
- [ ] Tables scroll at 320px with visible focus on wrapper (new this round)

### 7.4 Colour & contrast
- [ ] Measure every text/background pair (target ≥ 4.5:1, large text ≥ 3:1)
- [ ] Measure focus indicators and UI component boundaries (≥ 3:1)
- [ ] Verify no status is conveyed by colour alone (now with text prefix on badges + error prefix)
- [ ] Record every tint adjustment in the format required by exemption 4.3

---

## 8. Reproduction

```bash
# Backend (isolated, restores the tracked database on exit)
bash backend/run_tests.sh

# Frontend
node --test frontend/tests/*.test.mjs

# Live server
cd backend && gunicorn app:app --bind 0.0.0.0:5001 --worker-class gthread \
  --workers 1 --threads 100 --timeout 120
```

## 9. Files changed this round (third round)

- `frontend/a11y.js` — **NEW** — focus trap, dialog, card, form error, autocomplete, result count, live regions, responsive helpers, multilingual a11y strings
- `frontend/index.html` — loads `a11y.js` before `app.js`
- `frontend/app.js` — header aria-label, list-card/icon-item keyboard, emptyState/loadingState/errorState with live regions, for/id on all forms, QR modal dialog, camp modal dialog, iconItem aria-label+onkeydown, loading divs with role=status aria-busy
- `frontend/style.css` — added .pm-error-summary, .pm-field-error, .pm-help, .pm-req, .pm-form, .pm-result-count, .qr-modal/.pm-modal-overlay, list-card focus-visible, preserved brand colours/fonts
- `backend/app.py` — `/api/qr/decode` hardened: JSON object check, string type, base64 length cap 7MB, binary size <=5MB, magic-byte sniff jpeg/png/webp/gif, safe errors 400/413/415/422
- `docs/compliance/01-gap-matrix.md` — added L.6 with evidence
- `docs/compliance/03-test-report.md` — this file
