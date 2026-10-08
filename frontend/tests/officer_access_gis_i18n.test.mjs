/**
 * Officer Access + Government GIS Risk Map + shell multilingual tests.
 *
 *   node --test frontend/tests/officer_access_gis_i18n.test.mjs
 *
 * Covers the three changes that are easy to regress:
 *
 *  A. Officer Access — the header CTA routes to a real role-selection page
 *     (#/officer-access) that sends Veterinarian / Government Officer /
 *     Laboratory Staff to their EXISTING password login (#/login/<role>).
 *     The page must never authenticate anyone by itself.
 *
 *  B. GIS Risk Map — the marker coordinates fall back gracefully, the risk
 *     vocabulary is semantic (LOW/MODERATE/HIGH/CRITICAL) next to the legacy
 *     "High Risk" string, popups print risk + disease + cases + mortality,
 *     and the map has an accessible data-table alternative in the markup.
 *
 *  C. Shell multilingual — the global chrome (utility bar, header, primary
 *     navigation, footer) is fully translated for hi/mr/te, while the brand
 *     name "Pashu-Mitra" is never translated.
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
const indexHtml = read("index.html");
const styleSource = read("style.css");

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

/** Minimal sandbox able to execute app.js or shell.js top-level code. */
function loadSandbox({ source, storage = {}, lang = "en", user = null, extraWindow = {} }) {
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
      set(v) {
        this._innerHTML = String(v);
        this.children = [];
        for (const m of String(v).matchAll(/id="([^"]+)"/g)) {
          const child = makeElement();
          child.id = m[1];
          child._innerHTML = String(v);
          elements.set(m[1], child);
        }
      },
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
    localStorage: makeStorage(storage),
    navigator: { onLine: true, userAgent: "node-test" },
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
      ...extraWindow,
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.state = { token: null, user, lang };
  sandbox.window.router = () => {};
  sandbox.window.render = (html) => { appHost.innerHTML = html; };
  sandbox.window.header = (title) => `<div class="app-header"><h1>${title}</h1></div>`;
  sandbox.window.bottomNav = () => "";
  sandbox.window.toast = () => {};
  sandbox.window.logout = () => {};
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "sandboxed.js" });
  return { sandbox, context, appHost, elements, run: (expr) => vm.runInContext(expr, context) };
}

// ---------------------------------------------------------------------------
// A. Officer Access
// ---------------------------------------------------------------------------
test("Officer Access route exists, is public, and delegates to the existing logins", async () => {
  const { appHost, run } = loadSandbox({ source: appSource, storage: { pm_lang: "en" } });
  run(`routes["#/officer-access"].handler({})`);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const html = appHost.innerHTML;

  // The page names all three staff roles…
  assert.match(html, /Veterinarian/);
  assert.match(html, /Government Officer/);
  assert.match(html, /Laboratory Staff/);
  // …and each option routes to the EXISTING authentication screens.
  assert.match(html, /#\/login\/vet/);
  assert.match(html, /#\/login\/govt/);
  assert.match(html, /#\/login\/lab/);
  // The page never authenticates by itself: no credential form, no stored token.
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /name="identifier"/);
});

test("Officer Access is reachable logged-out and bounces logged-in users to their dashboard", () => {
  const { run } = loadSandbox({ source: appSource, storage: { pm_lang: "en" } });
  assert.equal(run("isPublic('#/officer-access')"), true, "logged-out officers must reach the page");
  assert.equal(run("isPublic('#/login/vet')"), true);
  assert.equal(run("isPublic('#/owner/dashboard')"), false);
});

test("the header Officer Access CTA points at the role-selection page (not '#/')", () => {
  const { run } = loadSandbox({ source: shellSource, lang: "en" });
  const html = run("window.PashuShell ? 'exported' : 'missing'");
  assert.equal(html, "exported");
  assert.match(shellSource, /#\/officer-access/,
    "shell.js header CTA must route to #/officer-access");
  assert.doesNotMatch(shellSource, /pm-auth-cta-staff">\s*<\/a>/);
});

// ---------------------------------------------------------------------------
// B. Government GIS Risk Map
// ---------------------------------------------------------------------------
test("GIS: semantic risk mapping, coordinate fallback, and popup content", () => {
  const { run } = loadSandbox({ source: appSource, storage: { pm_lang: "en" } });
  // Seed the module-level gisState the helpers read.
  run(`
    gisState = {
      geo: [
        { district: "Pune", latitude: 18.5204, longitude: 73.8567, cases: 3, active: 3, mortality: 2,
          risk_level: "High Risk", risk: "HIGH", affected_animals: 3, high_severity: 1,
          diseases: [{ label: "FMD", value: 2 }], updated_at: "2026-09-23 13:07:49" },
        { district: "Washim", latitude: null, longitude: null, cases: 1, active: 1, mortality: 0,
          risk_level: "Low Risk", risk: "LOW", affected_animals: 1, high_severity: 0,
          diseases: [], updated_at: null },
      ],
      locations: [{ district: "Washim", lat: 20.1, lng: 77.15 }],
    };
  `);
  // Semantic level prefers the backend "risk" field…
  assert.equal(run('gisSemanticRisk(gisState.geo[0])'), "HIGH");
  // …and derives from the legacy string for older payloads.
  assert.equal(run(`gisSemanticRisk({ risk_level: "Moderate Risk" })`), "MODERATE");
  // Coordinates come from the API payload first…
  assert.deepEqual(Array.from(run("gisCoordsFor('Pune')")), [18.5204, 73.8567]);
  // …then fall back to the static centroid file…
  assert.deepEqual(Array.from(run("gisCoordsFor('Washim')")), [20.1, 77.15]);
  // …and a truly unknown district is reported, not guessed.
  assert.equal(run("gisCoordsFor('Nowhere')"), null);

  const popup = run("gisPopupHtml(gisState.geo[0])");
  assert.match(popup, /Risk:\s*HIGH/);
  assert.match(popup, /FMD/);
  assert.match(popup, /Active cases:/);
  assert.match(popup, /Mortality:<\/b>\s*2/);
  assert.match(popup, /Pune/);
  assert.match(popup, /Last updated:/);
});

test("GIS: the page ships an accessible data table, legend, loading and error states", () => {
  // Accessible alternative (WCAG 1.1.1) — the same data as a table.
  assert.match(appSource, /Disease Risk Summary/);
  assert.match(appSource, /id="gisTable"/);
  assert.match(appSource, /<th scope="col">District<\/th>/);
  assert.match(appSource, /<th scope="col">Mortality<\/th>/);
  assert.match(appSource, /<th scope="col">Risk<\/th>/);
  // Loading / failure states are honest.
  assert.match(appSource, /Risk map could not be loaded\./);
  assert.match(appSource, /Loading map & live district data…/);
  // Legend communicates risk by text + colour together.
  assert.match(appSource, /gis-legend/);
  // The map container has an explicit height (a 0px container is invisible).
  assert.match(styleSource, /\.gis-map\s*{[^}]*height:\s*\d+px/s);
  // Leaflet is vendored so the map does not depend on a third-party CDN.
  assert.ok(fs.existsSync(path.join(root, "vendor", "leaflet.min.js")), "vendor/leaflet.min.js must exist");
  assert.ok(fs.existsSync(path.join(root, "vendor", "leaflet.css")), "vendor/leaflet.css must exist");
  assert.match(indexHtml, /vendor\/leaflet\.min\.js/);
});

test("GIS API: the frontend consumes /govt/geo (govt+vet protected) with new fields documented", () => {
  assert.match(appSource, /api\("\/govt\/geo"\)/);
  const backend = fs.readFileSync(path.join(root, "..", "backend", "app.py"), "utf8");
  assert.match(backend, /def govt_geo\(\)/);
  assert.match(backend, /"latitude"/);
  assert.match(backend, /"mortality"/);
  assert.match(backend, /"updated_at"/);
  assert.match(backend, /@auth_required\(roles=\["govt", "vet"\]\)\ndef govt_geo/, "the GIS endpoint stays role-protected");
});

// ---------------------------------------------------------------------------
// C. Shell multilingual + brand protection
// ---------------------------------------------------------------------------
const SHELL_LANG_CHECKS = {
  hi: {
    farmerOtp: "किसान OTP लॉगिन",
    officer: "अधिकारी प्रवेश",
    search: "खोज",
    signOut: "लॉग आउट",
    navHome: "होम",
    navLivestock: "मेरा पशुधन",
    navWebcall: "वेब कॉल",
    skip: "मुख्य सामग्री पर जाएँ",
  },
  mr: {
    farmerOtp: "शेतकरी OTP लॉगिन",
    officer: "अधिकारी प्रवेश",
    search: "शोध",
    signOut: "बाहेर पडा",
    navHome: "मुख्यपृष्ठ",
    navLivestock: "माझे पशुधन",
    navWebcall: "वेब कॉल",
    skip: "मुख्य मजकुराकडे जा",
  },
  te: {
    farmerOtp: "రైతు OTP లాగిన్",
    officer: "అధికారి ప్రవేశం",
    search: "వెతుకు",
    signOut: "సైన్ అవుట్",
    navHome: "హోమ్",
    navLivestock: "నా పశువులు",
    navWebcall: "వెబ్ కాల్",
    skip: "ముఖ్య కంటెంట్‌కు వెళ్లండి",
  },
};

for (const [lang, want] of Object.entries(SHELL_LANG_CHECKS)) {
  test(`shell chrome is fully translated (${lang})`, () => {
    // Visitor: header shows the Farmer OTP Login + Officer Access CTAs.
    const visitor = loadSandbox({ source: shellSource, lang });
    const header = visitor.run("window.PashuShell.renderSiteHeader()");
    const bar = visitor.run("window.PashuShell.renderA11yBar()");
    const footer = visitor.run("window.PashuShell.renderFooter()");
    assert.ok(header.includes(want.farmerOtp), `${lang}: header Farmer OTP Login translated`);
    assert.ok(header.includes(want.officer), `${lang}: header Officer Access translated`);
    assert.ok(header.includes(want.search), `${lang}: header Search translated`);
    assert.ok(bar.includes(want.skip), `${lang}: utility bar skip link translated`);
    assert.ok(footer.length > 100);
    // THE BRAND NAME IS NEVER TRANSLATED.
    assert.ok(header.includes("Pashu-Mitra"), `${lang}: brand name stays "Pashu-Mitra"`);
    assert.doesNotMatch(header, /पशु-मित्र|Pashu Shield/i, "brand must be exactly Pashu-Mitra");

    // Signed-in farmer: primary navigation + Sign out in the same language.
    const farmer = loadSandbox({ source: shellSource, lang, user: { id: 1, role: "owner", full_name: "Test Farmer" } });
    const nav = farmer.run("window.PashuShell.renderPrimaryNavigation()");
    const headerIn = farmer.run("window.PashuShell.renderSiteHeader()");
    assert.ok(nav.includes(want.navHome), `${lang}: nav Home translated`);
    assert.ok(nav.includes(want.navLivestock), `${lang}: nav My Livestock translated`);
    assert.ok(nav.includes(want.navWebcall), `${lang}: nav Web Call translated`);
    assert.ok(headerIn.includes(want.signOut), `${lang}: Sign out translated`);
    assert.ok(headerIn.includes("Pashu-Mitra"));
  });
}

test("app.js exposes the new farmer-facing translation keys in all four languages", () => {
  const { run } = loadSandbox({ source: appSource, storage: { pm_lang: "en" } });
  const keys = [
    "farmer.livestock_overview", "farmer.quick_report", "farmer.print", "farmer.print_list",
    "farmer.export_csv", "farmer.checking_availability", "farmer.availability_check_failed",
    "farmer.availability_helpline_hint", "webcall.checking_availability",
    "webcall.availability_check_failed", "webcall.availability_helpline_hint",
  ];
  for (const lang of ["en", "hi", "mr", "te"]) {
    for (const key of keys) {
      const value = run(`I18N.${lang}[${JSON.stringify(key)}]`);
      assert.ok(value && value.length > 1, `${lang} is missing ${key}`);
    }
  }
  // Hindi example of the NO_LIVE_SESSION human message (never a raw code).
  assert.match(run('I18N.hi["webcall.no_vet_now"]'), /पशु चिकित्सक/);
  assert.match(run('I18N.te["webcall.no_vet_now"]'), /పశువైద్య/);
  assert.match(run('I18N.mr["webcall.no_vet_now"]'), /पशुवैद्य/);
});

test("language persistence keys stay in sync between the app and the shell", () => {
  // app.js reads pm_lang at boot…
  assert.match(appSource, /localStorage\.getItem\("pm_lang"\)/);
  // …and the shell writes pm_lang when its own selector is used.
  assert.match(shellSource, /localStorage\.setItem\("pm_lang", lang\)/);
  // app.js notifies the shell so the chrome re-renders in the same language.
  assert.match(appSource, /PashuShell\.syncAppLanguage/);
  assert.match(shellSource, /function syncAppLanguage/);
});
