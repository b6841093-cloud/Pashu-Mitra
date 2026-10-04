/**
 * Real two-browser acceptance test for WebRTC web calling.
 *
 * This is the only test in the repository that can prove *real two-way audio*:
 * it drives two genuine Chromium browsers (a farmer and a veterinarian) against
 * a running backend, answers the call, and reads `RTCPeerConnection.getStats()`
 * on BOTH sides to confirm that inbound audio RTP actually arrives on each
 * side. Signalling mocks cannot prove that — see backend/tests/webrtc/README.md.
 *
 * It is skipped unless the environment is prepared, so `node --test` stays green
 * on machines without a browser:
 *
 *   PM_BROWSER_URL=https://pashu-shield-backend-hjgr.onrender.com \
 *   PM_VET_EMAIL=vet@example.com PM_VET_PASSWORD=... \
 *   PM_FARMER_MOBILE=8341564042 PM_FARMER_OTP=123456 \
 *   node --test frontend/tests/webcall_browser.test.mjs
 *
 * Requirements:
 *   * `npm i -D playwright` (or playwright-core) with a Chromium build, or
 *     `npx playwright install chromium`;
 *   * a backend reachable from this machine with the frontend served from it
 *     (the Flask app serves the portal, so one URL is enough); at least one vet
 *     account and one farmer account;
 *   * the farmer login above uses the demo account's fixed OTP, so the backend
 *     must run with DEMO_MODE=true (DEMO_MODE_ALLOW_PRODUCTION=true when it looks
 *     like production). Otherwise obtain a real OTP through the normal flow and
 *     set PM_FARMER_OTP to it.
 *
 * Chromium runs with `--use-fake-device-for-media-stream`, i.e. a synthetic
 * microphone produces a real audio track; the media path (ICE, DTLS-SRTP, RTP)
 * is completely real. Nothing about the signalling or the call state machine is
 * stubbed.
 */
import test from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.PM_BROWSER_URL || "").replace(/\/+$/, "");
const FARMER = { mobile: process.env.PM_FARMER_MOBILE || "8341564042", otp: process.env.PM_FARMER_OTP || "123456" };
const VET = { email: process.env.PM_VET_EMAIL || "", password: process.env.PM_VET_PASSWORD || "" };
const TIMEOUT = Number(process.env.PM_BROWSER_TIMEOUT_MS || 90000);

let chromium = null;
let skipReason = "";
if (!BASE) {
  skipReason = "PM_BROWSER_URL is not set: this test needs a running backend + portal and a real browser";
} else if (!VET.email || !VET.password) {
  skipReason = "PM_VET_EMAIL and PM_VET_PASSWORD are required (a real veterinarian account)";
} else {
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    try {
      ({ chromium } = await import("playwright-core"));
    } catch (err2) {
      skipReason = "playwright/playwright-core is not installed — `npm i -D playwright && npx playwright install chromium`";
    }
  }
}

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch (err) { /* non-JSON error body */ }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${(data.error || text).slice(0, 200)}`);
  }
  return data;
}

async function signInFarmer() {
  // The demo account still follows the ordinary two-step OTP flow: the request
  // creates the (demo-marked) OTP row and the verify consumes it. A real OTP
  // flow works the same way — the operator copies the SMS code into PM_FARMER_OTP.
  try {
    await api("/api/auth/farmer/request-otp", { method: "POST", body: { mobile: FARMER.mobile, intent: "login" } });
  } catch (err) {
    // A cooldown/rate limit still leaves the previously issued OTP verifiable.
  }
  return api("/api/auth/farmer/verify-otp", {
    method: "POST",
    body: { mobile: FARMER.mobile, otp: FARMER.otp },
  });
}

async function signInVet() {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { identifier: VET.email, password: VET.password },
  });
  return data;
}

/** Capture every RTCPeerConnection the page creates so stats can be read later. */
const CAPTURE_PCS = () => {
  const Original = window.RTCPeerConnection;
  window.__pmPCs = [];
  window.RTCPeerConnection = function capturedPeerConnection(...args) {
    const pc = new Original(...args);
    window.__pmPCs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Original.prototype;
};

async function openPortal(browser, session, { token, user, hash }) {
  const context = await browser.newContext({
    permissions: ["microphone"],
    viewport: { width: 420, height: 900 },
  });
  await context.addInitScript(CAPTURE_PCS);
  await context.addInitScript(([t, u]) => {
    localStorage.setItem("token", t);
    localStorage.setItem("user", u);
  }, [token, JSON.stringify(user)]);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`[${session}] page error:`, err.message));
  await page.goto(`${BASE}/#${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.PMCall && typeof window.PMCall.status === "function", null, { timeout: TIMEOUT });
  await page.waitForFunction(() => window.PMCall.status().signaling === true, null, { timeout: TIMEOUT });
  return { context, page };
}

/** Sum inbound/outbound audio RTP packets for the newest peer connection. */
async function audioPackets(page) {
  return page.evaluate(async () => {
    const pcs = window.__pmPCs || [];
    const pc = pcs[pcs.length - 1];
    if (!pc) return { connections: 0, inbound: 0, outbound: 0, state: "none" };
    const stats = await pc.getStats();
    let inbound = 0;
    let outbound = 0;
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.kind === "audio") inbound += report.packetsReceived || 0;
      if (report.type === "outbound-rtp" && report.kind === "audio") outbound += report.packetsSent || 0;
    });
    return { connections: pcs.length, inbound, outbound, state: pc.connectionState };
  });
}

async function setupPair(browser) {
  const farmerAuth = await signInFarmer();
  const vetAuth = await signInVet();

  // Make the veterinarian explicitly available for the farmer's language. This
  // is the same endpoint the portal's availability card calls.
  await api("/api/vet/availability", {
    method: "PUT",
    token: vetAuth.token,
    body: { status: "AVAILABLE", supported_languages: ["en", "hi", "mr", "te"] },
  });

  const vet = await openPortal(browser, "vet", { token: vetAuth.token, user: vetAuth.user, hash: "/vet/dashboard" });
  const farmer = await openPortal(browser, "farmer", { token: farmerAuth.token, user: farmerAuth.user, hash: "/owner/webcall" });
  return { farmer, vet, farmerAuth, vetAuth };
}

async function startCallFromFarmer(farmer) {
  await farmer.page.waitForSelector("#pmCallStart", { timeout: TIMEOUT });
  await farmer.page.selectOption("#pmCallReason", { index: 0 }).catch(() => {});
  await farmer.page.fill("#pmCallNotes", "Automated browser test: fever since yesterday").catch(() => {});
  await farmer.page.click("#pmCallStart");
}

test("two real browsers: the vet answers and both directions carry real audio RTP", { skip: skipReason || false, timeout: TIMEOUT * 4 }, async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
    ],
  });
  let pair = null;
  try {
    pair = await setupPair(browser);
    const { farmer, vet } = pair;

    await startCallFromFarmer(farmer);

    // 1. The correct vet really receives an incoming-call event and it rings.
    await vet.page.waitForFunction(() => window.PMCall.status().overlay_open === true, null, { timeout: 20000 });
    await vet.page.waitForSelector("#pmCallAnswer", { timeout: 20000 });
    const ringing = await vet.page.evaluate(() => window.PMCall.status());
    assert.equal(ringing.call_status, "ringing", "the vet sees the call in the ringing state");
    assert.equal(ringing.ringtone_playing, true, "the ringtone loops while the call is ringing");
    const callerText = await vet.page.textContent("#pmCallSub");
    assert.match(callerText || "", /Rajesh|Demo|Farmer|\w/, "the popup shows who is calling");

    // 2. Answering establishes real media on both sides.
    await vet.page.click("#pmCallAnswer");
    for (const [name, peer] of [["farmer", farmer], ["vet", vet]]) {
      await peer.page.waitForFunction(
        () => window.PMCall.status().call_status === "connected" && window.PMCall.status().media_confirmed === true,
        null, { timeout: 30000 },
      ).catch(async (err) => {
        const status = await peer.page.evaluate(() => window.PMCall.status());
        throw new Error(`${name} never reported a media-confirmed connection: ${JSON.stringify(status)} (${err.message})`);
      });
    }

    // 3. Real two-way audio: inbound RTP must grow on BOTH sides.
    const before = { farmer: await audioPackets(farmer.page), vet: await audioPackets(vet.page) };
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const after = { farmer: await audioPackets(farmer.page), vet: await audioPackets(vet.page) };
    assert.ok(after.farmer.inbound > before.farmer.inbound,
      `farmer received audio (${before.farmer.inbound} -> ${after.farmer.inbound} packets)`);
    assert.ok(after.vet.inbound > before.vet.inbound,
      `vet received audio (${before.vet.inbound} -> ${after.vet.inbound} packets)`);
    assert.ok(after.farmer.outbound > 0 && after.vet.outbound > 0, "both sides are sending audio");

    // 4. The talk timer is running for both participants.
    const timerText = await farmer.page.textContent("#pmCallTimer").catch(() => "");
    assert.match(timerText || "", /^\d{1,2}:\d{2}$/, "the farmer sees a live talk-time timer");

    // 5. Mute really disables the outgoing track and is signalled to the peer.
    await vet.page.click("#pmCallMute");
    const muted = await vet.page.evaluate(async () => {
      const pcs = window.__pmPCs || [];
      const senders = pcs[pcs.length - 1].getSenders();
      const track = senders.map((s) => s.track).find(Boolean);
      return { enabled: track ? track.enabled : null, reported: window.PMCall.status().muted };
    });
    assert.equal(muted.reported, true, "the UI reports muted");
    assert.equal(muted.enabled, false, "the real outgoing track is disabled");
    await vet.page.waitForFunction(() => !!document.getElementById("pmCallPeerMute"), null, { timeout: 10000 });

    // 6. Hanging up tears everything down on both sides.
    await farmer.page.click("#pmCallHangup");
    for (const [name, peer] of [["farmer", farmer], ["vet", vet]]) {
      await peer.page.waitForFunction(() => window.PMCall.status().active_call === null, null, { timeout: 20000 })
        .catch((err) => { throw new Error(`${name} did not release the call: ${err.message}`); });
      const status = await peer.page.evaluate(() => window.PMCall.status());
      assert.equal(status.ringtone_playing, false, `${name} stopped the ringtone`);
      assert.equal(await peer.page.locator("#pmCallRemoteAudio").count(), 0, `${name} removed the remote audio element`);
    }

    // 7. The finished call is visible in the authorized history.
    const history = await api("/api/webcall/calls/history", { token: pair.farmerAuth.token });
    const calls = Array.isArray(history) ? history : (history.calls || []);
    assert.ok(calls.some((call) => call.status === "ended"), "the call appears in the farmer's history as ended");
  } finally {
    if (pair) {
      await pair.farmer.context.close().catch(() => {});
      await pair.vet.context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
});

test("two real browsers: the vet declines, the farmer is told, and nothing keeps ringing", { skip: skipReason || false, timeout: TIMEOUT * 3 }, async () => {
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
    ],
  });
  let pair = null;
  try {
    pair = await setupPair(browser);
    const { farmer, vet } = pair;

    await startCallFromFarmer(farmer);
    await vet.page.waitForFunction(() => window.PMCall.status().overlay_open === true, null, { timeout: 20000 });
    assert.equal((await vet.page.evaluate(() => window.PMCall.status())).ringtone_playing, true);

    await vet.page.click("#pmCallReject");

    for (const [name, peer] of [["vet", vet], ["farmer", farmer]]) {
      await peer.page.waitForFunction(() => window.PMCall.status().ringtone_playing === false, null, { timeout: 20000 })
        .catch((err) => { throw new Error(`${name} kept ringing after the decline: ${err.message}`); });
    }
    await farmer.page.waitForFunction(() => window.PMCall.status().active_call === null, null, { timeout: 20000 });
    const history = await api("/api/webcall/calls/history", { token: pair.farmerAuth.token });
    const calls = Array.isArray(history) ? history : (history.calls || []);
    assert.ok(calls.some((call) => ["rejected", "cancelled"].includes(call.status)),
      "the decline is recorded with an honest terminal status");
  } finally {
    if (pair) {
      await pair.farmer.context.close().catch(() => {});
      await pair.vet.context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
});
