#!/usr/bin/env node
/**
 * Deployment smoke test for the web-calling feature.
 *
 * Run this against a DEPLOYED backend (Render) or a local one started exactly
 * like the deployment. It answers the questions that only a real deployment can
 * answer:
 *
 *   1. Is the API healthy and does it report its web-calling configuration?
 *   2. Does the signaling socket accept an authenticated connection — over
 *      WebSocket, and over long-polling (the fallback for blocked networks)?
 *   3. **Does a REST-triggered incoming call actually reach the veterinarian's
 *      socket?** This is the check that fails when Gunicorn runs more than one
 *      worker without a message queue: Socket.IO rooms are per-process, so the
 *      event is emitted in a process that does not hold the browser's socket.
 *      Measured on 2026-10-04: 0/6 delivered with `--workers 2`, 4/4 in 5-9 ms
 *      with `--worker-class gthread --workers 1 --threads 100`.
 *   4. Is TURN configured (calls behind carrier-grade NAT need it)? Reported as
 *      `turn_mode` / `turn_url_count` / `turn_config_issue` / `turn_env` so a
 *      "not configured" verdict names the variable that is missing or empty.
 *   5. Is Web Push configured (ringing a backgrounded tab)?
 *
 * Usage:
 *   npm install --no-save socket.io-client
 *   PM_WEBCALL_URL=https://pashu-shield-backend-hjgr.onrender.com \
 *   PM_VET_EMAIL=vet1@example.com PM_VET_PASSWORD=... \
 *   PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
 *   [PM_EXPECT_TURN=1] [PM_EXPECT_PUSH=1] \
 *   node backend/tests/deploy/deploy_check.mjs
 *
 * Exit codes: 0 all checks passed, 1 a check failed, 2 skipped (missing config).
 * Tokens are never printed.
 */
const BASE = (process.env.PM_WEBCALL_URL || "").replace(/\/+$/, "");
const VET = { email: process.env.PM_VET_EMAIL || "", password: process.env.PM_VET_PASSWORD || "" };
const FARMER = { mobile: process.env.PM_FARMER_MOBILE || "8341564042", otp: process.env.PM_FARMER_OTP || "123456" };
const EXPECT_TURN = process.env.PM_EXPECT_TURN === "1";
const EXPECT_PUSH = process.env.PM_EXPECT_PUSH === "1";
const EVENT_TIMEOUT_MS = Number(process.env.PM_EVENT_TIMEOUT_MS || 10000);

if (!BASE) {
  console.log("SKIPPED: set PM_WEBCALL_URL to the deployment under test");
  process.exit(2);
}
if (!VET.email || !VET.password) {
  console.log("SKIPPED: set PM_VET_EMAIL and PM_VET_PASSWORD");
  process.exit(2);
}

let io;
try {
  ({ io } = await import("socket.io-client"));
} catch (err) {
  console.log("SKIPPED: socket.io-client is not installed — `npm install --no-save socket.io-client`");
  process.exit(2);
}

const failures = [];
const warnings = [];
let checks = 0;

function check(ok, message, { warnOnly = false } = {}) {
  checks += 1;
  const mark = ok ? "✔" : (warnOnly ? "!" : "✘");
  console.log(`  ${mark} ${message}`);
  if (!ok) (warnOnly ? warnings : failures).push(message);
  return ok;
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(BASE + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    return { status: 0, data: {}, error: err.message };
  }
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (err) { /* non-JSON body */ }
  return { status: response.status, data };
}

function connectSocket(token, transports, label) {
  const socket = io(BASE, {
    path: "/socket.io",
    auth: { token },
    transports,
    reconnection: false,
    timeout: 12000,
  });
  return new Promise((resolve) => {
    const done = (result) => { socket.removeAllListeners(); resolve({ socket, ...result }); };
    socket.on("connect", () => done({ ok: true, transport: socket.io.engine.transport.name }));
    socket.on("connect_error", (err) => done({ ok: false, why: err.message }));
    setTimeout(() => done({ ok: false, why: `timeout (${label})` }), 13000);
  });
}

function waitForEvent(socket, event, ms) {
  return new Promise((resolve) => {
    const handler = (payload) => { socket.off(event, handler); resolve({ payload, ms: Date.now() - started }); };
    const started = Date.now();
    socket.on(event, handler);
    setTimeout(() => { socket.off(event, handler); resolve(null); }, ms);
  });
}

const results = { pass: false };
try {
  console.log(`\n▶ target: ${BASE}`);

  console.log("\n▶ API health and web-calling configuration");
  const health = await api("/api/health");
  check(health.status === 200, `GET /api/health responds 200 (got ${health.status})`);
  const webCalling = (health.data && health.data.web_calling) || null;
  check(!!webCalling, "the health payload advertises the web-calling subsystem");
  if (webCalling) {
    console.log(`     signaling=${webCalling.signaling} ring_timeout=${webCalling.ring_timeout_seconds}s `
      + `sweeper=${webCalling.sweeper_enabled ?? "?"} push=${webCalling.push_configured}`);
    const ice = webCalling.ice || {};
    console.log(`     ice: policy=${ice.ice_transport_policy} turn=${ice.turn_configured} (${ice.turn_mode}) stun=${ice.stun_configured}`);
    check(ice.stun_configured === true, "STUN is configured");
    // Spell out the TURN diagnosis instead of a bare true/false: these fields
    // are the difference between "TURN is broken" and "SIH_TURN_URLS was never
    // pasted into this service". Names and states only — never a value.
    if (ice.turn_env) {
      console.log(`     turn_env: ${Object.entries(ice.turn_env).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    }
    console.log(`     turn_url_count=${ice.turn_url_count} turn_urls_ignored=${ice.turn_urls_ignored ?? "?"} `
      + `turn_config_issue=${ice.turn_config_issue ?? "none"}`);
    check(ice.turn_configured === true,
      `TURN is configured (${ice.turn_mode}) — calls between two mobile/CGNAT networks need it`
      + (ice.turn_config_issue ? ` [${ice.turn_config_issue}]` : ""),
      { warnOnly: !EXPECT_TURN });
    check((ice.turn_url_count ?? 0) > 0,
      `at least one usable turn:/turns: URL was parsed (${ice.turn_url_count})`,
      { warnOnly: !EXPECT_TURN });
    // A static/managed provider (Metered) must NOT also carry a coturn secret:
    // a non-empty SIH_TURN_SECRET wins the mode selection, so the browser would
    // receive coturn-style credentials that a static provider rejects. Report it
    // as a warning because the health payload itself is internally consistent —
    // only the operator knows which of the two credential sets was intended.
    if (ice.turn_env) {
      const bothCredentialSets = ice.turn_env.SIH_TURN_SECRET === "set"
        && ice.turn_env.SIH_TURN_USERNAME === "set" && ice.turn_env.SIH_TURN_CREDENTIAL === "set";
      check(!bothCredentialSets,
        "only one TURN credential set is configured — SIH_TURN_SECRET is set alongside "
        + `SIH_TURN_USERNAME/SIH_TURN_CREDENTIAL, so ${ice.turn_mode} mode wins and the other is ignored. `
        + "For Metered static credentials, delete or empty SIH_TURN_SECRET",
        { warnOnly: true });
    }
    check(webCalling.push_configured === true,
      "Web Push is configured (ringing a backgrounded vet tab needs it)",
      { warnOnly: !EXPECT_PUSH });
  }

  console.log("\n▶ authentication");
  const vetLogin = await api("/api/auth/login", { method: "POST", body: { identifier: VET.email, password: VET.password } });
  check(vetLogin.status === 200 && !!vetLogin.data.token, `veterinarian signs in (${vetLogin.status})`);
  if (vetLogin.status !== 200) throw new Error("cannot continue without a vet session");
  const vetToken = vetLogin.data.token;
  const vetId = vetLogin.data.user && vetLogin.data.user.id;

  // The demo account still follows the ordinary two-step OTP flow.
  await api("/api/auth/farmer/request-otp", { method: "POST", body: { mobile: FARMER.mobile, intent: "login" } });
  const farmerLogin = await api("/api/auth/farmer/verify-otp", { method: "POST", body: { mobile: FARMER.mobile, otp: FARMER.otp } });
  check(farmerLogin.status === 200 && !!farmerLogin.data.token,
    `farmer signs in (${farmerLogin.status}) — DEMO_MODE=true is needed for the fixed demo OTP`);
  if (farmerLogin.status !== 200) throw new Error("cannot continue without a farmer session");
  const farmerToken = farmerLogin.data.token;

  const anon = await api("/api/webcall/calls/current");
  check(anon.status === 401, `unauthenticated call access is rejected (${anon.status})`);

  console.log("\n▶ signalling transport");
  const ws = await connectSocket(vetToken, ["websocket"], "websocket-only");
  check(ws.ok && ws.transport === "websocket", `the authenticated socket connects over WebSocket (${ws.ok ? ws.transport : ws.why})`);
  const polling = await connectSocket(vetToken, ["polling"], "polling-only");
  check(polling.ok, `the long-polling fallback connects (${polling.ok ? "ok" : polling.why}) — it requires a single-process deployment`,
    { warnOnly: true });
  if (polling.socket) polling.socket.disconnect();

  console.log("\n▶ real-time delivery of an incoming call (the cross-worker check)");
  const socket = ws.socket;
  const incoming = waitForEvent(socket, "call:incoming", EVENT_TIMEOUT_MS);

  const availability = await api("/api/vet/availability", {
    method: "PUT", token: vetToken,
    body: { status: "AVAILABLE", supported_languages: ["en", "hi", "mr", "te"] },
  });
  check(availability.status === 200, `the veterinarian can set availability (${availability.status})`);

  // Clear any call left behind by an earlier run.
  const stale = await api("/api/webcall/calls/current", { token: farmerToken });
  if (stale.data && stale.data.call) {
    console.log(`     (clearing a stale call ${stale.data.call.call_id})`);
    await api(`/api/webcall/calls/${stale.data.call.call_id}/cancel`, { method: "POST", token: farmerToken });
    await api(`/api/webcall/calls/${stale.data.call.call_id}/end`, { method: "POST", token: farmerToken });
  }

  const created = await api("/api/webcall/calls", {
    method: "POST", token: farmerToken,
    body: { language: "en", reason: "animal_sick", notes: "deploy_check.mjs" },
  });
  const rang = created.status === 201 && (created.data.call || {}).status === "ringing";
  check(rang, `a farmer call rings (HTTP ${created.status}, status=${(created.data.call || {}).status})`,
    { warnOnly: false });
  if (!rang) {
    console.log("     ↳ the call was created but never rang, which means the veterinarian looked offline.");
    console.log("       The usual cause is a deployment with more than one Gunicorn worker: the vet's");
    console.log("       signalling socket lives in one process, so its presence lease and the incoming-call");
    console.log("       event cannot be seen by the process that handles the REST call. Deploy");
    console.log("       `--worker-class gthread --workers 1 --threads 100` (see WEB_CALLING.md §7).");
  }
  const callId = (created.data.call || {}).call_id;

  if (created.status === 201 && callId) {
    const assigned = (created.data.call.vet || {}).id;
    check(assigned === vetId, `the call was routed to the veterinarian under test (${assigned})`);

    const event = await incoming;
    check(!!event, `the vet's socket received call:incoming within ${EVENT_TIMEOUT_MS} ms${event ? ` (${event.ms} ms)` : " — check the Gunicorn worker model (see WEB_CALLING.md)"}`);
    if (event) {
      // The call:incoming payload is { call: <serialized call> } — the client
      // matches it by call.call_id.
      const eventCall = (event.payload && event.payload.call) || {};
      check(eventCall.call_id === callId, `the event carries the right call id (${eventCall.call_id})`);
      check(!!(eventCall.caller && eventCall.caller.name),
        "the event carries the caller's server-side identity");
    }

    const fallback = await api("/api/webcall/calls/current", { token: vetToken });
    check(!!(fallback.data && fallback.data.call),
      "the REST reconciliation endpoint also reports the ringing call (fallback path)");
    console.log("\n▶ authorization on a live call");
    const asVet = await api(`/api/webcall/calls/${callId}`, { token: vetToken });
    check(asVet.status === 200, "the assigned vet can read the call");
    const anonCall = await api(`/api/webcall/calls/${callId}`);
    check(anonCall.status === 401, `an anonymous reader is rejected (${anonCall.status})`);

    const cancel = await api(`/api/webcall/calls/${callId}/cancel`, { method: "POST", token: farmerToken });
    check(cancel.status === 200, `the caller can cancel the ringing call (${cancel.status})`);
    const terminal = await api(`/api/webcall/calls/${callId}`, { token: farmerToken });
    check(terminal.status === 200 && ["cancelled", "ended"].includes((terminal.data.call || {}).status),
      `the call ends in an honest terminal state (${(terminal.data.call || {}).status})`);
  }

  console.log("\n▶ push configuration as the browser reads it");
  const vapid = await api("/api/push/vapid-key", { token: vetToken });
  check(vapid.status === 200 && !!vapid.data.publicKey,
    `GET /api/push/vapid-key serves a public key (configured=${vapid.data.configured})`,
    { warnOnly: !EXPECT_PUSH });

  socket.disconnect();
  results.pass = failures.length === 0;
} catch (err) {
  failures.push(`unexpected error: ${err.message}`);
} finally {
  console.log(`\n${"-".repeat(68)}`);
  for (const warning of warnings) console.log(`WARN: ${warning}`);
  if (failures.length) {
    console.log(`FAIL — ${failures.length} of ${checks} checks failed:`);
    for (const failure of failures) console.log(`  • ${failure}`);
    process.exit(1);
  }
  console.log(`PASS — ${checks} checks passed against ${BASE}`);
  setTimeout(() => process.exit(0), 300).unref();
}
