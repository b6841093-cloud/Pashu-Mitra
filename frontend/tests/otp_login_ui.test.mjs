/**
 * Frontend checks for the farmer OTP login screen.
 *
 *   node --test frontend/tests/
 *
 * loads frontend/app.js inside a sandboxed VM context with a minimal DOM stub,
 * then asserts the OTP UI contract:
 *   - the new localisation keys exist in English, Marathi, Hindi and Telugu
 *   - the farmer login screen renders the OTP controls (and no password field)
 *   - the OTP flow calls the OTP API endpoints
 *   - OTP requests are never queued for offline sync
 *   - the OTP comment/state is never written to localStorage
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "..", "app.js"), "utf8");

function makeStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

function loadApp() {
  const storage = makeStorage();
  const elements = new Map();
  const element = () => ({
    hidden: false, disabled: false, value: "", textContent: "", innerHTML: "",
    dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    focus() {}, addEventListener() {}, removeEventListener() {},
    querySelectorAll: () => [],
  });
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error("fetch not stubbed in this test")),
    localStorage: storage,
    navigator: { onLine: true, serviceWorker: undefined },
    location: { hash: "#/", origin: "http://localhost", host: "localhost" },
    document: {
      documentElement: {},
      body: { classList: { toggle() {}, add() {}, remove() {} } },
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      createElement: element,
    },
    window: { addEventListener() {}, scrollTo() {}, scrollY: 0 },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(appSource, context, { filename: "app.js" });
  return {
    context,
    storage,
    run: (expression) => vm.runInContext(expression, context),
  };
}

const app = loadApp();
const I18N = app.run("I18N");

test("localisation: every OTP key exists in en, mr, hi and te", () => {
  const required = [
    "farmer.otp_title", "farmer.otp_mobile_label", "farmer.otp_mobile_hint",
    "farmer.otp_mobile_placeholder", "farmer.send_otp", "farmer.sending_otp",
    "farmer.enter_otp", "farmer.otp_placeholder", "farmer.verify_and_login",
    "farmer.verifying_otp", "farmer.resend_otp", "farmer.resending_otp",
    "farmer.resend_in", "farmer.resend_ready", "farmer.change_mobile",
    "farmer.otp_sent", "farmer.otp_resent", "farmer.otp_invalid_mobile",
    "farmer.otp_invalid_code", "farmer.otp_invalid", "farmer.otp_expired",
    "farmer.otp_locked", "farmer.otp_used", "farmer.otp_cooldown",
    "farmer.otp_rate_limited", "farmer.otp_unavailable", "farmer.otp_send_failed",
    "farmer.password_login_link", "farmer.otp_login_link", "farmer.demo_mobile",
  ];
  for (const lang of ["en", "mr", "hi", "te"]) {
    assert.ok(I18N[lang], `missing language block: ${lang}`);
    for (const key of required) {
      assert.equal(typeof I18N[lang][key], "string", `${lang} missing ${key}`);
      assert.ok(I18N[lang][key].length > 0, `${lang}.${key} is empty`);
    }
  }
});

test("farmer OTP form renders the required controls", () => {
  const html = app.run("farmerOtpLoginForm()");
  assert.match(html, /id="farmerOtpForm"/);
  assert.match(html, /id="otpMobile"/);
  assert.match(html, /id="otpSendBtn"/);
  assert.match(html, /id="otpCode"/);
  assert.match(html, /id="otpVerifyBtn"/);
  assert.match(html, /id="otpResendBtn"/);
  assert.match(html, /id="otpResendHint"/);
  assert.match(html, /id="otpChangeMobile"/);
  // A 10-digit mobile entry and a six-digit, one-time-code OTP input.
  assert.match(html, /maxlength="10"/);
  assert.match(html, /maxlength="6"/);
  assert.match(html, /autocomplete="one-time-code"/);
  // The farmer OTP screen must not contain a password input.
  assert.doesNotMatch(html, /type="password"/);
});

test("farmer password fallback form is still available", () => {
  const html = app.run('loginForm("owner", { farmerPasswordFallback: true })');
  assert.match(html, /name="password"/);
  assert.match(html, /id="farmerOtpLink"/);
});

test("vet, govt and lab login forms keep the password flow", () => {
  for (const role of ["vet", "govt", "lab"]) {
    const html = app.run(`loginForm("${role}")`);
    assert.match(html, /name="identifier"/, role);
    assert.match(html, /name="password"/, role);
    assert.doesNotMatch(html, /id="otpCode"/, role);
  }
});

test("OTP endpoints are wired and never queued offline", () => {
  for (const endpoint of ["/auth/farmer/request-otp", "/auth/farmer/resend-otp", "/auth/farmer/verify-otp"]) {
    const marker = `"${endpoint}"`;
    const index = appSource.indexOf(marker);
    assert.ok(index > -1, `app.js must call ${endpoint}`);
    const callSite = appSource.slice(index, index + 420);
    assert.match(callSite, /method: "POST"/, `${endpoint} must be a POST`);
    assert.match(callSite, /queueOffline: false/, `${endpoint} must never be queued offline`);
  }
  // A farmer typing a wrong OTP must not be logged out by the 401 handler.
  assert.match(appSource, /path\.startsWith\("\/auth\/farmer\/"\)/, "401 must not force logout during OTP login");
});

test("OTP secrets are never persisted in the browser", () => {
  const storageWrites = appSource.match(/localStorage\.setItem\([^)]*\)/g) || [];
  assert.ok(storageWrites.length > 0, "expected at least the auth token write");
  for (const write of storageWrites) {
    assert.doesNotMatch(write, /otp/i, `unexpected OTP persistence: ${write}`);
  }
  const state = app.run("farmerOtpState");
  assert.equal(typeof state.mobile, "string");
  assert.ok(!("code" in state) && !("otp" in state), "the OTP value must never be held in app state");
});

test("cooldown countdown formats and restores from an absolute deadline", () => {
  const remaining = app.run("(farmerOtpState.cooldownUntil = Date.now() + 45000, remainingFarmerOtpCooldown())");
  assert.ok(remaining > 40 && remaining <= 45, `unexpected remaining: ${remaining}`);
  app.run("stopFarmerOtpCooldown()");
  assert.equal(app.run("remainingFarmerOtpCooldown()"), 0);
  assert.equal(app.run("farmerOtpState.sent"), false);
});

test("error codes map to localised farmer messages", () => {
  const mapping = app.run("OTP_ERROR_KEYS");
  for (const code of ["INVALID_MOBILE", "OTP_INVALID", "OTP_EXPIRED", "OTP_LOCKED",
    "OTP_ALREADY_USED", "COOLDOWN_ACTIVE", "RATE_LIMITED", "SMS_GATEWAY_NOT_CONFIGURED",
    "SMS_GATEWAY_UNAVAILABLE"]) {
    assert.ok(mapping[code], `no UI message mapped for ${code}`);
    assert.equal(typeof I18N.en[`farmer.${mapping[code]}`], "string");
  }
});
