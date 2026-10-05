/**
 * Frontend checks for the real-time web calling client (frontend/call.js).
 *
 *   node --test frontend/tests/
 *
 * How these tests are set up — and what they prove:
 *   * call.js runs inside a sandboxed VM with a small DOM stub, a stubbed
 *     Socket.IO client, a stubbed RTCPeerConnection and a stubbed getUserMedia,
 *   * the stubbed objects record *exactly* what the production code asks them
 *     to do: which requests go to which endpoint, when the audio track is
 *     disabled, when the peer connection is closed and when the ringtone is
 *     stopped.
 *
 * They therefore prove the client-side logic (state handling, mute, cleanup,
 * ringtone lifecycle, signal ordering, "Connected" gating, permission errors)
 * but they are NOT proof that audio flows between two browsers: that requires
 * real browser engines. See webcall_browser.test.mjs (Playwright) and
 * tests/webrtc-real/ for the real-connection tests.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const callSource = fs.readFileSync(path.join(here, "..", "call.js"), "utf8");

const TOKEN = "test.jwt.token";
const USER = { id: 7, role: "vet", full_name: "Dr. Test" };

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

// When the code under test assigns innerHTML, the browser makes the elements
// with ids real nodes. The stub records those ids so the test can click them.
let innerHtmlIdSink = null;
// Removing a node in the browser also removes it from getElementById lookups.
let elementRemovalSink = null;

/** Minimal DOM element with working listeners + innerHTML bookkeeping. */
function makeElement(tag = "div") {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    id: "",
    className: "",
    style: {},
    textContent: "",
    _innerHTML: "",
    hidden: false,
    disabled: false,
    value: "",
    srcObject: null,
    autoplay: false,
    playsInline: false,
    attributes: {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = String(value);
      this.children = [];
      if (innerHtmlIdSink) {
        const ids = [...this._innerHTML.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
        innerHtmlIdSink(ids);
      }
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() {
      if (this.parentNode && Array.isArray(this.parentNode.children)) {
        this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      }
      this.removed = true;
      if (elementRemovalSink && this.id) elementRemovalSink(this.id);
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((h) => h !== handler));
    },
    querySelectorAll: () => [],
    dispatch(type, event = {}) {
      const handlers = listeners.get(type) || [];
      handlers.forEach((handler) => handler({ preventDefault() {}, ...event }));
      return handlers.length;
    },
    click() { if (this.disabled) return 0; return this.dispatch("click"); },
    focus() {},
    play: () => Promise.resolve(),
    listeners,
  };
  return el;
}

/** Build a sandbox in which call.js can run. */
const activeClients = [];
afterEach(() => {
  while (activeClients.length) {
    const client = activeClients.pop();
    try { client.cleanup(); } catch (err) { /* already torn down */ }
  }
});

function loadCallClient({
  storage = makeStorage({ token: TOKEN, user: JSON.stringify(USER) }),
  session = { token: TOKEN, user: USER },
} = {}) {
  const elements = new Map();
  const intervals = new Map();
  const createdIntervals = [];
  const clearedIntervals = [];
  const oscillators = [];
  const peerConnections = [];
  const sockets = [];
  const requests = [];
  const toasts = [];
  const mediaRequests = [];

  elementRemovalSink = (id) => { elements.delete(id); };
  innerHtmlIdSink = (ids) => {
    // Fresh nodes for the ids in the new markup (old children are discarded by
    // the browser as well), so listeners attached to a previous render cannot
    // fire a second time.
    ids.forEach((id) => {
      const el = makeElement();
      el.id = id;
      elements.set(id, el);
    });
  };

  function element(id) {
    if (!elements.has(id)) {
      const el = makeElement();
      el.id = id;
      // call.js builds the panel by assigning innerHTML and then re-reading
      // #pmCallAnswer/#pmCallReject/#pmCallMute/#pmCallHangup: materialize them.
      el.__materialize = true;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  const body = makeElement("body");
  body.appendChild = (child) => { body.children.push(child); if (child.id) elements.set(child.id, child); return child; };

  class FakeTrack {
    constructor() { this.kind = "audio"; this.enabled = true; this.stopped = false; }
    stop() { this.stopped = true; }
  }

  function makeStream() {
    const tracks = [new FakeTrack()];
    return { getAudioTracks: () => tracks, getTracks: () => tracks, tracks };
  }

  class FakePeerConnection {
    constructor(config) {
      this.config = config;
      this.connectionState = "new";
      this.iceConnectionState = "new";
      this.signalingState = "stable";
      this.localDescription = null;
      this.currentRemoteDescription = null;
      this.addedTracks = [];
      this.remoteCandidates = [];
      this.closed = false;
      this.stats = { inbound: 0, outbound: 0 };
      this.calls = [];
      this.restarted = 0;
      peerConnections.push(this);
    }
    addTrack(track) { this.addedTracks.push(track); }
    async createOffer() { this.calls.push("createOffer"); return { type: "offer", sdp: "fake-offer" }; }
    async createAnswer() { this.calls.push("createAnswer"); return { type: "answer", sdp: "fake-answer" }; }
    async setLocalDescription(description) {
      this.calls.push(`setLocal:${description.type}`);
      this.localDescription = { type: description.type, sdp: description.sdp };
      this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    }
    async setRemoteDescription(description) {
      this.calls.push(`setRemote:${description.type}`);
      this.currentRemoteDescription = { type: description.type, sdp: description.sdp };
      this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    }
    async addIceCandidate(candidate) { this.remoteCandidates.push(candidate); }
    restartIce() { this.restarted += 1; }
    close() { this.closed = true; this.connectionState = "closed"; }
    async getStats() {
      const stats = new Map();
      stats.set("in", { type: "inbound-rtp", kind: "audio", packetsReceived: this.stats.inbound });
      stats.set("out", { type: "outbound-rtp", kind: "audio", packetsSent: this.stats.outbound });
      return stats;
    }
    emitConnectionState(value) { this.connectionState = value; if (this.onconnectionstatechange) this.onconnectionstatechange(); }
    emitIceCandidate(candidate) { if (this.onicecandidate) this.onicecandidate({ candidate }); }
    emitTrack(stream) { if (this.ontrack) this.ontrack({ streams: [stream] }); }
  }

  class FakeSocket {
    constructor(url, options) {
      this.url = url; this.options = options;
      this.connected = true; this.handlers = new Map(); this.emitted = [];
      sockets.push(this);
      setTimeout(() => this.receive("session:ready", { user_id: USER.id, role: USER.role }), 0);
    }
    on(event, handler) {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event).push(handler);
      return this;
    }
    emit(event, payload, ack) {
      this.emitted.push({ event, payload });
      if (typeof ack === "function") ack({ ok: true });
      return this;
    }
    receive(event, payload) {
      (this.handlers.get(event) || []).forEach((handler) => handler(payload));
    }
    disconnect() { this.connected = false; }
  }

  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    async resume() { this.state = "running"; }
    createOscillator() {
      const osc = {
        type: "sine", frequency: { value: 0 }, startedAt: null, stopped: false,
        connect(node) { this.connectedTo = node; return node; },
        start() { this.startedAt = 1; oscillators.push(this); },
        stop() { this.stopped = true; },
      };
      return osc;
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 },
        connect(node) { return node; },
      };
    }
  }

  let fetchHandler = () => Promise.reject(new Error("network not stubbed"));
  const timeouts = new Set();
  let cleanedUp = false;
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => {
      // call.js finishes its asynchronous init after the synchronous test body:
      // once the test is over, later timers must not keep the process alive.
      if (cleanedUp) return -1;
      const id = setTimeout(fn, ms);
      timeouts.add(id);
      return id;
    },
    clearTimeout: (id) => { timeouts.delete(id); clearTimeout(id); },
    setInterval: (fn, ms) => {
      // Real intervals: the client's signal polling is part of what is tested.
      // cleanup() clears every interval this sandbox created, so nothing can
      // keep the test process alive afterwards.
      if (cleanedUp) return -1;
      const id = setInterval(fn, ms);
      intervals.set(id, { fn, ms });
      createdIntervals.push({ id, ms });
      return id;
    },
    clearInterval: (id) => {
      clearedIntervals.push(id);
      intervals.delete(id);
      clearInterval(id);
    },
    fetch: (url, options = {}) => {
      requests.push({ url: String(url), options });
      return fetchHandler(String(url), options);
    },
    localStorage: storage,
    navigator: {
      onLine: true,
      serviceWorker: undefined,
      mediaDevices: {
        getUserMedia: (constraints) => {
          mediaRequests.push(constraints);
          return Promise.resolve(makeStream());
        },
        enumerateDevices: () => Promise.resolve([{ kind: "audioinput" }]),
      },
    },
    location: { hash: "#/", origin: "http://localhost", host: "localhost", href: "http://localhost/" },
    RTCPeerConnection: FakePeerConnection,
    AudioContext: FakeAudioContext,
    io: (url, options) => new FakeSocket(url, options),
    document: {
      readyState: "complete",
      documentElement: {},
      body,
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => (tag === "audio" ? makeElement("audio") : makeElement(tag)),
    },
    window: {
      addEventListener() {},
      scrollTo() {},
      state: { token: session.token, user: session.user, lang: "en" },
      localStorage: storage,
      // A browser exposes these on window as well; call.js uses both spellings.
      io: (url, options) => new FakeSocket(url, options),
      AudioContext: FakeAudioContext,
      RTCPeerConnection: FakePeerConnection,
      RTCPeerConnection_: null,
      render: (html) => { element("app").innerHTML = html; },
      toast: (message, isError) => toasts.push({ message, isError }),
      header: (title) => `<header>${title}</header>`,
      bottomNav: () => "<nav></nav>",
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  const context = vm.createContext(sandbox);
  vm.runInContext(callSource, context, { filename: "call.js" });

  const client = {
    sandbox,
    context,
    elements,
    element,
    requests,
    toasts,
    oscillators,
    peerConnections,
    sockets,
    mediaRequests,
    createdIntervals,
    clearedIntervals,
    intervals,
    setFetch: (handler) => { fetchHandler = handler; },
    run: (expression) => vm.runInContext(expression, context),
    /** Wait until call.js finished its asynchronous init (socket opened). */
    ready: async (timeoutMs = 400) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && sockets.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return sockets[sockets.length - 1];
    },
    /** Fetch a rendered element; fail loudly when the UI never rendered it. */
    el: (id) => {
      const el = elements.get(id);
      if (!el) throw new Error(`expected the UI to render #${id}`);
      return el;
    },
    socket: () => sockets[sockets.length - 1],
    pm: () => vm.runInContext("window.PMCall", context),
    /** Stop every timer/socket this harness created so the test runner exits. */
    cleanup: () => {
      cleanedUp = true;
      createdIntervals.forEach(({ id }) => clearInterval(id));
      intervals.clear();
      timeouts.forEach((id) => clearTimeout(id));
      timeouts.clear();
      sockets.forEach((socket) => { socket.connected = false; socket.handlers.clear(); });
      try {
        const status = client.pm().status();
        if (status.active_call) vm.runInContext("window.PMCall.onAuthChanged && window.PMCall.onAuthChanged()", context);
      } catch (err) { /* nothing to tear down */ }
    },
  };
  activeClients.push(client);
  return client;
}


const CONFIG = {
  channel: "webrtc_web_call",
  user: { id: 7, role: "vet", language: "en" },
  ice_servers: [{ urls: ["stun:stun.example.org:3478"] }],
  ice: { turn_configured: false },
  ice_transport_policy: "all",
  signaling: { url: "", path: "socket.io", offline_warning_seconds: 10 },
  ring_timeout_seconds: 45,
  call_reasons: ["animal_sick", "emergency"],
  supported_languages: [{ code: "en", name: "English" }],
  push: { configured: false },
  helpline: { number: "7382210251", pstn_connected: false },
};

/** Route the client's REST calls without pretending a call exists when it does not. */
function callApi(routes = {}) {
  return (url) => {
    const path = url.replace(/^\/api/, "");
    if (path.startsWith("/webcall/config")) return json(routes.config || CONFIG);
    if (path.startsWith("/webcall/availability")) {
      if (typeof routes.availability === "function") return json(routes.availability(path));
      return json(routes.availability || {
        requested_language: "en", requested_language_name: "English", routable: true,
        message: "A veterinarian for English is currently online.",
        alternatives: [], selected_vet: { vet_id: 7, name: "Dr. Test", district: "Pune" },
        helpline: { number: "7382210251", pstn_connected: false },
      });
    }
    if (path.startsWith("/webcall/calls/current")) return json({ call: routes.current || null });
    if (path.includes("/signals")) {
      // Deliberately independent of the detail payload: the signal backfill must
      // not silently report a terminal call unless the test asks for it.
      return json({ call: routes.signal_call || null, signals: routes.signals || [], first_signal_id: routes.first_signal_id ?? null });
    }
    if (path.includes("/accept")) return json({ call: routes.accepted || routes.call || null });
    if (path.includes("/reject")) return json({ call: routes.rejected || TERMINAL_CALL("rejected") });
    if (path.includes("/connected")) return json({ call: routes.connected || routes.call || null });
    if (path.includes("/failed")) return json({ call: TERMINAL_CALL("failed") });
    if (path.endsWith("/end") || path.includes("/cancel")) return json({ call: TERMINAL_CALL("ended") });
    if (path === "/webcall/calls") return json(routes.created || { call: RINGING_CALL, outcome: "ringing" });
    if (path.startsWith("/webcall/calls/")) return json({ call: routes.call || null });
    return json({ call: null });
  };
}
function json(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

const TERMINAL_CALL = (status = "ended") => ({
  call_id: "wc_test_1", status, active: false, channel: "web", language: "en",
  caller: { id: 5, name: "Rajesh Patil", village: "Wagholi", district: "Pune" },
  vet: { id: 7, name: "Dr. Test" }, connected_at: "2026-01-01 10:00:00",
  duration_seconds: 42, end_reason: "HANGUP", ring_timeout_seconds: 45,
});

const RINGING_CALL = {
  call_id: "wc_test_1", status: "ringing", active: true, channel: "web", language: "mr",
  reason: "animal_sick", reason_note: "Cow with fever",
  caller: { id: 5, name: "Rajesh Patil", village: "Wagholi", district: "Pune" },
  vet: { id: 7, name: "Dr. Test" }, ring_timeout_seconds: 45,
};

/** Switch the client's active session status and render, like the server would. */
function pushCallUpdate(client, call) {
  client.socket().receive("call:update", { call_id: call.call_id, status: call.status, event: "test" });
  return Promise.resolve();
}


const OWNER = { id: 5, role: "owner", full_name: "Rajesh Patil", preferred_language: "mr" };


// ---------------------------------------------------------------------------
test("the signaling socket is opened WebSocket-first with a polling fallback", async () => {
  // Deployment-critical: WebSocket-first keeps signaling on one upgraded
  // connection (one worker process), and tryAllTransports lets a network that
  // blocks WebSocket upgrades fall back to long-polling instead of failing.
  const client = loadCallClient();
  client.setFetch(callApi());
  await client.ready();
  const options = client.socket().options;
  assert.equal(options.transports[0], "websocket", "WebSocket is the first transport");
  // join() rather than deepEqual: the options array comes from the VM realm.
  assert.equal(options.transports.join(","), "websocket,polling", "polling stays available as a fallback");
  assert.equal(options.tryAllTransports, true, "a blocked WebSocket falls back instead of giving up");
});

test("the calling client exposes its public API and reports configuration", async () => {
  const client = loadCallClient();
  const pm = client.pm();
  assert.equal(typeof pm.startFarmerCallFlow, "function");
  assert.equal(typeof pm.renderOwnerCallView, "function");
  assert.equal(typeof pm.renderCallHistory, "function");
  assert.equal(typeof pm.mountVetCard, "function");
  assert.equal(typeof pm.onAuthChanged, "function");
  assert.equal(pm.status().active_call, null);
});

test("no token means no signaling socket is opened", async () => {
  const client = loadCallClient({ storage: makeStorage({}), session: { token: null, user: null } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(client.sockets.length, 0);
  assert.equal(client.requests.length, 0);
});

test("incoming call shows the popup, starts the ringtone and lists caller context", async () => {
  const client = loadCallClient();
  client.setFetch(callApi());
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));

  const overlay = client.el("pmCallOverlay");
  assert.ok(overlay, "overlay rendered");
  assert.match(overlay.innerHTML, /Rajesh Patil/);
  assert.match(overlay.innerHTML, /Wagholi/);
  assert.match(overlay.innerHTML, /MR/);                     // language badge
  assert.match(overlay.innerHTML, /Cow with fever/);          // reason note
  assert.match(overlay.innerHTML, /pmCallAnswer/);
  assert.match(overlay.innerHTML, /pmCallReject/);
  assert.equal(client.pm().status().ringtone_playing, true, "ringtone loops while ringing");
  assert.ok(client.oscillators.length > 0, "ringtone uses synthesized audio");
});

test("declining stops the ringtone immediately and calls the reject endpoint", async () => {
  const client = loadCallClient();
  const calls = [];
  const route = callApi({ rejected: TERMINAL_CALL("rejected") });
  client.setFetch((url, options) => { calls.push({ url, options }); return route(url, options); });
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const answerElement = client.element("pmCallReject");
  assert.equal(answerElement.dispatch("click"), 1, "decline button is wired");
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(client.pm().status().ringtone_playing, false);
  assert.ok(calls.some((call) => call.url.endsWith("/api/webcall/calls/wc_test_1/reject") && call.options.method === "POST"),
    "the decline is authorized on the server, not simulated locally");
  assert.equal(client.pm().status().overlay_open, false, "popup closed");
});

test("ring timeout / terminal server state stops the ringtone and reports honestly", async () => {
  const client = loadCallClient();
  const expired = { ...TERMINAL_CALL("expired"), end_reason: "RING_TIMEOUT" };
  client.setFetch(callApi({ call: expired, expired }));
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(client.pm().status().ringtone_playing, true, "ringtone loops while ringing");

  client.socket().receive("call:update", { call_id: RINGING_CALL.call_id, status: "expired", event: "expired" });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(client.pm().status().ringtone_playing, false, "ringtone stopped on a terminal state");
  assert.equal(client.pm().status().overlay_open, true, "the practitioner is told what happened");
});

test("answering acquires the microphone and mute really disables the outgoing track", async () => {
  const client = loadCallClient();
  const calls = [];
  const accepted = { ...RINGING_CALL, status: "accepted" };
  const route = callApi({ accepted, call: accepted });
  client.setFetch((url, options) => { calls.push({ url, options }); return route(url, options); });
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));

  client.el("pmCallAnswer").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.equal(client.mediaRequests.length, 1, "getUserMedia is requested when answering");
  assert.ok(calls.some((call) => call.url.endsWith("/accept")), "answer is recorded server-side");
  const pc = client.peerConnections[0];
  assert.ok(pc, "a peer connection was created");
  const track = pc.addedTracks[0];
  assert.equal(track.enabled, true);

  client.el("pmCallMute").dispatch("click");
  assert.equal(track.enabled, false, "mute disables the real MediaStreamTrack");
  assert.ok(client.socket().emitted.some((e) => e.event === "call:mute" && e.payload.muted === true));

  client.el("pmCallMute").dispatch("click");
  assert.equal(track.enabled, true, "unmute re-enables the track");
  assert.ok(client.socket().emitted.some((e) => e.event === "call:mute" && e.payload.muted === false));
});

test("'Connected' is only reported to the server after the peer connection is connected", async () => {
  const client = loadCallClient();
  const calls = [];
  const accepted = { ...RINGING_CALL, status: "accepted" };
  const acceptedThenConnected = { ...accepted, status: "connected" };
  const route = callApi({ accepted, call: accepted, connected: acceptedThenConnected });
  client.setFetch((url, options) => { calls.push({ url, options }); return route(url, options); });
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.el("pmCallAnswer").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.ok(!calls.some((call) => call.url.endsWith("/connected")), "no connected report while still connecting");

  const pc = client.peerConnections[0];
  pc.stats.inbound = 12;
  pc.emitConnectionState("connected");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const connectedCall = calls.find((call) => call.url.endsWith("/connected"));
  assert.ok(connectedCall, "connected only after the peer connection reaches 'connected'");
  assert.equal(JSON.parse(connectedCall.options.body).media_confirmed, true, "confirmed by inbound RTP stats");
});

test("hanging up closes the peer connection, stops the tracks and removes the audio element", async () => {
  const client = loadCallClient();
  const accepted = { ...RINGING_CALL, status: "accepted" };
  client.setFetch(callApi({ accepted, call: accepted }));
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.el("pmCallAnswer").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pc = client.peerConnections[0];
  const track = pc.addedTracks[0];
  pc.emitTrack({ getAudioTracks: () => [] });

  // The remote audio element is created by ontrack.
  assert.ok(client.elements.get("pmCallRemoteAudio"), "remote audio element attached");
  client.el("pmCallHangup").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(pc.closed, true, "peer connection closed");
  assert.equal(track.stopped, true, "microphone track stopped");
  assert.equal(client.pm().status().active_call, null);
  assert.equal(client.pm().status().ringtone_playing, false);
});

test("signals are applied strictly in order, duplicates are ignored", async () => {
  const client = loadCallClient();
  const accepted = { ...RINGING_CALL, status: "accepted" };
  client.setFetch(callApi({ accepted, call: accepted }));
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.el("pmCallAnswer").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pc = client.peerConnections[0];
  pc.calls.length = 0;

  // Out-of-order delivery: ice (id 3) arrives before offer (id 2).
  client.socket().receive("call:signal", { call_id: "wc_test_1", id: 3, from: "peer", kind: "ice", payload: { candidate: { candidate: "c3" } } });
  client.socket().receive("call:signal", { call_id: "wc_test_1", id: 2, from: "peer", kind: "offer", payload: { sdp: "remote-offer", type: "offer" } });
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(pc.calls.slice(0, 3), ["setRemote:offer", "createAnswer", "setLocal:answer"],
    "the offer is applied before the answer is produced (the ICE candidate is buffered)");
  assert.equal(pc.remoteCandidates.length, 1, "buffered candidate applied after the offer");

  // A duplicate of an already applied signal must not be applied twice.
  client.socket().receive("call:signal", { call_id: "wc_test_1", id: 2, from: "peer", kind: "offer", payload: { sdp: "remote-offer", type: "offer" } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(pc.calls.filter((call) => call === "setRemote:offer").length, 1);
});

test("the REST signal backfill delivers signals missed on the socket", async () => {
  const client = loadCallClient();
  const accepted = { ...RINGING_CALL, status: "accepted" };
  client.setFetch(callApi({ accepted, call: accepted }));
  await client.ready();
  client.socket().receive("call:incoming", { call: RINGING_CALL });
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.el("pmCallAnswer").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const pc = client.peerConnections[0];

  client.setFetch(callApi({
    accepted,
    call: accepted,
    signal_call: accepted,
    signals: [{ id: 1, from: "peer", kind: "offer", payload: { sdp: "backfilled", type: "offer" } }],
    first_signal_id: 1,
  }));
  await new Promise((resolve) => setTimeout(resolve, 1600));
  assert.ok(pc.calls.includes("setRemote:offer"), "backfilled offer was applied");
});

test("microphone denial never creates a call and surfaces a clear error", async () => {
  const client = loadCallClient();
  const calls = [];
  client.setFetch((url, options) => { calls.push({ url, options }); return Promise.reject(new Error("should not be called")); });
  client.sandbox.navigator.mediaDevices.getUserMedia = () => {
    const err = new Error("Permission denied");
    err.name = "NotAllowedError";
    return Promise.reject(err);
  };
  await new Promise((resolve) => setTimeout(resolve, 20));
  await client.run("window.PMCall.startFarmerCallFlow({language:'en', reason:'animal_sick'})");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.filter((call) => call.url === "/api/webcall/calls").length, 0,
    "no call record is created when the microphone was refused");
  assert.ok(client.toasts.some((toast) => /Microphone permission/i.test(toast.message) && toast.isError),
    "the farmer sees a clear permission error");
});

test("farmer call flow attaches the microphone track and follows the server state", async () => {
  const client = loadCallClient({
    session: { token: TOKEN, user: { id: 5, role: "owner", full_name: "Rajesh" } },
  });
  const calls = [];
  client.setFetch((url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/api/webcall/config")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        user: { id: 5, role: "owner", language: "mr" }, ice_servers: [{ urls: ["stun:stun.example.org:3478"] }],
        signaling: { url: "", path: "socket.io" }, ring_timeout_seconds: 45, call_reasons: ["animal_sick"],
        supported_languages: [{ code: "mr", name: "Marathi" }], push: { configured: false }, helpline: { number: "7382210251" },
      }) });
    }
    if (url.endsWith("/api/webcall/calls/current")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ call: null }) });
    }
    if (url.endsWith("/api/webcall/calls")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        call: { ...RINGING_CALL, caller: { id: 5, name: "Rajesh", village: "Wagholi", district: "Pune" } },
        outcome: "ringing", routed_to: { name: "Dr. Test" },
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ call: RINGING_CALL }) });
  });
  await client.run("window.PMCall.init()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await client.run("window.PMCall.startFarmerCallFlow({language:'mr', reason:'animal_sick'})");
  await new Promise((resolve) => setTimeout(resolve, 60));

  const createCall = calls.find((call) => call.url === "/api/webcall/calls");
  assert.ok(createCall, "the server was asked to create the call");
  const body = JSON.parse(createCall.options.body);
  assert.equal(body.language, "mr");
  assert.equal(Object.prototype.hasOwnProperty.call(body, "vet_id"), false,
    "the client never chooses the veterinarian");
  const pc = client.peerConnections[0];
  assert.equal(pc.addedTracks.length, 1, "the microphone track is attached to the peer connection");
  assert.equal(pc.config.iceServers[0].urls[0], "stun:stun.example.org:3478", "ICE servers come from the server");
});

test("owner call view pre-check keeps Start Call disabled until a routable vet is online", async () => {
  const client = loadCallClient({
    storage: makeStorage({ token: TOKEN, user: JSON.stringify(OWNER) }),
    session: { token: TOKEN, user: OWNER },
  });
  client.setFetch(callApi({
    config: {
      ...CONFIG,
      user: { id: 5, role: "owner", language: "te" },
      supported_languages: [{ code: "en", name: "English" }, { code: "te", name: "Telugu" }],
      helpline: { number: "7382210251", pstn_connected: false },
    },
    availability: {
      requested_language: "te",
      requested_language_name: "Telugu",
      routable: false,
      message: "No veterinarian for Telugu is currently online.",
      alternatives: [{ code: "en", name: "English", vet_id: 7, vet_name: "Dr. Test", district: "Pune" }],
      selected_vet: null,
      helpline: { number: "7382210251", pstn_connected: false },
      skipped_codes: ["LANGUAGE_NOT_SUPPORTED"],
    },
  }));
  await client.run("window.PMCall.renderOwnerCallView({})");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(client.el("pmCallStart").disabled, true, "the farmer cannot start a call before a routable vet is found");
  assert.match(client.element("app").innerHTML, /7382210251/, "the helpline fallback stays visible");
});

test("availability card is rendered with the persisted server state", async () => {
  const client = loadCallClient();
  client.elements.set("pmVetCallHost", client.element("pmVetCallHost"));
  client.setFetch((url) => {
    if (url.endsWith("/api/webcall/config")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({
        user: { id: 7, role: "vet", language: "en" }, ice_servers: [], ice: { turn_configured: false },
        signaling: { url: "", path: "socket.io" }, ring_timeout_seconds: 45, call_reasons: [],
        supported_languages: [], push: { configured: false }, availability: { status: "BUSY", supported_languages: ["en", "mr"] },
      }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ call: null }) });
  });
  await client.run("window.PMCall.init()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await client.run("window.PMCall.mountVetCard()");
  const host = client.elements.get("pmVetCallHost");
  assert.match(host.innerHTML, /value="BUSY" selected/, "the saved availability status is shown");
  assert.match(host.innerHTML, /pmVetEnablePush/, "notification opt-in is offered");
  assert.match(host.innerHTML, /#\/vet\/calls/, "call history is reachable");
});

test("owner call view shows a signaling-offline warning after the configured timeout", async () => {
  const client = loadCallClient({
    storage: makeStorage({ token: TOKEN, user: JSON.stringify(OWNER) }),
    session: { token: TOKEN, user: OWNER },
  });
  client.setFetch(callApi({
    config: {
      ...CONFIG,
      user: { id: 5, role: "owner", language: "mr" },
      signaling: { url: "", path: "socket.io", offline_warning_seconds: 0.01 },
      supported_languages: [{ code: "mr", name: "Marathi" }],
    },
    availability: {
      requested_language: "mr",
      requested_language_name: "Marathi",
      routable: true,
      message: "A veterinarian for Marathi is currently online.",
      alternatives: [],
      selected_vet: { vet_id: 7, name: "Dr. Test", district: "Pune" },
      helpline: { number: "7382210251", pstn_connected: false },
      skipped_codes: [],
    },
  }));
  await client.run("window.PMCall.renderOwnerCallView({})");
  await new Promise((resolve) => setTimeout(resolve, 40));
  client.socket().connected = false;
  client.socket().receive("disconnect");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(client.el("pmCallSignalStatus").textContent, /offline/i);
  assert.equal(client.pm().status().signaling_offline_long, true);
});

test("all four farmer languages define the web-call translations", async () => {
  const appSource = fs.readFileSync(path.join(here, "..", "app.js"), "utf8");
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: makeStorage({}), fetch: () => Promise.reject(new Error("no network")),
    navigator: { onLine: true }, location: { hash: "#/", origin: "http://localhost" },
    document: {
      documentElement: {},
      body: { classList: { toggle() {}, add() {}, remove() {} } },
      addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, createElement: () => makeElement(),
    },
    window: { addEventListener() {}, scrollTo() {} },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(appSource, context, { filename: "app.js" });
  const i18n = vm.runInContext("I18N", context);
  const keys = ["farmer.call_vet", "farmer.call_vet_help", "farmer.call_language", "farmer.call_reason",
    "farmer.call_notes", "farmer.start_call", "farmer.call_history", "farmer.helpline", "farmer.helpline_help"];
  for (const lang of ["en", "mr", "hi", "te"]) {
    for (const key of keys) {
      assert.ok(i18n[lang][key], `${lang} is missing ${key}`);
      assert.ok(i18n[lang][key].length > 1);
    }
  }
  // The helpline text must not claim the in-app call is a phone call.
  assert.match(i18n.en["farmer.helpline"], /phone/i);
  assert.match(i18n.en["farmer.call_vet_help"], /microphone/i);
  assert.match(appSource, /canonical availability controls for both web calls and helpline routing/i,
    "app.js documents the single editable availability source of truth");
  assert.ok(!/id=\"vetAvailabilityStatus\"/.test(appSource),
    "the old duplicate editable helpline availability control is gone");
});


// ---------------------------------------------------------------------------
// Production regression (2026-10-05): the browser-side Socket.IO path.
//
// The server accepts "socket.io" and "/socket.io" (Engine.IO normalizes its
// mount point) but the browser client concatenates the value onto the origin, so
// "socket.io" became "wss://hostsocket.io/" — an unresolvable host. The
// handshake never reached the backend, no vet presence was registered, and the
// vet portal still showed AVAILABLE while every farmer call ended in
// "No veterinarian is online right now." (NO_LIVE_SESSION).
// ---------------------------------------------------------------------------
test("the Socket.IO path from the server is normalized to a browser-safe value", async () => {
  const client = loadCallClient();
  client.setFetch(callApi({
    config: {
      ...CONFIG,
      signaling: { url: "https://pashu-shield-backend-hjgr.onrender.com", path: "socket.io", transports: ["websocket", "polling"] },
    },
  }));
  await client.ready();
  const socket = client.socket();
  assert.equal(socket.url, "https://pashu-shield-backend-hjgr.onrender.com",
    "signaling connects directly to the backend, not through the Vercel /api rewrite");
  assert.equal(socket.options.path, "/socket.io",
    "a path without a leading slash resolves to https://hostsocket.io/ and never reaches the server");
  assert.equal(socket.options.auth.token, TOKEN, "the existing JWT is presented in the handshake");
  const status = client.pm().status();
  assert.equal(status.signaling_path, "/socket.io");
  assert.equal(status.signaling_url, "https://pashu-shield-backend-hjgr.onrender.com");

  const normalize = client.run("window.PMCall.__test.normalizeSocketPath");
  assert.equal(normalize("socket.io"), "/socket.io");
  assert.equal(normalize("/socket.io/"), "/socket.io");
  assert.equal(normalize("custom/emit"), "/custom/emit");
  assert.equal(normalize(""), "/socket.io");
  assert.equal(normalize(null), "/socket.io");
  assert.equal(normalize("   "), "/socket.io");
});

test("the client uses exactly the transports the server advertises", async () => {
  const client = loadCallClient();
  client.setFetch(callApi({
    config: { ...CONFIG, signaling: { url: "", path: "/socket.io", transports: ["polling"] } },
  }));
  await client.ready();
  assert.equal(client.socket().options.transports.join(","), "polling",
    "an operator that restricts transports gets a client that matches the server");
  client.setFetch(callApi());
});

test("an AVAILABLE vet is never shown as receiving calls while signaling is down", async () => {
  const client = loadCallClient();
  client.elements.set("pmVetCallHost", client.element("pmVetCallHost"));
  client.setFetch(callApi({
    config: {
      ...CONFIG,
      availability: { status: "AVAILABLE", supported_languages: ["en"] },
      presence: { online: true, presence: "ONLINE" },
    },
  }));
  await client.run("window.PMCall.init()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await client.run("window.PMCall.mountVetCard()");

  // Signaling is up (harness default) and the lease is confirmed: routable.
  assert.equal(client.pm().status().signaling_state, "connected");
  assert.match(client.pm().__test.vetRoutabilityState().label, /CONNECTED · AVAILABLE/);

  // The socket drops: the card must stop claiming the vet can be called.
  const socket = client.socket();
  socket.connected = false;
  socket.receive("disconnect", "transport close");
  const dropped = client.pm().__test.vetRoutabilityState();
  assert.match(dropped.label, /NOT RECEIVING/, "an AVAILABLE vet with no signaling is not callable");
  assert.notEqual(client.pm().status().signaling_state, "connected");
  client.run("window.PMCall.mountVetCard()");
  assert.match(client.elements.get("pmVetCallHost").innerHTML, /signaling offline/i,
    "the vet card states the reason instead of hiding it");
  assert.match(client.elements.get("pmVetSignalStatus") ? client.elements.get("pmVetSignalStatus").textContent : "",
    /offline|reconnecting/i, "the vet sees the real channel state, not only AVAILABLE");

  // Reconnect: presence is restored automatically and the card turns green again.
  socket.connected = true;
  socket.receive("connect");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(client.pm().status().signaling_state, "connected");
  assert.match(client.pm().__test.vetRoutabilityState().label, /CONNECTED · AVAILABLE/);
  assert.ok(socket.emitted.some((entry) => entry.event === "presence:heartbeat"),
    "reconnecting renews the presence lease without any extra user action");
});

test("a rejected signaling handshake is reported instead of silently retrying", async () => {
  const client = loadCallClient({
    storage: makeStorage({ token: TOKEN, user: JSON.stringify(OWNER) }),
    session: { token: TOKEN, user: OWNER },
  });
  client.setFetch(callApi());
  await client.run("window.PMCall.renderOwnerCallView({})");
  await new Promise((resolve) => setTimeout(resolve, 60));
  const socket = client.socket();
  socket.connected = false;
  socket.receive("connect_error", { message: "Connection refused", type: "HandshakeError" });
  const status = client.pm().status();
  assert.equal(status.signaling_state, "error", "a refused handshake is an error, not a healthy state");
  assert.match(String(status.signaling_error), /Connection refused/);
  assert.match(client.el("pmCallSignalStatus").textContent, /unavailable/i,
    "the farmer sees that web calling is unavailable");
});

test("saving availability renews the presence lease on the live socket", async () => {
  const client = loadCallClient();
  client.elements.set("pmVetCallHost", client.element("pmVetCallHost"));
  const calls = [];
  client.setFetch((url, options) => {
    calls.push({ url, options });
    if (url.startsWith("/api/webcall/config")) {
      return json({ ...CONFIG, availability: { status: "OFFLINE", supported_languages: ["en"] } });
    }
    if (url.startsWith("/api/vet/availability")) {
      return json({ status: "AVAILABLE", supported_languages: ["en", "mr"] });
    }
    return json({ call: null });
  });
  await client.run("window.PMCall.init()");
  await new Promise((resolve) => setTimeout(resolve, 40));
  await client.run("window.PMCall.mountVetCard()");
  client.el("pmVetAvailability").value = "AVAILABLE";
  client.el("pmVetLanguages").selectedOptions = [{ value: "en" }, { value: "mr" }];
  client.el("pmVetSaveAvailability").click();
  await new Promise((resolve) => setTimeout(resolve, 60));

  const put = calls.find((call) => call.url === "/api/vet/availability");
  assert.ok(put, "the availability choice is persisted server-side");
  assert.equal(put.options.method, "PUT");
  assert.ok(client.socket().emitted.some((entry) => entry.event === "presence:heartbeat"),
    "choosing AVAILABLE immediately renews the presence lease (the choice alone is not routable)");
  assert.ok(client.toasts.some((toast) => /Availability updated/i.test(toast.message)));
});
