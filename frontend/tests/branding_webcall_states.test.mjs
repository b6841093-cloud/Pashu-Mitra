/**
 * Pashu-Mitra branding + web-call state-honesty tests.
 *
 *   node --test frontend/tests/
 *
 * Covers two change requests that are easy to regress:
 *
 *  A. Branding — the user-facing product name is "Pashu-Mitra" everywhere a
 *     person can see it (titles, headers, login, help text, PWA metadata), the
 *     official logo asset is the single source for every logo location, and no
 *     user-facing "Pashu Shield" string survives. Deployment identifiers that
 *     belong to the running services (Render service names, Vercel project
 *     name, storage keys, env var names) must NOT be renamed — those are
 *     asserted as still present so a future "cleanup" cannot break a deploy.
 *
 *  B. Web-call states — the twelve states are distinguishable by TEXT, the
 *     routing codes the server returns are translated into human wording
 *     ("NO_LIVE_SESSION" is never the sentence a farmer reads), and a browser
 *     whose own Origin the signaling server refuses is told that, instead of
 *     the misleading "signaling offline".
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
const orgSource = read("org-config.js");
const callSource = read("call.js");
const indexHtml = read("index.html");
const manifest = JSON.parse(read("manifest.json"));
const swSource = read("sw.js");

// ---------------------------------------------------------------------------
// A. Branding
// ---------------------------------------------------------------------------
const USER_FACING_SOURCES = [
  ["app.js", appSource],
  ["shell.js", shellSource],
  ["org-config.js", orgSource],
  ["call.js", callSource],
  ["info-pages.js", read("info-pages.js")],
  ["a11y.js", read("a11y.js")],
  ["captcha.js", read("captcha.js")],
  ["index.html", indexHtml],
  ["manifest.json", read("manifest.json")],
  ["sw.js", swSource],
];

test("no user-facing 'Pashu Shield' branding remains in any frontend source", () => {
  const offenders = [];
  for (const [name, source] of USER_FACING_SOURCES) {
    const matches = source.match(/Pashu[\s-]?Shield/gi) || [];
    if (matches.length) offenders.push(`${name}: ${matches.length}`);
  }
  assert.deepEqual(offenders, [], `old branding still present -> ${offenders.join(", ")}`);
});

test("the product name is configured once and used by the shell", () => {
  assert.match(orgSource, /appName:\s*"Pashu-Mitra"/);
  assert.match(orgSource, /appNameLocal:\s*"पशु-मित्र"/);
  // The shell never falls back to the old name.
  assert.doesNotMatch(shellSource, /Pashu[\s-]?Shield/i);
  assert.match(shellSource, /Pashu-Mitra/);
  // Titles and metadata come from ORG.appName, so they cannot drift apart.
  assert.match(shellSource, /window\.ORG\.appName/);
  assert.match(indexHtml, /<title>Pashu-Mitra /);
  assert.match(indexHtml, /content="Pashu-Mitra:/);
  assert.equal(manifest.name.startsWith("Pashu-Mitra"), true);
  assert.equal(manifest.short_name, "Pashu-Mitra");
});

test("the official logo asset is the single source for every logo location", () => {
  assert.match(orgSource, /logo:\s*\{[\s\S]*?src:\s*"assets\/pashu-mitra-logo\.png"/);
  // Browser tab and PWA icons point at the same asset...
  assert.match(indexHtml, /rel="icon"[^>]*assets\/pashu-mitra-logo\.png/);
  assert.match(indexHtml, /rel="apple-touch-icon"[^>]*assets\/pashu-mitra-logo\.png/);
  const iconSources = manifest.icons.map((icon) => icon.src);
  assert.ok(iconSources.includes("assets/pashu-mitra-logo.png"), "manifest must ship the logo");
  // ...and the login/OTP screens render it through the shared helper.
  assert.match(appSource, /function brandLogoHtml\(/);
  assert.match(appSource, /brandLogoHtml\(\{ className: "auth-logo-img" \}\)/);
  // Never stretched, never replaced by an emoji: CSS limits height only.
  const css = read("style.css");
  assert.match(css, /\.pm-brand-logo\{[^}]*object-fit:contain/);
  assert.match(appSource, /onerror="this\.hidden=true"/);
});

const LOGO_PATH = path.join(root, "assets", "pashu-mitra-logo.png");
const logoPresent = fs.existsSync(LOGO_PATH);

test("the official logo file, when present, is a usable PNG", { skip: logoPresent ? false : "assets/pashu-mitra-logo.png is not in this checkout yet" }, () => {
  const bytes = fs.readFileSync(LOGO_PATH);
  // PNG signature — the brand asset must be the supplied raster file as-is.
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "not a PNG file");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", "missing IHDR chunk");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.ok(width >= 64 && height >= 64, `logo is too small to render crisply (${width}x${height})`);
  const ratio = width / height;
  assert.ok(ratio > 0.2 && ratio < 5, `implausible aspect ratio ${ratio.toFixed(2)} (${width}x${height})`);
  assert.ok(bytes.length <= 2 * 1024 * 1024, `logo is ${(bytes.length / 1024).toFixed(0)} KB — keep it under 2 MB for the PWA`);
  // No stretch is possible: the CSS never forces a ratio, and the markup only
  // limits the height. Assert both remain true alongside the asset itself.
  const css = read("style.css");
  assert.match(css, /\.pm-logo-img\{[^}]*height:40px; width:auto/);
  assert.doesNotMatch(css, /\.pm-logo-img\{[^}]*aspect-ratio/);
  assert.doesNotMatch(shellSource, /pm-logo-img[^>]*aspect-ratio:[0-9]/);
});

test("deployment identifiers are intentionally NOT renamed", () => {
  // Renaming any of these would break a running service rather than branding.
  const vercel = JSON.parse(read("vercel.json"));
  assert.equal(vercel.name, "pashu-shield-frontend");
  assert.match(vercel.rewrites[0].destination, /pashu-shield-backend-hjgr\.onrender\.com/);
  assert.match(appSource, /localStorage\.getItem\("token"\)/);
  assert.doesNotMatch(appSource, /localStorage\.getItem\("pashu-mitra/);
});

test("the demo access card stays visible, clean and fully localised", () => {
  // Credentials are shown; the section reads as an information card.
  assert.match(appSource, /"farmer\.demo_account_title": "Demo access"/);
  const titles = [...appSource.matchAll(/"farmer\.demo_account_title": "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(titles.length, 4, "the demo card must be localised in en, mr, hi and te");
  // Only the *rendered* strings matter: comments may still describe the
  // prototype demo account. Check every string literal in the bundle.
  const literals = [...appSource.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((m) => m[0]);
  const banned = /prototype demo|demo mode enabled|using demo credentials|development environment|production_override/i;
  const offenders = literals.filter((literal) => banned.test(literal));
  assert.deepEqual(offenders, [], `development-style wording still rendered -> ${offenders.join(", ")}`);
  // The card is grouped and labelled for assistive technology.
  assert.match(appSource, /role="group"[\s\S]{0,160}aria-labelledby="farmerDemoAccountTitle"/);
});

test("every dashboard header renders the official logo and the Pashu-Mitra name", () => {
  // The shell header is hosted once in index.html and rendered for every route,
  // so the farmer / veterinarian / government / laboratory dashboards and the
  // web-call page all inherit this markup.
  assert.match(indexHtml, /id="pmSiteHeaderHost"/);
  assert.match(shellSource, /getElementById\("pmSiteHeaderHost"\)/);

  const headerHost = makeElement();
  const json = () => {};
  const sandbox = {
    console: { log() {}, warn() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      readyState: "complete",
      documentElement: {
        style: { setProperty() {}, removeProperty() {} },
        classList: { toggle() {}, add() {}, remove() {} },
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
      },
      body: makeElement("body"),
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: (id) => (id === "pmSiteHeaderHost" ? headerHost : null),
      createElement: (tag) => makeElement(tag),
      title: "",
    },
    localStorage: makeStorage({}),
    location: { href: "https://portal.example.com/", hash: "", origin: "https://portal.example.com" },
    navigator: { language: "en", onLine: true },
    json,
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // The real organisation config is used, not a stub, so the assertions below
  // prove the shipped header and the shipped brand object agree.
  vm.runInContext(orgSource, vm.createContext(sandbox), { filename: "org-config.js" });
  sandbox.ORG = vm.runInContext("window.ORG", vm.createContext(sandbox));
  vm.runInContext(shellSource, vm.createContext(sandbox), { filename: "shell.js" });

  const header = headerHost.innerHTML;
  assert.match(header, /role="banner"/);
  assert.match(header, /class="pm-logo-img" src="assets\/pashu-mitra-logo\.png"/);
  assert.match(header, /alt="Pashu-Mitra[^"]*"/);
  assert.match(header, /pm-brand-name">Pashu-Mitra</);
  assert.match(header, /aria-label="Pashu-Mitra[^"]*go to the home page"/);
  // No emoji stand-in while the official asset is configured, and no old name.
  assert.doesNotMatch(header, /pm-logo-mark/);
  assert.doesNotMatch(header, /Pashu[\s-]?Shield/i);
});

// ---------------------------------------------------------------------------
// B. Web-call states
// ---------------------------------------------------------------------------
function makeElement(tag = "div") {
  const listeners = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    style: {},
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    attributes: {},
    children: [],
    _innerHTML: "",
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = String(v); },
    setAttribute(n, v) { this.attributes[n] = String(v); },
    removeAttribute(n) { delete this.attributes[n]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, h) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(h); },
    remove() {},
    querySelectorAll: () => [],
    focus() {},
  };
  return el;
}

function makeStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function loadCallClient({ config } = {}) {
  const elements = new Map();
  const sockets = [];
  function element(id) {
    if (!elements.has(id)) { const el = makeElement(); el.id = id; elements.set(id, el); }
    return elements.get(id);
  }
  const storage = makeStorage({ token: "test.jwt.token", user: JSON.stringify({ id: 5, role: "owner" }) });

  class FakeSocket {
    constructor(url, options) {
      this.url = url; this.options = options;
      this.connected = true; this.handlers = new Map(); this.emitted = [];
      sockets.push(this);
      setTimeout(() => this.receive("session:ready", {}), 0);
    }
    on(ev, h) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(h); return this; }
    emit(ev, payload, ack) { this.emitted.push({ event: ev, payload }); if (typeof ack === "function") ack({ ok: true }); return this; }
    receive(ev, payload) { (this.handlers.get(ev) || []).forEach((h) => h(payload)); }
    connect() { this.connected = true; this.receive("connect"); }
    disconnect() { this.connected = false; }
  }

  const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  const BASE_CONFIG = {
    channel: "webrtc_web_call",
    user: { id: 5, role: "owner", language: "en" },
    ice_servers: [], ice: {}, ice_transport_policy: "all",
    signaling: { url: "https://backend.example.com", path: "/socket.io", transports: ["websocket", "polling"], offline_warning_seconds: 10, client_origin_allowed: true },
    ring_timeout_seconds: 45, call_reasons: ["animal_sick"],
    supported_languages: [{ code: "en", name: "English" }],
    push: { configured: false },
    helpline: { number: "7382210251", pstn_connected: false },
    availability: null, presence: null,
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: (url) => {
      const p = String(url).replace(/^\/api/, "");
      if (p.startsWith("/webcall/config")) return json(config || BASE_CONFIG);
      if (p.startsWith("/webcall/availability")) {
        return json({
          requested_language: "en", requested_language_name: "English",
          routable: false, message: "No veterinarian for English is currently online.",
          alternatives: [], selected_vet: null,
          helpline: { number: "7382210251", pstn_connected: false },
          skipped_codes: ["NO_LIVE_SESSION"], skipped_reasons: ["NO_LIVE_SESSION"],
        });
      }
      return json({ call: null });
    },
    localStorage: storage,
    navigator: { onLine: true, serviceWorker: undefined, mediaDevices: { getUserMedia: () => Promise.reject(new Error("no mic in test")) } },
    location: { hash: "#/owner/webcall", origin: "https://portal.example.com", host: "portal.example.com", href: "https://portal.example.com/#/owner/webcall" },
    io: (url, options) => new FakeSocket(url, options),
    document: {
      readyState: "complete",
      documentElement: {},
      body: makeElement("body"),
      visibilityState: "visible",
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => makeElement(tag),
    },
    window: {
      addEventListener() {}, scrollTo() {},
      state: { token: "test.jwt.token", user: { id: 5, role: "owner" }, lang: "en" },
      localStorage: storage,
      io: (url, options) => new FakeSocket(url, options),
      render: (html) => { element("app").innerHTML = html; },
      toast: () => {},
      header: (title) => `<header>${title}</header>`,
      bottomNav: () => "<nav></nav>",
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  const context = vm.createContext(sandbox);
  vm.runInContext(callSource, context, { filename: "call.js" });
  return {
    context, elements, element,
    run: (expr) => vm.runInContext(expr, context),
    pm: () => vm.runInContext("window.PMCall", context),
    socket: () => sockets[sockets.length - 1],
  };
}

test("the twelve call states are distinguished by text, not colour", () => {
  const client = loadCallClient();
  const expected = {
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
  for (const [code, label] of Object.entries(expected)) {
    assert.equal(client.run(`window.PMCall.__test.callStateLabel("${code}")`), label, code);
  }
  // With no signaling socket at all the honest state is OFFLINE.
  assert.equal(client.run("window.PMCall.__test.callState()"), "OFFLINE");
});

test("server routing codes never become the farmer's primary message", () => {
  const client = loadCallClient();
  const sentence = client.run('window.PMCall.__test.skipReasonSentence(["NO_LIVE_SESSION","NO_LIVE_SESSION"])');
  assert.equal(sentence, "not connected right now");
  assert.doesNotMatch(sentence, /NO_LIVE_SESSION/);
  assert.equal(
    client.run('window.PMCall.__test.skipReasonSentence(["LANGUAGE_NOT_SUPPORTED","BUSY_WEB_CALL"])'),
    "does not take calls in this language, already on a web call",
  );
});

test("a refused browser Origin is reported as such, not as 'signaling offline'", async () => {
  const config = {
    user: { id: 5, role: "owner", language: "en" },
    signaling: {
      url: "https://backend.example.com", path: "/socket.io",
      offline_warning_seconds: 10,
      client_origin: "https://portal.example.com",
      client_origin_allowed: false,
    },
    helpline: { number: "7382210251", pstn_connected: false },
    supported_languages: [{ code: "en", name: "English" }],
    ice_servers: [], ice: {},
  };
  const client = loadCallClient({ config });
  await client.pm().init().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  const info = client.run("window.PMCall.__test.signalingFailureInfo()");
  assert.equal(info.code, "ORIGIN_NOT_ALLOWED");
  assert.ok(/not enabled for this address/i.test(info.farmer), info.farmer);
  assert.match(info.dev, /allowed_origins/);
  assert.match(info.dev, /socket\.io$/);
});

test("the farmer availability card hides raw codes and only names a matched vet when routable", async () => {
  const client = loadCallClient();
  await client.pm().init().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 30));
  const socket = client.socket();
  if (socket) socket.connected = true;
  const result = {
    requested_language: "en", requested_language_name: "English",
    routable: false, message: "No veterinarian for English is currently online.",
    alternatives: [], selected_vet: { vet_id: 7, name: "Dr. Test", district: "Pune" },
    helpline: { number: "7382210251", pstn_connected: false },
    skipped_codes: ["NO_LIVE_SESSION"], skipped_reasons: ["NO_LIVE_SESSION"],
  };
  client.element("pmCallAvailabilityBox");
  client.element("pmCallStart");
  client.run(`window.PMCall.__test.renderFarmerAvailabilityResult(${JSON.stringify(result)}, {})`);
  const html = client.element("pmCallAvailabilityBox").innerHTML;
  // The message is human; the raw code is only in the developer data attribute.
  assert.match(html, /No veterinarian for English is online right now/i);
  assert.doesNotMatch(html.split('data-skipped-codes')[0], /NO_LIVE_SESSION/);
  assert.match(html, /data-skipped-codes="NO_LIVE_SESSION"/);
  // A vet that cannot be routed to is never presented as "matched".
  assert.doesNotMatch(html, /Dr\. Test/);
  // Every one of the twelve states is listed (text, with the current one marked).
  const strip = client.run("window.PMCall.__test.callStateStripHtml()");
  for (const label of ["Offline", "Connecting", "Available", "Incoming call", "Calling", "Ringing",
    "Connecting audio", "Connected", "Connected · muted", "Reconnecting", "Ended", "Failed"]) {
    assert.ok(strip.includes(label), `missing state label: ${label}`);
  }
  assert.match(strip, /aria-current="true"/);
  assert.equal((strip.match(/role="listitem"/g) || []).length, 12);
  assert.equal((strip.match(/aria-current="true"/g) || []).length, 1);
});
