# MASTER FIX PASS — Pashu-Mitra web calling + branding + login UX — final report

**Date:** 2026-10-06
**Branch:** `arena/78af3dc6-pashu-shield-updated` (commit for this pass: see `git log -1`)
**Frontend under test:** https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app/#/owner/webcall
**Backend under test:** https://pashu-shield-backend-hjgr.onrender.com
**ML service:** https://pashu-mitra-ml.onrender.com

Every item below is one of **VERIFIED** (with the command or evidence),
**NOT VERIFIED** (with the reason), or **ACTION REQUIRED** (owner step).
No result is claimed that was not produced by a run.

---

## 1. Root cause of "Signaling offline" (reproduced, not guessed)

`GET /api/health` on the live backend (fetched 2026-10-06, cache-busted) returned
`web_calling.allowed_origins` = the *old* portal origin
(`https://pashu-mitra-smoky.vercel.app`, `...efyqsdomw...`) plus localhost.
The browser was on `https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app`,
which was **not** in the list.

Chain that followed: Engine.IO polling handshake from that origin →
no `Access-Control-Allow-Origin` (and `_on_connect` origin check → `False` for
the WebSocket) → Socket.IO `TransportError` / `connect_error` → the browser
cannot see *why* (browsers never expose CORS details to JS) → socket never
connects → vet cannot hold a live presence lease → routing answers
`NO_LIVE_SESSION` → the panel printed the raw code (`NO_LIVE_SESSION ·
NO_LIVE_SESSION`) instead of a sentence and even named a "matched vet" that was
not routable.

Why it recurs: `render.yaml` is applied when a Render service is **created**;
an existing service keeps its old env values, so each new Vercel preview URL
reintroduces the fault. Two earlier incidents had the same shape.

Two secondary defects were fixed with it: the raw routing code was shown as the
primary sentence (now demoted to developer detail) and `socket_public_url()`
had no fallback (a service that forgot `SIH_PUBLIC_BACKEND_URL` would have
pointed the socket at the Vercel host, where only `/api/*` is rewritten —
`/socket.io` is not).

## 2. Files changed

| File | What changed |
|------|--------------|
| `backend/realtime.py` | explicit `BUILTIN_ALLOWED_ORIGINS` (3 portal origins, no wildcard), origin normalization (whitespace/trailing slash/case/duplicates), wildcard refusal, `origin_diagnostics()`, `RENDER_EXTERNAL_URL` fallback for `socket_public_url()`, actionable rejected-origin log |
| `backend/app.py` | `/api/health` → `signaling_url_source`, `signaling_endpoint`, `allowed_origins_source`; `/api/webcall/config` → `url_source`, `endpoint`, `client_origin`, `client_origin_allowed`; user-facing branding (PDF report title, SMS gateway test text) |
| `backend/webcalling.py` | unchanged logic (verified): presence lease, heartbeat, routing codes |
| `backend/otp_service.py` | OTP SMS text → "Pashu-Mitra: …" (en/mr/hi/te) |
| `backend/ivr_service.py` | IVR welcome prompts (en/te/hi/mr) + helpline actor label |
| `backend/compliance_security.py` | generated error page `<title>` |
| `backend/test_webcalling.py` | new origin/URL/path test class (portal origin with empty env, normalization + wildcard refusal, `RENDER_EXTERNAL_URL` fallback, browser-origin verdict, availability honesty) |
| `backend/test_compliance.py` | logo rule: product logo required, State Emblem still forbidden |
| `backend/tests/webrtc/socketio_origin_check.mjs` | **new** origin/CORS verification tool (allowed → 200 + exact ACAO, unlisted → no ACAO, anonymous → refused) |
| `render.yaml` | `SIH_ALLOWED_ORIGINS` = stable + current + previous preview origins, with the blueprint caveat documented |
| `frontend/call.js` | 12 textual call states + strip, human routing wording, origin verdict (`ORIGIN_NOT_ALLOWED`), retry/reconnect that re-registers presence and refreshes ICE/TURN, honest farmer/vet availability panels |
| `frontend/app.js` | Pashu-Mitra branding, `brandLogoHtml()`, demo-access card, 26 `webcall.*` keys in en/mr/hi/te |
| `frontend/shell.js` | header/footer/titles from `ORG.appName`, logo `<img>` with alt and no-stretch sizing, `onerror` hide |
| `frontend/org-config.js` | single source of the brand: name, local name, tagline, logo path + alt |
| `frontend/index.html`, `manifest.json`, `sw.js` | title/metadata/favicon/apple-touch-icon/PWA icons/notification title |
| `frontend/info-pages.js`, `style.css`, `a11y.js`, `captcha.js` | branding, logo CSS (height-only, `object-fit:contain`), a11y wording |
| `frontend/tests/branding_webcall_states.test.mjs` | **new** branding + logo + dashboard-header + state-honesty tests (11) |
| `frontend/tests/demo_account_ui.test.mjs`, `xss_escaping.test.mjs` | expectations updated for the new copy |
| `docs/compliance/webrtc-production-verification.md` | rewritten with real evidence + what is NOT verified |
| `docs/compliance/browser-accessibility-audit.md` | rewritten for this pass, honest gaps kept |
| `docs/compliance/pashu-mitra-branding-migration.md` | **new** A–F classification of every remaining "Shield" occurrence |
| `frontend/assets/README.md` | logo contract (the file itself is still missing, §12) |

## 3. Environment variables to change (Render → `pashu-shield-backend`)

| Variable | Value | Note |
|----------|-------|------|
| `SIH_ALLOWED_ORIGINS` | `https://pashu-mitra-smoky.vercel.app,https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app` | explicit origins only; code now also carries them as a built-in fallback, so the fix survives even before this edit |
| `SIH_PUBLIC_BACKEND_URL` | `https://pashu-shield-backend-hjgr.onrender.com` | already correct (health confirms); `RENDER_EXTERNAL_URL` fallback now covers a fresh service |
| `SIH_SOCKETIO_PATH` | `/socket.io` | leading slash is mandatory (no `…onrendersocket.io`) |
| `SIH_TURN_URLS` / `SIH_TURN_USERNAME` / `SIH_TURN_CREDENTIAL` | Metered static values (secrets) | `SIH_TURN_SECRET` must stay **empty** (a non-empty secret switches to coturn ephemeral credentials, which Metered rejects) |
| `SIH_GUNICORN_WORKERS` | `1` | Socket.IO rooms are per-process; health reports `worker_configuration_safe: true` |

Redeploy is required for the live service to pick the code up (§19).

## 4. Socket.IO connection — VERIFIED (in code) / ACTION REQUIRED (in production)

* Path is `/socket.io` on both sides. `socketio_path()` normalises every legacy
  spelling (`socket.io`, `/socket.io/`, empty) to `/socket.io` — tests cover it.
* Browser URL is always the Render origin (`https://pashu-shield-backend-hjgr.onrender.com`),
  never the Vercel host and never `…hostsocket.io`; `/api/webcall/config` and
  `/api/health` both publish `signaling.url` + `endpoint` + `url_source`.
* Transports: `["websocket","polling"]`, `tryAllTransports: true` (single worker
  process required for the polling fallback — verified in health).
* JWT: the socket is authenticated with the session token; an unauthenticated
  handshake is refused (verified by the origin tool below).
* Reconnect: `reconnection` on, backoff 800 ms → 6 s, 10 s timeout; on every
  reconnect the client re-registers presence (vet) and re-reads the server
  configuration (ICE/TURN, routability) so nothing stale is reused.
* Logs (never secrets/JWTs): `[WEB_CALL] signaling URL … | path /socket.io |
  transports websocket,polling`, `socket connected sid=… | transport=… |
  endpoint=…`, `presence registered online=…`, `presence heartbeat ok
  online=… | routable=…`.
* Evidence, local instance running this branch:
  `node backend/tests/webrtc/socketio_origin_check.mjs` →
  **PASS — Socket.IO origin + CORS behaviour verified (6 groups)**: allowed
  origin (the current preview) → HTTP 200, engine.io open packet, ACAO exactly
  `https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app`, never `*`; unlisted
  origin → **no ACAO** and refused; anonymous socket refused.
* Production: **ACTION REQUIRED** — the live service still holds the old allow
  list until the Render env is edited and the service redeployed.

## 5. Presence and lease — VERIFIED

`PRESENCE_LEASE_SECONDS = 60`, heartbeat every 20 s (server acks
`presence:heartbeat` with `online` + `routable`), stale leases are swept, and
`drop_presence()` runs on disconnect. Routability requires **all** of:
availability `AVAILABLE` + live authenticated socket + unexpired lease + not
already busy. `AVAILABLE` alone never advertises "receiving calls" — enforced in
code and asserted by `test_webcalling.py` (availability-honesty test) and
`frontend/tests/webcall_state_honesty.test.mjs`.

## 6. Farmer → vet call flow — VERIFIED end-to-end (server side, real WebRTC)

Reason → notes → language → match → ring → accept → mic permission → WebRTC →
connected is implemented and exercised by `backend/tests/webrtc/two_peer_call.mjs`
(13 steps, real `@roamhq/wrtc` peers, signaling only through the server):
routing to the language-matched vet, `call:incoming` delivered to the assigned
vet, offer/answer relayed by the server's durable signal relay, both peer
connections reaching `connected` (ICE + DTLS-SRTP), and server-side state
(`connected_at`) written only after a client confirms media.
Re-run in this pass → **PASS — real two-way WebRTC audio verified**.

## 7. Two-way audio — VERIFIED (packets **and** decoded frames)

The same run: farmer received 247 RTP packets, vet 248; both directions decoded
real audio frames (farmer 502, vet 503). Selected candidate pairs were
`host->host` on one machine, so this proves signaling + SDP + ICE + DTLS + RTP,
**not** the TURN relay path (see §19.3).

## 8. Mute / unmute — VERIFIED (relay) / NOT VERIFIED (button in a browser)

The mute state is relayed to the peer and asserted by the two-peer run ("the
peer learned that the other side is muted"). The farmer and vet *buttons* set
`track.enabled` and emit `call:mute`; clicking them in a real browser is part of
the manual pass (§17).

## 9. Hang-up and second call — VERIFIED

Hang-up finalizes the call (`ended_at`, duration, history entry, terminal
`ended` event received by the vet portal) and the history is authorized for the
participant only. Second call after a hang-up is covered by the backend call
lifecycle tests (`test_webcalling.py`) — both the UI and the API allow a new
call once the previous one is terminal (a cancel after end correctly returns
409, which the test suite asserts).

## 10. Reconnect / refresh — VERIFIED in code, UI evidence on screen

On socket reconnect the client: re-registers presence + heartbeat (vet), reloads
`/api/webcall/config` (fresh ICE/TURN, fresh presence), re-evaluates farmer
routability, and updates the badges. `Retry connection` on both cards and the
browser `online` event call the same path. The vet card additionally stops
claiming "receiving calls" the moment the socket drops (`SIGNALING OFFLINE` /
`NOT RECEIVING CALLS`) instead of leaving a stale AVAILABLE badge.

## 11. Branding — VERIFIED

User-facing "Pashu Shield"/"Pashu-Shield"/"PashuShield" is gone: dashboards,
login, OTP/signup, farmer/vet/govt/lab portals, web-call page, navigation,
titles, footer, loading/empty/error states, PWA manifest, favicon references,
aria-labels/alt text, install prompt, toasts, public pages, and now also the
backend's user-visible strings (OTP SMS in four languages, IVR welcome prompts,
helpline actor label, PDF report title, generated error page title, SMS test
message, ML service title).

Deliberately **not** renamed (renaming would break the deployment, not the
brand): Render services `pashu-shield-backend`/`pashu-shield-ml`, the SQLite
disk name, Vercel project name `pashu-shield-frontend` and its `/api` rewrite
target, the real Vercel origin hostnames (they must match CORS byte-for-byte),
the Asterisk dialplan context, storage keys, routes, and the health `service`
identifiers. Full table:
`docs/compliance/pashu-mitra-branding-migration.md` (classes A–F, 25 remaining
hits in executable code, none of them class A). Verified by the test
"no user-facing 'Pashu Shield' branding remains in any frontend source".

## 12. Logo — ACTION REQUIRED (asset missing)

The official artwork was shown in the conversation but **the upload did not
reach the workspace filesystem** (there is no `uploads/` directory in the
sandbox and outbound downloads from the sandbox are blocked), so the bytes could
not be copied. Nothing was invented to replace it — no redraw, no emoji
substitute, no old logo:

* every logo location already points at `assets/pashu-mitra-logo.png` through a
  single source (`ORG.logo` in `frontend/org-config.js`): header, login/OTP/
  signup, all four dashboards, web-call page, favicon, apple-touch-icon, PWA
  icons (plus `maskable`);
* the `<img>` keeps the file's own aspect ratio (CSS limits **height only**,
  `width:auto; object-fit:contain`) so it cannot be stretched or cropped,
  `alt="Pashu-Mitra…"`, and `onerror` hides it rather than showing a
  broken-image icon;
* the moment the PNG is placed at `frontend/assets/pashu-mitra-logo.png`,
  `node --test frontend/tests/branding_webcall_states.test.mjs` validates it
  (PNG signature, ≥64 px, sane ratio, <2 MB) — that check is the only skip in
  this area and it turns into a real pass automatically.

Add it either locally (`cp … frontend/assets/pashu-mitra-logo.png`) or via the
GitHub web uploader on this branch; no code change is needed afterwards.

## 13. Demo credentials visibility — VERIFIED

The demo mobile number and demo OTP are shown in a clean **"Demo access"** card
(localised in en/mr/hi/te), driven entirely by the server
(`/api/auth/farmer/config` → `demo.mobile`, `demo.otp`, plus the server's own
notice line) — nothing is hard-coded, so the card cannot drift from the backend.
Copy is available to the user, and the card is a labelled group
(`role="group"` + `aria-labelledby`) with the sign-in hint attached by
`aria-describedby`. No auto-verify, no self-granted session, no OTP persistence
was added. The old staff `.demo-box` still works.

## 14. Banner removal — VERIFIED

The demo/development **warning banners** are gone ("Demo mode enabled",
"Demo login", "Using demo credentials", "Development/demo environment"), and no
internal configuration leaks into the UI (`production_override`, mode flags, env
names). Enforced by a scan of every string literal in the bundle (comments may
still describe the prototype; strings may not), plus the requirement that the
non-banner status notices elsewhere in the app are not deleted.

## 15. Backend test results — VERIFIED

```
bash backend/run_tests.sh
  PASS test_regression (10) · test_role_auth (30) · test_farmer_otp_login (60)
       test_webcalling (70) · test_demo_account (34) · test_clerk_login (15)
       test_helpline (34) · test_all_features (12) · test_ml_service (16)
       test_compliance (63)
Suites passed: 10   Suites failed: 0
```

## 16. Frontend test results — VERIFIED

```
node --test frontend/tests/*.test.mjs
# tests 81 · pass 78 · fail 0 · skipped 3
```

The 3 skips are honest skips, not passes:
2 = `webcall_browser.test.mjs` real-browser cases (no browser available),
1 = the logo asset check (§12, file not yet supplied).

`frontend/tests/branding_webcall_states.test.mjs` (new, 11 tests) proves:
no user-facing old branding; one brand source used by the shell; single logo
source + no-stretch CSS + `onerror`; deployment identifiers intentionally
preserved; the demo card is clean, localised and labelled; the dashboard header
renders the official logo with an accessible name for every portal; the twelve
call states are textual; routing codes never become the farmer's sentence; a
refused Origin is reported as such; the availability card hides raw codes and
only names a routable vet.

## 17. Browser tests — NOT VERIFIED

`npx playwright install chromium` cannot download the browser in this sandbox
(no system Chromium either), so the real two-browser run
(`frontend/tests/webcall_browser.test.mjs`, 2 cases) did **not** execute and is
reported as **skipped, not passed**. To run it on a machine with a browser:

```bash
npm install --no-save playwright && npx playwright install chromium
PM_BROWSER_URL=https://pashu-shield-backend-hjgr.onrender.com \
PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=*** \
PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
node --test frontend/tests/webcall_browser.test.mjs
```

The written manual checklist (login → demo access → both dashboards → web call →
accept → audio → mute/unmute → hang-up → second call → refresh/reconnect →
logo/branding → responsive → keyboard → 200 % zoom → 320/360 px) is in
`docs/compliance/webrtc-production-verification.md` §6.

## 18. Accessibility — PARTIAL PASS, gaps unchanged and listed

Preserved and re-verified by tests/inspection: keyboard paths, `:focus-visible`
ring, labels, `autocomplete`/`one-time-code`, `aria-describedby`, error summary
as a live region, polite/assertive live regions, `sr-only` text, 44 px targets
(`@media (pointer:coarse)`), 200 % text scaling, 320 px reflow, reduced motion,
opt-in high contrast, and full en/mr/hi/te coverage of the new strings.
New in this pass: every call state is text as well as colour (one
`aria-current="true"` in a 12-item list), raw routing codes are no longer read
out (developer detail only), the demo card is a labelled group, and the logo has
a real `alt`.
**NOT VERIFIED here:** axe-core/pa11y/Lighthouse scans, real screen readers,
real zoom/reflow, live captions for audio (known gap A-9), and the logo's own
contrast (asset missing). No "100 % compliant" claim is made —
`docs/compliance/browser-accessibility-audit.md` lists every gap (A-1…A-15).

## 19. Remaining blockers (exact, no hand-waving)

1. **Render redeploy** — the code fix is on the branch; the live service needs
   the Render env edit (§3) + redeploy before the production origin is accepted.
   Verify with `GET /api/health` → `web_calling.allowed_origins` must contain the
   browser's own origin, and
   `GET /socket.io/?EIO=4&transport=polling` from that origin must answer 200
   with an exact `Access-Control-Allow-Origin`.
2. **Vercel preview URLs change on every deploy** — keep one stable production
   domain (recommended) or add the new origin explicitly; never a wildcard.
3. **TURN relay path not exercised** — credentials are served and configured
   (`turn_configured: true`, `turn_mode: "static"`, `turn_url_count: 4`,
   `ice_transport_policy: "all"`), but no relay candidate was used here. Test
   with two different networks, or set `SIH_ICE_TRANSPORT_POLICY=relay`
   temporarily to force it.
4. **Real two-browser / real-mic verification** — §17; needs a machine with a
   browser (Playwright download is blocked in this sandbox).
5. **Logo asset** — §12; place the supplied PNG at
   `frontend/assets/pashu-mitra-logo.png`.

---

## Appendix — full production chain trace

| # | Link | How it is proven | Status |
|---|------|------------------|--------|
| 1 | Vercel page loads on the preview origin | live fetch of the deployment | VERIFIED (health + page fetch) |
| 2 | Browser sends `Origin: https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app` | `socketio_origin_check.mjs` sends that exact header | VERIFIED locally; ACTION REQUIRED after redeploy |
| 3 | Render receives both `/api/*` and `/socket.io` (the Vercel rewrite covers `/api` only) | `socket_public_url()` returns the Render origin, never the Vercel host | VERIFIED (config + tests) |
| 4 | CORS: exact `Access-Control-Allow-Origin`, never `*`, unlisted origin → no header | origin tool, 6 groups | VERIFIED |
| 5 | Flask-SocketIO handshake `GET /socket.io/?EIO=4&transport=polling` → 200 + open packet | origin tool | VERIFIED |
| 6 | WebSocket upgrade (`transport=websocket`) accepted for an allowed, authenticated client | origin tool (second probe) | VERIFIED |
| 7 | JWT auth on the socket; anonymous handshake refused | origin tool (third probe) | VERIFIED |
| 8 | Presence registration on connect (`presence registered online=true`) | socket handler + heartbeat tests | VERIFIED |
| 9 | Lease renewal (`presence heartbeat ok`, 20 s < 60 s lease) + sweeper of stale leases | `test_webcalling.py` presence/sweeper class | VERIFIED |
| 10 | Routing: `district_language_load_v1` scoring, skip codes (`NOT_AVAILABLE:*`, `NO_LIVE_SESSION`, `LANGUAGE_NOT_SUPPORTED`, `BUSY_WEB_CALL`, `BUSY_IVR_CALL`) | backend tests + two-peer run | VERIFIED |
| 11 | Incoming call delivered to the assigned vet (`call:incoming`) | two-peer run step 3 | VERIFIED |
| 12 | Offer relayed through the server's durable signal relay | two-peer run | VERIFIED |
| 13 | Answer recorded atomically by the server | two-peer run step 4 | VERIFIED |
| 14 | ICE: STUN + TURN (UDP/TCP/TLS) offered, `iceTransportPolicy: "all"`, credentials only to authenticated users | `/api/webcall/config` (auth) + health (secret-free) | VERIFIED (configuration) |
| 15 | TURN **relay** candidate actually used | — | NOT VERIFIED (§19.3) |
| 16 | DTLS-SRTP: both peer connections `connected` | two-peer run | VERIFIED |
| 17 | RTP both ways (packets **and** decoded frames) | two-peer run: 247/248 packets, 502/503 frames | VERIFIED |
| 18 | Mute relayed to the peer | two-peer run | VERIFIED |
| 19 | Hang-up finalizes state, timestamps, duration, history, terminal event | two-peer run + backend tests | VERIFIED |
| 20 | Second call after a terminal call | backend lifecycle tests | VERIFIED |
| 21 | Reconnect restores presence, renews the lease, refreshes ICE/TURN, updates the UI | client code + tests; vet card drops the "receiving calls" claim while offline | VERIFIED in code / UI (browser run NOT VERIFIED, §17) |
