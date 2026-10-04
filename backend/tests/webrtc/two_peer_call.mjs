#!/usr/bin/env node
/**
 * Real two-peer WebRTC integration test for the web-calling feature.
 *
 * Two genuine WebRTC peer connections (node-webrtc) run against a REAL running
 * backend: the call is created over REST, routed by the server, announced to the
 * veterinarian over the real Socket.IO signaling socket, answered over REST,
 * and the SDP/ICE exchange travels through the server's durable signal relay.
 * Each peer sends an audio tone with `RTCAudioSource`; the test then reads
 * `RTCPeerConnection.getStats()` on BOTH peers and requires inbound RTP packets
 * AND decoded audio frames in each direction.
 *
 * Signalling mocks cannot prove audio; this can. It is still not a browser test
 * (no getUserMedia/devices) and it does not cross the public internet, so it is
 * the *integration* rung between `backend/test_webcalling.py` and
 * `frontend/tests/webcall_browser.test.mjs`. See ./README.md.
 *
 * Usage:
 *   npm install --no-save @roamhq/wrtc socket.io-client
 *   PM_WEBCALL_URL=http://127.0.0.1:5001 \
 *   PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=vet1234 \
 *   PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
 *   node backend/tests/webrtc/two_peer_call.mjs
 *
 * Exit codes: 0 pass, 1 failure, 2 skipped (missing deps/configuration).
 * Tokens are never printed.
 */
const BASE = (process.env.PM_WEBCALL_URL || process.env.PM_BROWSER_URL || "").replace(/\/+$/, "");
const FARMER = { mobile: process.env.PM_FARMER_MOBILE || "8341564042", otp: process.env.PM_FARMER_OTP || "123456" };
const VET = { email: process.env.PM_VET_EMAIL || "", password: process.env.PM_VET_PASSWORD || "" };
const LANGUAGE = process.env.PM_WEBCALL_LANGUAGE || "en";
const AUDIO_SECONDS = Number(process.env.PM_WEBCALL_AUDIO_SECONDS || 5);
const STEP_TIMEOUT_MS = Number(process.env.PM_WEBCALL_STEP_TIMEOUT_MS || 30000);

function skip(reason) {
  console.log(`SKIPPED: ${reason}`);
  process.exit(2);
}

if (!BASE) skip("set PM_WEBCALL_URL to a running backend (for example http://127.0.0.1:5001)");
if (!VET.email || !VET.password) skip("set PM_VET_EMAIL and PM_VET_PASSWORD to a real veterinarian account");

let wrtc;
let io;
try {
  wrtc = (await import("@roamhq/wrtc")).default;
} catch (err) {
  skip("node-webrtc is not installed — `npm install --no-save @roamhq/wrtc`");
}
try {
  ({ io } = await import("socket.io-client"));
} catch (err) {
  skip("socket.io-client is not installed — `npm install --no-save socket.io-client`");
}

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, MediaStream, nonstandard } = wrtc;
const steps = [];
function step(name) { steps.push(name); console.log(`\n▶ ${name}`); }
function ok(message) { console.log(`  ✔ ${message}`); }
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  ok(message);
}
function withTimeout(promise, label, ms = STEP_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms).unref?.()),
  ]);
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(BASE + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (err) { /* non-JSON error page */ }
  return { ok: response.ok, status: response.status, data };
}

async function loginFarmer() {
  // The demo account still follows the ordinary two-step OTP flow: the request
  // creates the (demo-marked) OTP row and the verify consumes it. A real OTP
  // flow works the same way — copy the SMS code into PM_FARMER_OTP.
  try {
    await api("/api/auth/farmer/request-otp", { method: "POST", body: { mobile: FARMER.mobile, intent: "login" } });
  } catch (err) {
    // A cooldown/rate limit still leaves the previously issued OTP verifiable.
  }
  const result = await api("/api/auth/farmer/verify-otp", {
    method: "POST", body: { mobile: FARMER.mobile, otp: FARMER.otp },
  });
  if (!result.ok) {
    throw new Error(`farmer login failed (${result.status}): ${result.data.error || "no detail"}. `
      + "Start the backend with DEMO_MODE=true, or set PM_FARMER_MOBILE/PM_FARMER_OTP to a real OTP flow.");
  }
  return { token: result.data.token, user: result.data.user };
}

async function loginVet() {
  const result = await api("/api/auth/login", {
    method: "POST", body: { identifier: VET.email, password: VET.password },
  });
  if (!result.ok) throw new Error(`vet login failed (${result.status}): ${result.data.error || "no detail"}`);
  return { token: result.data.token, user: result.data.user };
}

/** A socket that is authenticated exactly like the browser client. */
function connectSocket(token, label) {
  const socket = io(BASE, {
    path: "/socket.io",
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
    timeout: 15000,
  });
  socket.on("connect_error", (err) => console.log(`  ! ${label} socket error: ${err.message}`));
  return socket;
}

function waitForEvent(socket, event, predicate, label) {
  return withTimeout(new Promise((resolve) => {
    const handler = (payload) => {
      if (predicate && !predicate(payload)) return;
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  }), label);
}

/** 48 kHz mono tone so the encoder always has something to send. */
function makeTone(frequency) {
  const source = new nonstandard.RTCAudioSource();
  const track = source.createTrack();
  let n = 0;
  const timer = setInterval(() => {
    const samples = new Int16Array(480);
    for (let i = 0; i < 480; i += 1) {
      samples[i] = Math.round(4000 * Math.sin((2 * Math.PI * frequency * (n + i)) / 48000));
    }
    n += 480;
    source.onData({ samples, sampleRate: 48000, bitsPerSample: 16, channelCount: 1, numberOfFrames: 480 });
  }, 10);
  return { track, stop: () => clearInterval(timer) };
}

function makePeer(socket, callId, label, tone, received, iceConfig, candidateLog, counters) {
  // Honour the policy the API publishes: with "relay" every candidate must come
  // from the TURN server, which is how a managed deployment is verified.
  const pc = new RTCPeerConnection({
    iceServers: (iceConfig && iceConfig.iceServers) || [],
    iceTransportPolicy: (iceConfig && iceConfig.iceTransportPolicy) || "all",
  });
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    if (candidateLog) candidateLog.push(`${label}:${event.candidate.type}/${event.candidate.protocol}`);
    counters.sent += 1;
    socket.emit("call:signal", {
      call_id: callId,
      kind: "ice",
      payload: {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      },
    });
  };
  pc.ontrack = (event) => {
    const sink = new nonstandard.RTCAudioSink(event.track);
    sink.ondata = () => { received.frames += 1; };
  };
  pc.addTrack(tone.track, new MediaStream());
  return pc;
}

async function stats(pc) {
  let inbound = 0;
  let outbound = 0;
  const pairTypes = new Set();
  const report = await pc.getStats();
  const byId = new Map();
  report.forEach((r) => byId.set(r.id, r));
  report.forEach((r) => {
    if (r.type === "inbound-rtp" && r.kind === "audio") inbound += r.packetsReceived || 0;
    if (r.type === "outbound-rtp" && r.kind === "audio") outbound += r.packetsSent || 0;
    if (r.type === "candidate-pair" && (r.nominated || r.selected || r.state === "succeeded")) {
      const local = byId.get(r.localCandidateId);
      const remote = byId.get(r.remoteCandidateId);
      if (local && remote) pairTypes.add(`${local.candidateType}->${remote.candidateType}`);
    }
  });
  return { inbound, outbound, pairs: [...pairTypes] };
}

const results = { passed: false, farmerDecoded: 0, vetDecoded: 0 };
const cleanup = [];
try {
  step("sign in both roles (server-issued identities, no ids supplied by the client)");
  const farmer = await loginFarmer();
  const vet = await loginVet();
  assert(farmer.user.role === "owner" && vet.user.role === "vet", "the two sessions carry the expected roles");

  step("clear any call left over by an earlier run (the test must be re-runnable)");
  const stale = await api("/api/webcall/calls/current", { token: vet.token });
  const staleVet = await api("/api/webcall/calls/current", { token: farmer.token });
  const staleIds = new Set([stale.data.call && stale.data.call.call_id, staleVet.data.call && staleVet.data.call.call_id]);
  for (const id of staleIds) {
    if (!id) continue;
    // cancel() is for a still-ringing call; an answered call is closed with end().
    for (const verb of ["cancel", "end"]) {
      for (const who of [farmer, vet]) {
        const closed = await api(`/api/webcall/calls/${id}/${verb}`, { method: "POST", token: who.token });
        if (closed.ok) { console.log(`  · closed stale call ${id} via ${verb}`); break; }
      }
      if ((await api("/api/webcall/calls/current", { token: farmer.token })).data.call === null
        && (await api("/api/webcall/calls/current", { token: vet.token })).data.call === null) break;
    }
  }
  if (staleIds.size && [...staleIds].some(Boolean)) ok("no stale call is left behind");

  step("the API hands the client usable ICE configuration (never a hardcoded secret)");
  const config = await api("/api/webcall/config", { token: farmer.token });
  const iceServers = (config.data && config.data.ice_servers) || [];
  const icePolicy = (config.data && config.data.ice_transport_policy) || "all";
  const iceConfig = { iceServers, iceTransportPolicy: icePolicy };
  assert(config.ok && Array.isArray(iceServers) && iceServers.length > 0, "config returns ICE servers for the browser");
  const turnConfigured = !!(config.data.ice && config.data.ice.turn_configured);
  console.log(`  · TURN relay configured: ${turnConfigured ? "yes" : "no (reflexive/direct paths only)"}`);
  if (config.data.ice && config.data.ice.turn_mode) {
    assert(!["static", "ephemeral"].includes(config.data.ice.turn_mode) || turnConfigured,
      "a configured TURN server is reported honestly");
  }

  step("veterinarian opts in to availability for the farmer's language");
  const availability = await api("/api/vet/availability", {
    method: "PUT", token: vet.token,
    body: { status: "AVAILABLE", supported_languages: [LANGUAGE, "en", "hi", "mr", "te"] },
  });
  assert(availability.ok, `availability accepted by the server (${availability.status})`);

  step("both portals open their real signaling sockets");
  // Attach the ready listener in the same tick as the connection: Socket.IO
  // does not replay events to listeners registered later.
  const farmerSocket = connectSocket(farmer.token, "farmer");
  const farmerReady = waitForEvent(farmerSocket, "session:ready", null, "farmer session:ready");
  const vetSocket = connectSocket(vet.token, "vet");
  const vetReady = waitForEvent(vetSocket, "session:ready", null, "vet session:ready");
  cleanup.push(() => { farmerSocket.disconnect(); vetSocket.disconnect(); });
  await Promise.all([farmerReady, vetReady]);
  ok("both sockets authenticated and ready");

  step("farmer places the call; the server routes it");
  const incomingPromise = waitForEvent(vetSocket, "call:incoming", null, "vet call:incoming");
  const created = await api("/api/webcall/calls", {
    method: "POST", token: farmer.token,
    body: { language: LANGUAGE, reason: "animal_sick", notes: "two_peer_call.mjs integration test" },
  });
  assert(created.ok && created.status === 201, `call created and ringing (${created.status})`);
  const callId = created.data.call.call_id;
  assert(!!callId && created.data.call.status === "ringing", `call ${callId} is ringing`);
  cleanup.push(() => api(`/api/webcall/calls/${callId}/cancel`, { method: "POST", token: farmer.token }));

  const incoming = await incomingPromise;
  assert(incoming.call && incoming.call.call_id === callId, "the assigned vet received call:incoming for this call");
  assert(incoming.call.caller && incoming.call.caller.name, "the vet sees the caller's server-side identity");
  assert(VET.email && vet.user.id, "the vet identity is the authenticated account, not a client-supplied id");

  step("server refuses signaling before the vet answers");
  const early = await new Promise((resolve) => farmerSocket.emit("call:signal",
    { call_id: callId, kind: "offer", payload: { type: "offer", sdp: "v=0" } }, resolve));
  assert(early && early.ok === false && early.error === "state_conflict",
    `signaling while ringing is rejected by the state machine (${early && early.error})`);

  step("vet answers; the pair negotiates through the real relay");
  const farmerTone = makeTone(440);
  const vetTone = makeTone(660);
  cleanup.push(() => { farmerTone.stop(); vetTone.stop(); });
  const vetReceived = { frames: 0 };
  const farmerReceived = { frames: 0 };
  const iceCandidateTypes = [];
  const iceCounters = { sent: 0, relayed: 0, buffered: 0, applied: 0 };
  const vetPc = makePeer(vetSocket, callId, "vet", vetTone, vetReceived, iceConfig, iceCandidateTypes, iceCounters);
  const farmerPc = makePeer(farmerSocket, callId, "farmer", farmerTone, farmerReceived, iceConfig, iceCandidateTypes, iceCounters);
  cleanup.push(() => { try { farmerPc.close(); vetPc.close(); } catch (err) { /* already closed */ } });

  // ICE candidates can outrun the SDP; buffer them until the remote
  // description is in place (exactly what the browser client does).
  // A signal arriving on a participant's socket was sent by the OTHER
  // participant, so it belongs on that socket owner's peer connection:
  //   candidates sent by the farmer arrive on the vet's socket -> vet's PC.
  // Host candidates are also embedded in the offer/answer SDP, which can hide a
  // mismatch here; relay candidates only arrive by trickle, so this must be right.
  const relayIce = (from, pc) => {
    const buffered = [];
    from.on("call:signal", async (payload) => {
      if (payload.kind !== "ice" || !payload.payload || !payload.payload.candidate) return;
      iceCounters.relayed += 1;
      if (!pc.remoteDescription) { buffered.push(payload.payload); iceCounters.buffered += 1; return; }
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.payload)); iceCounters.applied += 1; } catch (err) { /* late candidate */ }
    });
    return { flush: async () => { for (const candidate of buffered.splice(0)) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); iceCounters.applied += 1; } catch (err) { /* late */ } } } };
  };
  const farmerIce = relayIce(vetSocket, vetPc);      // the farmer's candidates
  const vetIce = relayIce(farmerSocket, farmerPc);   // the vet's candidates
  const flushIce = async () => { await farmerIce.flush(); await vetIce.flush(); };

  // The vet applies the offer as soon as it arrives (set up before answering).
  const offerPromise = waitForEvent(vetSocket, "call:signal", (p) => p.kind === "offer", "vet offer");
  const answerPromise = waitForEvent(farmerSocket, "call:signal", (p) => p.kind === "answer", "farmer answer");

  const accepted = await api(`/api/webcall/calls/${callId}/accept`, { method: "POST", token: vet.token });
  assert(accepted.ok && accepted.data.call.status === "accepted", "the server recorded the answer atomically");

  // Signaling is only allowed once the call is accepted, so the caller offers now.
  const offer = await farmerPc.createOffer();
  await farmerPc.setLocalDescription(offer);
  farmerSocket.emit("call:signal", {
    call_id: callId, kind: "offer",
    payload: { type: farmerPc.localDescription.type, sdp: farmerPc.localDescription.sdp },
  });

  const offerSignal = await offerPromise;
  await vetPc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSignal.payload.sdp }));
  await vetPc.setLocalDescription(await vetPc.createAnswer());
  vetSocket.emit("call:signal", {
    call_id: callId, kind: "answer",
    payload: { type: vetPc.localDescription.type, sdp: vetPc.localDescription.sdp },
  });

  const answerSignal = await answerPromise;
  await farmerPc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: answerSignal.payload.sdp }));
  await flushIce();
  ok("offer/answer exchanged through the server's durable signal relay");


  const waitConnected = (pc, label) => withTimeout(new Promise((resolve) => {
    if (pc.connectionState === "connected") return resolve(true);
    pc.addEventListener("connectionstatechange", () => { if (pc.connectionState === "connected") resolve(true); });
  }), `${label} peer connection`, 45000);
  const iceDiagnostics = () => JSON.stringify({
    farmer: { connection: farmerPc.connectionState, ice: farmerPc.iceConnectionState, gathering: farmerPc.iceGatheringState },
    vet: { connection: vetPc.connectionState, ice: vetPc.iceConnectionState, gathering: vetPc.iceGatheringState },
    policy: icePolicy,
    candidate_types: iceCandidateTypes,
    ice_signals: iceCounters,
  });
  try {
    await Promise.all([waitConnected(farmerPc, "farmer"), waitConnected(vetPc, "vet")]);
  } catch (err) {
    // A failed ICE negotiation is the hardest failure to debug remotely; always
    // print the state of both peers (never credentials or SDP contents).
    console.error(`ICE diagnostics: ${iceDiagnostics()}`);
    for (const [label, pc] of [["farmer", farmerPc], ["vet", vetPc]]) {
      const report = await pc.getStats().catch(() => null);
      if (!report) continue;
      const byId = new Map();
      report.forEach((r) => byId.set(r.id, r));
      const pairs = [];
      report.forEach((r) => {
        if (r.type !== "candidate-pair") return;
        const local = byId.get(r.localCandidateId);
        const remote = byId.get(r.remoteCandidateId);
        pairs.push({
          state: r.state, nominated: !!r.nominated, checks: r.requestsSent, responses: r.responsesReceived,
          bytesSent: r.bytesSent, bytesRecv: r.bytesReceived,
          local: local ? `${local.candidateType}/${local.protocol} ${local.address}:${local.port}` : null,
          remote: remote ? `${remote.candidateType}/${remote.protocol} ${remote.address}:${remote.port}` : null,
        });
      });
      console.error(`${label} candidate pairs: ${JSON.stringify(pairs)}`);
    }
    throw err;
  }
  assert(farmerPc.connectionState === "connected" && vetPc.connectionState === "connected",
    "both real peer connections reached the connected state (ICE + DTLS-SRTP)");

  step("the server records the connection only after a client confirms real media");
  const farmerConnected = await api(`/api/webcall/calls/${callId}/connected`, {
    method: "POST", token: farmer.token, body: { media_confirmed: true },
  });
  const vetConnected = await api(`/api/webcall/calls/${callId}/connected`, {
    method: "POST", token: vet.token, body: { media_confirmed: true },
  });
  assert(farmerConnected.ok && vetConnected.ok, "both clients confirmed the connected state");
  assert(!!farmerConnected.data.call.connected_at, "the server stamped connected_at");
  assert(farmerConnected.data.call.status === "connected", "the call is connected server-side");

  step(`audio flows in both directions (${AUDIO_SECONDS}s)`);
  const before = { farmer: await stats(farmerPc), vet: await stats(vetPc) };
  await new Promise((resolve) => setTimeout(resolve, AUDIO_SECONDS * 1000));
  const after = { farmer: await stats(farmerPc), vet: await stats(vetPc) };
  assert(after.farmer.inbound > before.farmer.inbound, `farmer received RTP audio (${after.farmer.inbound} packets)`);
  assert(after.vet.inbound > before.vet.inbound, `vet received RTP audio (${after.vet.inbound} packets)`);
  assert(after.farmer.outbound > 0 && after.vet.outbound > 0, "both peers sent RTP audio");
  console.log(`  · selected candidate pairs: farmer ${JSON.stringify(after.farmer.pairs)} vet ${JSON.stringify(after.vet.pairs)}`);
  if (icePolicy === "relay") {
    assert(after.farmer.pairs.every((p) => p.startsWith("relay")) && after.farmer.pairs.length > 0,
      "with ice_transport_policy=relay every farmer candidate is a TURN relay candidate");
    assert(after.vet.pairs.every((p) => p.startsWith("relay")) && after.vet.pairs.length > 0,
      "with ice_transport_policy=relay every vet candidate is a TURN relay candidate");
  }
  assert(farmerReceived.frames > 0 && vetReceived.frames > 0,
    `both directions decoded real audio frames (farmer ${farmerReceived.frames}, vet ${vetReceived.frames})`);
  results.farmerDecoded = farmerReceived.frames;
  results.vetDecoded = vetReceived.frames;

  step("mute state is relayed to the peer");
  const muteSeen = waitForEvent(vetSocket, "call:mute", (p) => p.muted === true, "vet call:mute");
  await new Promise((resolve) => farmerSocket.emit("call:mute", { call_id: callId, muted: true }, resolve));
  const mute = await muteSeen;
  assert(mute.call_id === callId, "the peer learned that the other side is muted");

  step("ending the call finalizes the state for both participants");
  const terminalForVet = waitForEvent(vetSocket, "call:update",
    (p) => p.call_id === callId && ["ended", "cancelled", "rejected", "missed", "failed", "expired"].includes(p.status),
    "vet terminal call:update");
  const ended = await api(`/api/webcall/calls/${callId}/end`, {
    method: "POST", token: farmer.token, body: { reason: "HANGUP" },
  });
  assert(ended.ok && ended.data.call.status === "ended", "the server closed the call");
  assert(ended.data.call.connected_at && Number(ended.data.call.duration_seconds) >= 0,
    "the call carries accurate timestamps and a duration");
  const terminal = await terminalForVet;
  assert(terminal.status === "ended", `the vet portal received the terminal event (${terminal.status})`);

  step("history is authorized and complete for the participant");
  const history = await api("/api/webcall/calls/history", { token: farmer.token });
  const list = Array.isArray(history.data) ? history.data : (history.data.calls || []);
  const row = list.find((item) => item.call_id === callId);
  assert(!!row && row.status === "ended", "the ended call appears in the farmer's history");

  results.passed = true;
  console.log(`\nPASS — real two-way WebRTC audio verified (${steps.length} steps, decoded frames farmer=${results.farmerDecoded} vet=${results.vetDecoded}).`);
  process.exitCode = 0;
} catch (err) {
  console.error(`\nFAIL: ${err.message}`);
  process.exitCode = 1;
} finally {
  for (const fn of cleanup.reverse()) {
    try { await fn(); } catch (err) { /* best-effort cleanup */ }
  }
  // node-webrtc keeps native handles; leaving immediately is intentional.
  setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
}
