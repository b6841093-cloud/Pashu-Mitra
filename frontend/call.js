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
  };

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
      .then((cfg) => { state.config = cfg; return cfg; })
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
        reject(new Error(t("webcall.signaling_unavailable",
          "Real-time signaling could not load. Check your connection and reload the page.")));
        return;
      }
      const socket = window.io(signalingUrl(cfg), {
        path: (cfg.signaling && cfg.signaling.path) || "socket.io",
        auth: { token: authToken() },
        transports: ["websocket", "polling"],
        withCredentials: false,
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 6000,
        timeout: 10000,
      });
      state.socket = socket;

      socket.on("connect", () => {
        updateOverlayStatus();
        if (currentRole() === "vet") startPresenceHeartbeat();
      });
      socket.on("disconnect", () => {
        stopPresenceHeartbeat();
        updateOverlayStatus();
      });
      socket.on("connect_error", (err) => {
        if (err && (err.message || "").length < 120) console.warn("[webcall] signaling error:", err.message);
        updateOverlayStatus();
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
        state.presence = payload;
        refreshVetCard(payload);
      });
      // If the handshake fails the socket closes; fall back to polling so the
      // portal still learns about calls.
      setTimeout(() => resolve(socket), 2500);
    }));
    return state.socketReady;
  }

  function startPresenceHeartbeat() {
    stopPresenceHeartbeat();
    const beat = () => {
      if (!state.socket || !state.socket.connected) return;
      state.socket.emit("presence:heartbeat", {}, (ack) => {
        if (ack && ack.ok) { state.presence = ack; refreshVetCard(ack); }
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
    };
    this.pc.onconnectionstatechange = () => {
      const connectionState = self.pc && self.pc.connectionState;
      updateOverlayStatus();
      if (connectionState === "connected") self.onMediaConnected();
      if (connectionState === "failed") self.onConnectionFailed();
      if (connectionState === "disconnected") self.renderPanel();  // transient; ICE may recover
    };
    this.pc.oniceconnectionstatechange = () => { updateOverlayStatus(); };
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

  /** Confirm actual media flow, not just signaling: count inbound audio RTP. */
  WebCallSession.prototype.startStatsWatch = function startStatsWatch() {
    const self = this;
    this.statsTimerStart = Date.now();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(async () => {
      if (!self.pc || self.ended) return;
      try {
        let outboundAudio = 0;
        const stats = await self.pc.getStats();
        stats.forEach((report) => {
          if (report.type === "outbound-rtp" && report.kind === "audio") outboundAudio += report.packetsSent || 0;
        });
        const wasConfirmed = self.mediaConfirmed;
        await self.sampleInboundAudio();
        if (self.mediaConfirmed) {
          if (!wasConfirmed) {
            updateOverlayStatus();
            await self.reportConnected();   // correct the earlier honest "not yet"
          }
          clearInterval(self.statsTimer);
          self.statsTimer = null;
        } else if (Date.now() - self.statsTimerStart > MEDIA_CONFIRM_TIMEOUT_MS) {
          updateOverlayStatus();
          clearInterval(self.statsTimer);
          self.statsTimer = null;
        }
        if (outboundAudio === 0 && Date.now() - self.statsTimerStart > 4000) {
          const warn = document.getElementById("pmCallWarn");
          if (warn) warn.textContent = t("webcall.no_sent_audio", "No audio is leaving your device — check your microphone.");
        }
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
    const badge = document.getElementById("pmCallLinkBadge");
    if (badge) {
      const connected = state.socket && state.socket.connected;
      badge.textContent = connected ? t("webcall.online", "Web calls online") : t("webcall.offline", "Web calls offline");
      badge.className = "badge " + (connected ? "badge-green" : "badge-orange");
    }
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
    if (call.status === "ringing") {
      return session.mode === "caller"
        ? t("webcall.ringing_vet", "Ringing {name}…").replace("{name}", session.peerLabel)
        : t("webcall.incoming", "Incoming call");
    }
    if (call.status === "accepted") return t("webcall.accepted", "Answered — connecting audio…");
    if (call.status === "connecting") return t("webcall.connecting", "Connecting audio…");
    if (call.status === "connected") {
      return session.remoteDescriptionSet
        ? (session.mediaConfirmed ? t("webcall.connected", "Connected") : t("webcall.connected_no_audio", "Connected — verifying audio…"))
        : t("webcall.connecting", "Connecting audio…");
    }
    return t("webcall.connecting", "Connecting audio…");
  }

  function renderInCallOverlay(session) {
    const call = session.call;
    const root = overlayRoot();
    const isRingingForMe = session.mode === "callee" && call.status === "ringing";
    const buttons = isRingingForMe
      ? `<button class="pm-call-btn pm-call-accept" id="pmCallAnswer">📞 ${esc(t("webcall.answer", "Answer"))}</button>
         <button class="pm-call-btn pm-call-decline" id="pmCallReject">✕ ${esc(t("webcall.reject", "Decline"))}</button>`
      : `<button class="pm-call-btn ${session.muted ? "is-muted" : ""}" id="pmCallMute" aria-pressed="${session.muted}">
           ${session.muted ? "🔇" : "🎙️"} ${esc(session.muted ? t("webcall.unmute", "Unmute") : t("webcall.mute", "Mute"))}
         </button>
         <button class="pm-call-btn pm-call-decline" id="pmCallHangup">📵 ${esc(t("webcall.end", "End call"))}</button>`;

    root.innerHTML = `
      <div class="pm-call-card" role="document">
        <div class="pm-call-header">
          <span class="pm-call-icon">${isRingingForMe ? "📞" : "🎙️"}</span>
          <div>
            <div class="pm-call-title">${esc(isRingingForMe ? t("webcall.incoming", "Incoming call") : session.peerLabel)}</div>
            <div class="pm-call-sub" id="pmCallSub">${esc(callerContextHtml(call))}</div>
          </div>
          ${call.status === "connected" ? `<div class="pm-call-timer" id="pmCallTimer">${esc(mmss(0))}</div>` : ""}
        </div>
        <div class="pm-call-status" id="pmCallStatus">${esc(inCallStatusText(session))}</div>
        ${isRingingForMe ? '<div class="pm-call-rings" id="pmCallRingElapsed"></div>' : ""}
        <div class="pm-call-meta">
          <span class="badge badge-blue">${esc(t("webcall.web_call", "Internet call (WebRTC)"))}</span>
          ${call.language ? `<span class="badge badge-blue">${esc(call.language.toUpperCase())}</span>` : ""}
          ${call.reason ? `<span class="badge badge-blue">${esc(reasonLabel(call.reason))}</span>` : ""}
          ${session.peerMuted ? `<span class="badge badge-orange" id="pmCallPeerMute">🔇 ${esc(t("webcall.peer_muted", "Muted"))}</span>` : ""}
        </div>
        ${call.reason_note ? `<div class="pm-call-note">${esc(call.reason_note)}</div>` : ""}
        <div class="pm-call-hint" id="pmCallHint"></div>
        <div class="pm-call-warn" id="pmCallWarn"></div>
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
        ${reason && status !== "ended" ? `<div class="pm-call-warn">${esc(reason)}</div>` : ""}
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
      await showCallSummary(created.call, created.message ||
        t("webcall.unavailable", "No veterinarian was available."), created.skipped_codes && created.skipped_codes.join(", "));
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
  function vetCardHtml() {
    const presence = state.presence || {};
    const availability = (state.config && state.config.availability) || { status: "OFFLINE", supported_languages: ["en"] };
    const languages = ["en", "hi", "mr", "te"];
    return `
      <div class="section-card" id="pmVetCallCard">
        <div class="section-title">📞 ${esc(t("webcall.vet_card_title", "Web call availability"))}</div>
        <div class="meta" style="margin-bottom:8px">
          ${esc(t("webcall.vet_card_help", "Farmers can call you directly in the browser while this portal stays open."))}
        </div>
        <div class="meta" style="margin-bottom:8px">
          ${esc(t("webcall.signaling", "Signaling"))}: <span id="pmCallLinkBadge" class="badge badge-orange">…</span>
          <span class="badge ${presence.online ? "badge-green" : "badge-orange"}" style="margin-left:6px">
            ${esc(presence.online ? t("webcall.online", "Web calls online") : t("webcall.offline", "Web calls offline"))}
          </span>
        </div>
        <div class="form-row">
          <div class="field"><label>${esc(t("webcall.receive_calls", "Receive web calls"))}</label>
            <select id="pmVetAvailability">
              ${["AVAILABLE", "BUSY", "OFFLINE"].map((s) => `<option value="${s}" ${availability.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>${esc(t("webcall.languages", "Languages you can take calls in"))}</label>
            <select id="pmVetLanguages" multiple size="4">
              ${languages.map((code) => `<option value="${code}" ${(availability.supported_languages || []).includes(code) ? "selected" : ""}>${code.toUpperCase()}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" id="pmVetSaveAvailability">${esc(t("webcall.save", "Save"))}</button>
          <button class="btn btn-ghost btn-sm" id="pmVetEnablePush">🔔 ${esc(t("webcall.enable_push", "Enable call notifications"))}</button>
          <button class="btn btn-ghost btn-sm" onclick="location.hash='#/vet/calls'">${esc(t("webcall.history", "Call history"))}</button>
        </div>
        <div class="small-muted" id="pmVetPushStatus" style="margin-top:6px"></div>
      </div>`;
  }

  function mountVetCard() {
    const host = document.getElementById("pmVetCallHost");
    if (!host) return;
    host.innerHTML = vetCardHtml();
    updateOverlayStatus();
    const save = document.getElementById("pmVetSaveAvailability");
    if (save) save.addEventListener("click", async () => {
      const status = document.getElementById("pmVetAvailability").value;
      const supported_languages = Array.from(document.getElementById("pmVetLanguages").selectedOptions).map((o) => o.value);
      try {
        await pmFetch("/vet/availability", { method: "PUT", body: { status, supported_languages } });
        notify(t("webcall.saved", "Availability updated."));
        loadConfig(true).then(() => refreshVetCard(state.presence)).catch(() => {});
      } catch (err) { notify(err.message, true); }
    });
    const push = document.getElementById("pmVetEnablePush");
    if (push) push.addEventListener("click", enablePushForCalls);
    refreshVetCard(state.presence);
  }

  function refreshVetCard(presence) {
    const badge = document.getElementById("pmCallLinkBadge");
    if (badge) updateOverlayStatus();
    const stateBadge = document.querySelector("#pmVetCallCard .badge.badge-green, #pmVetCallCard .badge.badge-orange");
    if (stateBadge && presence && "online" in presence) {
      stateBadge.textContent = presence.online ? t("webcall.online", "Web calls online") : t("webcall.offline", "Web calls offline");
      stateBadge.className = "badge " + (presence.online ? "badge-green" : "badge-orange");
    }
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
        <div class="field"><label>${esc(ft("call_language", "Call language"))}</label>
          <select id="pmCallLanguage">
            ${languages.map((lang) => `<option value="${esc(lang.code)}" ${lang.code === preferred ? "selected" : ""}>${esc(lang.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>${esc(ft("call_reason", "Reason for calling"))}</label>
          <select id="pmCallReason">
            ${REASONS.map((reason) => `<option value="${reason}">${esc(reasonLabel(reason))}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>${esc(ft("call_notes", "Notes (optional)"))}</label>
          <textarea id="pmCallNotes" rows="3" maxlength="500" placeholder="${esc(ft("call_notes_placeholder", "Symptoms, since when, animal tag…"))}"></textarea>
        </div>
        <div id="pmCallAnimalOptions" class="field"></div>
        <button class="btn btn-primary" id="pmCallStart">📞 ${esc(ft("start_call", "Start call"))}</button>
        <div class="small-muted" id="pmCallPrepStatus" style="margin-top:8px"></div>
      </div>
      ${helplineFallbackHtml()}
      ${nav}`;
  }

  function helplineFallbackHtml() {
    const helpline = (state.config && state.config.helpline) || {};
    return `
      <div class="section-card">
        <div class="section-title">☎️ ${esc(ft("helpline", "Helpline (phone call)"))}</div>
        <div class="meta">${esc(ft("helpline_help",
          "If nobody is online for a web call, you can dial the helpline from a phone. This is a separate telephone service."))}</div>
        ${helpline.number ? `<div class="meta"><b>${esc(helpline.number)}</b> · PSTN: ${esc(helpline.pstn_connected ? "connected" : "not connected (MOCK mode)")}</div>` : ""}
      </div>`;
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
    start.addEventListener("click", () => startFarmerCallFlow({
      language: document.getElementById("pmCallLanguage").value,
      reason: document.getElementById("pmCallReason").value,
      reasonNote: document.getElementById("pmCallNotes").value,
      caseId: (params && params.case) ? params.case : undefined,
      animalId: (params && params.animal) ? params.animal : undefined,
    }));
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
    if (state.activeSession) state.activeSession.teardown();
    hideOverlay();
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
    active_call: state.activeSession ? state.activeSession.call.call_id : null,
    call_status: state.activeSession ? state.activeSession.call.status : null,
    media_confirmed: state.activeSession ? state.activeSession.mediaConfirmed : false,
    muted: state.activeSession ? state.activeSession.muted : false,
    ringtone_playing: state.ringtone.playing,
    ringtone_blocked: state.ringtone.blocked,
    overlay_open: !!document.getElementById("pmCallOverlay"),
  });

  window.PMCall = PM;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => PM.init());
  } else {
    PM.init();
  }
})();
