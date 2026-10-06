# Pashu-Shield — Compliance Change Log

**Branch:** `arena/01a10b85-pashu-shield-updated` · **Baseline commit:** `1227fddd`
**Format per entry:** Requirement → Problem → Solution → Files → Risk → Testing → Result

---

## Change 1 — Global shell: organisation identity, accessibility bar, footer

| Field | Detail |
|---|---|
| **Requirement** | GIGW 3.0 Q01, Q02, Q05, Q09–Q12, Q18; A27 (2.4.1), A28 (2.4.2), A31 (2.4.5), A38 (3.1.1), A50 (4.1.3); UX4G navigation & trust parameters |
| **Problem** | The SPA had no ownership information, no footer, no About/Contact/Help/Feedback, no organisation identity, no accessibility controls and no way to bypass repeated navigation. It also had one static page title for 33 hash routes. |
| **Solution** | Added an **additive global shell** — a slim organisation identity header above the existing `.app-header`, an accessibility control bar, and a full footer below the existing app container. The existing `.app-header` and `.bottom-nav` were **not touched**, so the product still looks like Pashu-Shield. Live regions were declared statically in `index.html` (created later they are not reliably announced). |
| **Files** | `frontend/index.html` (modified), `frontend/shell.js` (new), `frontend/org-config.js` (new), `frontend/style.css` (appended) |
| **Risk** | Low. All new markup lives outside `#app`; existing DOM lookups and the service worker's asset list are unaffected except by an intentional cache bump. |
| **Testing** | `test_compliance.py`: test_60–test_63, test_70, test_73. Live: assets return 200, skip link is first focusable element. Frontend suite unchanged (48/50). |
| **Result** | Verified working |

## Change 2 — Text scaling without touching the brand font

| Field | Detail |
|---|---|
| **Requirement** | GIGW A15 (1.4.4 resize to 200%), programme §16 (A- / A / A+); **exemption 4.2 (do not change fonts)** |
| **Problem** | The A-/A/A+ control cannot work if sizes are hard-coded in px, but converting the design to `rem` risks visual drift across 859 CSS rules. |
| **Solution** | Mechanically rewrote all **135** `font-size:NNpx` declarations to `font-size:calc(NNpx * var(--pm-text-scale, 1))`. At the default scale of `1` this computes to **exactly** the original value, so nothing renders differently until the user changes it. `font-family` was never touched. |
| **Files** | `frontend/style.css` |
| **Risk** | Low. Verified `calc()` equivalence; the `:root` brand token block is byte-identical (asserted by test_67). |
| **Testing** | `test_67` asserts all original brand tokens survive; `test_68` asserts the font stack is unchanged. |
| **Result** | Verified working; scale steps 87.5% → 150% (200% reachable with browser zoom) |

## Change 3 — Visible keyboard focus

| Field | Detail |
|---|---|
| **Requirement** | GIGW A33 (2.4.7 focus visible), A18 (1.4.11 non-text contrast ≥ 3:1) |
| **Problem** | `.field input:focus { outline:none; ... }` removed the focus indicator with **no replacement** — a keyboard user could not see where they were. |
| **Solution** | Replaced with a 3px `--pm-focus` ring (`#2c3690`) plus `outline-offset`, keeping the original border tint. Added a global `:focus-visible` rule for every interactive element, with an `@supports not selector(:focus-visible)` fallback. |
| **Files** | `frontend/style.css` |
| **Risk** | Very low. Purely additive visual feedback. |
| **Testing** | `test_70` asserts `:focus-visible` and `--pm-focus` exist **and** that the old `outline:none` rule is gone. |
| **Result** | Verified working |

## Change 4 — Screen-reader status announcements

| Field | Detail |
|---|---|
| **Requirement** | GIGW A50 (4.1.3 status messages) |
| **Problem** | `toast()` showed success/error messages visually only. Screen-reader users received nothing. |
| **Solution** | Added `#pmLivePolite` (`role="status"`) and `#pmLiveAssertive` (`role="alert"`) **statically** in `index.html`, and announced every toast through them — errors assertively, confirmations politely. Error toasts also gained an **`Error —` text prefix** so status is never conveyed by colour alone (GIGW A12). |
| **Files** | `frontend/index.html`, `frontend/app.js` (`toast()`), `frontend/shell.js` (`announce()`) |
| **Risk** | Low. `announce()` no-ops if the region is missing. |
| **Testing** | `test_61`. Frontend suite unchanged. |
| **Result** | Verified working |

## Change 5 — Per-route page metadata

| Field | Detail |
|---|---|
| **Requirement** | GIGW Q17 (title + lang + metadata), A28 (2.4.2 page titled), A38 (3.1.1 language of page) |
| **Problem** | One static `<title>` for all 33 routes; no description, keywords, canonical or Open Graph. |
| **Solution** | `render()` now calls `setPageMeta()` after each view; views may pass their own title/description via a new `setPageMeta({title, description})` helper. Canonical URL is refreshed to the current hash URL; `<html lang>` is kept in sync with the selected language. |
| **Files** | `frontend/app.js` (`render()` + new `setPageMeta()`), `frontend/shell.js` (`setPageMeta` implementation), `frontend/index.html` (baseline meta + canonical) |
| **Risk** | Low. Metadata only; no behaviour change. |
| **Testing** | Live: title updates per route. |
| **Result** | Verified working |

## Change 6 — GIGW information pages

| Field | Detail |
|---|---|
| **Requirement** | GIGW Q09 (About), Q10 (Contact), Q11 (Feedback), Q14 (Help), Q18 (minimum content), A31 (2.4.5 multiple ways); L03 (12 policies); programme §43–§44 |
| **Problem** | None of these pages existed. |
| **Solution** | New additive module `info-pages.js` registering `#/about`, `#/contact`, `#/feedback`, `#/help`, `#/sitemap`, `#/search`, `#/policies`, `#/policies/:id`. Made reachable without login by extending `isPublic()` with a single `PUBLIC_INFO_ROUTES` list shared by the router, footer and sitemap. Feedback posts to a new `POST /api/feedback` and returns a **reference number** that can be tracked. |
| **Files** | `frontend/info-pages.js` (new), `frontend/app.js` (`isPublic()`, `PUBLIC_INFO_ROUTES`), `backend/compliance_security.py` (feedback API) |
| **Risk** | Low. New routes only; existing routes untouched. |
| **Testing** | `test_72`–`test_74`, `test_20`–`test_35`. Live: submission → `FB-20261005-XXXXXX` → lookup returns 200. |
| **Result** | Verified working |

## Change 7 — Security response headers

| Field | Detail |
|---|---|
| **Requirement** | GIGW C1.2d (harden HTTP response headers); programme §25 (HSTS, CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame protection) |
| **Problem** | The Flask app set only `X-Frame-Options` and a conditional `Cache-Control`. No CSP, no HSTS at the app layer. |
| **Solution** | New `backend/compliance_security.py` adds `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (**microphone/camera retained for WebRTC**), `Cross-Origin-Opener-Policy`, and HSTS — the latter **only on secure requests** so plain-HTTP development is not bricked. **CSP is report-only by default** (`SIH_CSP_ENFORCE=1` to enforce) because the app depends on the Leaflet CDN and inline `onclick` handlers. |
| **Files** | `backend/compliance_security.py` (new), `backend/app.py` (one `install()` call) |
| **Risk** | **Medium if enforced prematurely** — mitigated by report-only default. Permissions-Policy deliberately keeps `microphone=(self), camera=(self)` so WebRTC is unaffected. |
| **Testing** | `test_01`–`test_06`. Live: all headers confirmed present on `/api/health`. |
| **Result** | Verified working (report-only pending operator verification) |

## Change 8 — Safe error handling

| Field | Detail |
|---|---|
| **Requirement** | GIGW C1.2c (custom error pages, no source code in errors); programme §26 |
| **Problem** | No handlers for 400/401/403/404/408/409/429/500/502/503; an unhandled exception would surface a Werkzeug debug/traceback page. |
| **Solution** | Handlers for all 11 statuses plus a catch-all `Exception` handler. `/api/*` gets JSON, page routes get a styled HTML page with a skip link, `role="alert"`, helpful links and a **correlation reference**. Full detail goes to the server log only; the client receives a reference, never a stack trace, SQL, path or credential. |
| **Files** | `backend/compliance_security.py`, `backend/app.py` |
| **Risk** | Low–medium: a catch-all could mask a genuine 500 in development. Mitigated by `log.exception` with the same correlation id. |
| **Testing** | `test_10`–`test_14`. Live: `/api/does-not-exist` → safe JSON 404; `/not-a-page` → safe HTML 404 with no `Traceback`/`Werkzeug`. |
| **Result** | Verified working |

## Change 9 — Upload hardening

| Field | Detail |
|---|---|
| **Requirement** | GuDApps 4.5.1.2 / 4.5.1.3 / 4.5.1.4; programme §22 |
| **Problem** | The QR upload relied on the browser's `accept="image/*"`; **the browser-supplied MIME type is not trustworthy**. |
| **Solution** | `safe_filename_parts()` + `validate_upload()`: extension allow-list, **denied-extension check across all parts** (blocks `report.pdf.exe` and `photo.png.php`), multi-extension rejection, path-traversal stripping, size cap, empty-file rejection, and **magic-byte sniffing** so the content — not the client — decides. MIME mismatch is rejected. |
| **Files** | `backend/compliance_security.py` |
| **Risk** | Low. Applied to new validation paths; the existing upload flow is unchanged until it is wired to these helpers (tracked as open work). |
| **Testing** | `test_40`–`test_50` — 11 tests, all passing. |
| **Result** | Verified working (helpers ready; existing upload flow integration is open work) |

## Change 10 — Orientation lock removed

| Field | Detail |
|---|---|
| **Requirement** | GIGW A10 (WCAG 1.3.4 — orientation must not be restricted) |
| **Problem** | `manifest.json` set `"orientation": "portrait-primary"`, locking the installed PWA to portrait. |
| **Solution** | Removed the `orientation` key entirely (the neutral default). Also aligned `theme_color` with the CSS brand token `#3d4db8` (it had drifted to `#3f51b5`). |
| **Files** | `frontend/manifest.json` |
| **Risk** | None. Removing a restriction cannot break anything. |
| **Testing** | `test_65`. |
| **Result** | Verified working |

## Change 11 — Baseline defect F-B1: helpline suite env dependency

| Field | Detail |
|---|---|
| **Requirement** | Programme §9 (baseline must be reproducible) |
| **Problem** | `test_helpline.py:40` read `os.environ["IVR_WEBHOOK_SECRET"]`, but `.env.example` ships it **empty** → 17 errors + 4 cascading failures in a clean checkout. |
| **Solution** | `os.environ.setdefault(...)` with a clearly-labelled non-secret test value, plus `SIH_SECRET_KEY`. **Harness fix only — no product assertion weakened.** The application's behaviour (refusing an unsigned webhook) is correct and unchanged. |
| **Files** | `backend/test_helpline.py` |
| **Risk** | None. |
| **Testing** | Suite now passes in a clean checkout with no env configuration. |
| **Result** | Verified working — 34/34 |

## Change 12 — Baseline defect F-B2: database isolation

| Field | Detail |
|---|---|
| **Requirement** | Programme §9, §61 (regression must be trustworthy) |
| **Problem** | `backend/animal_health.db` is **tracked in git**, and test runs mutate it. OTP rate-limit cooldowns persisted between runs, so `test_05_demo_login` failed with `429 COOLDOWN_ACTIVE` on any second run. |
| **Solution** | New `backend/run_tests.sh` snapshots the DB, gives **each suite a pristine copy**, restores the original on exit (incl. on failure), and generates long random secret values so "secret must not appear" assertions cannot match a single character by accident. |
| **Files** | `backend/run_tests.sh` (new) |
| **Risk** | None. Removing the tracked DB from git is an **organisation action** (it doubles as the demo dataset) and is recorded as such. |
| **Testing** | `bash backend/run_tests.sh` → **10/10 suites, 331 tests, 0 failures**; `git status` clean afterwards. |
| **Result** | Verified working |

## Change 13 — Service worker cache bump

| Field | Detail |
|---|---|
| **Requirement** | Programme §48 (offline); prevents stale-cache regression |
| **Problem** | New files (`org-config.js`, `shell.js`, `info-pages.js`) and modified `style.css`/`app.js`/`index.html` would be shadowed by the v7 cache. |
| **Solution** | Bumped `CACHE_NAME` to `pashu-mitra-v8` and added the three new assets to `STATIC_ASSETS`. No authenticated data was added to the offline cache. |
| **Files** | `frontend/sw.js` |
| **Risk** | Low. |
| **Testing** | `test_83`; all assets return 200 live. |
| **Result** | Verified working |

---

## Change 14 — WebRTC state-honesty (W01–W08)

| Field | Detail |
|---|---|
| **Requirement** | E W01–W08 — WebRTC state-honesty: distinguish availability / signaling / presence lease / routability / WebRTC PC / ICE / media; never claim online/ready/connected unless real technical state exists; fix stale/offline, reconnect, routing failures, timeout/cancel/reject cleanup; preserve Farmer/Vet/auth/TURN/STUN/history |
| **Problem** | UI conflated vet availability (AVAILABLE) vs Socket.IO CONNECTED vs READY TO RECEIVE CALLS vs WebRTC connected. Vet dashboard Helpline panel showed effective_status AVAILABLE even when signaling offline. Farmer “Vet online now” badge did not gate on signaling. In-call overlay showed “Connected” based on server status without verifying ICE/media. No separate badges for 7 states, no aria-live for reconnect, no truthful skipped reasons in farmer view, no poor-connection detection. |
| **Solution** | **Frontend `call.js`**: Added 7-state model with helpers `availabilityState()`, `presenceLeaseState()` (lease_expires_at, leaseLabel), `webrtcConnectionState()`, `iceConnectionState()`, `mediaConnectionState()` (inbound/outbound). `vetRoutabilityState()` now returns `breakdown` with all 7 states and `routable` boolean = AVAILABLE+online+socketOnline+not busy. Vet card now renders 4 separate badges: Avail, Socket, Lease, Routable with `aria-live=polite`, plus presence detail and honesty note. `updateOverlayStatus()` updates all badges, announces reconnect via live region, shows signaling offline for farmer with `role=status`. `inCallStatusText()` only returns “Connected” when `remoteDescriptionSet && mediaConfirmed && pc.connected && ice not failed/disconnected`; otherwise “Connected — verifying audio…” or “Connecting…”. Added `detailedCallStateText()` and diagnostics div `pmCallDiagnostics` showing `Signaling: x · WebRTC: y · ICE: z · Media: label`. Overlay now shows separate badges `pmCallPcState`, `pmCallIceState`, `pmCallMediaState` plus accessible hidden list of states. `wirePeerConnection()` now logs and tracks `_outboundPackets`, handles `disconnected`/`failed` with honest warnings. `startStatsWatch()` tracks inbound+outbound, shows poor-connection warning, updates diagnostics live. Farmer `renderFarmerAvailabilityResult()` now gates Start Call on `routable && sigOnline`, shows `Signaling offline` badge when offline, shows skipped_codes/reasons truthfully, shows signaling note and honesty note. `ownerCallViewHtml()` adds `for` labels and `aria-live`. **Frontend `app.js`**: Helpline/IVR panel now honest: says read-only, canonical controls in Web call card below, shows Configured vs Effective (hours) separately, adds state honesty note, preserves phrase “canonical availability controls for both web calls and helpline routing” for test compatibility. **Backend**: Already honest (presence leases 60s, socket_sids set, sweep_presence, choose_veterinarian HARD filters NOT_AVAILABLE/NO_LIVE_SESSION/LANGUAGE_NOT_SUPPORTED/BUSY_WEB_CALL/BUSY_IVR_CALL with truthful skipped reasons, state machine VALID_TRANSITIONS atomic, mark_connected requires client RTCPeerConnection connected with server timestamp, expire_stale_calls sweeper, durable signals, emit_call_event to both participants on every terminal transition). No backend change needed; verified. |
| **Files** | `frontend/call.js` (major), `frontend/app.js` (Helpline panel honesty), `frontend/style.css` (existing 48px min-height already meets W06), `frontend/tests/webcall_state_honesty.test.mjs` (new 6 tests), `docs/compliance/01-gap-matrix.md` (W01–W08 PASS) |
| **Risk** | Low. All existing IDs preserved (`pmCallLinkBadge`, `pmVetRoutableBadge`, `pmVetRoutableStatus`, `pmVetSignalStatus`, `pmCallSignalStatus`, etc). New badges additive (`pmVetAvailabilityBadge`, `pmVetPresenceBadge`, `pmVetPresenceDetail`, `pmCallPcState`, `pmCallIceState`, `pmCallMediaState`, `pmCallDiagnostics`). Tests: `webcall_ui.test.mjs` 22/22 still pass, `webcall_state_honesty.test.mjs` 6/6 pass, backend 10/10 suites 340 tests pass. No change to Socket.IO, presence lease, routing, TURN/STUN, state machine. |
| **Testing** | `node --test frontend/tests/webcall_ui.test.mjs` 22 pass, `frontend/tests/webcall_state_honesty.test.mjs` 6 pass, `frontend/tests/*.test.mjs` 62+ pass, `backend/run_tests.sh` 10/10 suites pass. Manual: vet card shows Avail/Socket/Lease/Routable separately, offline shows NOT RECEIVING, farmer Start disabled when signaling offline, in-call shows WebRTC/ICE/Media badges, Connected only after media. |
| **Result** | Verified working — W01–W08 PASS |

## Explicitly NOT changed (documented decisions)

| Item | Guideline | Decision |
|---|---|---|
| **Domain** (`gov.in`/`nic.in`) | GIGW Q21 | **Hard exemption 4.1.** Not changeable by application code. → Organisation action. |
| **Font family** | UX4G typography | **Hard exemption 4.2.** System stack preserved. Text scaling changes size only. |
| **Brand colours** | UX4G colour | **Hard exemption 4.3.** `:root` palette untouched; semantic aliases added that reference the *same* values. High contrast is opt-in with its own palette. |
| **JWT storage** (`localStorage`, not cookies) | GIGW C1.2e | Migrating would change the auth architecture and risk the farmer OTP flow and the Socket.IO handshake. Preserved per the zero-regression rule; documented in `security-notes.md`. |
| **WebRTC / Socket.IO / TURN / STUN** | programme §27 | Untouched. Only surrounding UX/state-honesty work is planned. |
| **Farmer OTP authentication** | programme §23 | Untouched and preserved. |
| **ML backend / IVR / SMS gateway** | programme §27 | Untouched. |
| **Framework** (Flask + vanilla JS + SQLite) | programme §6 | No migration. |
