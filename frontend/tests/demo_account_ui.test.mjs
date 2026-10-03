/**
 * Frontend checks for the prototype Demo Account on the farmer login screen.
 *
 *   node --test frontend/tests/
 *
 * loads frontend/app.js inside a sandboxed VM context with a small DOM stub
 * that records event listeners, then asserts:
 *   - the Demo Account section shows the configured phone number and OTP
 *   - the "Use Demo Account" button fills the demo number into the login form
 *   - nothing is shown when the backend reports demo mode as disabled
 *   - clicking the button only types a number: it never mints or stores a
 *     session, so the browser can never grant itself a farmer login
 *   - vet / govt / lab screens are untouched
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(here, "..", "app.js"), "utf8");

const DEMO_MOBILE = "8341564042";
const DEMO_OTP = "123456";

// The payload GET /api/auth/farmer/config returns while DEMO_MODE is on.
const DEMO_CONFIG_ON = {
  otp_login_enabled: true,
  otp_length: 6,
  signup_enabled: true,
  password_login_enabled: false,
  helpline: "7382210251",
  demo: { enabled: true, mobile: DEMO_MOBILE, otp: DEMO_OTP, fixed_code: true },
};
// ...and while it is off (the production default).
const DEMO_CONFIG_OFF = {
  otp_login_enabled: true,
  otp_length: 6,
  signup_enabled: true,
  password_login_enabled: false,
  helpline: "7382210251",
  demo: { enabled: false },
};

function makeStorage() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

// A DOM stub that is just real enough to click a button and read a field.
function loadApp() {
  const storage = makeStorage();
  const elements = new Map();
  const element = () => {
    const listeners = new Map();
    return {
      hidden: false, disabled: false, value: "", textContent: "", innerHTML: "",
      className: "", readOnly: false, focused: false,
      dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      focus() { this.focused = true; },
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      removeEventListener() {},
      click() {
        for (const handler of listeners.get("click") || []) handler({ preventDefault() {} });
      },
      dispatch(type) {
        for (const handler of listeners.get(type) || []) handler({ preventDefault() {} });
      },
      listeners,
      querySelectorAll: () => [],
    };
  };
  const requests = [];
  let fetchHandler = () => Promise.reject(new Error("network not stubbed"));
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: (url, options = {}) => {
      requests.push({ url, options });
      return fetchHandler(url, options);
    },
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
    requests,
    setFetch: (handler) => { fetchHandler = handler; },
    el: (id) => sandbox.document.getElementById(id),
    run: (expression) => vm.runInContext(expression, context),
  };
}

/** Put the farmer login screen on the page with a given backend config. */
function openFarmerLogin(app, config) {
  app.run(`farmerAuthConfig = ${JSON.stringify(config)}`);
  app.run('location.hash = "#/login/owner"');
  app.run('renderAuth("login", "owner")');
  app.run("renderFarmerDemoAccount()");
}

const app = loadApp();
const I18N = app.run("I18N");
const DEMO_REQUIRED_KEYS = [
  "farmer.demo_account_title", "farmer.demo_phone_label", "farmer.demo_otp_label",
  "farmer.demo_use_button", "farmer.demo_filled", "farmer.demo_no_sms", "farmer.demo_welcome",
];

// ---------------------------------------------------------------------------
// 1. the credentials are on the screen
// ---------------------------------------------------------------------------
test("the farmer login screen shows the demo phone number and OTP", () => {
  openFarmerLogin(app, DEMO_CONFIG_ON);
  const html = app.el("farmerDemoAccountSlot").innerHTML;

  assert.match(html, /id="farmerDemoAccount"/, "the demo box must be mounted");
  assert.match(html, /Demo Account/, "the box must be clearly labelled");
  assert.match(html, new RegExp(DEMO_MOBILE), "the demo phone number must be visible");
  assert.match(html, new RegExp(DEMO_OTP), "the demo OTP must be visible");
  // The two documented labels from the brief.
  assert.match(html, /Phone Number/);
  assert.match(html, /Demo OTP/);
  // It sits on the OTP login form, not on some other page.
  const page = app.el("app").innerHTML;
  assert.match(page, /id="farmerOtpForm"/);
  assert.match(page, /id="otpMobile"/);
  assert.match(page, /id="farmerDemoAccountSlot"/);
  // Still a password-free farmer screen.
  assert.doesNotMatch(page, /type="password"/);
});

test("the demo box is localised in en, mr, hi and te", () => {
  for (const lang of ["en", "mr", "hi", "te"]) {
    for (const key of DEMO_REQUIRED_KEYS) {
      assert.equal(typeof I18N[lang][key], "string", `${lang} missing ${key}`);
      assert.ok(I18N[lang][key].length > 0, `${lang}.${key} is empty`);
    }
  }
  assert.equal(I18N.en["farmer.demo_account_title"], "Demo Account");
  assert.match(I18N.en["farmer.demo_otp_label"], /^Demo OTP$/);
});

// ---------------------------------------------------------------------------
// 2. the Use Demo Account button fills the number
// ---------------------------------------------------------------------------
test("Use Demo Account fills the demo number into the farmer login form", () => {
  const fresh = loadApp();
  openFarmerLogin(fresh, DEMO_CONFIG_ON);

  const button = fresh.el("otpUseDemoBtn");
  assert.ok(button, "the Use Demo Account button must exist");
  assert.match(fresh.el("farmerDemoAccountSlot").innerHTML, /Use Demo Account/);
  assert.equal(button.listeners.get("click").length, 1, "the button must be wired once");

  // The farmer types their own number first; the button replaces it.
  fresh.el("otpMobile").value = "9800000001";
  button.click();

  assert.equal(fresh.el("otpMobile").value, DEMO_MOBILE,
    "the button must fill the demo phone number into the login form");
  assert.equal(fresh.run("farmerOtpState.mobile"), "",
    "filling the field must not submit anything by itself");
  assert.equal(fresh.el("toast").textContent, I18N.en["farmer.demo_filled"]);
});

test("the demo button is keyboard- and screen-reader reachable", () => {
  openFarmerLogin(app, DEMO_CONFIG_ON);
  const html = app.el("farmerDemoAccountSlot").innerHTML;
  assert.match(html, /<button[^>]*type="button"/, "must be a real button, not a link");
  assert.match(html, /id="otpUseDemoBtn"/);
  // The credentials are plain text, so they can be read aloud on a projector.
  assert.doesNotMatch(html, /aria-hidden/);
});

// ---------------------------------------------------------------------------
// 3. nothing is advertised unless the backend enables demo mode
// ---------------------------------------------------------------------------
test("no demo box when the backend reports demo mode as disabled", () => {
  const fresh = loadApp();
  openFarmerLogin(fresh, DEMO_CONFIG_OFF);
  const slot = fresh.el("farmerDemoAccountSlot");
  assert.equal(slot.innerHTML, "", "the box must not render when demo mode is off");
  assert.equal(slot.hidden, true);
  assert.doesNotMatch(fresh.el("app").innerHTML, /id="farmerDemoAccount"/);
  assert.doesNotMatch(fresh.el("app").innerHTML, new RegExp(DEMO_OTP));
  assert.equal(fresh.el("otpUseDemoBtn").listeners.size, 0,
    "no click handler may be wired when demo mode is off");
});

test("an incomplete demo config is hidden instead of using duplicate frontend credentials", () => {
  const fresh = loadApp();
  openFarmerLogin(fresh, { ...DEMO_CONFIG_ON, demo: { enabled: true } });
  assert.equal(fresh.el("farmerDemoAccountSlot").innerHTML, "");
  assert.equal(fresh.el("farmerDemoAccountSlot").hidden, true);
  assert.doesNotMatch(fresh.el("app").innerHTML, new RegExp(DEMO_MOBILE));
  assert.doesNotMatch(fresh.el("app").innerHTML, new RegExp(DEMO_OTP));
});

test("the screen cannot grant itself a session from the demo credentials", () => {
  const fresh = loadApp();
  openFarmerLogin(fresh, DEMO_CONFIG_ON);
  // The login screen legitimately fetches its public config on mount; what
  // matters is that clicking the demo button adds no further traffic.
  const before = fresh.requests.length;
  fresh.el("otpUseDemoBtn").click();
  // Filling a field is all that happens: no token, no user, no API call.
  assert.equal(fresh.requests.length, before, "the button must not call any endpoint");
  assert.equal(fresh.storage.store.has("token"), false);
  assert.equal(fresh.storage.store.has("user"), false);
  assert.equal(fresh.run("state.token"), null);
  assert.equal(fresh.run("state.user"), null);
  // The OTP is still typed and verified through the normal endpoints.
  assert.match(appSource, /api\("\/auth\/farmer\/verify-otp"/);
  assert.match(appSource, /queueOffline: false, \/\/ never claim an SMS that was not dispatched/);
});

test("successful demo verification stores the Farmer session and opens its dashboard", async () => {
  const fresh = loadApp();
  openFarmerLogin(fresh, DEMO_CONFIG_ON);
  fresh.run(`farmerOtpState.mobile = "${DEMO_MOBILE}"`);
  fresh.el("otpCode").value = DEMO_OTP;

  let verifyRequest;
  fresh.setFetch(async (url, options) => {
    verifyRequest = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        token: "test-farmer-session-token",
        user: { id: 42, role: "owner", full_name: "Demo Farmer", mobile: DEMO_MOBILE },
        login_method: "otp",
        demo: true,
      }),
    };
  });

  await fresh.run("farmerVerifyOtp()");
  assert.equal(verifyRequest.url, "/api/auth/farmer/verify-otp");
  assert.deepEqual(JSON.parse(verifyRequest.options.body), { mobile: DEMO_MOBILE, otp: DEMO_OTP });
  assert.equal(fresh.storage.getItem("token"), "test-farmer-session-token");
  assert.equal(JSON.parse(fresh.storage.getItem("user")).role, "owner");
  assert.equal(fresh.run("location.hash"), "#/owner/dashboard");
});

test("the demo credentials are read from the server config, not hardcoded into the markup", () => {
  // The rendered values follow /api/auth/farmer/config, so an operator can
  // change the number or the code without touching the frontend.
  const fresh = loadApp();
  openFarmerLogin(fresh, {
    ...DEMO_CONFIG_ON,
    demo: { enabled: true, mobile: "8888888888", otp: "654321" },
  });
  const html = fresh.el("farmerDemoAccountSlot").innerHTML;
  assert.match(html, /8888888888/);
  assert.doesNotMatch(html, new RegExp(DEMO_OTP));
  fresh.el("otpUseDemoBtn").click();
  assert.equal(fresh.el("otpMobile").value, "8888888888");
});

// ---------------------------------------------------------------------------
// 4. role isolation and no secret persistence
// ---------------------------------------------------------------------------
test("vet, govt and lab screens never show the farmer demo account", () => {
  const fresh = loadApp();
  fresh.run(`farmerAuthConfig = ${JSON.stringify(DEMO_CONFIG_ON)}`);
  for (const role of ["vet", "govt", "lab"]) {
    fresh.run(`renderAuth("login", "${role}")`);
    const html = fresh.el("app").innerHTML;
    assert.doesNotMatch(html, /id="farmerDemoAccount"/, role);
    assert.doesNotMatch(html, /Use Demo Account/, role);
    assert.doesNotMatch(html, new RegExp(DEMO_MOBILE), role);
    assert.doesNotMatch(html, new RegExp(DEMO_OTP), role);
    // Their original password login is unchanged.
    assert.match(html, /name="password"/, role);
    assert.match(html, /name="identifier"/, role);
    // ...and the staff demo box still shows its own username/password.
    assert.match(html, /class="demo-box"/, role);
  }
});

test("the farmer signup screen shows the same demo box", () => {
  const fresh = loadApp();
  fresh.run(`farmerAuthConfig = ${JSON.stringify(DEMO_CONFIG_ON)}`);
  fresh.run('location.hash = "#/register/owner"');
  fresh.run('renderAuth("register", "owner")');
  fresh.run("renderFarmerDemoAccount()");
  const html = fresh.el("farmerDemoAccountSlot").innerHTML;
  assert.match(html, new RegExp(DEMO_MOBILE));
  assert.match(html, new RegExp(DEMO_OTP));
  assert.doesNotMatch(fresh.el("app").innerHTML, /type="password"/);
});

test("the demo OTP is never persisted in the browser", () => {
  for (const write of appSource.match(/localStorage\.setItem\([^)]*\)/g) || []) {
    assert.doesNotMatch(write, /otp|demo/i, `unexpected persistence: ${write}`);
  }
  const state = app.run("farmerOtpState");
  assert.ok(!("code" in state) && !("otp" in state),
    "the OTP value must never be held in app state");
});

test("the demo note never claims that an SMS was sent", () => {
  // The server marks the demo response explicitly; the screen must not fall
  // back to the conditional "an OTP has been sent" wording for it.
  const handler = appSource.slice(appSource.indexOf("async function farmerRequestOtp"),
    appSource.indexOf("async function farmerVerifyOtp")).replace(/\/\/[^\n]*/g, "");
  assert.match(handler, /data\.demo/);
  assert.match(handler, /ft\("demo_no_sms"\)/);
  for (const lang of ["en", "mr", "hi", "te"]) {
    assert.doesNotMatch(I18N[lang]["farmer.demo_no_sms"], /SMS (has been |was )?sent/i,
      `${lang}.demo_no_sms must not claim a delivery`);
  }
});
