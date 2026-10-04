#!/usr/bin/env node
/**
 * Local TURN fixture for validating the feature's TURN integration.
 *
 * WHY THIS EXISTS
 * ===============
 * `turn_config.py` can hand the browser two kinds of TURN credential:
 *
 *   1. static        — SIH_TURN_USERNAME / SIH_TURN_CREDENTIAL
 *   2. ephemeral     — coturn REST API: username "<expiry-unix>:<user-id>" and
 *                      credential = base64(HMAC-SHA1(static-auth-secret, username))
 *
 * Validating either of them against a *hosted* TURN service needs an account and
 * credentials that this repository does not (and must not) contain. This fixture
 * runs a real TURN server (the `node-turn` RFC 5389/5766 implementation) on
 * localhost so both credential modes can be exercised end to end:
 *
 *   * static mode  — start with TURN_USER/TURN_PASS and point the backend at it
 *     with SIH_TURN_USERNAME/SIH_TURN_CREDENTIAL.
 *   * ephemeral mode — start with TURN_SECRET. The server then *independently*
 *     computes the coturn REST credential for every username of the form
 *     "<expiry>:<user-id>" and rejects anything that does not match. If the
 *     app's credential derivation were wrong, authentication would fail and no
 *     relay candidate would be produced.
 *
 * It is a **test fixture**, not a production TURN server: it is single-process,
 * unauthenticated over plain UDP, and has no TLS. Production must run coturn (or
 * a managed TURN service) with TLS + long-lived/secret credentials.
 *
 * Usage:
 *   npm install --no-save node-turn
 *   TURN_SECRET=<random> node backend/tests/webrtc/local_turn_ephemeral.mjs
 *   # or static:
 *   TURN_USER=user TURN_PASS=pass node backend/tests/webrtc/local_turn_ephemeral.mjs
 */
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let Turn;
try {
  Turn = require("node-turn");
} catch (err) {
  console.error("SKIPPED: node-turn is not installed — `npm install --no-save node-turn`");
  process.exit(2);
}

const port = Number(process.env.TURN_PORT || 3478);
const secret = process.env.TURN_SECRET || "";
const staticUser = process.env.TURN_USER || "";
const staticPass = process.env.TURN_PASS || "";
const useEphemeral = secret.length > 0;

if (!useEphemeral && !(staticUser && staticPass)) {
  console.error("Set either TURN_SECRET (ephemeral/coturn REST mode) or TURN_USER + TURN_PASS (static mode).");
  process.exit(2);
}

const server = new Turn({
  authMech: "long-term",
  realm: "pashu-mitra.test",
  credentials: useEphemeral ? {} : { [staticUser]: staticPass },
  listeningPort: port,
  listeningIps: ["0.0.0.0"],
  relayIps: ["127.0.0.1"],
  debugLevel: process.env.TURN_DEBUG || "OFF",
  debug: (message) => { if (process.env.TURN_DEBUG === "1") console.log("[turn]", message); },
});

if (useEphemeral) {
  // Independent implementation of the coturn REST formula. Any username the app
  // mints is accepted only when its credential matches this computation.
  const restCredential = (username) => createHmac("sha1", secret).update(username).digest("base64");
  const isRestUsername = (username) => typeof username === "string" && /^\d+:\d+$/.test(username);
  const store = server.authentification.credentials;
  server.authentification.credentials = new Proxy(store, {
    get(target, prop) {
      if (typeof prop === "string" && !(prop in target) && isRestUsername(prop)) return restCredential(prop);
      return target[prop];
    },
    set(target, prop, value) { target[prop] = value; return true; },
    has(target, prop) { return (typeof prop === "string" && isRestUsername(prop)) || prop in target; },
  });
}

server.start();
console.log(`local TURN fixture listening on udp 0.0.0.0:${port} (auth: ${useEphemeral ? "coturn REST secret" : "static credentials"})`);
process.on("SIGTERM", () => { server.stop(); process.exit(0); });
process.on("SIGINT", () => { server.stop(); process.exit(0); });
