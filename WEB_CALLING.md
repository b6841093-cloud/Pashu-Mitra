# Real-time web calling (farmer ↔ veterinarian)

Two-way, real-time **WebRTC audio** calling between the existing farmer portal and
the existing veterinary portal, with server-authoritative routing, state and
authorization. This document is the implementation report: architecture, files,
migrations, environment, deployment, the tests that were actually executed (and
the ones that were not), remaining blockers, and a verification checklist.

Authoritative verification ladder: `backend/tests/webrtc/README.md`.

| Layer | State |
|-------|-------|
| Backend (FSM, routing, signaling, auth, push) | Implemented, **47/47 tests pass** |
| Portal client (`frontend/call.js`) | Implemented, **41/43 client tests pass**, 0 fail, 2 skipped (the browser rung; no browser here) |
| Real two-peer WebRTC audio through the real API | **Executed and passed** (`backend/tests/webrtc/two_peer_call.mjs`) |
| Media over a TURN relay | **Executed and passed** against a real TURN server (`relay`→`relay`, 511/512 decoded frames) |
| Web Push send path (VAPID, encryption, 410 pruning) | **Executed and passed** (`backend/tests/deploy/push_loopback_check.py`, 20 checks) |
| Realtime delivery under the deployed worker model | **Executed and passed** (`backend/tests/deploy/deploy_check.mjs`, 22 checks); the same check **fails** on the old `--workers 2` model |
| Two real browsers (Playwright) | Implemented, **not executed here** (no browser in the build environment) |
| Production TURN/VAPID values, PSTN bridging | **Not provisioned** — see Blockers |

---

## 1. Architecture (and why)

```
 Farmer portal (plain HTML/CSS/JS SPA, Vercel)
        │  REST  /api/*            (JWT, existing auth)
        │  WSS   Socket.IO         (same JWT in the handshake)
        ▼
 Flask app  ── webcalling.py   : call FSM, routing, presence, persistence
 (Render)   ── realtime.py     : ONE signaling layer (Flask-SocketIO)
            ── turn_config.py  : STUN/TURN ICE config, short-lived credentials
            ── push_service.py : Web Push (existing), used for incoming calls
            ── SQLite (SIH_DB_PATH) : web_calls / web_call_events /
                                      web_call_signals / vet_presence
        ▲
 Vet portal (same SPA, vet role)   ── WebRTC media: browser ↔ browser
```

Decisions and the reasoning behind them:

* **Media is peer-to-peer WebRTC; the server never touches audio.** Only SDP/ICE
  are relayed. That keeps the server cheap and keeps call audio out of the
  backend's trust boundary.
* **One signaling technology.** Flask-SocketIO (WebSocket, `simple-websocket`,
  threading async mode) — no second stack, no third-party signaling service. A
  free public signaling service was deliberately not used: it has no production
  SLA and no permanent free tier, and the feature must not depend on one.
* **Signaling is durable, not just live.** Every signal is written to
  `web_call_signals` before it is emitted, and every client also reconciles
  through `GET /api/webcall/calls/<id>/signals?after=<id>`. This is what makes
  the feature survive a page refresh, a reconnect and a dropped socket frame.
* **The worker model is part of the design, and it was measured.** Socket.IO
  rooms live in the process that owns the socket, so a REST-triggered event such
  as `call:incoming` is only delivered if the same process handles the HTTP
  request that created the call. Measured on 2026-10-04 with gunicorn 23.0.0:
  `--workers 2` (sync) → long-polling sessions die with `Invalid session` and
  **0 of 6** incoming-call events were delivered across workers, and `--workers 1`
  (sync) → one open socket blocks every other REST request for the full 120 s
  `--timeout`, which would fail the platform health check. The deployment
  therefore runs **`--worker-class gthread --workers 1 --threads 100`**, which
  delivered **4 of 4** events in 5–9 ms with a 3 ms REST median and stayed alive
  through 65 s idle (4 heartbeats). Setting `SIH_REDIS_URL` enables Socket.IO's
  message queue and makes multiple workers safe (still with the durable signal
  log as the safety net). `backend/tests/deploy/deploy_check.mjs` asserts this
  behaviour against any deployment, and reports the wrong worker model loudly.
* **The database is the authority for call state.** `POST /accept` is an atomic
  compare-and-set on the call row, so two veterinarians cannot both answer; the
  unique partial indexes (`uq_web_calls_active_vet`, `uq_web_calls_active_caller`)
  make a second simultaneous live call impossible at the storage layer.
* **Identity comes from the JWT and the database, never from the client.** The
  caller's id/role/region/language are read from `g.user` and the users table; a
  socket handshake re-verifies the token and reloads the user, so a
  client-supplied vet id, role or location is meaningless.
* **Availability is explicit and evidence-based.** The vet *chooses*
  `AVAILABLE` (persisted in the pre-existing `vet_availability` table); liveness
  is a separate 60-second presence lease in `vet_presence` refreshed by a socket
  heartbeat. A vet whose browser is closed expires out of availability without
  anyone toggling a switch — a stored `online` flag was rejected as a lie that
  goes stale.
* **Routing is a documented, deterministic policy** (`district_language_load_v1`):
  hard filters (explicitly available, live lease, speaks the farmer's language,
  not already on a web/IVR call), then scoring (same district +100, adjacent
  +25, same state +10, same block +20, prior case with this farmer +35,
  specialisation +15, minus current case load and live calls). When nobody
  qualifies the API says so — with the machine-readable reasons
  (`skipped_codes`) — instead of pretending a call is ringing.
* **Push reuses the existing plumbing**: the existing service worker is extended
  (same file, bumped cache version) and the pre-existing `push_subscriptions`
  table + `/api/push/*` endpoints are reused. No second push system.
* **Web calls are not phone calls.** The existing helpline and `/api/ivr/*`
  routes are untouched; web calling is an additional channel inside the portal,
  not a replacement, and it does not simulate "Press 1–4".

### Call state machine (server-enforced)

`created → ringing → accepted → connecting → connected → ended`, plus the
terminal states `rejected`, `cancelled`, `missed`, `busy`, `failed`, `expired`.
Only `webcalling.VALID_TRANSITIONS` are permitted; every transition is an atomic
compare-and-set with its own timestamp (`ringing_at`, `accepted_at`,
`connected_at`, `ended_at`) and an `end_reason`; every call action is written to
`web_call_events` and `audit_log`.

The client shows **"Connected" only after the browser's `RTCPeerConnection`
reports connected** (ICE + DTLS-SRTP established) and posts that fact; the
server only then records `connected_at`. Ring tones stop on every terminal state
because the ringtone is owned by the call state, not by a button.

---

## 2. Files inspected before changing anything

* Backend: `backend/app.py` (~4.6k lines — auth/JWT/roles, `/api/vet/availability`,
  `/api/vets`, cases/animals, helpline + IVR routes and their webhook security,
  admin/diagnostics, push endpoints), `backend/database.py` (schema conventions,
  seeds, `init_db`, `audit_log`, `next_code`), `backend/push_service.py`,
  `backend/ivr_service.py`, `backend/ivr_config.py`, `backend/ivr_security.py`,
  `backend/case_service.py`, `backend/otp_service.py`, `backend/sms_gateway.py`,
  `backend/demo_auth.py`, `backend/telephony.py`, and the existing test suites
  (`test_regression.py`, `test_role_auth.py`, `test_demo_account.py`,
  `test_farmer_otp_login.py`, `test_all_features.py`, `test_helpline.py`,
  `test_ml_service.py`) to match conventions.
* Frontend: `frontend/app.js` (state/token handling, i18n blocks for
  en/mr/hi/te, router, `ownerDashboard`, `vetDashboard`, `render`, `header`,
  `bottomNav`, toast, service-worker registration), `frontend/index.html`,
  `frontend/sw.js`, `frontend/style.css`, `frontend/vercel.json`,
  `frontend/manifest.json`.
* Deployment: `render.yaml`, `.env.example`, `.gitignore`.
* **The attached `Free-Call-No-Twilio-Doctor-Lifts.html` was not present in the
  repository, the branch history, or the sandbox** (searched by name and by
  content). Nothing could be audited or copied from it, and nothing in this
  implementation depends on it. The anti-patterns it was described as containing
  — random/hardcoded Peer IDs, localStorage as the routing authority,
  `simulateIVR()`, fake "Connected" states, a single global `currentCall`, no
  rejection/timeout/mic cleanup, STUN-only ICE — are all deliberately absent
  here; every one of them is replaced by a server-side or browser-native
  mechanism described in section 1.

---

## 3. Files created / modified

**Created**

| File | Purpose |
|------|---------|
| `backend/webcalling.py` | Call FSM, routing, presence leases, durable signaling, push dispatch, history/serialization |
| `backend/realtime.py` | The single Socket.IO signaling layer: JWT handshake, private rooms, `call:signal`, `call:mute`, `presence:heartbeat`, sweeper |
| `backend/turn_config.py` | STUN/TURN ICE config; ephemeral coturn credentials (HMAC-SHA1, REST API) with a static-credential fallback; never exposes a secret to the browser |
| `backend/test_webcalling.py` | 47 backend tests |
| `backend/tests/webrtc/README.md` | The verification ladder + manual two-browser procedure |
| `backend/tests/webrtc/two_peer_call.mjs` | **Real two-peer WebRTC audio test** against the running API; honours the server's ICE policy and asserts a `relay`→`relay` pair when TURN is forced |
| `backend/tests/webrtc/local_turn_ephemeral.mjs` | A real TURN server for local verification, implementing coturn's REST (shared-secret) credential mode so the ephemeral-credential path can be proven without coturn |
| `backend/tests/deploy/deploy_check.mjs` | **Deployment smoke test**: health/config, auth, both socket transports, real `call:incoming` delivery (catches the multi-worker bug), TURN/push presence, authorization, terminal state |
| `backend/tests/deploy/push_loopback_check.py` | End-to-end Web Push delivery check against a stand-in push service: VAPID signature, `aes128gcm` encryption, TTL/urgency, 410 pruning |
| `frontend/call.js` | Portal calling client: signaling, real `RTCPeerConnection`, ringtone, overlays, availability card, call history, push opt-in |
| `frontend/vendor/socket.io.min.js` (+ LICENSE, README.md) | Vendored Socket.IO client **4.8.4** (CDNs blocked in the build environment; update recipe documented in that folder) |
| `frontend/tests/webcall_ui.test.mjs` | 15 client tests (VM sandbox, DOM/WebRTC/socket fakes) |
| `frontend/tests/webcall_browser.test.mjs` | 2 Playwright two-browser tests (skip with a reason when unstaged) |
| `WEB_CALLING.md` | This report |

**Modified**

| File | Change |
|------|--------|
| `backend/app.py` | `init_realtime(...)` wiring, ~255-line `/api/webcall/*` section, `web_calling` block in `/api/health`, `first_signal_id` in the signals response |
| `backend/database.py` | `SCHEMA_WEBCALL` + `ensure_webcall_tables()` called from `init_db()` |
| `backend/requirements.txt` | Flask-SocketIO / python-socketio / python-engineio / simple-websocket, and `pywebpush` |
| `backend/tools/vapid_keys.py` | **Created**: prints a ready-to-use VAPID key pair (base64url) with a self-check, so operators never generate keys with the wrong encoding |
| `frontend/app.js` | 10 new `farmer.*` i18n keys in **all four** languages (en/mr/hi/te); `PMCall.onAuthChanged()` on login/logout; a "Call a Veterinarian" action card on the farmer dashboard; `#pmVetCallHost` on the vet dashboard; routes `#/owner/webcall`, `#/owner/calls`, `#/vet/calls` |
| `frontend/index.html` | Loads `vendor/socket.io.min.js` then `call.js` after `app.js`, registers `/sw.js` |
| `frontend/style.css` | `.pm-call-*` styles (overlay, card, buttons, status, mobile layout) |
| `frontend/sw.js` | Cache `pashu-mitra-v6 → v7`, `call.js` + vendor in `STATIC_ASSETS`, `/api/webcall/*` never cached, `push` handler for `incoming_call`, `notificationclick` → focus/open the vet portal |
| `frontend/vercel.json` | `call.js` in the no-store rule; immutable caching for `/vendor/*`; existing `/api` rewrite and security headers unchanged |
| `render.yaml` | Web-call env vars (below), TURN/VAPID/Redis left as `sync: false` secrets |
| `.env.example` | Fully documented web-calling block (placeholders only), incl. the single-worker requirement |
| `backend/push_service.py` | `push_notification(..., ttl=, urgency=)` delivery hints; the incoming-call push uses `TTL` = the ring window and `Urgency: high` |
| `backend/realtime.py` | Startup warning now states the measured multi-worker failure and the exact fix |
| `.gitignore` | `node_modules/` (the optional browser/WebRTC dev dependencies are never vendored) |

---

## 4. Migrations and deployment changes

**Database (additive, idempotent, no ORM/Alembic in this repo):**
`SCHEMA_WEBCALL` creates `web_calls`, `web_call_events`, `web_call_signals`,
`vet_presence` and seven indexes, and runs on every `init_db()` through
`ensure_webcall_tables(conn)` (same convention as `ensure_otp_tables`). Existing
tables/data are untouched; pushed subscriptions reuse the pre-existing
`push_subscriptions`, notifications reuse `notifications`, and every action is
audited through the existing `audit_log`.

**Deployment:** `render.yaml` gains the web-call env vars (TURN, VAPID, Redis and
the public URL remain dashboard-only secrets), and the start command becomes
`gunicorn app:app --worker-class gthread --workers 1 --threads 100 --timeout 120`
with a comment recording the measurement above — a gthread worker keeps the
socket responsive while other threads serve REST traffic, and a single worker is
what makes Socket.IO rooms reach the browser from a REST-triggered event; `frontend/vercel.json` adds immutable caching for the vendored
Socket.IO client and keeps the existing same-origin `/api` proxy; the service
worker version bump makes existing browsers pick up the new shell.

> Note: the Vercel `/api` rewrite cannot proxy a WebSocket upgrade. Set
> `SIH_PUBLIC_BACKEND_URL=https://pashu-shield-backend-hjgr.onrender.com` (and
> list the Vercel origin in `SIH_ALLOWED_ORIGINS`) so the browser opens `wss://`
> directly to Render; REST keeps using the same-origin `/api` proxy.

---

## 5. Environment variables (placeholders only — no real secrets in Git)

| Variable | Example | Meaning |
|----------|---------|---------|
| `SIH_WEBCALL_RING_TIMEOUT_SECONDS` | `45` | Ring timeout before `missed` (clamped 10–180) |
| `SIH_WEBCALL_SWEEPER` | `true` | Background sweeper for expired/abandoned calls |
| `SIH_WEBCALL_ABANDON_MINUTES` | `45` | Age at which the sweeper force-closes a stale call |
| `SIH_WEBCALL_PUSH_SYNC` | `1` | Dispatch Web Push inside the request (0 = let a worker do it) |
| `SIH_STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated STUN URLs |
| `SIH_TURN_URLS` | `turn:turn.example.org:3478` | TURN URL(s); empty = STUN only |
| `SIH_TURN_SECRET` | `<coturn static-auth-secret>` | Preferred: ephemeral credentials |
| `SIH_TURN_TTL_SECONDS` | `3600` | Lifetime of an ephemeral credential |
| `SIH_TURN_USERNAME` / `SIH_TURN_CREDENTIAL` | `<user>` / `<pass>` | Fallback for TURN servers without the REST API |
| `SIH_ICE_TRANSPORT_POLICY` | `all` (`relay` to force TURN) | Browser ICE policy |
| `SIH_REDIS_URL` | `redis://…` | Optional Socket.IO message queue (cross-worker) |
| `SIH_GUNICORN_WORKERS` | `1` | How many worker processes the deployment runs; used for the startup warning about per-process Socket.IO rooms. Leave at 1 unless `SIH_REDIS_URL` is set |
| `SIH_PUBLIC_BACKEND_URL` | `https://pashu-shield-backend-hjgr.onrender.com` | Absolute WSS/REST base for a split deployment |
| `SIH_ALLOWED_ORIGINS` | `https://pashu-mitra-smoky.vercel.app` | Origins allowed to open the signaling socket |
| `SIH_SOCKETIO_PATH` | `socket.io` | Socket.IO path (must match the deployment) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_CLAIM_EMAIL` | `<generated>` / `<generated>` / `mailto:ops@example.org` | Web Push keys (empty = push disabled) |

---

## 6. Deployment commands

```bash
# 1. Deploy the backend (Render auto-deploys the branch; or use the dashboard)
git push origin main
# Verify:
curl -s https://pashu-shield-backend-hjgr.onrender.com/api/health | python3 -m json.tool | grep -A6 web_calling

# 2. Generate Web Push keys ONCE, then set them in the Render dashboard
python3 backend/tools/vapid_keys.py          # prints base64url keys + a reload self-check
#   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_CLAIM_EMAIL  (sync: false)
#   (Do NOT paste a PEM; pywebpush wants the base64url strings this tool prints.)

# 3. TURN (required for mobile carrier / symmetric NAT). Example coturn essentials:
#    listening-port=3478, tls-listening-port=5349, use-auth-secret,
#    static-auth-secret=<random>, realm=<your.realm>,
#    fingerprint, no-multicast-peers, min-port=49152, max-port=65535
#    Then set: SIH_TURN_URLS, SIH_TURN_SECRET (dashboard only)

# 4. Point the browser at the backend for WebSockets
#    SIH_PUBLIC_BACKEND_URL=https://pashu-shield-backend-hjgr.onrender.com
#    SIH_ALLOWED_ORIGINS=https://pashu-mitra-smoky.vercel.app

# 5. Deploy the frontend
cd frontend && vercel --prod      # or push; keep /api rewrite in vercel.json
# Users must accept the service-worker update (cache v7); a hard reload forces it.

# 6. Verify the DEPLOYED backend (after every deploy, once per environment):
npm install --no-save socket.io-client
PM_WEBCALL_URL=https://pashu-shield-backend-hjgr.onrender.com \
PM_VET_EMAIL=... PM_VET_PASSWORD=... PM_EXPECT_TURN=1 PM_EXPECT_PUSH=1 \
node backend/tests/deploy/deploy_check.mjs
#    Expect "PASS — 22 checks" and, above all, that the vet's socket received
#    call:incoming. If that fails, the Gunicorn worker model is wrong: the start
#    command must stay
#    gunicorn app:app --bind 0.0.0.0:$PORT --worker-class gthread --workers 1 --threads 100 --timeout 120
#    (or set SIH_REDIS_URL so Socket.IO can fan out across workers).
```

---

## 7. Tests actually run (and results)

All commands were executed in this environment on 2026-10-04.

| Command | Result |
|---------|--------|
| `cd backend && rm -f test_webcalling.db* && python3 -m unittest test_webcalling` | **OK — 47 tests, 0 failures** (`Ran 47 tests in 1.002s`) |
| `node --test frontend/tests/*.test.mjs` | **43 tests: 41 pass, 0 fail, 2 skipped** (the 2 skips are the Playwright browser tests, which report their skip reason) |
| `node backend/tests/webrtc/two_peer_call.mjs` (against a local Flask instance) | **PASS — 13 steps**, real bidirectional RTP, DTLS-SRTP connected, mute relayed, terminal state + history verified |
| `SIH_ICE_TRANSPORT_POLICY=relay node backend/tests/webrtc/two_peer_call.mjs` (through a real TURN server) | **PASS — 511 and 512 decoded audio frames**, both peers' selected candidate pair reported as **`relay` → `relay`**, i.e. media really traversed TURN |
| `node backend/tests/webrtc/local_turn_ephemeral.mjs` + `/api/webcall/config` | **PASS** — with `SIH_TURN_SECRET` set, the server issued a coturn-REST username `<expiry>:<uid>` whose credential equals an independent `base64(HMAC-SHA1(secret, username))` computation (constant-time compare `True`); no static credential is used |
| `python3 backend/tests/deploy/push_loopback_check.py` (local backend + a stand-in push service) | **PASS — 20 checks**: the healthy subscription received a VAPID-signed (`Authorization: vapid t=…`), `aes128gcm`-encrypted body (362 bytes) with `TTL: 45` and `Urgency: high`; the 410 subscription was contacted once and then pruned; unsubscribe stops delivery; no push reaches an unsubscribed endpoint |
| `node backend/tests/deploy/deploy_check.mjs` (against the locally deployed configuration) | **PASS — 22 checks** including "the vet's socket received `call:incoming` within 10 s (22 ms)". Re-run against `--workers 2`: **FAIL** — this is the check that catches the worker misconfiguration |
| `python3 -m unittest test_regression test_role_auth test_demo_account test_farmer_otp_login test_all_features` | **OK** (unchanged by this work) |
| `python3 -m unittest test_helpline` | **FAILED (4 failures, 17 errors)** — **identical at the base commit `aa39a36`** (verified in a clean worktree), i.e. pre-existing and out of scope |
| `node --test frontend/tests/webcall_browser.test.mjs` | **Not executed** — skipped: no Chromium/Playwright in this environment (browser downloads are blocked) |
| Real deployment (Render/Vercel) | **Not executed** — no deployment is claimed. Everything above ran against a local process started with the deployment's own command line. |
| Real browser / two-browser call / OS notification | **Not executed** — no browser exists in this environment; see Blockers 3 and 5. |

Coverage of the 19 required cases: backend suite covers auth on create, no
impersonation, only the assigned vet receives, wrong-role rejection, double-answer
race, accurate terminal statuses, presence expiry, disconnected ≠ online, mic
cleanup, ringtone/state integrity, history visibility, and existing OTP/staff/IVR
features; the client suite covers real `track.enabled` mute, PC/track teardown,
ringtone stops for terminal states, signal ordering/dedupe, REST backfill,
mic-denial and reconnect reconciliation; the real-WebRTC rung covers two-way
audio and the full lifecycle. Web Push is covered where it can be (dispatch and
subscription storage); actual delivery requires the VAPID keys and a browser.

---

## 8. Remaining blockers (exact)

1. **TURN is implemented and verified, but no TURN server is provisioned for the
   deployment.** The whole path is proven against a real TURN server in this
   environment (relay-only media, ephemeral coturn REST credentials, both peers
   pairing `relay`→`relay`, 511/512 decoded frames) — what is missing is a
   production coturn (or a managed TURN) endpoint. Until `SIH_TURN_URLS` +
   `SIH_TURN_SECRET` are set on Render, calls between two networks behind
   symmetric NAT / mobile CGNAT will honestly fail with "could not connect",
   while LANs and permissive NATs work. Provision it, then re-run
   `deploy_check.mjs` (it warns when TURN is absent).
2. **Web Push is implemented and verified as far as a server can verify it.** The
   backend was proven to send real VAPID-signed, `aes128gcm`-encrypted, `high`
   urgency pushes with `TTL` = the ring window, and to prune a 410 subscription
   (`push_loopback_check.py`, 20 checks). What remains is operational: put real
   VAPID keys on Render (`backend/tools/vapid_keys.py` prints a ready-to-use
   pair), re-deploy, and have a vet accept notifications in a real browser. The
   service worker already handles `push`/`notificationclick`.
3. **No browser in this build environment**, so the two-browser rung and the
   visual/audio acceptance (real microphone and speakers, two networks) were
   **not** executed here. Run section 10 (and the manual procedure in
   `backend/tests/webrtc/README.md`) on two devices before declaring the feature
   accepted. Note this is a limitation of the environment, not of the code.
4. **PSTN/IVR remain separate.** A web call cannot ring a real phone, press
   DTMF, or bridge into a phone call; that needs a telephony provider. The
   existing helpline `7382210251` and `/api/ivr/*` routes still work exactly as
   before and are the only PSTN path.
5. **Guaranteed ringing with a closed browser is impossible for a website.**
   Web Push narrows the gap (background tabs, some locked-screen cases) but
   cannot survive: browser fully closed, offline, notifications denied, or an
   OS/battery policy. Guaranteeing that needs a native app or a telephony
   provider. The portal states this instead of pretending.
6. **Cross-worker instant delivery** needs `SIH_REDIS_URL`; without it, signaling
   still converges (durable log + REST reconciliation) but with up to one poll
   interval of latency when the two peers land on different Gunicorn workers.

---

## 9. Was real two-way audio tested, and where?

**Yes — in an integration environment, through the real API and real signaling,
between two genuine WebRTC peer connections.** Verified locally on 2026-10-04
with `backend/tests/webrtc/two_peer_call.mjs`: 248 inbound RTP packets in each
direction, decoded audio frames on both sides (farmer 502, vet 503), both peers
reaching DTLS-SRTP `connected`, the call reaching `connected`/`ended`
server-side with accurate timestamps, mute relayed to the peer, and the call
appearing in the farmer's authorized history.

**Also executed:** the same script with `SIH_ICE_TRANSPORT_POLICY=relay` against a
real TURN server — both peers reported their selected candidate pair as
`relay`→`relay` and decoded 511/512 audio frames, which proves the media path
works when direct connectivity is impossible (the TURN credentials were the
short-lived coturn REST kind: the server's username/credential pair matched an
independent HMAC-SHA1 computation).

**Not yet tested:** two real browsers with real microphones/speakers (rung 4 and
the manual procedure), calls across two different carrier networks, and a
production TURN server (the relay proof above used a local fixture). Those are
the user's acceptance steps below; no result is claimed for them.

---

## 10. End-to-end verification checklist

1. `cd backend && rm -f test_webcalling.db* && python3 -m unittest test_webcalling`
   → expect 47/47 OK.
2. `node --test frontend/tests/*.test.mjs` → expect 41 pass / 0 fail / 2 skipped.
3. `PM_WEBCALL_URL=<backend> PM_VET_EMAIL=… PM_VET_PASSWORD=… node backend/tests/webrtc/two_peer_call.mjs`
   → expect `PASS` with non-zero RTP packets **and** decoded frames in both
   directions (install `@roamhq/wrtc` + `socket.io-client`; skip code 2 otherwise).
4. `PM_WEBCALL_URL=<backend> PM_VET_EMAIL=… PM_VET_PASSWORD=… PM_EXPECT_TURN=1 PM_EXPECT_PUSH=1`
   `node backend/tests/deploy/deploy_check.mjs` → expect `PASS — 22 checks passed`,
   and in particular that the vet's socket receives `call:incoming` (the
   worker-model check). Run it after every deployment change.
5. Set TURN + VAPID in Render, re-deploy, then `curl …/api/health` and confirm
   `web_calling.ice.turn_configured` is true; repeat step 3 with
   `SIH_ICE_TRANSPORT_POLICY=relay` to prove the relay path.
6. On two devices on **different networks**: vet sets *Available* + languages and
   enables notifications; farmer places a call; vet sees the popup with caller
   details and hears the repeating ringtone; vet answers; **both sides hear each
   other**; mute/unmute is audible and mirrored in the UI; the timer runs;
   hang up and confirm both sides stop and the microphone indicator disappears.
7. Repeat for: decline, no-answer (45 s timeout → `missed`), busy vet, cancel
   while ringing, refresh mid-call, and notification-click while the tab is in
   the background.
8. Check the call history in both portals, and that an unrelated farmer account
   cannot see the call.
9. Record date, devices, networks, whether TURN was used, and whether audio was
   audible in **both** directions. The feature is accepted only when step 6
   passes on two networks with TURN configured.
