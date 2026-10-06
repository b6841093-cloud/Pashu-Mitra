/**
 * Socket.IO origin/CORS verification (rung 1.5 — no browser, real HTTP).
 *
 *   PM_WEBCALL_URL=http://127.0.0.1:5001 \
 *   PM_ALLOWED_ORIGIN=http://127.0.0.1:5001 \
 *   PM_BLOCKED_ORIGIN=https://not-allowed.example.com \
 *   node backend/tests/webrtc/socketio_origin_check.mjs
 *
 * Why this exists
 * ---------------
 * A browser cannot be told *why* a Socket.IO handshake failed: an origin that
 * is missing from `SIH_ALLOWED_ORIGINS` produces a CORS error (polling) or a
 * bare `connect_error` (WebSocket), and the portal can only report the generic
 * "signaling offline". That is exactly how the 2026-10-05 and 2026-10-06
 * incidents hid a one-line configuration problem.
 *
 * This script performs the same two requests the browser makes, but with the
 * `Origin` header under the caller's control, so the origin allow-list and the
 * `Access-Control-Allow-Origin` response header can be verified directly:
 *
 *   1. Engine.IO polling handshake (`/socket.io/?EIO=4&transport=polling`)
 *      from an allowed origin  -> HTTP 200 + matching ACAO header,
 *      from a blocked origin   -> no ACAO header (the browser then refuses).
 *   2. WebSocket transport connect with a JWT from an allowed origin ->
 *      `session:ready`; from a blocked origin or without a token -> a refused
 *      handshake (`connect_error`).
 *
 * Exit codes: 0 pass, 1 failure, 2 skipped (missing dependency/configuration —
 * the check was NOT exercised).
 */
import process from "node:process";

const BASE = (process.env.PM_WEBCALL_URL || "").replace(/\/$/, "");
const ALLOWED = process.env.PM_ALLOWED_ORIGIN || "http://127.0.0.1:5001";
const BLOCKED = process.env.PM_BLOCKED_ORIGIN || "https://not-allowed.example.com";
const VET_EMAIL = process.env.PM_VET_EMAIL;
const VET_PASSWORD = process.env.PM_VET_PASSWORD;
const SOCKET_PATH = process.env.PM_SOCKETIO_PATH || "/socket.io";

let failures = 0;
let steps = 0;
function step(name) { steps += 1; console.log(`\n▶ ${name}`); }
function ok(name) { console.log(`  ✔ ${name}`); }
function fail(name, detail) { failures += 1; console.log(`  ✘ ${name}${detail ? " — " + detail : ""}`); }
function check(condition, name, detail) { if (condition) ok(name); else fail(name, detail); }

if (!BASE) {
  console.log("SKIP — PM_WEBCALL_URL is not set (nothing to verify).");
  process.exit(2);
}
let io;
try {
  ({ io } = await import("socket.io-client"));
} catch (err) {
  console.log("SKIP — socket.io-client is not installed (npm install --no-save socket.io-client).");
  process.exit(2);
}

const handshakeUrl = `${BASE}${SOCKET_PATH}/?EIO=4&transport=polling`;

async function pollingProbe(origin) {
  const res = await fetch(handshakeUrl, { headers: origin ? { Origin: origin } : {} });
  const body = await res.text();
  return {
    status: res.status,
    acao: res.headers.get("access-control-allow-origin"),
    acac: res.headers.get("access-control-allow-credentials"),
    body,
  };
}

function websocketProbe(origin, token) {
  return new Promise((resolve) => {
    const socket = io(BASE, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
      auth: token ? { token } : {},
      extraHeaders: origin ? { Origin: origin } : {},
    });
    const done = (result) => { try { socket.close(); } catch (e) { /* closed */ } resolve(result); };
    socket.on("session:ready", (payload) => done({ connected: true, payload }));
    socket.on("connect_error", (err) => done({ connected: false, error: (err && err.message) || "connect_error" }));
    setTimeout(() => done({ connected: false, error: "timeout" }), 9000);
  });
}

step(`Engine.IO polling handshake — allowed origin (${ALLOWED})`);
const allowed = await pollingProbe(ALLOWED);
check(allowed.status === 200, `handshake answered with HTTP 200 (got ${allowed.status})`, allowed.body.slice(0, 120));
check(/^\d+:/.test(allowed.body) || allowed.body.startsWith("0{"), "the engine.io open packet was returned");
check(allowed.acao === ALLOWED,
  `Access-Control-Allow-Origin is exactly the frontend origin (got ${JSON.stringify(allowed.acao)})`);
check(allowed.acao !== "*", "no wildcard CORS policy is in use");
check(SOCKET_PATH.startsWith("/") && !SOCKET_PATH.endsWith("/"),
  `the signaling path is the canonical ${SOCKET_PATH}`);

step("Engine.IO polling handshake — origin that is NOT in the allow-list");
const blocked = await pollingProbe(BLOCKED);
check(blocked.acao !== BLOCKED && blocked.acao !== "*",
  `an unlisted origin receives no ACAO header (got ${JSON.stringify(blocked.acao)})`,
  "an unlisted origin was accepted — the allow-list is not being enforced");

let vetToken = null;
if (VET_EMAIL && VET_PASSWORD) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: VET_EMAIL, password: VET_PASSWORD }),
  });
  const data = await res.json().catch(() => ({}));
  vetToken = data.token || null;
  step("authenticate a veterinarian for the WebSocket probes");
  check(Boolean(vetToken), "the veterinarian session token was issued", `login status ${res.status}`);
} else {
  console.log("\n(skipping the authenticated WebSocket probes: PM_VET_EMAIL/PM_VET_PASSWORD unset)");
}

if (vetToken) {
  step(`WebSocket transport — allowed origin (${ALLOWED})`);
  const wsAllowed = await websocketProbe(ALLOWED, vetToken);
  check(wsAllowed.connected, "the authenticated socket reached session:ready", wsAllowed.error);

  step("WebSocket transport — origin that is NOT in the allow-list");
  const wsBlocked = await websocketProbe(BLOCKED, vetToken);
  check(!wsBlocked.connected, "the unlisted origin was refused", "an unlisted origin connected");

  step("WebSocket transport — no token");
  const wsAnon = await websocketProbe(ALLOWED, null);
  check(!wsAnon.connected, "an unauthenticated socket was refused", "a socket connected without a token");
}

console.log("");
if (failures) {
  console.log(`FAIL — ${failures} of ${steps} checks failed.`);
  process.exit(1);
}
console.log(`PASS — Socket.IO origin + CORS behaviour verified (${steps} groups).`);
process.exit(0);
