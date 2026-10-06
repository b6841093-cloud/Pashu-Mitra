# WebRTC / Web-Calling Production Verification

**Date of this pass:** 2026-10-06 (second pass — task "MASTER FIX PASS")
**Branch:** `arena/78af3dc6-pashu-shield-updated`
**Frontend under test:** https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app/#/owner/webcall
**Backend under test:** https://pashu-shield-backend-hjgr.onrender.com
**Canonical Socket.IO path:** `/socket.io`
**Full signaling endpoint:** `https://pashu-shield-backend-hjgr.onrender.com/socket.io`

> Honesty rule for this document: every row below is either **VERIFIED** (with the
> exact command/evidence), **FAILED** (reproduced), or **NOT VERIFIED** (with the
> reason it could not be executed here). Nothing is claimed as passing because it
> "should" work.

---

## 1. Status summary

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Production `allowed_origins` contained the origin the browser was using | **FAILED (root cause)** | `/api/health` snapshot, §2 |
| 2 | Origin allow-list normalizes, de-duplicates, refuses wildcards | **VERIFIED** | `test_webcalling.py` #88, §4.1 |
| 3 | Current preview origin allowed without any env change | **VERIFIED** | `socketio_origin_check.mjs` with `Origin: https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app`, §4.2 |
| 4 | Unlisted origin is refused (no `Access-Control-Allow-Origin`, handshake `connect_error`) | **VERIFIED** | same script, §4.2 |
| 5 | `Access-Control-Allow-Origin` is the exact origin, never `*` | **VERIFIED** | same script, §4.2 |
| 6 | `/socket.io` path canonical on both sides (`socket.io` → `/socket.io`, never `hostsocket.io`) | **VERIFIED** | `test_webcalling.py` #90 + `webcall_ui.test.mjs` |
| 7 | Signaling URL never points at the Vercel host (no `/api`-rewrite dependence for WSS) | **VERIFIED** | `socket_public_url()` + `RENDER_EXTERNAL_URL` fallback, tests #89 |
| 8 | JWT-authenticated handshake; unauthenticated socket refused | **VERIFIED** | `socketio_origin_check.mjs`, §4.2 |
| 9 | Presence lease registered / renewed / expired correctly | **VERIFIED** | `test_webcalling.py` presence + sweeper suites |
| 10 | Vet presence drives routability (AVAILABLE alone is never enough) | **VERIFIED** | `test_webcalling.py` #91, `webcall_state_honesty.test.mjs` |
| 11 | Farmer → vet call routing, ringing, atomic answer | **VERIFIED** | `two_peer_call.mjs` steps 1–4, §4.3 |
| 12 | Real SDP/ICE exchange through the server, DTLS-SRTP connected | **VERIFIED** | `two_peer_call.mjs` — both PCs `connected` |
| 13 | **Real two-way RTP audio** (packets *and* decoded frames, both directions) | **VERIFIED** | `two_peer_call.mjs`: farmer 199 packets / 402 frames, vet 199 / 403 |
| 14 | Mute state relayed to the peer | **VERIFIED** | `two_peer_call.mjs` |
| 15 | Hang-up finalizes state, timestamps, duration, history | **VERIFIED** | `two_peer_call.mjs` |
| 16 | Second call after hang-up (backend lifecycle) | **VERIFIED** | `test_webcalling.py` re-call tests |
| 17 | TURN/STUN configuration reported correctly, credentials never public | **VERIFIED** | `/api/health` + `test_webcalling.py` ICE suites |
| 18 | TURN **relay path** actually used (carrier/CGNAT peer) | **NOT VERIFIED** | needs two networks + `SIH_ICE_TRANSPORT_POLICY=relay`, §5 |
| 19 | Two **real browsers** (farmer + vet, real `getUserMedia`, mute button, refresh/reconnect) | **NOT VERIFIED** | Playwright Chromium download blocked in this sandbox; §5 |
| 20 | Production end-to-end after the Render redeploy | **NOT VERIFIED** | owner action (Render dashboard env + deploy); §6 |

Result: the **server-side chain is verified end-to-end with real WebRTC media**
(transport, JWT auth, presence, routing, offer/answer, ICE, DTLS, RTP, mute,
hang-up). The two rows that remain unverified are the ones that require a real
browser and a real carrier network, and they are stated as such.

---

## 2. Root cause (reproduced, not inferred)

`GET https://pashu-shield-backend-hjgr.onrender.com/api/health` was fetched from
the live service on 2026-10-06 and returned:

```json
"web_calling": {
  "allowed_origins": [
    "https://pashu-mitra-smoky.vercel.app",
    "https://pashu-mitra-efyqsdomw-pashu-shield.vercel.app",
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:8000"
  ],
  "signaling": "flask-socketio",
  "signaling_configured": true,
  "signaling_url": "https://pashu-shield-backend-hjgr.onrender.com",
  "socketio_path": "/socket.io",
  "turn_configured": true, "turn_mode": "static", "turn_url_count": 4,
  "push_configured": true, "worker_configuration_safe": true
}
```

The browser was on **`https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app`**
(the current Vercel preview origin). It is **not** in `allowed_origins`.

Consequences, in order (this is the complete chain the screen showed):

1. The Engine.IO polling handshake from that origin receives **no
   `Access-Control-Allow-Origin` header**, and the WebSocket handshake is
   rejected by `_on_connect` → `origin_allowed(...) is False`.
2. The Socket.IO client reports `TransportError` / `connect_error`. A browser
   **cannot** expose the CORS reason to JavaScript, so the portal can only say
   "signaling offline / connecting".
3. The farmer's Start button stays disabled (it requires a live socket), and the
   vet can never hold a live presence lease from that origin — so
   `NO_LIVE_SESSION` is the routing answer and the panel showed
   `Reason: NO_LIVE_SESSION · NO_LIVE_SESSION`.

Why it recurs: `render.yaml` is applied when a Render service is **created**; an
existing service keeps its old `SIH_ALLOWED_ORIGINS` until somebody edits it in
the dashboard. Every new Vercel preview URL therefore re-introduces the same
fault. Two earlier incidents (2026-10-05, and the first 2026-10-06 pass with
`efyqsdomw`) had exactly this shape.

Two secondary defects made the failure harder to read:

* the farmer panel printed the **raw** routing codes (`NO_LIVE_SESSION ·
  NO_LIVE_SESSION`) as the primary sentence, and showed `Matched vet: …` even
  when the call was not routable — the matched name came from a *different*
  vet's successful match, so the screen contradicted itself;
* `socket_public_url()` had no fallback, so a deployment that forgot
  `SIH_PUBLIC_BACKEND_URL` would tell the browser "same origin" and the socket
  would be sent to the Vercel host (Vercel rewrites `/api/*` only — never
  `/socket.io`).

---

## 3. The fix (additive; no feature removed)

### 3.1 `backend/realtime.py` — explicit, self-healing allow-list

* `BUILTIN_ALLOWED_ORIGINS` — the portal origins this product is deployed on,
  listed **explicitly** (no `*`, no `*.vercel.app`):
  * `https://pashu-mitra-smoky.vercel.app` (stable production)
  * `https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app` (current preview)
  * `https://pashu-mitra-efyqsdomw-pashu-shield.vercel.app` (previous preview)
* `LOCAL_DEV_ORIGINS` — localhost/127.0.0.1 dev ports, unchanged in purpose.
* `_normalize_origin()` — trims whitespace, strips trailing slashes, lower-cases.
  Both the configured list **and** the incoming `Origin` header pass through it,
  so `https://Portal.example.com/` and `https://portal.example.com` match.
* `_split_origins()` — comma-separated parsing of `SIH_ALLOWED_ORIGINS` **and**
  the historical alias `SIH_FRONTEND_ORIGINS`, de-duplicated, and any entry
  containing `*` is **refused with a warning** (logged once per value).
* `origin_diagnostics()` — secret-free provenance for `/api/health`.
* `socket_public_url()` — `SIH_PUBLIC_BACKEND_URL` → `RENDER_EXTERNAL_URL`
  (Render sets it automatically) → `""` (same origin). `socket_public_url_source()`
  and `signaling_endpoint()` report which was used and the exact WSS URL.
* `_on_connect` — an origin rejection now logs the rejected origin, the
  effective list and both sources, with the corrective action, instead of a
  single opaque line.

### 3.2 `backend/app.py` — diagnostics an operator can read from outside

* `GET /api/health → web_calling` additionally reports `signaling_url_source`,
  `signaling_endpoint`, `allowed_origins_source`
  (`{count, from_env, from_builtin, env_configured, wildcards_allowed}`).
  Nothing secret is added — the origins were already public.
* `GET /api/webcall/config → signaling` additionally reports `url_source`,
  `endpoint`, `client_origin`, and **`client_origin_allowed`**: the verdict for
  the requesting browser's own `Origin`. That is what lets the portal say
  "this deployment's address is not permitted yet" instead of the misleading
  "signaling offline".

### 3.3 `frontend/call.js` — the UI can only claim what the server proves

* `clientOriginAllowed()` + `signalingFailureInfo()` → farmer text, developer
  detail (`ORIGIN_NOT_ALLOWED` / `CONNECTING` / `RECONNECTING` / `FAILED`).
* `callState()` / `callStateLabel()` / `callStateStripHtml()` — the twelve
  states (OFFLINE, CONNECTING, AVAILABLE, INCOMING_CALL, CALLING, RINGING,
  CONNECTING_MEDIA, CONNECTED, MUTED, RECONNECTING, ENDED, FAILED) are rendered
  as **text** (a badge plus a labelled strip), never by colour alone.
* `skipReasonSentence()` — `NO_LIVE_SESSION` → "not connected right now",
  `LANGUAGE_NOT_SUPPORTED` → "does not take calls in this language", etc. The
  raw codes stay in the console and in `data-*` attributes for developers.
* The farmer card prints `Matched veterinarian: …` **only when routable**, and
  the primary sentence when the socket is down is
  "Your connection to the veterinarian service is being restored."
* `reconnectSignaling()` (+ a **Retry connection** button on both the farmer
  and vet cards, and a `window online` hook) re-opens the socket *and* refreshes
  the server configuration, so a later call can never use a stale ICE/TURN list.
* On reconnect the vet re-registers presence/heartbeat and both roles refresh
  their configuration (ICE servers, presence, routability).

### 3.4 `render.yaml`

`SIH_ALLOWED_ORIGINS` now lists the stable production origin, the current
preview origin and the previous preview origin; the comments explain the
blueprint-at-creation caveat and the recommended single-production-origin
policy, and that `SIH_PUBLIC_BACKEND_URL` has the `RENDER_EXTERNAL_URL`
fallback. The Vercel `/api/*` rewrite is still used for REST only — WebSocket
traffic never depends on it.

---

## 4. Verification executed in this pass

### 4.1 Unit/integration suites

```bash
bash backend/run_tests.sh            # 10/10 suites PASS (344 tests)
node --test frontend/tests/*.test.mjs # 80 tests: 78 pass, 2 skipped, 0 fail
```

New backend tests added to `backend/test_webcalling.py` (they live in the
origin/URL test class, so the numbers below are that class's own):

* **#87** the three portal origins are allowed with an **empty**
  `SIH_ALLOWED_ORIGINS` (the regression that caused this incident), and a
  foreign origin is still refused;
* **#88** parsing: trailing slash / whitespace / case / duplicates, both
  variable names merged, `*` and `https://*.vercel.app` refused;
* **#89** `socket_public_url()` falls back to `RENDER_EXTERNAL_URL`, explicit
  configuration wins, `/api/health` reports source + endpoint;
* **#90** `/api/webcall/config` returns the requesting Origin's verdict and the
  canonical `/socket.io` path; `/api/health` reports the allow-list provenance.

### 4.2 Origin / CORS behaviour (new tool: `backend/tests/webrtc/socketio_origin_check.mjs`)

Run against the current code (local instance started from this branch) with the
**production preview origin** as the allowed origin:

```
▶ Engine.IO polling handshake — allowed origin (https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app)
  ✔ handshake answered with HTTP 200
  ✔ the engine.io open packet was returned
  ✔ Access-Control-Allow-Origin is exactly the frontend origin
  ✔ no wildcard CORS policy is in use
  ✔ the signaling path is the canonical /socket.io
▶ Engine.IO polling handshake — origin that is NOT in the allow-list
  ✔ an unlisted origin receives no ACAO header (got null)
▶ WebSocket transport — allowed origin
  ✔ the authenticated socket reached session:ready
▶ WebSocket transport — origin that is NOT in the allow-list
  ✔ the unlisted origin was refused
▶ WebSocket transport — no token
  ✔ an unauthenticated socket was refused
PASS — Socket.IO origin + CORS behaviour verified (6 groups).
```

This is the exact request pair a browser makes; the only difference is that the
`Origin` header is under our control, which is what makes the allow-list
observable. It reproduces "allowed → 200 + exact ACAO" and "unlisted → no ACAO
and refused handshake" from the same code that will be deployed.

### 4.3 Real two-peer WebRTC audio (`backend/tests/webrtc/two_peer_call.mjs`)

Two genuine `@roamhq/wrtc` peers, signaling exclusively through the running
server (Socket.IO + REST):

```
✔ the assigned vet received call:incoming for this call
✔ offer/answer exchanged through the server's durable signal relay
✔ both real peer connections reached the connected state (ICE + DTLS-SRTP)
✔ farmer received RTP audio (199 packets)
✔ vet received RTP audio (199 packets)
✔ both directions decoded real audio frames (farmer 402, vet 403)
✔ the peer learned that the other side is muted
✔ the call carries accurate timestamps and a duration
PASS — real two-way WebRTC audio verified (13 steps).
```

The candidate pairs were `host->host` on one machine, so this proves the
signaling + SDP + ICE + DTLS + RTP path, **not** the TURN relay path (§5).

### 4.4 ICE/TURN posture (unchanged, re-verified)

`/api/health → web_calling.ice` on the deployed service: `turn_configured: true`,
`turn_mode: "static"`, `turn_url_count: 4`, `turn_config_issue: null`,
`ice_transport_policy: "all"`, `stun_configured: true`; `turn_env` reports
`SIH_TURN_SECRET: missing` (correct: a non-empty secret would switch the backend
to coturn credentials the Metered provider rejects). No credential, username or
URL list is exposed by `/api/health`; ICE credentials are returned only by the
authenticated `GET /api/webcall/config`, and no TURN credential appears in
frontend source, git, logs or documentation.

---

## 5. NOT VERIFIED — and why

1. **Two real browsers (farmer + vet) with a real microphone.**
   `frontend/tests/webcall_browser.test.mjs` requires Playwright + Chromium. In
   this sandbox `npx playwright install chromium` fails (the browser CDN is not
   reachable) and no system browser is installed. Therefore: *not run, not
   claimed*. The script still exists and skips with an explicit reason; running
   it needs a machine with a browser:

   ```bash
   npm install --no-save playwright && npx playwright install chromium
   PM_BROWSER_URL=https://pashu-shield-backend-hjgr.onrender.com \
   PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=*** \
   PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
   node --test frontend/tests/webcall_browser.test.mjs
   ```

2. **The TURN relay path** (mobile-carrier/CGNAT peers): needs two networks and
   `SIH_ICE_TRANSPORT_POLICY=relay`; §4.4 shows the credentials are served, but
   no relay candidate was exercised here.

3. **Production end-to-end after redeploy**: the live service still holds the
   old `SIH_ALLOWED_ORIGINS`, so the current incident is fixed by code only
   *after* the backend is redeployed (§6). Until then the fix is verified
   against the same code on a local instance, not against the live URL.

---

## 6. Production configuration (owner action)

The code change alone fixes the current origin **after the backend redeploys**.
To make the deployment configuration explicit as well, set on
**Render → `pashu-shield-backend` → Environment** and redeploy:

| Variable | Value | Why |
|----------|-------|-----|
| `SIH_ALLOWED_ORIGINS` | `https://pashu-mitra-smoky.vercel.app,https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app` | explicit portal origins; no wildcards |
| `SIH_PUBLIC_BACKEND_URL` | `https://pashu-shield-backend-hjgr.onrender.com` | already correct (health confirms); the `RENDER_EXTERNAL_URL` fallback now covers a fresh service too |
| `SIH_SOCKETIO_PATH` | `/socket.io` | must keep the leading slash |
| `SIH_TURN_URLS` / `SIH_TURN_USERNAME` / `SIH_TURN_CREDENTIAL` | Metered values (secrets) | static TURN mode; `SIH_TURN_SECRET` must stay **empty** |
| `SIH_GUNICORN_WORKERS` | `1` | Socket.IO rooms are per-process (health: `worker_configuration_safe: true`) |

Recommended long-term: deploy the portal on **one stable Vercel production
domain** and keep only that origin (plus temporarily the preview under test) in
the list.

Verify after the redeploy:

```bash
curl -s https://pashu-shield-backend-hjgr.onrender.com/api/health \
  | python3 -c "import json,sys; w=json.load(sys.stdin)['web_calling']; \
print(w['allowed_origins']); print(w['signaling_url'], w['signaling_url_source'], w['socketio_path'], w['signaling_endpoint']); \
print(w['turn_configured'], w['turn_mode'], w['turn_url_count'], w['push_configured'])"
```

`allowed_origins` must contain the browser's own origin; the browser then shows
`[WEB_CALL] signaling URL … | path /socket.io | transports websocket,polling`,
`[WEB_CALL] socket connected sid=… | transport=websocket`,
`[WEB_CALL] presence registered online=true`, `[WEB_CALL] presence heartbeat ok`.
No token or TURN credential is ever logged.

### Manual two-browser acceptance (still required)

Vet browser: log in → Web Call → **AVAILABLE** + languages → Save → expect
`CONNECTED · AVAILABLE — receiving calls`, `Lease: ONLINE (lease valid for …)`,
`Signaling connected`. Farmer browser: log in → Call a veterinarian → language /
reason / notes → expect `Veterinarian available` + matched vet → Start → Ringing
→ vet Accept → both reach `Connected` → speak both ways → Mute / Unmute → Hang
up → repeat (second call) → refresh the vet tab and confirm the socket
reconnects and the lease returns. Anything that does not match one of those
sentences must be reported as a defect, not explained away.

---

## 7. Remaining blockers

1. Render redeploy required before the live service accepts the current preview
   origin (code-level fix is already in this branch).
2. Real two-browser verification must be run by a human (or on a machine with
   Playwright + Chromium) — §5.1.
3. TURN relay path unexercised — §5.2.
4. Vercel preview URLs change on every deployment; keep one stable production
   domain, or extend the explicit list (`SIH_ALLOWED_ORIGINS` or
   `BUILTIN_ALLOWED_ORIGINS`) — never a wildcard.

---

## 8. Files changed in this pass

| File | Change |
|------|--------|
| `backend/realtime.py` | explicit built-in origins, normalization/wildcard refusal, origin diagnostics, `RENDER_EXTERNAL_URL` fallback, actionable rejection log |
| `backend/app.py` | health + `/api/webcall/config` diagnostics (`signaling_url_source`, `signaling_endpoint`, `allowed_origins_source`, `client_origin_allowed`), user-facing report/error/SMS branding |
| `backend/test_webcalling.py` | tests #87–#90 (origins, normalization, URL fallback, config verdict) |
| `backend/tests/webrtc/socketio_origin_check.mjs` | **new** origin/CORS verification tool |
| `backend/tests/webrtc/README.md` | documents the new rung |
| `backend/test_compliance.py` | logo rule updated (product logo allowed; emblem still forbidden) |
| `backend/compliance_security.py`, `backend/ivr_service.py`, `backend/otp_service.py` | user-facing product name (error page title, IVR welcome prompts, OTP SMS) |
| `render.yaml` | `SIH_ALLOWED_ORIGINS` explicit list + corrected comments |
| `frontend/call.js` | 12-state labels, human routing wording, origin verdict, retry/reconnect, config refresh on reconnect |
| `frontend/app.js`, `frontend/shell.js`, `frontend/org-config.js`, `frontend/index.html`, `frontend/manifest.json`, `frontend/sw.js`, `frontend/info-pages.js`, `frontend/style.css`, `frontend/a11y.js`, `frontend/captcha.js` | Pashu-Mitra branding, official logo wiring, demo-access card, web-call translations (en/mr/hi/te) |
| `frontend/tests/branding_webcall_states.test.mjs` | **new** branding + state-honesty tests (incl. the logo asset check: PNG signature, dimensions, aspect ratio, under 2 MB — skipped with a reason while the asset is absent) |
| `frontend/tests/demo_account_ui.test.mjs` | demo card copy updated to the new (non-warning) wording |
| `docs/compliance/webrtc-production-verification.md` | this document |
| `docs/compliance/browser-accessibility-audit.md` | accessibility status for the branding/login changes |
