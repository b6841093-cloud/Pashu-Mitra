/**
 * Portal names, Farmer Login routing, QR scanner UI, medication history i18n,
 * timestamps and veterinary Disease Info removal.
 *
 *   node --test frontend/tests/animal_qr_medication.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const appSource = read("app.js");
const shellSource = read("shell.js");

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function loadSandbox({ source, storage = {}, lang = "en", user = null } = {}) {
  const elements = new Map();
  function makeElement(tag = "div") {
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
      attributes: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {},
      removeEventListener() {},
      appendChild(child) { this.children.push(child); return child; },
      querySelector: () => null,
      querySelectorAll: () => [],
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k] ?? null; },
    };
    Object.defineProperty(el, "innerHTML", {
      get() { return this._innerHTML; },
      set(v) { this._innerHTML = String(v); },
    });
    return el;
  }
  const appHost = makeElement("div");
  appHost.id = "app";
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: makeStorage({ pm_lang: lang, ...storage }),
    navigator: { onLine: true, userAgent: "node-test", mediaDevices: undefined },
    location: { hash: "#/", origin: "http://localhost:5001", href: "http://localhost:5001/#/", reload() {} },
    history: { back() {} },
    confirm: () => false,
    alert() {},
    prompt: () => null,
    fetch: () => Promise.reject(new Error("no network in test")),
    document: {
      documentElement: { lang: "en", style: { setProperty() {} }, classList: { toggle() {} } },
      body: { classList: { toggle() {}, add() {}, remove() {} } },
      addEventListener() {},
      removeEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => (id === "app" ? appHost : elements.get(id) || null),
      createElement: makeElement,
      title: "",
    },
    window: {
      addEventListener() {},
      scrollTo() {},
      matchMedia: () => ({ matches: false }),
      location: { hash: "#/", origin: "http://localhost:5001", reload() {} },
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
  };
  sandbox.window.state = user ? { token: "t", user, lang } : undefined;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "under-test.js" });
  return { run: (expression) => vm.runInContext(expression, context), sandbox };
}

test("public navigation uses the required English portal labels", () => {
  assert.match(shellSource, /\["#\/home", "Home"/);
  assert.match(shellSource, /\["#\/login\/owner", "Farmer Portal"/);
  assert.match(shellSource, /\["#\/login\/vet", "Veterinary Portal"/);
  assert.match(shellSource, /\["#\/login\/govt", "Government Portal"/);
  assert.match(shellSource, /\["#\/login\/lab", "Laboratory Portal"/);
  assert.doesNotMatch(shellSource, /Veterinary Officer/);
  assert.doesNotMatch(shellSource, /Government Official/);
  assert.doesNotMatch(shellSource, /Diagnostic Laboratory/);
});

test("root route opens Farmer OTP Login and Home remains at #/home", () => {
  assert.match(appSource, /route\("#\/", \(\) => renderAuth\("login", "owner"\)\)/);
  assert.match(appSource, /route\("#\/home", \(\) => renderRoleSelect\(\)\)/);
  assert.match(appSource, /path === "#\/" \|\| path === "#\/home"/);
  assert.match(appSource, /route\("#\/login\/:role"/);
  assert.match(appSource, /route\("#\/officer-access"/);
  assert.match(appSource, /route\("#\/owner\/dashboard"/);
  assert.match(appSource, /route\("#\/vet\/dashboard"/);
  assert.match(appSource, /route\("#\/govt\/dashboard"/);
  assert.match(appSource, /route\("#\/lab\/dashboard"/);
});

test("Disease Info is removed from veterinary dashboard navigation", () => {
  assert.doesNotMatch(appSource, /iconItem\("📖", "Disease Info", "#\/vet\/diseases"\)/);
  // Clinical disease workflows stay available (library API / other portals).
  assert.match(appSource, /diseasesView\("govt"\)/);
});

test("farmer QR scanner route, camera fallback and duplicate-scan lock exist", () => {
  assert.match(appSource, /route\("#\/owner\/scan"/);
  assert.match(appSource, /#\/owner\/scan/);
  assert.match(appSource, /scanLock/);
  assert.match(appSource, /getUserMedia/);
  assert.match(appSource, /camera_denied/);
  assert.match(appSource, /enter_animal_id/);
  assert.match(appSource, /stopCameraScanner/);
  assert.match(appSource, /BarcodeDetector/);
  assert.match(appSource, /manualLookupInput/);
});

test("medication history UI distinguishes event time from record creation", () => {
  assert.match(appSource, /medication_history/);
  assert.match(appSource, /treatment_date/);
  assert.match(appSource, /record_created/);
  assert.match(appSource, /not_vet_diagnosis/);
  assert.match(appSource, /upload_medical_photo/);
  assert.match(appSource, /\/animals\/\$\{a\.id\}\/medications/);
});

test("fmtDate shows time for datetime values and em-dash for missing timestamps", () => {
  const { run } = loadSandbox({ source: appSource, lang: "en" });
  const missing = run("fmtDate(null)");
  assert.equal(missing, "—");
  const dateOnly = run('fmtDate("2026-10-09")');
  assert.match(dateOnly, /09/);
  assert.match(dateOnly, /Oct/);
  assert.match(dateOnly, /2026/);
  const withTime = run('fmtDate("2026-10-09 10:30:00")');
  assert.match(withTime, /2026/);
  assert.match(withTime, /\d{1,2}:\d{2}/);
});

test("new farmer-facing keys exist in all four languages", () => {
  const { run } = loadSandbox({ source: appSource, lang: "en" });
  const keys = [
    "farmer.scan_animal_qr", "farmer.start_scanner", "farmer.stop_scanner",
    "farmer.enter_animal_id", "farmer.upload_medical_photo", "farmer.medication_history",
    "farmer.treatment_date", "farmer.record_created", "farmer.follow_up",
    "farmer.invalid_qr", "farmer.animal_not_found", "farmer.unauthorized_access",
    "farmer.upload_success", "farmer.upload_failure", "ts.created", "ts.updated",
  ];
  for (const lang of ["en", "hi", "mr", "te"]) {
    for (const key of keys) {
      const value = run(`I18N.${lang}[${JSON.stringify(key)}]`);
      assert.ok(value && String(value).length > 1, `${lang} is missing ${key}`);
    }
  }
  assert.equal(run('I18N.en["farmer.scan_animal_qr"]'), "Scan Animal QR");
  assert.equal(run('I18N.en["farmer.app_name"]'), "Pashu-Mitra");
});

test("shell Home item points at the preserved homepage, not Farmer Login", () => {
  const { run } = loadSandbox({ source: shellSource, lang: "en" });
  const nav = run("window.PashuShell.renderPrimaryNavigation()");
  assert.match(nav, /#\/home/);
  assert.match(nav, /Farmer Portal/);
  assert.match(nav, /Veterinary Portal/);
  assert.match(nav, /Government Portal/);
  assert.match(nav, /Laboratory Portal/);
  assert.match(nav, />Home</);
});
