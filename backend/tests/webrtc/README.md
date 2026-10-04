# Web calling — how this feature is verified

Real-time audio calling cannot be proven by mocking WebRTC. The feature is
therefore verified in four rungs, each proving something the one below it
cannot. Run them in order when you change anything in the call path.

| # | What | Command | Proves |
|---|------|---------|--------|
| 1 | Backend unit + integration | `cd backend && rm -f test_webcalling.db* && python3 -m unittest test_webcalling -v` | Auth/authorization on every endpoint, routing, atomic single-answer, FSM + timestamps, presence leases, durable signal relay, history scoping, push dispatch |
| 2 | Portal client unit tests (no browser) | `node --test frontend/tests/webcall_ui.test.mjs` | The browser client's state machine, real `track.enabled` mute, ringtone lifecycle, PC teardown, signal ordering, REST backfill, mic-denial handling |
| 3 | **Real two-peer WebRTC** | `node backend/tests/webrtc/two_peer_call.mjs` | Two genuine WebRTC peers negotiating **through the real server** and exchanging real RTP audio in **both** directions (inbound packets *and* decoded frames measured on each side) |
| 4 | **Two real browsers** | `node --test frontend/tests/webcall_browser.test.mjs` | The same over real `getUserMedia`, the real portal UI, real ringtone, real overlay, real push/notification plumbing |

Rungs 3 and 4 are the only ones that can say "audio actually flowed". Everything
else is necessary but not sufficient.

---

## Rung 3 — `two_peer_call.mjs` (real WebRTC, no browser)

Two `@roamhq/wrtc` peer connections talk only through the deployed API: REST for
the call lifecycle, the authenticated Socket.IO socket for SDP/ICE, and
`RTCAudioSource` tones as the media. The script then reads
`RTCPeerConnection.getStats()` on both peers and requires inbound RTP packets
**and** decoded audio frames in each direction before it prints `PASS`.

```bash
# from the repository root
npm install --no-save @roamhq/wrtc socket.io-client   # optional dev dependencies

# a running backend (local example)
cd backend
SIH_SECRET_KEY=dev-secret SIH_DB_PATH=/tmp/webcall_dev.db \
DEMO_MODE=true python3 -c "from app import app, socketio; socketio.run(app, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)"

# in another shell
PM_WEBCALL_URL=http://127.0.0.1:5001 \
PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=password123 \
PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
node backend/tests/webrtc/two_peer_call.mjs
```

Environment variables: `PM_WEBCALL_URL`, `PM_VET_EMAIL`/`PM_VET_PASSWORD`,
`PM_FARMER_MOBILE`/`PM_FARMER_OTP` (the demo account's fixed OTP requires
`DEMO_MODE=true` in the backend; otherwise use a real OTP), optional
`PM_WEBCALL_LANGUAGE` (default `en`), `PM_WEBCALL_AUDIO_SECONDS` (default `5`),
`PM_WEBCALL_STEP_TIMEOUT_MS` (default `30000`).

Exit codes: `0` pass, `1` failure, `2` skipped (missing dependency or
configuration — the rung was **not** exercised).

The script is deliberately re-runnable: it closes any call left behind by an
earlier run before starting.

### What it does **not** prove

* No `getUserMedia`, so none of the browser's microphone-permission UX,
  device selection, autoplay/ringtone policy, or the portal DOM is covered —
  that is rung 4.
* Both peers run on one machine, so ICE uses host candidates: the **TURN relay
  path is not exercised** unless the backend is configured with a TURN server
  *and* the peers are forced through it (`SIH_ICE_TRANSPORT_POLICY=relay`).
* It is not a load/scale test and does not cover carrier-grade NAT variety.

### Forcing the TURN path

```bash
SIH_TURN_URLS=turn:turn.example.org:3478 SIH_TURN_SECRET=<coturn static-auth-secret> \
SIH_ICE_TRANSPORT_POLICY=relay SIH_DB_PATH=/tmp/webcall_turn.db \
python3 -c "from app import app, socketio; socketio.run(app, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)"
```

Every candidate is then a relay candidate; if the call still reports
media-confirmed audio, the relay is working. `GET /api/webcall/config` reports
`ice.turn_configured`, `ice.turn_mode` (`ephemeral` / `static` / `none`) and
`ice.transport_policy` so you can see which mode the deployment is using.

---

## Rung 4 — `webcall_browser.test.mjs` (two real browsers)

Playwright drives two Chromium contexts (farmer + vet) with a **synthetic audio
device**, so real RTP flows over a real `getUserMedia` track. It asserts the
incoming-call popup, the repeating ringtone, the caller details, that
`media_confirmed` is true on both sides, that inbound packets grow on both sides,
that mute flips the real outgoing `track.enabled`, that hang-up stops the
tracks/closes the peer connection, and that decline produces an honest terminal
status.

```bash
npm install --no-save playwright && npx playwright install chromium
PM_BROWSER_URL=https://pashu-shield-backend-hjgr.onrender.com \
PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=*** \
PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
node --test frontend/tests/webcall_browser.test.mjs
```

The test **skips** (and says why) when `PM_BROWSER_URL` is unset, credentials are
missing, or Playwright/Chromium is not installed, so a plain
`node --test frontend/tests/*.test.mjs` stays green on machines without a
browser.

---

## Manual two-browser procedure (the acceptance test a human runs)

Two real browsers on **two different networks** is the only way to exercise ICE
across NATs and the real device audio path.

1. **Prepare the backend.** HTTPS/WSS URL reachable from both browsers, with
   `SIH_SECRET_KEY` set, `SIH_ALLOWED_ORIGINS` listing the portal origin, and
   either a TURN server (`SIH_TURN_URLS` + `SIH_TURN_SECRET`) or an acceptance
   of "same-network calls only".
2. **Prepare the veterinarian.** Sign in to the vet portal on device A. Open the
   calling card and set availability to **Available** with the languages you
   speak, then press **Enable call notifications** and accept the browser
   permission prompt. The card must show `Presence: online`.
3. **Prepare the farmer.** Sign in to the farmer portal on device B (a phone is
   ideal — a different network from device A).
4. **Place the call.** Farmer → *📞 Call a vet* → choose language, reason,
   optional note → **Start call**. Expect: the farmer sees "Ringing …" with the
   chosen vet's name and a **Cancel** button.
5. **Incoming call on the vet side.** Expect within a second: a prominent popup
   with the farmer's name, village/district, language and reason, and a
   **repeating ringtone** that keeps looping until you answer, decline, cancel,
   or the ring timeout (45 s) expires. Confirm the ringtone is audible with the
   tab in the foreground; background it and confirm the Web Push notification
   appears (if push was enabled) and that clicking it focuses the portal and
   restores the popup.
6. **Answer.** Press **Answer**. Expect: "Connecting …" then **Connected** with a
   running timer *only* after audio is really flowing, and — this is the point of
   the whole exercise — **two-way audio**: speak on each device and hear the
   other side. Check both directions separately.
7. **Mute.** Press the mute button on one side: the other side must show the
   "Muted" badge and stop hearing you. Unmute and confirm audio returns.
   (The UI must never show a mute state the track does not actually have.)
8. **Network blip.** Turn Wi-Fi off on the farmer device for ~10 s and back on.
   Expect: no crash; either recovery with audio restored, or an honest failure
   state — never a fake "Connected".
9. **Hang up.** Press **End call** on either side. Expect: the other side ends
   immediately, the ringtone stops, the audio element is detached, and the
   microphone indicator in the browser is gone (tracks stopped).
10. **Decline path.** Call again and press **Decline** on the vet side. Expect:
    the farmer sees "declined" with an honest reason, history records
    `rejected`, and nothing keeps ringing.
11. **No answer / busy path.** Call a vet who is already on a call, and call one
    who does not answer. Expect `busy` / `missed` (ring timeout) — never a fake
    connection.
12. **Refresh mid-call.** While connected, refresh the farmer's tab. Expect the
    call to reconcile: the portal restores the call panel, re-negotiates, and
    either restores audio or reports the truthful failure.
13. **History.** Both portals' call history must list the call with the correct
    direction, status, timestamps and duration. A different farmer's account must
    not see it; the government role sees aggregate counts only.
14. **Record the result** (date, devices, networks, TURN used, both directions
    audible yes/no). A web call is only "verified" when step 6 passes on two
    different networks with TURN configured.

## Known limits (state these honestly to users)

* A normal website **cannot** ring when the browser is fully closed, the machine
  is offline, notifications are disabled, or the OS blocks them (battery savers
  on Android/iOS aggressively do). Web Push narrows the gap; guaranteed ringing
  would require a native app with push, or a telephony provider.
* A WebRTC web call is **not** a phone call: no PSTN number/DTMF/bridging. The
  existing helpline and IVR routes are separate and untouched.
* iOS Safari ends audio when the browser is backgrounded; the in-call audio will
  stop. The UI says so instead of pretending.
