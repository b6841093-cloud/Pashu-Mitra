/* ==========================================================================
   PashuMitra — Real-Time Web Calling (farmer <-> veterinarian)
   --------------------------------------------------------------------------
   A genuine two-way audio call between two authenticated browsers:

     * signaling      authenticated Socket.IO (JWT in the handshake) against the
                      Flask backend, with a durable REST reconciliation path,
     * media          peer-to-peer WebRTC audio (mic -> RTCPeerConnection),
     * routing/state  decided exclusively by the backend (this file never
                      decides who is available, authorized, or connected),
     * ringtone       generated with WebAudio (no audio asset, no autoplay
                      workaround: if the browser blocks audio the UI says so),
     * terminal UX    ringtone stops and resources are released on every
                      terminal state (answer, reject, cancel, timeout, failure).

   It is loaded as a plain script after app.js and uses app.js's globals when
   they exist (render/header/bottomNav/t/ft/toast) while remaining usable
   without them (the notification/overlay part is self-contained).

   Honest limitations (see WEBCALL_ARCHITECTURE.md):
     * ringing while the browser is completely closed is not guaranteed — Web
       Push is used where the browser/OS supports it, and the platform decides
       whether anything is delivered,
     * a call that needs a TURN relay cannot connect when no TURN server is
       configured; the UI then reports "could not connect" instead of faking a
       connection,
     * this is *not* a telephone call: no PSTN/IVR is involved.
   ========================================================================== */
(function () {
  "use strict";

  const PM = {};
  const REASONS = ["animal_sick", "emergency", "vaccination_advice", "follow_up", "other"];
  const SIGNAL_POLL_MS = 1500;
  // Signal ids come from one global AUTOINCREMENT column: a call's ids are not
  // 1-based and not always contiguous. A very short reorder window lets a
  // slightly-out-of-order neighbour arrive before the batch is applied.
  const SIGNAL_REORDER_MS = 30;
  const STATS_CHECK_MS = 800;
  const MEDIA_CONFIRM_TIMEOUT_MS = 9000;
  const ICE_RESTART_LIMIT = 3;
  const SPEAKER_HINT_MS = 1200;
  const SIGNAL_OFFLINE_WARNING_MS = 10000;
  // Socket.IO's documented path. The browser client concatenates this value onto
  // the origin, so it MUST start with "/": a path like "socket.io" produces
  // "https://hostsocket.io/" (unresolvable host), the handshake never reaches
  // the server, presence is never registered and every farmer call is answered
  // with NO_LIVE_SESSION while the vet UI still reads AVAILABLE.
  const DEFAULT_SOCKET_PATH = "/socket.io";
  const DEFAULT_TRANSPORTS = ["websocket", "polling"];

  const state = {
    config: null,
    configPromise: null,
    socket: null,
    socketReady: null,
    activeSession: null,
    heartbeatTimer: null,
    ringtone: null,
    notificationTimer: null,
    lastIncomingCallId: null,
    audioUnlocked: false,
    signalingOfflineSince: null,
    signalingWarningTimer: null,
    lastAvailabilityCheck: null,
    presence: null,
    // Signaling diagnostics (never a token, never a credential).
    signalingUrl: null,
    signalingPath: null,
    signalingTransports: null,
    signalingError: null,
    signalingErrorType: null,
    everConnected: false,
    disconnectedAt: null,
    // Raw routing codes from the last failed attempt (developer diagnostics
    // only — never rendered as the farmer-facing sentence).
    lastCallDiagnosticCodes: null,
  };

  /** Safe diagnostic logging: the exact signaling failure is never hidden. */
  function logCall(...args) {
    try { console.log("[WEB_CALL]", ...args); } catch (e) { /* console unavailable */ }
  }
  function warnCall(...args) {
    try { console.warn("[WEB_CALL]", ...args); } catch (e) { /* console unavailable */ }
  }

  /**
   * Normalize the Socket.IO path from the server into the only form the browser
   * client can use: an absolute path with a leading slash. Accepts "", null,
   * "socket.io", "/socket.io" and "/socket.io/" and always returns "/socket.io"
   * for the default. The Python server accepts both spellings, so normalizing
   * here can never break a deployment: it only removes the asymmetry that made
   * the socket unreachable from the browser.
   */
  function normalizeSocketPath(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return DEFAULT_SOCKET_PATH;
    const withLeadingSlash = raw.startsWith("/") ? raw : "/" + raw;
    const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, "");
    return withoutTrailingSlashes || DEFAULT_SOCKET_PATH;
  }

  function signalingTransportsFrom(cfg) {
    const list = cfg && cfg.signaling && cfg.signaling.transports;
    if (Array.isArray(list) && list.length) return list.map((name) => String(name));
    return DEFAULT_TRANSPORTS.slice();
  }

  // --------------------------------------------------------------- helpers --
  function authToken() {
    if (typeof window.state === "object" && window.state && window.state.token) return window.state.token;
    try { return localStorage.getItem("token"); } catch (e) { return null; }
  }
  function currentUser() {
    if (typeof window.state === "object" && window.state && window.state.user) return window.state.user;
    try { return JSON.parse(localStorage.getItem("user") || "null"); } catch (e) { return null; }
  }
  function currentRole() {
    const user = currentUser();
    return user && ["owner", "vet", "govt", "lab"].includes(user.role) ? user.role : null;
  }
  function isFarmer() { return currentRole() === "owner"; }
  function t(key, fallback) {
    if (typeof window.t === "function") {
      try {
        const value = window.t(key);
        if (value && value !== key) return value;
      } catch (e) { /* fall through */ }
    }
    return fallback;
  }
  function ft(key, fallback) {
    if (typeof window.ft === "function") {
      try {
        const value = window.ft(key);
        if (value && value !== key) return value;
      } catch (e) { /* fall through */ }
    }
    return t("farmer." + key, fallback);
  }
  function notify(message, isError) {
    if (typeof window.toast === "function") { window.toast(message, !!isError); return; }
    if (isError) console.warn("[webcall]", message); else console.log("[webcall]", message);
  }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function mmss(seconds) {
    const value = Math.max(0, Math.floor(seconds || 0));
    return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;
  }
  function rerenderRoute() {
    if (typeof window.router === "function") window.router();
  }
  function currentHelpline() {
    return (state.config && state.config.helpline) || { number: "7382210251", pstn_connected: false };
  }
  function offlineWarningSeconds() {
    const configured = Number(state.config && state.config.signaling && state.config.signaling.offline_warning_seconds);
    return Number.isFinite(configured) && configured > 0 ? configured : (SIGNAL_OFFLINE_WARNING_MS / 1000);
  }
  function clearSignalingWarningTimer() {
    if (state.signalingWarningTimer) {
      clearTimeout(state.signalingWarningTimer);
      state.signalingWarningTimer = null;
    }
  }
  function signalingStatus() {
    const connected = !!(state.socket && state.socket.connected);
    const offlineSince = connected ? null : state.signalingOfflineSince;
    const offlineLong = !!(offlineSince && (Date.now() - offlineSince >= offlineWarningSeconds() * 1000));
    return { connected, offlineSince, offlineLong };
  }

  /**
   * One honest state for the signaling channel, used by every piece of UI:
   *   "idle"         no socket has been created yet (not logged in)
   *   "connecting"   the socket exists and is opening
   *   "connected"    the socket is live and authenticated
   *   "reconnecting" the socket dropped or the transport cannot reach the URL
   *   "error"        the server refused the handshake (bad/expired JWT, origin)
   */
  function signalingState() {
    const connected = !!(state.socket && state.socket.connected);
    if (connected) return "connected";
    if (!state.socket) return state.signalingError ? "error" : "idle";
    if (state.signalingErrorType === "TransportError") {
      // The transport cannot reach the signaling server at all: the URL, the
      // path or the network is wrong. Never report this as a healthy "online".
      return state.everConnected || state.signalingOfflineSince ? "reconnecting" : "error";
    }
    if (state.signalingError) return "error";
    // A dropped socket that is being retried is "reconnecting", not "connecting".
    return state.everConnected || state.disconnectedAt ? "reconnecting" : "connecting";
  }

  function signalingErrorText() {
    if (!state.signalingError) return "";
    const text = String(state.signalingError);
    return text.length > 160 ? text.slice(0, 157) + "…" : text;
  }

  /**
   * Did the server tell this browser that its own Origin is not allowed?
   *
   * /api/webcall/config reports the verdict for the requesting Origin
   * (`signaling.client_origin_allowed`). A rejected Origin fails the Socket.IO
   * handshake with a bare "TransportError" in the browser — CORS failures do
   * not expose a reason to JavaScript — so this server-side verdict is the only
   * way the portal can say what is actually wrong instead of "signaling
   * offline". Null when the server did not report it (older backend).
   */
  function clientOriginAllowed() {
    const value = state.config && state.config.signaling && state.config.signaling.client_origin_allowed;
    return typeof value === "boolean" ? value : null;
  }

  /**
   * One human-readable explanation of a signaling problem, plus the raw detail
   * that a developer needs. Never contains a token or a credential.
   */
  function signalingFailureInfo() {
    const channel = signalingState();
    const status = signalingStatus();
    const originOk = clientOriginAllowed();
    const dev = signalingErrorText();
    const endpoint = (state.signalingUrl || (typeof location !== "undefined" ? location.origin : "")) +
      (state.signalingPath || DEFAULT_SOCKET_PATH);
    if (originOk === false) {
      return {
        code: "ORIGIN_NOT_ALLOWED",
        farmer: t("webcall.origin_not_allowed",
          "Web calls are not enabled for this address yet. Please open the portal from the official link, or call the helpline."),
        dev: "Origin " + (state.config && state.config.signaling && state.config.signaling.client_origin) +
          " is not in the server's allowed_origins (see /api/health -> web_calling.allowed_origins). " +
          "Endpoint: " + endpoint,
      };
    }
    if (channel === "connected") return { code: "CONNECTED", farmer: "", dev: "" };
    if (channel === "connecting" || channel === "idle") {
      return {
        code: "CONNECTING",
        farmer: t("webcall.signal_restoring",
          "Your connection to the veterinarian service is being restored."),
        dev: "Engine.IO handshake has not completed yet. Endpoint: " + endpoint +
          (dev ? " · " + dev : ""),
      };
    }
    if (channel === "reconnecting" && !status.offlineLong) {
      return {
        code: "RECONNECTING",
        farmer: t("webcall.signal_restoring",
          "Your connection to the veterinarian service is being restored."),
        dev: "Socket dropped; automatic reconnection is running. Endpoint: " + endpoint +
          (dev ? " · " + dev : ""),
      };
    }
    return {
      code: "FAILED",
      farmer: t("webcall.signal_failed",
        "Web calling could not connect. Check your internet connection and try again, or call the helpline."),
      dev: "Signaling unreachable. Endpoint: " + endpoint + (dev ? " · " + dev : ""),
    };
  }

  /**
   * The 12 user-visible call states in one place (text, not colour alone):
   *   OFFLINE, CONNECTING, AVAILABLE, INCOMING_CALL, CALLING, RINGING,
   *   CONNECTING_MEDIA, CONNECTED, MUTED, RECONNECTING, ENDED, FAILED
   */
  const CALL_STATE_LABELS = {
    OFFLINE: "Offline",
    CONNECTING: "Connecting",
    AVAILABLE: "Available",
    INCOMING_CALL: "Incoming call",
    CALLING: "Calling",
    RINGING: "Ringing",
    CONNECTING_MEDIA: "Connecting audio",
    CONNECTED: "Connected",
    MUTED: "Connected · muted",
    RECONNECTING: "Reconnecting",
    ENDED: "Ended",
    FAILED: "Failed",
  };

  function callState() {
    const session = state.activeSession;
    const channel = signalingState();
    if (session) {
      const call = session.call || {};
      const pcState = webrtcConnectionState(session);
      const iceState = iceConnectionState(session);
      const media = mediaConnectionState(session);
      if (call.status === "ringing") return session.mode === "callee" ? "INCOMING_CALL" : "RINGING";
      if (call.status === "accepted" || call.status === "connecting") {
        if (iceState === "failed" || pcState === "failed") return "FAILED";
        return "CONNECTING_MEDIA";
      }
      if (call.status === "connected") {
        if (pcState === "failed" || iceState === "failed") return "FAILED";
        // A muted call is still a connected call: the label says both
        // ("Connected · muted") so the two facts are never conflated.
        if (media.confirmed && pcState === "connected") return session.muted ? "MUTED" : "CONNECTED";
        return "CONNECTING_MEDIA";
      }
      if (call.status === "missed" || call.status === "failed" || call.status === "busy") return "FAILED";
      if (TERMINAL_STATUSES.includes(call.status)) return "ENDED";
      return "CALLING";
    }
    if (channel === "connected") return "AVAILABLE";
    if (channel === "reconnecting") return "RECONNECTING";
    if (channel === "connecting") return "CONNECTING";
    if (channel === "error") return "FAILED";
    return "OFFLINE";
  }

  function callStateLabel(code) {
    const key = "webcall.state." + String(code || "").toLowerCase();
    return t(key, CALL_STATE_LABELS[code] || String(code || "").replace(/_/g, " "));
  }

  const CALL_STATE_ORDER = [
    "OFFLINE", "CONNECTING", "AVAILABLE", "INCOMING_CALL", "CALLING", "RINGING",
    "CONNECTING_MEDIA", "CONNECTED", "MUTED", "RECONNECTING", "ENDED", "FAILED",
  ];

  /** The complete state list with the current one marked (text, not colour). */
  function callStateStripHtml(current) {
    const active = current || callState();
    const chips = CALL_STATE_ORDER.map((code) =>
      `<span class="pm-state-chip" role="listitem" aria-current="${code === active ? "true" : "false"}">${esc(callStateLabel(code))}</span>`
    ).join("");
    return `<div class="pm-state-strip" role="list" aria-label="${esc(t("webcall.state_machine", "Call states"))}">${chips}</div>`;
  }

  /** Refresh every mounted state strip (farmer panel and vet card). */
  function renderStateStrips() {
    const html = callStateStripHtml();
    ["pmCallStateStripFarmer", "pmCallStateStripVet"].forEach((id) => {
      const host = document.getElementById(id);
      if (host) host.innerHTML = html;
    });
  }

  /**
   * Human wording for the server's routing codes. The codes themselves are
   * developer information: they stay in the console and in a data attribute,
   * never as the farmer's primary message ("NO_LIVE_SESSION · NO_LIVE_SESSION").
   */
  const SKIP_REASON_TEXT = {
    NO_LIVE_SESSION: "not connected right now",
    LANGUAGE_NOT_SUPPORTED: "does not take calls in this language",
    BUSY_WEB_CALL: "already on a web call",
    BUSY_IVR_CALL: "already on a phone call",
    NOT_AVAILABLE: "marked as not available",
  };

  function skipReasonSentence(codes) {
    const list = Array.isArray(codes) ? codes.filter(Boolean) : [];
    if (!list.length) return "";
    const phrases = list.map((code) => SKIP_REASON_TEXT[String(code).split(":")[0]] || "not reachable");
    const unique = phrases.filter((phrase, index) => phrases.indexOf(phrase) === index);
    return unique.join(", ");
  }
  function scheduleSignalingStatusRefresh() {
    clearSignalingWarningTimer();
    const status = signalingStatus();
    if (status.connected || !status.offlineSince) return;
    const wait = Math.max(0, (offlineWarningSeconds() * 1000) - (Date.now() - status.offlineSince));
    state.signalingWarningTimer = setTimeout(() => {
      state.signalingWarningTimer = null;
      updateOverlayStatus();
    }, wait + 5);
  }
  function setSignalingConnected(connected) {
    if (connected) {
      state.signalingOfflineSince = null;
      clearSignalingWarningTimer();
    } else if (!state.signalingOfflineSince) {
      state.signalingOfflineSince = Date.now();
      scheduleSignalingStatusRefresh();
    }
    updateOverlayStatus();
  }

  /** REST helper for the call API.
   *
   * Deliberately independent of app.js's `api()`: call actions must never be
   * queued for offline sync (a queued "answer" or "hang up" would execute hours
   * later against a dead call).
   */
  async function pmFetch(path, { method = "GET", body } = {}) {
    const headers = { "Content-Type": "application/json" };
    const token = authToken();
    if (token) headers.Authorization = "Bearer " + token;
    let response;
    try {
      response = await fetch("/api" + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch (err) {
      const offline = new Error(t("webcall.network_error", "Network unavailable — the call could not reach the server."));
      offline.offline = true;
      throw offline;
    }
    let data = {};
    try { data = await response.json(); } catch (e) { /* empty body */ }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.code = data.code;
      error.data = data;
      error.call = data.call || null;
      throw error;
    }
    return data;
  }

  function loadConfig(force) {
    if (state.config && !force) return Promise.resolve(state.config);
    if (state.configPromise && !force) return state.configPromise;
    state.configPromise = pmFetch("/webcall/config")
      .then((cfg) => {
        state.config = cfg;
        if (cfg && cfg.presence) state.presence = cfg.presence;
        return cfg;
      })
      .catch((err) => { state.configPromise = null; throw err; })
      .finally(() => { /* keep the promise for the session */ });
    return state.configPromise;
  }

  // -------------------------------------------------------------- ringtone --
  /* Two-tone ring burst every 3 s, synthesized with WebAudio: no binary asset,
     no external request, and an honest "sound blocked" report when the browser
     has not yet allowed audio playback. */
  function createRingtone() {
    let ctx = null;
    let timer = null;
    let playing = false;

    async function ensureContext() {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      if (!ctx) ctx = new Ctor();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch (e) { /* still blocked */ }
      }
      return ctx;
    }

    function burst() {
      if (!ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      [440, 480].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.05);
        gain.gain.setValueAtTime(0.16, now + 0.7);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.95);
      });
    }

    return {
      get playing() { return playing; },
      get blocked() { return !ctx || ctx.state !== "running"; },
      async unlock() {
        const context = await ensureContext();
        if (context && context.state === "running") state.audioUnlocked = true;
        return !!(context && context.state === "running");
      },
      async start() {
        if (playing) return this.blocked;
        playing = true;
        const context = await ensureContext();
        if (!context || context.state !== "running") return true; // blocked
        burst();
        timer = setInterval(burst, 3000);
        return false;
      },
      stop() {
        playing = false;
        if (timer) { clearInterval(timer); timer = null; }
      },
    };
  }
  state.ringtone = createRingtone();

  // Any first user gesture unlocks audio (browser autoplay policy).
  ["click", "touchstart", "keydown"].forEach((eventName) => {
    document.addEventListener(eventName, function unlockOnce() {
      state.ringtone.unlock().then((ok) => { if (ok) rerenderRouteSafe(); });
      ["click", "touchstart", "keydown"].forEach((name) => document.removeEventListener(name, unlockOnce));
    }, { passive: true });
  });
  function rerenderRouteSafe() { /* overlay-only refresh; avoids re-rendering forms */ }

  // ------------------------------------------------------------- signaling --
  function signalingUrl(cfg) {
    const url = cfg && cfg.signaling && cfg.signaling.url;
    if (url) return url;                  // split deployment (Vercel frontend + Render API)
    return undefined;                     // same origin
  }

  function ensureSocket() {
    if (state.socketReady) return state.socketReady;
    state.socketReady = loadConfig().then((cfg) => new Promise((resolve, reject) => {
      if (typeof window.io !== "function") {
        state.signalingError = "Socket.IO client library not loaded (vendor/socket.io.min.js)";
        state.signalingErrorType = "LibraryMissing";
        warnCall("socket connect_error:", state.signalingError);
        updateOverlayStatus();
        reject(new Error(t("webcall.signaling_unavailable",
          "Real-time signaling could not load. Check your connection and reload the page.")));
        return;
      }
      // The path comes from the server so both sides always agree; it is
      // normalized here because the browser client requires a leading slash.
      const path = normalizeSocketPath(cfg && cfg.signaling && cfg.signaling.path);
      const transports = signalingTransportsFrom(cfg);
      const url = signalingUrl(cfg);
      state.signalingUrl = url || (typeof location !== "undefined" ? location.origin : null);
      state.signalingPath = path;
      state.signalingTransports = transports;
      logCall("signaling URL", state.signalingUrl, "| path", path, "| transports", transports.join(","));
      logCall("socket connecting as", currentRole() || "unknown", "| auth token present:", !!authToken());
      const socket = window.io(url, {
        path,
        auth: { token: authToken() },
        // WebSocket first (a single upgraded connection, one worker process).
        // tryAllTransports keeps the long-polling fallback for networks that
        // block WebSocket upgrades; it requires the server to run a SINGLE
        // process (deployed: gunicorn --worker-class gthread --workers 1),
        // because Engine.IO polling session state is per-process.
        transports,
        tryAllTransports: true,
        withCredentials: false,
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 6000,
        timeout: 10000,
      });
      state.socket = socket;
      setSignalingConnected(false);

      socket.on("connect", () => {
        state.signalingError = null;
        state.signalingErrorType = null;
        state.everConnected = true;
        setSignalingConnected(true);
        const activeTransport = socket.io && socket.io.engine && socket.io.engine.transport
          ? socket.io.engine.transport.name : "unknown";
        logCall("socket connected", "sid=" + (socket.id || "?"), "| transport=" + activeTransport,
          "| endpoint=" + (state.signalingUrl || location.origin) + (state.signalingPath || DEFAULT_SOCKET_PATH));
        if (currentRole() === "vet") {
          // Presence is (re)registered by the server on every connect; ask for
          // the fresh server state so the card and the lease agree again.
          startPresenceHeartbeat();
        }
        // Every reconnect refreshes the server configuration: presence lease,
        // ICE/TURN list and (for a farmer) whether a vet is routable. Nothing
        // in the UI may keep using a stale answer.
        loadConfig(true).then((fresh) => {
          if (currentRole() === "vet") {
            if (fresh && fresh.presence) state.presence = fresh.presence;
            refreshVetCard(state.presence);
          } else if (currentRole() === "owner" && document.getElementById("pmCallAvailabilityBox")) {
            refreshFarmerAvailability({}, { keepExisting: true }).catch(() => {});
          }
        }).catch(() => {});
        updateOverlayStatus();
      });
      socket.on("disconnect", (reason) => {
        stopPresenceHeartbeat();
        state.disconnectedAt = Date.now();
        warnCall("socket disconnected:", reason || "unknown");
        setSignalingConnected(false);
      });
      socket.on("connect_error", (err) => {
        const message = (err && (err.message || err.description)) || "signaling connection failed";
        const type = (err && err.type) || "HandshakeError";
        state.signalingErrorType = type;
        state.signalingError = type === "TransportError"
          ? message + " — the signaling server could not be reached at " + state.signalingUrl
          : message;
        warnCall("socket connect_error:", message, "| type:", type,
          "| url:", state.signalingUrl, "| path:", path,
          err && err.description && err.description !== message ? "| detail: " + err.description : "");
        setSignalingConnected(false);
      });
      socket.on("session:ready", () => resolve(socket));
      socket.on("call:incoming", (payload) => handleIncomingCall(payload && payload.call));
      socket.on("call:update", (payload) => handleCallUpdate(payload));
      socket.on("call:signal", (payload) => {
        if (state.activeSession) state.activeSession.receiveSignal(payload);
      });
      socket.on("call:mute", (payload) => {
        if (state.activeSession) state.activeSession.peerMuteChanged(payload && payload.muted);
      });
      socket.on("presence:ack", (payload) => {
        logCall("presence registered", "online=" + (payload && payload.online),
          "| presence=" + (payload && payload.presence),
          "| availability=" + (payload && payload.availability),
          "| lease=" + (payload && payload.lease_expires_at));
        applyPresence(payload);
      });
      // If the handshake fails the socket closes; fall back to polling so the
      // portal still learns about calls.
      setTimeout(() => resolve(socket), 2500);
    }));
    return state.socketReady;
  }

  /** Apply a server presence payload (presence:ack / heartbeat ack / config). */
  function applyPresence(payload) {
    if (payload && typeof payload === "object" &&
        (typeof payload.online === "boolean" || typeof payload.presence === "string")) {
      state.presence = payload;
    }
    refreshVetCard(state.presence);
  }

  function startPresenceHeartbeat() {
    stopPresenceHeartbeat();
    const beat = () => {
      if (!state.socket || !state.socket.connected) return;
      state.socket.emit("presence:heartbeat", {}, (ack) => {
        if (ack && ack.ok) {
          logCall("presence heartbeat ok", "online=" + ack.online, "| routable=" + ack.routable,
            "| lease=" + ack.lease_expires_at);
          applyPresence(ack);
        } else {
          warnCall("presence heartbeat rejected:", (ack && (ack.error || ack.message)) || "no acknowledgement");
          updateOverlayStatus();
        }
      });
    };
    beat();
    state.heartbeatTimer = setInterval(beat, 20000);
  }
  function stopPresenceHeartbeat() {
    if (state.heartbeatTimer) { clearInterval(state.heartbeatTimer); state.heartbeatTimer = null; }
  }

  // ------------------------------------------------------------ ICE/WebRTC --
  function rtcConfiguration(cfg) {
    return {
      iceServers: (cfg && cfg.ice_servers) || [{ urls: ["stun:stun.l.google.com:19302"] }],
      iceTransportPolicy: (cfg && cfg.ice_transport_policy) || "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    };
  }

  async function getMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = new Error(t("webcall.mic_unsupported",
        "This browser cannot access the microphone (a secure HTTPS context is required)."));
      err.code = "MIC_UNSUPPORTED";
      throw err;
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      const map = {
        NotAllowedError: t("webcall.mic_denied", "Microphone permission was denied. Allow it in the browser and try again."),
        SecurityError: t("webcall.mic_denied", "Microphone permission was denied. Allow it in the browser and try again."),
        NotFoundError: t("webcall.mic_missing", "No microphone was found on this device."),
        NotReadableError: t("webcall.mic_busy", "The microphone is in use by another application."),
        OverconstrainedError: t("webcall.mic_missing", "No suitable microphone was found on this device."),
      };
      const friendly = new Error(map[err && err.name] ||
        t("webcall.mic_error", "The microphone could not be started."));
      friendly.code = (err && err.name) || "MIC_ERROR";
      throw friendly;
    }
  }

  // =========================================================================
  // WebCallSession — one live call, one RTCPeerConnection
  // =========================================================================
  function WebCallSession(call, mode) {
    this.call = call;                       // authoritative server payload
    this.mode = mode;                       // "caller" (owner) | "callee" (vet)
    this.pc = null;
    this.localStream = null;
    this.audioEl = null;
    this.lastAppliedSignalId = 0;
    this.signalFloorId = null;              // lowest id that can still arrive
    this.buffered = new Map();              // id -> signal awaiting ordering
    this.flushTimer = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.pollTimer = null;
    this.durationTimer = null;
    this.statsTimer = null;
    this.connectedAt = null;
    this.iceRestarts = 0;
    this.muted = false;
    this.ended = false;
    this.mediaConfirmed = false;
    this.statsTimerStart = 0;
    this.ringStartedAt = 0;
    this.ringTimer = null;
    this.peerLabel = this.mode === "caller"
      ? ((call.vet && call.vet.name) || t("webcall.vet", "Veterinarian"))
      : ((call.caller && call.caller.name) || t("webcall.farmer", "Farmer"));
  }

  WebCallSession.prototype.start = async function start() {
    if (this.ended) return;
    this.pc = new RTCPeerConnection(rtcConfiguration(state.config));
    this.wirePeerConnection();
    this.localStream = await getMicrophone();
    this.localStream.getAudioTracks().forEach((track) => this.pc.addTrack(track, this.localStream));
    this.renderPanel();
    this.startPolling();
    if (this.mode === "caller" && ["accepted", "connecting", "connected"].includes(this.call.status)) {
      // Resumed after a refresh: the peer's old connection is gone, so a fresh
      // (ICE-restarting) offer is required.
      await this.createOffer();
    }
  };

  WebCallSession.prototype.wirePeerConnection = function wirePeerConnection() {
    const self = this;
    this.pc._outboundPackets = 0;
    this.pc._inboundPackets = 0;
    this.pc.onicecandidate = (event) => {
      if (event.candidate) self.sendSignal("ice", { candidate: event.candidate.toJSON() });
    };
    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!self.audioEl) {
        self.audioEl = document.createElement("audio");
        self.audioEl.autoplay = true;
        self.audioEl.playsInline = true;
        self.audioEl.id = "pmCallRemoteAudio";
        document.body.appendChild(self.audioEl);
      }
      self.audioEl.srcObject = stream;
      const play = self.audioEl.play();
      if (play && play.catch) play.catch(() => self.showSpeakerHint());
      self.renderPanel();
    };
    this.pc.onconnectionstatechange = () => {
      const connectionState = self.pc && self.pc.connectionState;
      logCall("pc connectionState", connectionState, "| ice", self.pc && self.pc.iceConnectionState);
      updateOverlayStatus();
      self.renderPanel();
      if (connectionState === "connected") self.onMediaConnected();
      if (connectionState === "failed") self.onConnectionFailed();
      if (connectionState === "disconnected") {
        // Transient: ICE may recover, but announce honestly
        const warn = document.getElementById("pmCallWarn");
        if (warn) warn.textContent = t("webcall.ice_disconnected", "Connection unstable — reconnecting…");
        self.renderPanel();
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const iceState = self.pc && self.pc.iceConnectionState;
      logCall("iceConnectionState", iceState, "| pc", self.pc && self.pc.connectionState);
      updateOverlayStatus();
      self.renderPanel();
      const warn = document.getElementById("pmCallWarn");
      if (iceState === "failed" && warn) {
        warn.textContent = t("webcall.ice_failed", "Connection failed — retrying…");
      } else if (iceState === "disconnected" && warn) {
        warn.textContent = t("webcall.ice_disconnected", "Connection unstable — reconnecting…");
      } else if ((iceState === "connected" || iceState === "completed") && warn) {
        if (warn.textContent && /unstable|failed|retrying/i.test(warn.textContent)) warn.textContent = "";
      }
    };
  };

  WebCallSession.prototype.onMediaConnected = async function onMediaConnected() {
    if (this.connectedAt) return;
    this.connectedAt = Date.now();
    // Give the first RTP packets a chance to arrive so the report says whether
    // media was actually observed instead of guessing.
    await this.sampleInboundAudio();
    await this.reportConnected();
    this.renderPanel();
    this.startDurationTimer();
    this.startStatsWatch();
  };

  /** Read RTCPeerConnection stats; true once real inbound audio was seen. */
  WebCallSession.prototype.sampleInboundAudio = async function sampleInboundAudio() {
    if (this.mediaConfirmed || !this.pc) return this.mediaConfirmed;
    try {
      const stats = await this.pc.getStats();
      stats.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "audio" && (report.packetsReceived || 0) > 0) {
          this.mediaConfirmed = true;
        }
      });
    } catch (e) { /* getStats can fail while tearing down */ }
    return this.mediaConfirmed;
  };

  /**
   * Tell the server the peer connection genuinely reached "connected". The
   * server keeps its own connected_at; media_confirmed only becomes true when
   * inbound RTP was observed, and the report is repeated once that happens.
   */
  WebCallSession.prototype.reportConnected = async function reportConnected() {
    if (this.ended) return;
    if (this.connectedReported && !this.mediaConfirmed) return;
    this.connectedReported = true;
    try {
      await pmFetch(`/webcall/calls/${this.call.call_id}/connected`, {
        method: "POST", body: { media_confirmed: this.mediaConfirmed },
      });
    } catch (err) {
      console.warn("[webcall] connected report failed:", err && err.message);
    }
  };

  WebCallSession.prototype.startDurationTimer = function startDurationTimer() {
    const self = this;
    if (this.durationTimer) clearInterval(this.durationTimer);
    this.durationTimer = setInterval(() => self.refreshTimerText(), 1000);
  };

  /**
   * The incoming popup must show how long the phone has been ringing (and how
   * long it will keep ringing), so the vet can judge whether to answer.
   */
  WebCallSession.prototype.startRingClock = function startRingClock() {
    const self = this;
    if (!this.ringStartedAt) this.ringStartedAt = Date.now();
    if (this.ringTimer) clearInterval(this.ringTimer);
    const update = () => {
      const el = document.getElementById("pmCallRingElapsed");
      if (!el || !self.call || self.call.status !== "ringing") return;
      const elapsed = mmss((Date.now() - self.ringStartedAt) / 1000);
      const limit = Number(self.call.ring_timeout_seconds) || 0;
      el.textContent = limit
        ? t("webcall.ring_elapsed", "Ringing {time} · ends automatically after {limit}")
          .replace("{time}", elapsed).replace("{limit}", mmss(limit))
        : t("webcall.ring_elapsed_short", "Ringing {time}").replace("{time}", elapsed);
    };
    update();
    this.ringTimer = setInterval(update, 1000);
  };

  WebCallSession.prototype.refreshTimerText = function refreshTimerText() {
    const el = document.getElementById("pmCallTimer");
    if (el && this.connectedAt) el.textContent = mmss((Date.now() - this.connectedAt) / 1000);
  };

  /** Confirm actual media flow, not just signaling: count inbound audio RTP and outbound. */
  WebCallSession.prototype.startStatsWatch = function startStatsWatch() {
    const self = this;
    this.statsTimerStart = Date.now();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      if (!self.pc || self.ended) return;
      try {
        let outboundAudio = 0;
        let inboundAudio = 0;
        const stats = await self.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") outboundAudio += report.packetsSent || 0;
          if (report.type === "inbound-rtp" && report.kind === "audio") inboundAudio += report.packetsReceived || 0;
        });
        self.pc._outboundPackets = outboundAudio;
        self.pc._inboundPackets = inboundAudio;
        const wasConfirmed = self.mediaConfirmed;
        await self.sampleInboundAudio();
        if (self.mediaConfirmed) {
          if (!wasConfirmed) {
            updateOverlayStatus();
            self.renderPanel();
            await self.reportConnected();   // correct the earlier honest "not yet"
          }
          clearInterval(self.statsTimer);
          self.statsTimer = null;
        } else if (Date.now() - self.statsTimerStart > MEDIA_CONFIRM_TIMEOUT_MS) {
          updateOverlayStatus();
          self.renderPanel();
          clearInterval(self.statsTimer);
          self.statsTimer = null;
        }
        const warn = document.getElementById("pmCallWarn");
        if (outboundAudio === 0 && Date.now() - self.statsTimerStart > 4000) {
          if (warn) warn.textContent = t("webcall.no_sent_audio", "No audio is leaving your device — check your microphone.");
        } else if (inboundAudio === 0 && outboundAudio > 20 && Date.now() - self.statsTimerStart > 6000) {
          if (warn && !warn.textContent) warn.textContent = t("webcall.poor_connection", "Poor connection — audio may be interrupted.");
        }
        updateOverlayStatus();
        const diag = document.getElementById("pmCallDiagnostics");
        if (diag) diag.textContent = detailedCallStateText(self);
      } catch (e) { /* getStats can fail while tearing down */ }
    }, STATS_CHECK_MS);
  };

  WebCallSession.prototype.showSpeakerHint = function showSpeakerHint() {
    const hint = document.getElementById("pmCallHint");
    if (hint) hint.textContent = t("webcall.tap_for_sound", "Tap anywhere to enable sound.");
    setTimeout(() => { const el = document.getElementById("pmCallHint"); if (el) el.textContent = ""; }, SPEAKER_HINT_MS * 4);
  };

  WebCallSession.prototype.onConnectionFailed = async function onConnectionFailed() {
    if (this.ended) return;
    if (this.iceRestarts < ICE_RESTART_LIMIT && this.mode === "caller" && this.pc.restartIce) {
      this.iceRestarts += 1;
      this.renderPanel();
      try {
        this.pc.restartIce();
        await this.createOffer();
        return;
      } catch (err) { /* fall through to failure */ }
    }
    this.reportFailure("MEDIA_CONNECTION_FAILED");
  };

  WebCallSession.prototype.createOffer = async function createOffer() {
    const offer = await this.pc.createOffer({ iceRestart: this.iceRestarts > 0 });
    await this.pc.setLocalDescription(offer);
    this.sendSignal("offer", { sdp: this.pc.localDescription.sdp, type: this.pc.localDescription.type });
    this.renderPanel();
  };

  WebCallSession.prototype.sendSignal = function sendSignal(kind, payload) {
    if (this.ended || !this.call) return;
    if (state.socket && state.socket.connected) {
      state.socket.emit("call:signal", { call_id: this.call.call_id, kind, payload });
    } else {
      // No live socket: queue through the durable REST path by retrying the
      // delivery on the next reconciliation poll (polling also reads signals).
      this.pendingOutbound = this.pendingOutbound || [];
      this.pendingOutbound.push({ kind, payload });
    }
  };

  WebCallSession.prototype.flushPendingOutbound = function flushPendingOutbound() {
    if (!this.pendingOutbound || !this.pendingOutbound.length) return;
    if (!state.socket || !state.socket.connected) return;
    const queue = this.pendingOutbound;
    this.pendingOutbound = [];
    queue.forEach((item) => state.socket.emit("call:signal", { call_id: this.call.call_id, kind: item.kind, payload: item.payload }));
  };

  WebCallSession.prototype.receiveSignal = function receiveSignal(signal) {
    if (!signal || this.ended) return;
    if (signal.from === "self") return;
    const id = Number(signal.id);
    if (!Number.isFinite(id)) { this.applySignal(signal); return; }
    if (this.signalFloorId === null || id < this.signalFloorId) this.signalFloorId = id;
    if (id <= this.lastAppliedSignalId) return;     // already applied (dedupe)
    if (this.buffered.has(id)) return;              // duplicate still in flight
    this.buffered.set(id, signal);
    // Slightly out-of-order signals get one short window to be sorted; signals
    // that continue the sequence are applied immediately.
    const contiguous = this.lastAppliedSignalId > 0 && id === this.lastAppliedSignalId + 1;
    this.scheduleSignalFlush(contiguous ? 0 : SIGNAL_REORDER_MS);
  };

  WebCallSession.prototype.scheduleSignalFlush = function scheduleSignalFlush(delay) {
    const self = this;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      self.flushTimer = null;
      self.flushBufferedSignals();
    }, delay);
  };

  /** Apply buffered signals in ascending id order (never reordering SDP). */
  WebCallSession.prototype.flushBufferedSignals = function flushBufferedSignals() {
    const ids = Array.from(this.buffered.keys()).sort((a, b) => a - b);
    ids.forEach((id) => {
      const signal = this.buffered.get(id);
      this.buffered.delete(id);
      if (id <= this.lastAppliedSignalId) return;
      this.lastAppliedSignalId = id;
      this.applySignal(signal);
    });
  };

  WebCallSession.prototype.applySignal = function applySignal(signal) {
    const self = this;
    const payload = signal.payload || {};
    const run = async () => {
      if (!self.pc) return;
      if (signal.kind === "offer") {
        await self.pc.setRemoteDescription({ type: "offer", sdp: payload.sdp || payload });
        self.remoteDescriptionSet = true;
        await self.flushPendingCandidates();
        const answer = await self.pc.createAnswer();
        await self.pc.setLocalDescription(answer);
        self.sendSignal("answer", { sdp: self.pc.localDescription.sdp, type: self.pc.localDescription.type });
        self.renderPanel();
        return;
      }
      if (signal.kind === "answer") {
        if (self.pc.signalingState === "have-local-offer") {
          await self.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp || payload });
          self.remoteDescriptionSet = true;
          await self.flushPendingCandidates();
        }
        return;
      }
      if (signal.kind === "ice" && payload.candidate) {
        if (!self.remoteDescriptionSet) { self.pendingCandidates.push(payload.candidate); return; }
        try { await self.pc.addIceCandidate(payload.candidate); }
        catch (err) { if (err && err.name !== "InvalidStateError") console.warn("[webcall] ICE candidate rejected:", err.name); }
        return;
      }
      if (signal.kind === "renegotiate" && self.mode === "caller") {
        self.iceRestarts += 1;
        if (self.pc.restartIce) self.pc.restartIce();
        await self.createOffer();
        return;
      }
    };
    run().catch((err) => console.warn("[webcall] signal handling failed:", err && err.name ? err.name : "error"));
  };

  WebCallSession.prototype.flushPendingCandidates = async function flushPendingCandidates() {
    const pending = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of pending) {
      try { await this.pc.addIceCandidate(candidate); }
      catch (err) { if (err && err.name !== "InvalidStateError") console.warn("[webcall] ICE candidate rejected:", err.name); }
    }
  };

  WebCallSession.prototype.startPolling = function startPolling() {
    const self = this;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => self.pollSignals(), SIGNAL_POLL_MS);
    this.pollSignals();
  };

  WebCallSession.prototype.pollSignals = async function pollSignals() {
    if (this.ended) return;
    this.flushPendingOutbound();
    try {
      const data = await pmFetch(`/webcall/calls/${this.call.call_id}/signals?after=${this.lastAppliedSignalId}`);
      if (data.call) this.applyServerCall(data.call);
      if (data.first_signal_id && this.signalFloorId === null) {
        // Older signals are gone (pruned); this is the lowest id we can still get,
        // so ordering must not wait for anything below it.
        this.signalFloorId = Number(data.first_signal_id);
      }
      (data.signals || []).forEach((signal) => {
        if (signal.from === "peer") this.receiveSignal(signal);
      });
    } catch (err) {
      if (err && err.status === 403) this.teardown();
    }
  };

  WebCallSession.prototype.applyServerCall = function applyServerCall(call) {
    if (!call) return;
    this.call = call;
    if (TERMINAL_STATUSES.includes(call.status)) { this.finishFromServer(call); return; }
    if (this.mode === "caller" && ["accepted", "connecting"].includes(call.status) && !this.pc.currentRemoteDescription && !this.offerSent) {
      this.offerSent = true;
    }
    this.renderPanel();
  };

  WebCallSession.prototype.finishFromServer = async function finishFromServer(call) {
    const reason = (call && call.end_reason) || "";
    const message = {
      rejected: t("webcall.declined", "The veterinarian declined the call."),
      cancelled: t("webcall.cancelled", "The call was cancelled."),
      expired: t("webcall.no_answer", "No answer — the veterinarian did not pick up."),
      missed: t("webcall.unavailable", "No veterinarian was available."),
      failed: t("webcall.failed", "The call could not connect."),
      busy: t("webcall.busy", "The veterinarian is on another call."),
    }[call && call.status] || t("webcall.ended", "Call ended.");
    E.ringtone.stop();
    this.teardown();
    await showCallSummary(call, message, reason);
  };

  WebCallSession.prototype.reportFailure = async function reportFailure(reason) {
    if (this.ended) return;
    try {
      const data = await pmFetch(`/webcall/calls/${this.call.call_id}/failed`, {
        method: "POST", body: { reason },
      });
      if (data.call) await this.finishFromServer(data.call);
    } catch (err) {
      this.teardown();
      await showCallSummary(this.call, t("webcall.failed", "The call could not connect."), reason);
    }
  };

  WebCallSession.prototype.toggleMute = function toggleMute() {
    const tracks = this.localStream ? this.localStream.getAudioTracks() : [];
    if (!tracks.length) return;
    this.muted = !this.muted;
    tracks.forEach((track) => { track.enabled = !this.muted; });  // real mute, not a label change
    if (state.socket && state.socket.connected) {
      state.socket.emit("call:mute", { call_id: this.call.call_id, muted: this.muted });
    }
    this.renderPanel();
  };

  WebCallSession.prototype.peerMuteChanged = function peerMuteChanged(muted) {
    this.peerMuted = !!muted;
    this.renderPanel();
  };

  WebCallSession.prototype.hangUp = async function hangUp() {
    if (this.ended) return;
    E.ringtone.stop();
    try {
      const path = this.mode === "caller" && this.call.status === "ringing" ? "cancel" : "end";
      const data = await pmFetch(`/webcall/calls/${this.call.call_id}/${path}`, { method: "POST", body: { reason: "HANGUP" } });
      if (data.call) this.call = data.call;
    } catch (err) {
      // The server may already have ended it (timeout, other side hung up).
      if (!err || err.status !== 409) console.warn("[webcall] end request failed:", err && err.message);
    }
    this.teardown();
    hideOverlay();
  };

  /** Release every captured resource. Safe to call more than once. */
  WebCallSession.prototype.teardown = function teardown() {
    this.ended = true;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.buffered.clear();
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.durationTimer) { clearInterval(this.durationTimer); this.durationTimer = null; }
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    if (this.ringTimer) { clearInterval(this.ringTimer); this.ringTimer = null; }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => { try { track.stop(); } catch (e) { /* already stopped */ } });
      this.localStream = null;
    }
    if (this.pc) {
      try { this.pc.onicecandidate = null; this.pc.ontrack = null; this.pc.onconnectionstatechange = null; this.pc.close(); } catch (e) { /* closed */ }
      this.pc = null;
    }
    if (this.audioEl) {
      try { this.audioEl.srcObject = null; this.audioEl.remove(); } catch (e) { /* removed */ }
      this.audioEl = null;
    }
    state.ringtone.stop();
    if (state.activeSession === this) state.activeSession = null;
    updateOverlayStatus();
  };

  WebCallSession.prototype.renderPanel = function renderPanel() {
    if (this.ended) return;
    renderInCallOverlay(this);
  };

  // --------------------------------------------------------- overlay markup --
  const TERMINAL_STATUSES = ["ended", "rejected", "cancelled", "missed", "busy", "failed", "expired"];

  function overlayRoot() {
    let root = document.getElementById("pmCallOverlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "pmCallOverlay";
      root.className = "pm-call-overlay";
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-live", "polite");
      document.body.appendChild(root);
    }
    return root;
  }

  function hideOverlay() {
    const root = document.getElementById("pmCallOverlay");
    if (root) root.remove();
    updateOverlayStatus();
  }

  function updateOverlayStatus() {
    const status = signalingStatus();
    const channel = signalingState();
    const lease = presenceLeaseState();
    // Vet card signaling badge (separate from routability)
    const badge = document.getElementById("pmCallLinkBadge");
    if (badge) {
      badge.textContent = channel === "connected" ? t("webcall.online", "Web calls online")
        : channel === "connecting" ? t("webcall.connecting_badge", "Web calls connecting…")
        : channel === "error" ? t("webcall.error_badge", "Web calls error")
        : channel === "reconnecting" ? t("webcall.reconnecting_badge", "Web calls reconnecting…")
        : t("webcall.offline", "Web calls offline");
      badge.className = "badge " + (channel === "connected" ? "badge-green"
        : channel === "error" ? "badge-red" : "badge-orange");
      badge.setAttribute("aria-label", `Signaling: ${channel}`);
    }
    const availabilityBadge = document.getElementById("pmVetAvailabilityBadge");
    if (availabilityBadge) {
      const avail = availabilityState();
      availabilityBadge.textContent = `Avail: ${avail.status}`;
    }
    const presenceBadge = document.getElementById("pmVetPresenceBadge");
    if (presenceBadge) {
      presenceBadge.textContent = `Lease: ${lease.presence} (${lease.leaseLabel})`;
      presenceBadge.className = "badge " + (lease.online ? "badge-green" : "badge-orange");
      presenceBadge.setAttribute("aria-label", `Presence lease: ${lease.presence}, ${lease.leaseLabel}`);
    }
    const presenceDetail = document.getElementById("pmVetPresenceDetail");
    if (presenceDetail) {
      presenceDetail.textContent = `Presence: ${lease.presence} · ${lease.leaseLabel}${lease.lease_expires_at ? ` · expires ${lease.lease_expires_at}` : ""}`;
    }
    const farmerNotice = document.getElementById("pmCallSignalStatus");
    if (farmerNotice) {
      farmerNotice.setAttribute("role", "status");
      farmerNotice.setAttribute("aria-live", "polite");
      farmerNotice.textContent = channel === "error" && state.signalingError
        ? t("webcall.signal_error", "Web calling is unavailable: ") + signalingErrorText()
        : status.offlineLong
          ? t("webcall.signal_offline_farmer", "Web calling connection is offline. Please check your connection or try again.")
            + (state.signalingError ? " (" + signalingErrorText() + ")" : "")
          : channel === "reconnecting"
            ? t("webcall.signal_reconnecting_farmer", "Web calling is reconnecting… Please wait.")
            : "";
    }
    renderStateStrips();
    const vetNotice = document.getElementById("pmVetSignalStatus");
    if (vetNotice) {
      vetNotice.setAttribute("role", "status");
      vetNotice.setAttribute("aria-live", "polite");
      // The vet sees the real channel state immediately — never "AVAILABLE"
      // next to a stale or hidden failure.
      vetNotice.textContent = channel === "connected"
        ? t("webcall.signal_connected_vet", "Signaling connected — this portal can receive web calls.")
        : channel === "error"
          ? t("webcall.signal_error", "Web calling is unavailable: ") + signalingErrorText()
          : channel === "reconnecting"
            ? t("webcall.signal_offline_vet", "Call receiving is offline — reconnecting...")
              + (state.signalingError ? " (" + signalingErrorText() + ")" : "")
            : t("webcall.signal_connecting_vet", "Connecting to call signaling…");
    }
    // Active call diagnostics (WebRTC PC, ICE, media)
    const session = state.activeSession;
    if (session) {
      const pcState = webrtcConnectionState(session);
      const iceState = iceConnectionState(session);
      const media = mediaConnectionState(session);
      const diagEl = document.getElementById("pmCallDiagnostics");
      if (diagEl) {
        diagEl.textContent = `Signaling: ${channel} · WebRTC: ${pcState} · ICE: ${iceState} · Media: ${media.label}`;
        diagEl.setAttribute("aria-label", `Signaling ${channel}, WebRTC ${pcState}, ICE ${iceState}, Media ${media.label}`);
      }
      // Update status text live region
      const statusEl = document.getElementById("pmCallStatus");
      if (statusEl) {
        statusEl.setAttribute("role", "status");
        statusEl.setAttribute("aria-live", "polite");
      }
    }
    scheduleSignalingStatusRefresh();
  }

  function callerContextHtml(call) {
    const parts = [];
    if (call.caller && call.caller.name) parts.push(esc(call.caller.name));
    // The call row carries the region the call was routed with; fall back to the
    // caller profile when a partial payload is rendered.
    const place = [call.village || (call.caller && call.caller.village),
      call.district || (call.caller && call.caller.district)].filter(Boolean).join(", ");
    if (place) parts.push(esc(place));
    if (call.case && call.case.case_no) parts.push(esc(call.case.case_no));
    if (call.animal && (call.animal.animal_name || call.animal.animal_code)) {
      parts.push(esc(call.animal.animal_name || call.animal.animal_code));
    }
    return parts.join(" · ");
  }

  function inCallStatusText(session) {
    const call = session.call;
    const pcState = webrtcConnectionState(session);
    const iceState = iceConnectionState(session);
    const media = mediaConnectionState(session);
    // Honest state machine: never claim connected until WebRTC PC is connected/completed AND media flows
    if (call.status === "ringing") {
      return session.mode === "caller"
        ? t("webcall.ringing_vet", "Ringing {name}…").replace("{name}", session.peerLabel)
        : t("webcall.incoming", "Incoming call");
    }
    if (call.status === "accepted") {
      if (iceState === "failed") return t("webcall.ice_failed", "Connection failed — retrying…");
      if (iceState === "disconnected") return t("webcall.ice_disconnected", "Connection unstable — reconnecting…");
      return t("webcall.accepted", "Answered — connecting audio…");
    }
    if (call.status === "connecting") {
      if (iceState === "failed") return t("webcall.ice_failed", "Connection failed — retrying…");
      if (iceState === "disconnected") return t("webcall.ice_disconnected", "Connection unstable — reconnecting…");
      if (pcState === "connecting") return t("webcall.connecting", "Connecting audio…");
      return t("webcall.connecting", "Connecting audio…");
    }
    if (call.status === "connected") {
      // Server says connected only after client reported RTCPeerConnection connected,
      // but we still verify media flow honestly.
      if (!session.remoteDescriptionSet) return t("webcall.connecting", "Connecting audio…");
      if (pcState === "failed") return t("webcall.failed", "The call could not connect.");
      if (iceState === "failed") return t("webcall.ice_failed", "Connection failed — retrying…");
      if (iceState === "disconnected") return t("webcall.ice_disconnected", "Connection unstable — reconnecting…");
      if (media.confirmed) return t("webcall.connected", "Connected");
      // Honest: server says connected, but inbound RTP not yet observed
      return t("webcall.connected_no_audio", "Connected — verifying audio…");
    }
    return t("webcall.connecting", "Connecting audio…");
  }

  function detailedCallStateText(session) {
    const pcState = webrtcConnectionState(session);
    const iceState = iceConnectionState(session);
    const media = mediaConnectionState(session);
    const sig = signalingState();
    return `Signaling: ${sig} · WebRTC: ${pcState} · ICE: ${iceState} · Media: ${media.label}`;
  }

  function renderInCallOverlay(session) {
    const call = session.call;
    const root = overlayRoot();
    const isRingingForMe = session.mode === "callee" && call.status === "ringing";
    const pcState = webrtcConnectionState(session);
    const iceState = iceConnectionState(session);
    const media = mediaConnectionState(session);
    const sigState = signalingState();
    const buttons = isRingingForMe
      ? `<button class="pm-call-btn pm-call-accept" id="pmCallAnswer" aria-label="${esc(t("webcall.answer", "Answer"))}">📞 ${esc(t("webcall.answer", "Answer"))}</button>
         <button class="pm-call-btn pm-call-decline" id="pmCallReject" aria-label="${esc(t("webcall.reject", "Decline"))}">✕ ${esc(t("webcall.reject", "Decline"))}</button>`
      : `<button class="pm-call-btn ${session.muted ? "is-muted" : ""}" id="pmCallMute" aria-pressed="${session.muted}" aria-label="${esc(session.muted ? t("webcall.unmute", "Unmute") : t("webcall.mute", "Mute"))}">
           ${session.muted ? "🔇" : "🎙️"} ${esc(session.muted ? t("webcall.unmute", "Unmute") : t("webcall.mute", "Mute"))}
         </button>
         <button class="pm-call-btn pm-call-decline" id="pmCallHangup" aria-label="${esc(t("webcall.end", "End call"))}">📵 ${esc(t("webcall.end", "End call"))}</button>`;

    // Accessible state list for screen readers (W04)
    const accessibleStates = [
      call.status === "ringing" ? (isRingingForMe ? "Ringing" : "Calling") : null,
      call.status === "accepted" ? "Connecting call" : null,
      call.status === "connecting" ? "Connecting call" : null,
      call.status === "connected" && media.confirmed ? "Connected" : null,
      call.status === "connected" && !media.confirmed ? "Connected - verifying audio" : null,
      session.muted ? "Mic muted" : null,
      session.peerMuted ? "Peer muted" : null,
      sigState === "reconnecting" ? "Reconnecting" : null,
      iceState === "failed" ? "Poor connection" : null,
      iceState === "disconnected" ? "Reconnecting" : null,
    ].filter(Boolean).join(" · ");

    root.innerHTML = `
      <div class="pm-call-card" role="document" aria-live="polite">
        <div class="pm-call-header">
          <span class="pm-call-icon" aria-hidden="true">${isRingingForMe ? "📞" : "🎙️"}</span>
          <div>
            <div class="pm-call-title">${esc(isRingingForMe ? t("webcall.incoming", "Incoming call") : session.peerLabel)}</div>
            <div class="pm-call-sub" id="pmCallSub">${esc(callerContextHtml(call))}</div>
          </div>
          ${call.status === "connected" ? `<div class="pm-call-timer" id="pmCallTimer" aria-live="off">${esc(mmss(0))}</div>` : ""}
        </div>
        <div class="pm-call-status" id="pmCallStatus" role="status" aria-live="polite">${esc(inCallStatusText(session))}</div>
        <div class="small-muted" id="pmCallDiagnostics" role="status" aria-live="polite" style="margin-bottom:6px;font-size:11px">${esc(detailedCallStateText(session))}</div>
        <div class="small-muted" id="pmCallAccessibleStates" aria-live="polite" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">${esc(accessibleStates)}</div>
        ${isRingingForMe ? '<div class="pm-call-rings" id="pmCallRingElapsed" aria-live="polite"></div>' : ""}
        <div class="pm-call-meta">
          <span class="badge badge-blue">${esc(t("webcall.web_call", "Internet call (WebRTC)"))}</span>
          ${call.language ? `<span class="badge badge-blue">${esc(call.language.toUpperCase())}</span>` : ""}
          ${call.reason ? `<span class="badge badge-blue">${esc(reasonLabel(call.reason))}</span>` : ""}
          ${session.peerMuted ? `<span class="badge badge-orange" id="pmCallPeerMute">🔇 ${esc(t("webcall.peer_muted", "Muted"))}</span>` : ""}
          <span class="badge ${pcState === "connected" ? "badge-green" : pcState === "failed" ? "badge-red" : "badge-orange"}" id="pmCallPcState">WebRTC: ${esc(pcState)}</span>
          <span class="badge ${iceState === "connected" || iceState === "completed" ? "badge-green" : iceState === "failed" ? "badge-red" : "badge-orange"}" id="pmCallIceState">ICE: ${esc(iceState)}</span>
          <span class="badge ${media.confirmed ? "badge-green" : "badge-orange"}" id="pmCallMediaState">Media: ${esc(media.label)}</span>
        </div>
        ${call.reason_note ? `<div class="pm-call-note">${esc(call.reason_note)}</div>` : ""}
        <div class="pm-call-hint" id="pmCallHint" role="status" aria-live="polite"></div>
        <div class="pm-call-warn" id="pmCallWarn" role="alert" aria-live="assertive"></div>
        <div class="pm-call-actions">${buttons}</div>
        <div class="pm-call-foot">${esc(t("webcall.media_note",
          "Audio travels directly between the two browsers — it is not recorded by the platform."))}</div>
      </div>`;

    const answer = document.getElementById("pmCallAnswer");
    if (answer) answer.addEventListener("click", () => acceptIncomingCall(session));
    const reject = document.getElementById("pmCallReject");
    if (reject) reject.addEventListener("click", () => rejectIncomingCall(session));
    const mute = document.getElementById("pmCallMute");
    if (mute) mute.addEventListener("click", () => session.toggleMute());
    const hangup = document.getElementById("pmCallHangup");
    if (hangup) hangup.addEventListener("click", () => session.hangUp());
    session.refreshTimerText();
    if (isRingingForMe) session.startRingClock();
    updateOverlayStatus();
  }

  function reasonLabel(reason) {
    const labels = {
      animal_sick: t("webcall.reason.sick", "Animal is sick"),
      emergency: t("webcall.reason.emergency", "Emergency"),
      vaccination_advice: t("webcall.reason.vaccination", "Vaccination advice"),
      follow_up: t("webcall.reason.follow_up", "Follow-up"),
      other: t("webcall.reason.other", "Other"),
    };
    return labels[reason] || reason;
  }

  async function showCallSummary(call, message, reason) {
    state.activeSession = null;
    const root = overlayRoot();
    const status = call && call.status;
    const duration = call && call.duration_seconds;
    root.innerHTML = `
      <div class="pm-call-card">
        <div class="pm-call-header">
          <span class="pm-call-icon">${status === "ended" ? "✅" : "ℹ️"}</span>
          <div><div class="pm-call-title">${esc(message)}</div>
          <div class="pm-call-sub">${esc(callerContextHtml(call || {}))}</div></div>
        </div>
        ${duration ? `<div class="pm-call-status">${esc(t("webcall.talk_time", "Talk time"))}: ${esc(mmss(duration))}</div>` : ""}
        ${reason && status !== "ended" ? `<div class="pm-call-warn" data-diagnostic="${esc(state.lastCallDiagnosticCodes || "")}">${esc(reason)}</div>` : ""}
        <div class="pm-call-actions">
          <button class="pm-call-btn" id="pmCallClose">${esc(t("webcall.close", "Close"))}</button>
          ${isFarmer() ? `<button class="pm-call-btn pm-call-accept" id="pmCallRetry">🔁 ${esc(t("webcall.try_again", "Try again"))}</button>` : ""}
        </div>
      </div>`;
    document.getElementById("pmCallClose").addEventListener("click", hideOverlay);
    const retry = document.getElementById("pmCallRetry");
    if (retry) {
      retry.addEventListener("click", () => { hideOverlay(); startFarmerCallFlow(state.lastCallOptions || {}); });
    }
    setTimeout(() => { if (document.getElementById("pmCallOverlay")) hideOverlay(); }, 12000);
  }

  // ------------------------------------------------------ incoming call UX --
  async function handleIncomingCall(call) {
    if (!call) return;
    if (state.activeSession) {
      const existing = state.activeSession;
      if (existing.call.call_id !== call.call_id && !TERMINAL_STATUSES.includes(existing.call.status)) {
        // Never silently drop an in-progress call: keep the live one and let the
        // server-side rules (one live call per vet) do the arbitration.
        notify(t("webcall.already_on_call", "You are already in a call."), true);
        return;
      }
    }
    if (state.lastIncomingCallId === call.call_id && document.getElementById("pmCallOverlay")) return;
    state.lastIncomingCallId = call.call_id;
    const session = new WebCallSession(call, "callee");
    state.activeSession = session;
    renderInCallOverlay(session);
    const blocked = await state.ringtone.start();
    if (blocked) {
      const hint = document.getElementById("pmCallHint");
      if (hint) {
        hint.textContent = t("webcall.sound_blocked",
          "🔇 Sound is blocked by the browser. Tap the page once to enable the ringtone.");
      }
    }
    // A ringing call is also reconciled by REST polling, so the popup survives
    // a missed socket frame.
    session.startPolling();
  }

  async function acceptIncomingCall(session) {
    state.ringtone.stop();
    try {
      const data = await pmFetch(`/webcall/calls/${session.call.call_id}/accept`, { method: "POST" });
      session.call = data.call;
      await session.start();               // mic + peer connection ready for the offer
      await pmFetch(`/webcall/calls/${session.call.call_id}/connecting`, { method: "POST" }).catch(() => {});
      renderInCallOverlay(session);
      // Ask the caller for a fresh offer if none arrives (e.g. they refreshed).
      setTimeout(() => { if (!session.remoteDescriptionSet && !session.ended) session.sendSignal("renegotiate", {}); }, 4000);
    } catch (err) {
      state.ringtone.stop();
      session.teardown();
      await showCallSummary(session.call, err.message || t("webcall.failed", "The call could not be answered."), err.code);
    }
  }

  async function rejectIncomingCall(session) {
    state.ringtone.stop();
    try {
      await pmFetch(`/webcall/calls/${session.call.call_id}/reject`, { method: "POST", body: { reason: "VET_DECLINED" } });
    } catch (err) {
      if (!err || err.status !== 409) notify(err.message || "Could not decline the call.", true);
    }
    session.teardown();
    hideOverlay();
  }

  async function handleCallUpdate(payload) {
    if (!payload || !payload.call_id) return;
    const session = state.activeSession;
    if (session && session.call.call_id === payload.call_id) {
      try {
        const data = await pmFetch(`/webcall/calls/${payload.call_id}`);
        session.call = data.call;
        if (TERMINAL_STATUSES.includes(data.call.status)) {
          await session.finishFromServer(data.call);
          return;
        }
        if (session.mode === "caller" && data.call.status === "accepted" && !session.offerSent) {
          session.offerSent = true;
          if (!session.pc) await session.start();
          await session.createOffer();
        }
        session.renderPanel();
      } catch (err) { /* the poll loop retries */ }
      return;
    }
    if (payload.event === "ringing" || payload.status === "ringing") {
      await reconcileCurrentCall();
    }
  }

  // --------------------------------------------------------- reconciliation --
  async function reconcileCurrentCall() {
    if (!authToken()) return null;
    let data;
    try {
      data = await pmFetch("/webcall/calls/current");
    } catch (err) {
      return null;
    }
    const call = data && data.call;
    // /calls/current only ever returns a live call; ignore a terminal record
    // defensively so a stale response can never resurrect a finished call.
    if (call && TERMINAL_STATUSES.includes(call.status)) return null;
    if (!call) {
      if (state.activeSession) { state.activeSession.teardown(); hideOverlay(); }
      state.ringtone.stop();
      return null;
    }
    const session = state.activeSession;
    if (!session || session.call.call_id !== call.call_id) {
      if (isFarmer() || currentRole() === "vet") {
        const resumed = new WebCallSession(call, isFarmer() ? "caller" : "callee");
        state.activeSession = resumed;
        if (call.status === "ringing") {
          if (currentRole() === "vet") {
            renderInCallOverlay(resumed);
            const blocked = await state.ringtone.start();
            if (blocked) {
              const hint = document.getElementById("pmCallHint");
              if (hint) hint.textContent = t("webcall.sound_blocked",
                "🔇 Sound is blocked by the browser. Tap the page once to enable the ringtone.");
            }
          } else {
            renderInCallOverlay(resumed);
          }
        } else {
          try { await resumed.start(); } catch (err) {
            await showCallSummary(call, err.message, err.code);
          }
        }
      }
      return call;
    }
    session.call = call;
    if (TERMINAL_STATUSES.includes(call.status)) { await session.finishFromServer(call); return call; }
    session.renderPanel();
    return call;
  }

  // ------------------------------------------------------- farmer call flow --
  async function startFarmerCallFlow(options) {
    const opts = options || {};
    state.lastCallOptions = opts;
    const session = state.activeSession;
    if (session && !TERMINAL_STATUSES.includes(session.call.status)) {
      renderInCallOverlay(session);
      return;
    }
    // Microphone permission is requested on the explicit user action, with a
    // clear error if it is denied — before any call record is created.
    let stream;
    try {
      stream = await getMicrophone();
    } catch (err) {
      notify(err.message, true);
      return;
    }
    stream.getTracks().forEach((track) => track.stop());   // pre-flight only
    await state.ringtone.unlock();

    let created;
    try {
      created = await pmFetch("/webcall/calls", {
        method: "POST",
        body: {
          language: opts.language || (state.config && state.config.user.language) || "en",
          reason: opts.reason || "animal_sick",
          reason_note: opts.reasonNote || "",
          case_id: opts.caseId || undefined,
          animal_id: opts.animalId || undefined,
        },
      });
    } catch (err) {
      if (err.status === 409 && err.call) {   // already in a call: resume it
        state.activeSession = new WebCallSession(err.call, "caller");
        await state.activeSession.start();
        return;
      }
      await showCallSummary(err.call || null, err.message, err.code);
      return;
    }
    if (created.outcome !== "ringing") {
      // The farmer reads a sentence, not a routing code. The codes the server
      // returned stay in the console (and in the overlay's data attribute) for
      // developers.
      const skipSentence = skipReasonSentence(created.skipped_codes);
      const reason = [
        skipSentence
          ? t("webcall.unavailable_reason", "Veterinarians on the platform are currently ") + skipSentence + "."
          : "",
        (created.skipped_codes || []).length ? "" : created.code || "",
      ].filter(Boolean).join(" ");
      state.lastCallDiagnosticCodes = (created.skipped_codes || []).join(",");
      if ((created.skipped_codes || []).length) {
        logCall("call not routed", "outcome=" + created.outcome,
          "| skipped=" + created.skipped_codes.join(","),
          "| reasons=" + ((created.skipped_reasons || []).join(",") || "n/a"));
      }
      await showCallSummary(created.call, created.message ||
        t("webcall.unavailable", "No veterinarian was available."), reason);
      return;
    }
    const live = new WebCallSession(created.call, "caller");
    state.activeSession = live;
    await live.start();
    renderInCallOverlay(live);
    // Safety net: if the socket frame is missed, reconcile over REST.
    if (state.socket && !state.socket.connected) startReconcileTimer();
  }

  let reconcileTimer = null;
  function startReconcileTimer() {
    if (reconcileTimer) return;
    // Safety net only: with a live socket (and a visible tab) the server pushes
    // every state change, so there is nothing to poll for.
    const tick = () => {
      if (state.socket && state.socket.connected && document.visibilityState !== "hidden") return;
      reconcileCurrentCall().catch(() => {});
    };
    reconcileTimer = setInterval(tick, 4000);
    setTimeout(() => { clearInterval(reconcileTimer); reconcileTimer = null; }, 120000);
  }

  // ------------------------------------------------------------- vet card ---
  // 7-state honesty model (never conflated):
  //   1 availability  -> vet_availability.status (AVAILABLE/BUSY/OFFLINE/OUTSIDE_HOURS)
  //   2 Socket.IO     -> signalingState() (idle/connecting/connected/reconnecting/error)
  //   3 presence lease-> presence.online + lease_expires_at + presence presence (ONLINE/STALE/OFFLINE)
  //   4 routability   -> vetRoutabilityState() = AVAILABLE + online + socketOnline + not busy
  //   5 WebRTC PC     -> pc.connectionState (new/connecting/connected/disconnected/failed/closed)
  //   6 ICE           -> pc.iceConnectionState (new/checking/connected/completed/failed/disconnected/closed)
  //   7 media         -> inbound RTP observed (mediaConfirmed) + outbound check
  function currentVetAvailability() {
    return (state.config && state.config.availability) || { status: "OFFLINE", supported_languages: ["en"] };
  }

  function currentPresenceState() {
    return state.presence || (state.config && state.config.presence) || { online: false, presence: "OFFLINE" };
  }

  function availabilityState() {
    const a = currentVetAvailability();
    return { status: a.status || "OFFLINE", languages: a.supported_languages || ["en"] };
  }

  function presenceLeaseState() {
    const p = currentPresenceState();
    const lease = p.lease_expires_at || null;
    const last = p.last_heartbeat_at || null;
    let leaseLabel = "no lease";
    if (lease) {
      try {
        const exp = new Date(lease.replace(" ", "T") + "Z");
        const now = Date.now();
        const diff = Math.floor((exp.getTime() - now) / 1000);
        if (diff > 0) leaseLabel = `lease valid for ${diff}s`;
        else leaseLabel = `lease expired ${Math.abs(diff)}s ago`;
      } catch (e) { leaseLabel = String(lease); }
    }
    return {
      online: !!p.online,
      presence: p.presence || (p.online ? "ONLINE" : "OFFLINE"),
      lease_expires_at: lease,
      last_heartbeat_at: last,
      leaseLabel,
      routable: !!p.routable,
      active_call_id: p.active_call_id || (p.active_call && p.active_call.call_id) || null,
      active_call_status: p.active_call_status || (p.active_call && p.active_call.status) || null,
    };
  }

  function webrtcConnectionState(session) {
    if (!session || !session.pc) return "no pc";
    return session.pc.connectionState || "unknown";
  }

  function iceConnectionState(session) {
    if (!session || !session.pc) return "no pc";
    return session.pc.iceConnectionState || "unknown";
  }

  function mediaConnectionState(session) {
    if (!session) return { inbound: false, outbound: false, confirmed: false, label: "no session" };
    const inbound = !!session.mediaConfirmed;
    const outbound = session.pc ? (session.pc._outboundPackets || 0) > 0 : false;
    // outboundPackets tracked in stats watcher
    let label = "no media yet";
    if (inbound) label = "receiving audio";
    else if (session.connectedAt) label = "verifying audio";
    else label = "no media yet";
    return { inbound, outbound, confirmed: inbound, label };
  }

  /**
   * The one place that decides what the vet's availability card may claim.
   * A vet is only advertised as callable when ALL of these are true:
   *   * the signaling socket is connected (the browser can be reached),
   *   * the server holds a live presence lease for this vet,
   *   * the availability choice is AVAILABLE,
   *   * no call is already in progress.
   * Anything else is rendered as explicitly NOT receiving calls, so the UI can
   * never show "AVAILABLE" next to a hidden signaling failure.
   *
   * This function also exposes the 7-state breakdown for honest UI rendering.
   */
  function vetRoutabilityState() {
    const availability = currentVetAvailability();
    const presence = currentPresenceState();
    const lease = presenceLeaseState();
    const channel = signalingState();
    const socketOnline = channel === "connected";
    const activeCall = !!(presence.active_call || presence.active_call_id ||
      presence.active_call_status === "connected" || presence.active_call_status === "ringing" ||
      lease.active_call_id);
    const available = availability.status === "AVAILABLE";
    const presenceOnline = !!presence.online;
    const presencePresence = lease.presence || (presenceOnline ? "ONLINE" : "OFFLINE");

    // Base breakdown for UI (7 states)
    const breakdown = {
      availability: availability.status || "OFFLINE",
      socket: channel,
      socketOnline,
      presenceLease: presencePresence,
      presenceOnline,
      leaseLabel: lease.leaseLabel,
      lease_expires_at: lease.lease_expires_at,
      routable: false,
      activeCall,
    };

    if (available && activeCall) {
      return {
        badgeClass: "badge-red",
        label: "BUSY · On a call",
        detail: "You are in a call right now, so farmers are not routed to you.",
        breakdown: { ...breakdown, routable: false },
      };
    }
    if (available && socketOnline && presenceOnline) {
      return {
        badgeClass: "badge-green",
        label: "CONNECTED · AVAILABLE — receiving calls",
        detail: "Signaling is live and the server holds your presence lease: farmers can reach you now.",
        breakdown: { ...breakdown, routable: true },
      };
    }
    if (available && socketOnline && !presenceOnline) {
      return {
        badgeClass: "badge-orange",
        label: "CONNECTED · AVAILABLE — registering…",
        detail: "Signaling is live, but the server has not confirmed your presence lease yet. This should clear within a few seconds.",
        breakdown: { ...breakdown, routable: false },
      };
    }
    if (available && !socketOnline) {
      const failure = signalingFailureInfo();
      return {
        badgeClass: "badge-red",
        label: t("webcall.vet_not_receiving",
          "SIGNALING OFFLINE · NOT RECEIVING CALLS"),
        detail: (channel === "connecting" || channel === "idle"
          ? t("webcall.signal_connecting_vet", "Connecting to call signaling…")
          : channel === "error"
            ? failure.farmer
            : t("webcall.signal_offline_vet", "Call receiving is offline — reconnecting...")),
        devDetail: failure.dev,
        breakdown: { ...breakdown, routable: false },
      };
    }
    if (availability.status === "BUSY") {
      return {
        badgeClass: "badge-red",
        label: "BUSY · Not routable",
        detail: "You are marked busy, so farmers will not be routed to you right now.",
        breakdown: { ...breakdown, routable: false },
      };
    }
    if (availability.status === "OUTSIDE_HOURS") {
      return {
        badgeClass: "badge-orange",
        label: "OUTSIDE_HOURS · Not routable",
        detail: "You are outside working hours, so farmers are not routed to you right now.",
        breakdown: { ...breakdown, routable: false },
      };
    }
    return {
      badgeClass: "badge-red",
      label: (availability.status || "OFFLINE") + " · Not routable",
      detail: "You are not receiving web calls. Switch to AVAILABLE and keep this portal connected.",
      breakdown: { ...breakdown, routable: false },
    };
  }

  function vetCardHtml() {
    const availability = currentVetAvailability();
    const languages = ["en", "hi", "mr", "te"];
    const routability = vetRoutabilityState();
    const breakdown = routability.breakdown || {};
    const leaseInfo = breakdown.leaseLabel ? esc(breakdown.leaseLabel) : "no lease";
    const presenceLabel = esc(breakdown.presenceLease || "OFFLINE");
    const socketLabel = esc(breakdown.socket || "idle");
    const availabilityLabel = esc(breakdown.availability || availability.status || "OFFLINE");
    return `
      <div class="section-card" id="pmVetCallCard">
        <div class="section-title">📞 ${esc(t("webcall.vet_card_title", "Web call availability"))}</div>
        <div class="meta" style="margin-bottom:8px">
          ${esc(t("webcall.vet_card_help", "Farmers can call you directly in the browser while this portal stays open."))}
        </div>
        <div class="pm-vet-card-live" style="margin-bottom:8px" aria-live="polite">
          <span class="badge badge-blue" id="pmVetAvailabilityBadge" title="Configured availability from vet_availability">Avail: ${availabilityLabel}</span>
          <span class="badge badge-orange" id="pmCallLinkBadge" title="Socket.IO connection state">Socket: ${socketLabel}</span>
          <span class="badge ${breakdown.presenceOnline ? "badge-green" : "badge-orange"}" id="pmVetPresenceBadge" title="Presence lease from vet_presence">Lease: ${presenceLabel} (${leaseInfo})</span>
          <span class="badge ${routability.badgeClass}" id="pmVetRoutableBadge" title="Routability = AVAILABLE + socket connected + lease live + not busy">${esc(routability.label)}</span>
        </div>
        <div class="small-muted" id="pmVetRoutableStatus" style="margin-bottom:4px" role="status" aria-live="polite">${esc(routability.detail)}</div>
        <div class="btn-row" id="pmVetRetryRow" style="margin-bottom:6px" hidden>
          <button class="btn btn-ghost btn-sm" id="pmVetRetrySignaling" type="button">🔁 ${esc(t("webcall.retry_signaling", "Retry connection"))}</button>
        </div>
        <div class="small-muted" id="pmVetPresenceDetail" style="margin-bottom:4px" role="status" aria-live="polite">${esc(`Presence: ${presenceLabel} · ${leaseInfo}${breakdown.lease_expires_at ? ` · expires ${breakdown.lease_expires_at}` : ""}`)}</div>
        <div class="small-muted" id="pmVetSignalStatus" style="margin-bottom:8px" role="status" aria-live="polite"></div>
        <div class="form-row">
          <div class="field"><label for="pmVetAvailability">${esc(t("webcall.receive_calls", "Receive web calls"))}</label>
            <select id="pmVetAvailability" aria-label="${esc(t("webcall.receive_calls", "Receive web calls"))}">
              ${["AVAILABLE", "BUSY", "OFFLINE"].map((s) => `<option value="${s}" ${availability.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label for="pmVetLanguages">${esc(t("webcall.languages", "Languages you can take calls in"))}</label>
            <select id="pmVetLanguages" multiple size="4" aria-label="${esc(t("webcall.languages", "Languages you can take calls in"))}">
              ${languages.map((code) => `<option value="${code}" ${(availability.supported_languages || []).includes(code) ? "selected" : ""}>${code.toUpperCase()}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" id="pmVetSaveAvailability">${esc(t("webcall.save", "Save"))}</button>
          <button class="btn btn-ghost btn-sm" id="pmVetEnablePush">🔔 ${esc(t("webcall.enable_push", "Enable call notifications"))}</button>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='#/vet/calls'">${esc(t("webcall.history", "Call history"))}</button>
        </div>
        <div class="small-muted" id="pmVetPushStatus" style="margin-top:6px" role="status" aria-live="polite"></div>
        <div class="small-muted" style="margin-top:10px;line-height:1.4">
          <b>State honesty:</b> 1 availability (your choice) · 2 Socket.IO (${socketLabel}) · 3 presence lease (${presenceLabel}) · 4 routability (${breakdown.routable ? "routable" : "not routable"}) · 5 WebRTC PC · 6 ICE · 7 media. Only when 1-4 are all true are you advertised as receiving calls.
        </div>
        <details class="pm-state-details" style="margin-top:8px">
          <summary>${esc(t("webcall.all_states", "All call states"))}</summary>
          <div id="pmCallStateStripVet"></div>
        </details>
      </div>`;
  }

  function mountVetCard() {
    const host = document.getElementById("pmVetCallHost");
    if (!host) return;
    host.innerHTML = vetCardHtml();
    const save = document.getElementById("pmVetSaveAvailability");
    if (save) save.addEventListener("click", async () => {
      const status = document.getElementById("pmVetAvailability").value;
      const supported_languages = Array.from(document.getElementById("pmVetLanguages").selectedOptions).map((o) => o.value);
      try {
        await pmFetch("/vet/availability", { method: "PUT", body: { status, supported_languages } });
        logCall("availability changed", status, "| languages=" + supported_languages.join(","));
        notify(t("webcall.saved", "Availability updated."));
        const fresh = await loadConfig(true).catch(() => null);
        if (fresh && fresh.presence) state.presence = fresh.presence;
        if (state.socket && state.socket.connected) {
          // The choice only becomes routable together with a live lease, so
          // renew it now and let the card report what the server confirmed.
          startPresenceHeartbeat();
        } else {
          warnCall("availability saved while signaling is offline —",
            "the server will not route calls to this vet until the socket reconnects");
          refreshVetCard(state.presence);
        }
      } catch (err) { notify(err.message, true); }
    });
    const push = document.getElementById("pmVetEnablePush");
    if (push) push.addEventListener("click", enablePushForCalls);
    const retry = document.getElementById("pmVetRetrySignaling");
    if (retry) retry.addEventListener("click", () => {
      reconnectSignaling({ refresh: true, params: {} });
      // The card is a static render: refresh the text badges once the socket
      // has had a moment to come back.
      setTimeout(() => refreshVetCard(state.presence), 1200);
    });
    refreshVetCard(state.presence);
  }

  function refreshVetCard(presence) {
    if (presence) state.presence = presence;
    const availability = currentVetAvailability();
    const availabilitySelect = document.getElementById("pmVetAvailability");
    if (availabilitySelect) availabilitySelect.value = availability.status || "OFFLINE";
    const languagesSelect = document.getElementById("pmVetLanguages");
    if (languagesSelect) {
      Array.from(languagesSelect.options || []).forEach((option) => {
        option.selected = (availability.supported_languages || []).includes(option.value);
      });
    }
    const routability = vetRoutabilityState();
    const breakdown = routability.breakdown || {};
    const availabilityBadge = document.getElementById("pmVetAvailabilityBadge");
    if (availabilityBadge) {
      availabilityBadge.textContent = `Avail: ${breakdown.availability || availability.status || "OFFLINE"}`;
    }
    const linkBadge = document.getElementById("pmCallLinkBadge");
    if (linkBadge) {
      // Keep backward compat: tests check pmCallLinkBadge text for online/offline,
      // but we now also show socket state explicitly. Preserve original semantics
      // via updateOverlayStatus which overwrites this badge; here we just set a fallback.
      if (!linkBadge.textContent || linkBadge.textContent === "…") {
        linkBadge.textContent = breakdown.socketOnline ? "Web calls online" : "Web calls offline";
        linkBadge.className = "badge " + (breakdown.socketOnline ? "badge-green" : "badge-orange");
      }
    }
    const presenceBadge = document.getElementById("pmVetPresenceBadge");
    if (presenceBadge) {
      presenceBadge.textContent = `Lease: ${breakdown.presenceLease || "OFFLINE"} (${breakdown.leaseLabel || "no lease"})`;
      presenceBadge.className = "badge " + (breakdown.presenceOnline ? "badge-green" : "badge-orange");
    }
    const badge = document.getElementById("pmVetRoutableBadge");
    if (badge) {
      badge.textContent = routability.label;
      badge.className = "badge " + routability.badgeClass;
    }
    const detail = document.getElementById("pmVetRoutableStatus");
    if (detail) {
      detail.textContent = routability.detail;
      // Developer detail lives in the title attribute (hover), never in the
      // sentence a veterinarian reads. Guarded: minimal DOM shims used by the
      // test harness may not implement attributes.
      if (routability.devDetail && typeof detail.setAttribute === "function") {
        detail.setAttribute("title", routability.devDetail);
      } else if (typeof detail.removeAttribute === "function") {
        detail.removeAttribute("title");
      }
    }
    const retryRow = document.getElementById("pmVetRetryRow");
    if (retryRow) {
      // The button only appears when this portal cannot actually be reached.
      retryRow.hidden = !!breakdown.socketOnline;
    }
    const presenceDetail = document.getElementById("pmVetPresenceDetail");
    if (presenceDetail) {
      presenceDetail.textContent = `Presence: ${breakdown.presenceLease || "OFFLINE"} · ${breakdown.leaseLabel || "no lease"}${breakdown.lease_expires_at ? ` · expires ${breakdown.lease_expires_at}` : ""}`;
    }
    updateOverlayStatus();
  }

  async function enablePushForCalls() {
    const statusEl = document.getElementById("pmVetPushStatus");
    const setStatus = (text) => { if (statusEl) statusEl.textContent = text; };
    try {
      if (!("Notification" in window)) { setStatus(t("webcall.push_unsupported", "This browser does not support notifications.")); return; }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setStatus(t("webcall.push_denied", "Notification permission denied — in-app ringing still works.")); return; }
      if (!("serviceWorker" in navigator)) { setStatus(t("webcall.push_unsupported", "This browser does not support notifications.")); return; }
      const cfg = await loadConfig();
      if (!cfg.push || !cfg.push.configured) {
        setStatus(t("webcall.push_server_off", "The server has no Web Push keys configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)."));
        return;
      }
      const keyResponse = await pmFetch("/push/vapid-key");
      if (!keyResponse.configured) { setStatus(t("webcall.push_server_off", "The server has no Web Push keys configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).")); return; }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyResponse.publicKey,
      });
      await pmFetch("/push/subscribe", { method: "POST", body: subscription.toJSON() });
      setStatus(t("webcall.push_enabled", "✅ Call notifications enabled on this device."));
    } catch (err) {
      setStatus((err && err.message) || "Could not enable notifications.");
    }
  }

  // ----------------------------------------------------------- farmer view --
  function ownerCallViewHtml() {
    const user = currentUser() || {};
    const languages = (state.config && state.config.supported_languages) || [
      { code: "en", name: "English" }, { code: "hi", name: "Hindi" },
      { code: "mr", name: "Marathi" }, { code: "te", name: "Telugu" },
    ];
    const preferred = (state.config && state.config.user.language) || user.preferred_language || "en";
    const header = typeof window.header === "function" ? window.header(ft("call_vet", "Call a veterinarian"), { back: true }) : "";
    const nav = typeof window.bottomNav === "function" ? window.bottomNav("#/owner/dashboard") : "";
    return `
      ${header}
      <div class="section-card">
        <div class="section-title">📞 ${esc(ft("call_vet", "Call a veterinarian"))}</div>
        <div class="meta" style="margin-bottom:10px">
          ${esc(ft("call_vet_help", "Talk to a veterinarian now, from this browser. Your microphone is used only during the call."))}
        </div>
        <div class="field"><label for="pmCallLanguage">${esc(ft("call_language", "Call language"))}</label>
          <select id="pmCallLanguage" aria-label="${esc(ft("call_language", "Call language"))}">
            ${languages.map((lang) => `<option value="${esc(lang.code)}" ${lang.code === preferred ? "selected" : ""}>${esc(lang.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label for="pmCallReason">${esc(ft("call_reason", "Reason for calling"))}</label>
          <select id="pmCallReason" aria-label="${esc(ft("call_reason", "Reason for calling"))}">
            ${REASONS.map((reason) => `<option value="${reason}">${esc(reasonLabel(reason))}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label for="pmCallNotes">${esc(ft("call_notes", "Notes (optional)"))}</label>
          <textarea id="pmCallNotes" rows="3" maxlength="500" placeholder="${esc(ft("call_notes_placeholder", "Symptoms, since when, animal tag…"))}" aria-label="${esc(ft("call_notes", "Notes (optional)"))}"></textarea>
        </div>
        <div id="pmCallAnimalOptions" class="field"></div>
        <div id="pmCallAvailabilityBox" class="small-muted" style="margin-top:6px;margin-bottom:10px" role="status" aria-live="polite"></div>
        <button class="btn btn-primary" id="pmCallStart" disabled aria-label="${esc(ft("start_call", "Start call"))}">📞 ${esc(ft("start_call", "Start call"))}</button>
        <div class="small-muted" id="pmCallSignalStatus" style="margin-top:8px" role="status" aria-live="polite"></div>
        <div class="small-muted" id="pmCallPrepStatus" style="margin-top:8px" role="status" aria-live="polite"></div>
      </div>
      ${helplineFallbackHtml()}
      ${nav}`;
  }

  function helplineFallbackHtml() {
    const helpline = currentHelpline();
    return `
      <div class="section-card">
        <div class="section-title">☎️ ${esc(ft("helpline", "Helpline (phone call)"))}</div>
        <div class="meta">${esc(ft("helpline_help",
          "If nobody is online for a web call, you can dial the helpline from a phone. This is a separate telephone service."))}</div>
        ${helpline.number ? `<div class="meta"><b>${esc(helpline.number)}</b> · PSTN: ${esc(helpline.pstn_connected ? "connected" : "not connected (MOCK mode)")}</div>` : ""}
      </div>`;
  }

  function farmerLanguageName(code) {
    const languages = (state.config && state.config.supported_languages) || [];
    const match = languages.find((lang) => lang.code === code);
    return (match && match.name) || String(code || "").toUpperCase();
  }

  function farmerAvailabilityParams(params) {
    return {
      language: document.getElementById("pmCallLanguage")?.value,
      reason: document.getElementById("pmCallReason")?.value || "animal_sick",
      reasonNote: document.getElementById("pmCallNotes")?.value || "",
      caseId: (params && params.case) ? params.case : undefined,
      animalId: (params && params.animal) ? params.animal : undefined,
    };
  }

  function bindAlternativeLanguageButtons(params) {
    document.querySelectorAll("[data-alt-language]").forEach((button) => {
      button.addEventListener("click", () => {
        const select = document.getElementById("pmCallLanguage");
        if (select) select.value = button.getAttribute("data-alt-language") || select.value;
        refreshFarmerAvailability(params).catch(() => {});
      });
    });
  }

  function renderFarmerAvailabilityResult(result, params) {
    const box = document.getElementById("pmCallAvailabilityBox");
    const start = document.getElementById("pmCallStart");
    if (!box || !start) return;
    const helpline = result.helpline || currentHelpline();
    const sig = signalingState();
    const sigOnline = sig === "connected";
    const failure = signalingFailureInfo();
    start.disabled = !result.routable || !sigOnline;

    // The primary state is ALWAYS about this browser's connection to the call
    // service, because nothing else can work without it. "Vet online now" is
    // only claimed when the server says the call is routable AND the socket is
    // live.
    let stateCode;
    let badgeClass;
    let badgeText;
    if (!sigOnline) {
      stateCode = failure.code === "ORIGIN_NOT_ALLOWED" ? "FAILED" : callState();
      badgeClass = stateCode === "FAILED" ? "badge-red" : "badge-orange";
      badgeText = callStateLabel(stateCode);
    } else if (result.routable) {
      stateCode = "AVAILABLE";
      badgeClass = "badge-green";
      badgeText = t("webcall.vet_available_now", "Veterinarian available");
    } else {
      stateCode = "OFFLINE";
      badgeClass = "badge-orange";
      badgeText = t("webcall.no_vet_now", "No veterinarian available right now");
    }

    // The farmer-facing sentence. A raw routing code is never the message.
    let primaryMessage;
    if (!sigOnline) {
      primaryMessage = failure.farmer;
    } else if (result.routable && result.selected_vet) {
      primaryMessage = result.message ||
        t("webcall.vet_online", "A veterinarian is online now.");
    } else {
      const languageName = farmerLanguageName(result.requested_language);
      primaryMessage = t("webcall.no_vet_online",
        "No veterinarian for {language} is online right now. Try another language or call the helpline.")
        .replace("{language}", languageName);
    }

    // "Matched vet" is only shown when the server really can route the call.
    const selected = (result.routable && result.selected_vet)
      ? `<div class="small-muted" style="margin-top:6px">${esc(t("webcall.matched_vet", "Matched veterinarian"))}: <b>${esc(result.selected_vet.name)}</b>${result.selected_vet.district ? ` · ${esc(result.selected_vet.district)}` : ""}</div>`
      : "";

    const fallback = !result.routable && helpline.number
      ? `<div class="small-muted" style="margin-top:6px">${esc(t("webcall.helpline_fallback", "If you need help now, call the helpline"))} <b>${esc(helpline.number)}</b>.</div>`
      : "";

    // Other veterinarians' routing codes are summarised in words; the codes
    // themselves stay in the console and in data attributes for developers.
    const skipSentence = skipReasonSentence(result.skipped_codes);
    const others = (result.routable && skipSentence)
      ? `<div class="small-muted" style="margin-top:6px">${esc(t("webcall.other_vets", "Other veterinarians on the platform are"))} ${esc(skipSentence)}.</div>`
      : "";

    // When this browser cannot reach the call service, the server's routing
    // sentence is secondary information (it can still be true that a vet is
    // online) — shown as a note, never as the reason the call cannot start.
    const signalingNote = !sigOnline && result.routable && result.message
      ? `<div class="small-muted" style="margin-top:6px">${esc(result.message)}</div>`
      : "";
    const retry = !sigOnline
      ? `<div class="btn-row" style="margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" id="pmCallRetrySignaling">🔁 ${esc(t("webcall.retry_signaling", "Retry connection"))}</button></div>`
      : "";

    const alternatives = (result.alternatives || []).length
      ? `<div class="small-muted" style="margin-top:8px">${esc(t("webcall.try_other_language", "Try another language with an online veterinarian"))}:</div>
         <div class="btn-row" style="margin-top:6px">${result.alternatives.map((alt) => `<button type="button" class="btn btn-ghost btn-sm" data-alt-language="${esc(alt.code)}">${esc(alt.name)}</button>`).join("")}</div>`
      : "";

    box.innerHTML = `
      <div role="status" aria-live="polite"><span class="badge ${badgeClass}" id="pmCallStateBadge">${esc(badgeText)}</span> <span class="badge badge-blue" id="pmCallSignalBadge">${esc(t("webcall.signaling", "Signaling"))}: ${esc(callStateLabel(sigOnline ? "AVAILABLE" : (sig === "error" ? "FAILED" : sig.toUpperCase())))}</span></div>
      <div class="meta" style="margin-top:6px" role="status" aria-live="polite" id="pmCallAvailabilityMessage">${esc(primaryMessage)}</div>
      ${selected}
      ${others}
      ${signalingNote}
      ${retry}
      ${fallback}
      ${alternatives}
      <div class="small-muted" style="margin-top:8px" data-signaling-state="${esc(sig)}" data-skipped-codes="${esc((result.skipped_codes || []).join(","))}" data-state-code="${esc(stateCode)}">
        ${esc(t("webcall.state_honesty",
          "State: availability (vet choice) · Socket.IO ({socket}) · presence lease (server) · routability ({routable}) · WebRTC · ICE · media.")
          .replace("{socket}", sig).replace("{routable}", result.routable ? t("webcall.routable", "routable") : t("webcall.not_routable", "not routable")))}
        ${failure.dev ? `<span class="pm-dev-detail">${esc(failure.dev)}</span>` : ""}
      </div>
      <details class="pm-state-details" style="margin-top:8px">
        <summary>${esc(t("webcall.all_states", "All call states"))}</summary>
        <div id="pmCallStateStripFarmer"></div>
      </details>`;
    if (failure.dev || (result.skipped_codes || []).length) {
      logCall("availability", "state=" + stateCode, "| signaling=" + sig,
        "| routable=" + !!result.routable,
        "| skipped=" + ((result.skipped_codes || []).join(",") || "none"),
        failure.dev ? "| " + failure.dev : "");
    }
    const retryButton = document.getElementById("pmCallRetrySignaling");
    if (retryButton) retryButton.addEventListener("click", () => reconnectSignaling({ refresh: true }));
    bindAlternativeLanguageButtons(params);
  }

  /**
   * Re-open the signaling socket on demand (used by the "Retry connection"
   * button and after the browser regains connectivity). Reconnect also refreshes
   * the server configuration, so the ICE/TURN list a later call uses is current.
   */
  function reconnectSignaling(options) {
    const opts = options || {};
    logCall("manual signaling reconnect requested", "| current=" + signalingState());
    try {
      if (state.socket) {
        if (state.socket.connected) {
          state.socket.disconnect();
        }
        state.socket.connect();
      } else {
        state.socketReady = null;
        ensureSocket().catch((err) => warnCall("signaling reconnect failed:", err && err.message));
      }
    } catch (err) {
      warnCall("signaling reconnect failed:", err && err.message);
    }
    // Refresh server-side configuration (presence lease, ICE servers) so the
    // next call cannot use a stale TURN/STUN list.
    loadConfig(true).then((cfg) => {
      if (cfg && cfg.presence) applyPresence(cfg.presence);
      if (opts.refresh) refreshFarmerAvailability(opts.params || {}, { keepExisting: true }).catch(() => {});
    }).catch(() => {});
    updateOverlayStatus();
  }

  async function refreshFarmerAvailability(params, options) {
    const opts = options || {};
    const box = document.getElementById("pmCallAvailabilityBox");
    const start = document.getElementById("pmCallStart");
    if (start) start.disabled = true;
    if (box && !opts.keepExisting) {
      box.innerHTML = `<span class="badge badge-orange">Checking availability…</span>`;
    }
    const query = new URLSearchParams();
    const request = farmerAvailabilityParams(params);
    if (request.language) query.set("language", request.language);
    if (request.reason) query.set("reason", request.reason);
    if (request.caseId) query.set("case_id", request.caseId);
    if (request.animalId) query.set("animal_id", request.animalId);
    try {
      const result = await pmFetch(`/webcall/availability?${query.toString()}`);
      state.lastAvailabilityCheck = result;
      renderFarmerAvailabilityResult(result, params);
      updateOverlayStatus();
      return result;
    } catch (err) {
      state.lastAvailabilityCheck = null;
      if (start) start.disabled = true;
      if (box) {
        const helpline = currentHelpline();
        box.innerHTML = `
          <div><span class="badge badge-orange">Could not check availability</span></div>
          <div class="meta" style="margin-top:6px">${esc(err.message || "Could not check whether a veterinarian is online.")}</div>
          ${helpline.number ? `<div class="small-muted" style="margin-top:6px">If this continues, call the helpline <b>${esc(helpline.number)}</b>.</div>` : ""}`;
      }
      return null;
    }
  }

  async function renderOwnerCallView(params) {
    await loadConfig().catch(() => {});
    const render = typeof window.render === "function" ? window.render : null;
    if (render) render(ownerCallViewHtml());
    else document.getElementById("app").innerHTML = ownerCallViewHtml();

    const start = document.getElementById("pmCallStart");
    if (!start) return;
    // Reconcile first: the farmer may already have a live call (refresh).
    const active = await reconcileCurrentCall().catch(() => null);
    if (active) {
      renderInCallOverlay(state.activeSession);
      return;
    }
    const rerunAvailability = () => refreshFarmerAvailability(params).catch(() => {});
    document.getElementById("pmCallLanguage")?.addEventListener("change", rerunAvailability);
    document.getElementById("pmCallReason")?.addEventListener("change", rerunAvailability);
    start.addEventListener("click", async () => {
      const latest = await refreshFarmerAvailability(params, { keepExisting: true });
      if (!latest || !latest.routable) return;
      startFarmerCallFlow(farmerAvailabilityParams(params));
    });
    // Microphone availability is reported up-front (honest, no surprise).
    const status = document.getElementById("pmCallPrepStatus");
    if (status && navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasMic = devices.some((device) => device.kind === "audioinput");
        if (!hasMic && devices.length) {
          status.textContent = t("webcall.mic_missing", "No microphone was found on this device.");
        }
      } catch (e) { /* permission not granted yet: nothing to report */ }
    }
    await refreshFarmerAvailability(params).catch(() => {});
    updateOverlayStatus();
  }

  // -------------------------------------------------------- call history ----
  async function renderCallHistory(role) {
    const farmer = role === "owner";
    const header = typeof window.header === "function"
      ? window.header(farmer ? ft("call_history", "Call history") : t("webcall.history", "Call history"), { back: true })
      : "";
    const nav = typeof window.bottomNav === "function" ? window.bottomNav(`#/${role}/dashboard`) : "";
    const render = typeof window.render === "function" ? window.render : null;
    const doRender = (html) => { if (render) render(html); else document.getElementById("app").innerHTML = html; };
    doRender(`${header}<div class="loading">${esc(t("webcall.loading", "Loading call history…"))}</div>${nav}`);
    let data;
    try {
      data = await pmFetch("/webcall/calls/history?limit=50");
    } catch (err) {
      doRender(`${header}<div class="section-card">${esc(err.message)}</div>${nav}`);
      return;
    }
    const rows = data.calls || [];
    doRender(`
      ${header}
      <div class="section-card">
        <div class="section-title">📞 ${esc(t("webcall.history", "Call history"))} (${rows.length})</div>
        ${rows.length ? rows.map((call) => `
          <div class="list-card" style="cursor:default">
            <div class="row1">
              <span class="title">${esc(call.vet && call.vet.name ? call.vet.name : (call.caller && call.caller.name) || call.call_id)}</span>
              <span class="badge ${call.status === "ended" ? "badge-green" : "badge-orange"}">${esc(call.status)}</span>
            </div>
            <div class="meta">${esc(new Date((call.created_at || "").replace(" ", "T") + "Z").toLocaleString())}</div>
            ${call.duration_seconds ? `<div class="meta">${esc(t("webcall.talk_time", "Talk time"))}: ${esc(mmss(call.duration_seconds))}</div>` : ""}
            ${call.end_reason ? `<div class="meta">${esc(call.end_reason)}</div>` : ""}
          </div>`).join("") : `<div class="empty-state">${esc(t("webcall.no_history", "No calls yet."))}</div>`}
      </div>
      ${helplineFallbackHtml()}
      ${nav}`);
  }

  // --------------------------------------------------------------- wiring ---
  const E = { ringtone: state.ringtone };

  PM.init = async function init() {
    updateOverlayStatus();
    if (!authToken()) return;
    const role = currentRole();
    if (role !== "owner" && role !== "vet") return;
    try {
      await loadConfig();
    } catch (err) {
      console.warn("[webcall] configuration unavailable:", err && err.message);
    }
    if (typeof window.io !== "function") {
      console.warn("[webcall] signaling library missing (vendor/socket.io.min.js)");
      updateOverlayStatus();
      return;
    }
    ensureSocket().catch((err) => console.warn("[webcall] signaling unavailable:", err && err.message));
    if (role === "vet") {
      startReconcileTimer();
    }
    await reconcileCurrentCall().catch(() => {});
    // A push notification click focuses the portal and asks this page to
    // recover the call (fetching state from the server, not from the payload).
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        const data = event.data || {};
        if (data.type === "pm-focus-call" || data.type === "pm-incoming-call") {
          reconcileCurrentCall().catch(() => {});
        }
      });
    }
    // The Service Worker can deliver a call while the tab was asleep: the push
    // payload carries only a call id, and the state is re-read from the server.
    window.addEventListener("focus", () => { reconcileCurrentCall().catch(() => {}); });
  };

  /** Called by app.js after login/logout so the socket follows the session. */
  PM.onAuthChanged = function onAuthChanged() {
    if (state.socket) { try { state.socket.disconnect(); } catch (e) { /* already closed */ } }
    state.socket = null;
    state.socketReady = null;
    state.config = null;
    state.configPromise = null;
    state.lastIncomingCallId = null;
    state.lastAvailabilityCheck = null;
    state.presence = null;
    state.signalingOfflineSince = null;
    state.signalingError = null;
    state.signalingErrorType = null;
    state.signalingUrl = null;
    state.signalingPath = null;
    state.signalingTransports = null;
    state.everConnected = false;
    state.disconnectedAt = null;
    stopPresenceHeartbeat();
    clearSignalingWarningTimer();
    if (state.activeSession) state.activeSession.teardown();
    hideOverlay();
    updateOverlayStatus();
    if (authToken()) PM.init();
  };

  PM.renderOwnerCallView = renderOwnerCallView;
  PM.mountVetCard = mountVetCard;
  PM.renderCallHistory = renderCallHistory;
  PM.startFarmerCallFlow = startFarmerCallFlow;
  PM.reconcile = reconcileCurrentCall;
  PM.config = () => state.config;
  PM.status = () => ({
    signaling: !!(state.socket && state.socket.connected),
    signaling_state: signalingState(),
    signaling_url: state.signalingUrl,
    signaling_path: state.signalingPath,
    signaling_transports: state.signalingTransports,
    signaling_error: state.signalingError,
    signaling_error_type: state.signalingErrorType,
    client_origin_allowed: clientOriginAllowed(),
    call_state: callState(),
    presence_online: !!(currentPresenceState() && currentPresenceState().online),
    signaling_offline_long: signalingStatus().offlineLong,
    active_call: state.activeSession ? state.activeSession.call.call_id : null,
    call_status: state.activeSession ? state.activeSession.call.status : null,
    media_confirmed: state.activeSession ? state.activeSession.mediaConfirmed : false,
    muted: state.activeSession ? state.activeSession.muted : false,
    ringtone_playing: state.ringtone.playing,
    ringtone_blocked: state.ringtone.blocked,
    overlay_open: !!document.getElementById("pmCallOverlay"),
  });

  // Exposed for tests and for on-device diagnostics only (no secrets).
  PM.__test = {
    normalizeSocketPath,
    signalingState,
    vetRoutabilityState,
    signalingStatus,
    callState,
    callStateLabel,
    callStateStripHtml,
    renderStateStrips,
    signalingFailureInfo,
    skipReasonSentence,
    clientOriginAllowed,
    reconnectSignaling,
    renderFarmerAvailabilityResult,
  };

  // The browser tells us when connectivity returns: reconnect immediately
  // instead of waiting for the next backoff step, then refresh the server
  // configuration (ICE servers, presence lease) the next call will use.
  window.addEventListener("online", () => {
    if (!authToken()) return;
    logCall("browser online — reconnecting signaling");
    reconnectSignaling({ refresh: true });
  });

  window.PMCall = PM;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => PM.init());
  } else {
    PM.init();
  }
})();
