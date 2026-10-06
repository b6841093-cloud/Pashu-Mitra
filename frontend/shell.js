/* ==========================================================================
 * Pashu-Mitra — Global shell: accessibility bar, preferences, announcements,
 *                page metadata, site footer, breadcrumbs.
 * --------------------------------------------------------------------------
 * GIGW 3.0 mapping
 *   A27 (2.4.1) skip link / bypass blocks      -> skipLink() + #site-header
 *   A50 (4.1.3) status messages                -> announce()
 *   A15 (1.4.4) resize text 200%               -> textScale() (A- / A / A+)
 *   A14 (1.4.3) contrast / high contrast       -> highContrast toggle
 *   A25 (2.2.2) pause animation                -> reducedMotion toggle
 *   A38 (3.1.1) language of page               -> language select + <html lang>
 *   A28 (2.4.2) page titled                    -> setPageMeta()
 *   Q02 ownership, Q05 last updated, Q09-Q12, Q18 minimum content -> footer
 *   L04 external link indication               -> externalLink()
 *
 * ZERO-REGRESSION RULE
 *   This file is purely ADDITIVE. It never removes or replaces an existing
 *   Pashu-Mitra feature. The existing `.app-header` and `.bottom-nav`
 *   (app.js) are left untouched; a slim global bar is layered above them and
 *   a global footer below the existing app container.
 *
 * BRAND EXEMPTIONS (4.2 fonts, 4.3 colours)
 *   Text scaling changes font-SIZE only, never font-family.
 *   High-contrast mode is opt-in and uses its own palette; the default
 *   brand theme is byte-for-byte unchanged when it is off.
 * ========================================================================== */

/* global document, window, localStorage, location */
(function () {
  "use strict";

  const STORE = "pm_a11y_prefs";
  const SCALES = [0.875, 1.0, 1.125, 1.25, 1.5];   // ~A- .. A+ (200% reachable)
  const DEFAULT_SCALE_INDEX = 1;                     // 1.0 = unchanged default

  const prefs = {
    scaleIndex: DEFAULT_SCALE_INDEX,
    highContrast: false,
    reducedMotion: false,
    lang: null,          // null = follow the app's own language state
  };

  /* ---------------------------------------------------------- persistence */
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.scaleIndex === "number" &&
          saved.scaleIndex >= 0 && saved.scaleIndex < SCALES.length) {
        prefs.scaleIndex = saved.scaleIndex;
      }
      prefs.highContrast = !!saved.highContrast;
      prefs.reducedMotion = !!saved.reducedMotion;
      prefs.lang = typeof saved.lang === "string" ? saved.lang : null;
    } catch (_) { /* corrupt or unavailable storage -> keep defaults */ }
  }

  function savePrefs() {
    try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (_) {}
  }

  /* ------------------------------------------------------------ applying */
  function applyPrefs() {
    const root = document.documentElement;

    // Text scale — font-size only. The font FAMILY is never modified (ex. 4.2).
    root.style.setProperty("--pm-text-scale", String(SCALES[prefs.scaleIndex]));

    root.classList.toggle("pm-high-contrast", prefs.highContrast);
    root.classList.toggle("pm-reduced-motion", prefs.reducedMotion);

    // Reflect state on the toggle buttons so assistive tech sees it.
    document.querySelectorAll("[data-a11y-toggle]").forEach((btn) => {
      const key = btn.getAttribute("data-a11y-toggle");
      const on = !!prefs[key];
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const label = btn.getAttribute("data-a11y-label");
      const labelOn = btn.getAttribute("data-a11y-label-on");
      if (label && labelOn) {
        btn.setAttribute("aria-label", on ? labelOn : label);
      }
    });

    const scaleOut = document.getElementById("pmScaleValue");
    if (scaleOut) {
      const pct = Math.round(SCALES[prefs.scaleIndex] * 100);
      scaleOut.textContent = prefs.scaleIndex === DEFAULT_SCALE_INDEX
        ? "Normal (100%)"
        : pct + "%";
    }
  }

  function setScaleIndex(i) {
    prefs.scaleIndex = Math.min(SCALES.length - 1, Math.max(0, i));
    savePrefs();
    applyPrefs();
    const msg = "Text size " + (prefs.scaleIndex === DEFAULT_SCALE_INDEX
      ? "reset to normal"
      : "set to " + Math.round(SCALES[prefs.scaleIndex] * 100) + "%");
    announce(msg);
  }

  function togglePref(key) {
    prefs[key] = !prefs[key];
    savePrefs();
    applyPrefs();
    if (key === "highContrast") {
      announce(prefs[key] ? "High contrast mode on" : "High contrast mode off");
    }
    if (key === "reducedMotion") {
      announce(prefs[key] ? "Animations reduced" : "Animations enabled");
    }
  }

  /* ------------------------------------------------- screen-reader announcer
   * WCAG 4.1.3 Status Messages (GIGW A50).
   * IMPORTANT: the live regions must exist in the DOM before text is written
   * into them, otherwise screen readers do not announce the first message.
   * They are therefore declared statically in index.html.
   */
  let politeTimer = null;
  function announce(message, assertive) {
    const id = assertive ? "pmLiveAssertive" : "pmLivePolite";
    const region = document.getElementById(id);
    if (!region) return;
    // Clearing first forces re-announcement of an identical message.
    region.textContent = "";
    window.clearTimeout(politeTimer);
    politeTimer = window.setTimeout(function () {
      region.textContent = message;
    }, 60);
  }

  /* --------------------------------------------------------- page metadata
   * GIGW Q17 (page title + lang + metadata) and A28 (2.4.2 page titled).
   */
  function setPageMeta(opts) {
    const o = opts || {};
    const orgName = (window.ORG && window.ORG.appName) || "Pashu-Mitra";
    const title = o.title ? o.title + " — " + orgName : orgName + " — Animal Disease Reporting & Veterinary Care";
    document.title = title;

    setMeta("name", "description", o.description ||
      "Pashu-Mitra: animal disease reporting, veterinary care, laboratory diagnostics and disease surveillance for livestock owners, veterinarians, laboratories and government officers.");
    setMeta("name", "keywords", o.keywords ||
      "animal health, livestock, disease reporting, veterinary, laboratory, surveillance, Pashu-Mitra");

    // lang: keep <html lang> in step with the selected language (A38 / 3.1.1).
    const lang = (o.lang || (window.state && window.state.lang) || "en");
    document.documentElement.lang = lang;

    // Canonical URL — the SPA uses hash routes, so the canonical is the hash URL.
    let link = document.getElementById("pmCanonical");
    if (!link) {
      link = document.createElement("link");
      link.id = "pmCanonical";
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = window.location.href;

    // Open Graph (only where meaningful; never misleading).
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", o.description || "Animal disease reporting and veterinary care platform.");
    setMeta("property", "og:type", "website");
    setMeta("property", "og:url", window.location.href);
  }

  function setMeta(attr, key, content) {
    if (!content) return;
    let el = document.querySelector("meta[" + attr + '="' + key + '"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  /* ---------------------------------------------------------- breadcrumbs */
  const CRUMB_LABELS = {
    "#/": "Home",
    "#/about": "About Us",
    "#/contact": "Contact Us",
    "#/feedback": "Feedback",
    "#/help": "Help",
    "#/sitemap": "Site Map",
    "#/search": "Search",
    "#/policies": "Policies",
    owner: "Animal Owner",
    vet: "Veterinarian",
    govt: "Government",
    lab: "Laboratory",
  };

  function breadcrumbTrail(routePath, extraLabel) {
    const parts = String(routePath || "").split("/").filter(Boolean);
    const trail = [{ href: "#/", label: "Home" }];
    if (parts[0] && CRUMB_LABELS[parts[0]]) {
      trail.push({ href: "#/", label: CRUMB_LABELS[parts[0]] });
    }
    if (extraLabel) trail.push({ href: null, label: extraLabel });
    else if (parts[1]) trail.push({ href: null, label: titleCase(parts[1].replace(/[-_]/g, " ")) });
    if (trail.length <= 1) return "";
    const items = trail.map(function (c, i) {
      const last = i === trail.length - 1;
      const sep = '<span class="pm-crumb-sep" aria-hidden="true">›</span>';
      const body = (c.href && !last)
        ? '<a class="pm-crumb-link" href="' + c.href + '">' + escapeHtml(c.label) + "</a>"
        : '<span aria-current="page">' + escapeHtml(c.label) + "</span>";
      return "<li>" + sep + " " + body + "</li>";
    }).join("");
    return '<nav class="pm-crumbs" aria-label="Breadcrumb"><ol>' + items + "</ol></nav>";
  }

  function titleCase(s) {
    return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ------------------------------------------------------- external links
   * GIGW L04 — clear indication when a link leaves the site, plus
   * rel="noopener noreferrer" whenever target="_blank" is used (programme §41).
   */
  function externalLink(href, label, opts) {
    const o = opts || {};
    const id = "ext-" + Math.random().toString(36).slice(2, 8);
    const newWin = o.newWindow !== false;
    return '<a class="pm-ext-link" href="' + escapeHtml(href) + '"' +
      (newWin ? ' target="_blank" rel="noopener noreferrer"' : "") +
      ' aria-describedby="' + id + '">' + escapeHtml(label) +
      '<span class="pm-ext-icon" aria-hidden="true">↗</span></a>' +
      '<span id="' + id + '" class="sr-only">' +
      (newWin ? "(external site, opens in a new window)" : "(external site)") +
      "</span>";
  }

  /* ------------------------------------------------------------- footer */
  function renderFooter() {
    const org = window.ORG || {};
    const owner = org.owner || {};
    const pending = !org.approved;

    const policyLinks = (org.policies || []).map(function (p) {
      return '<li><a href="#/policies/' + p.id + '">' + escapeHtml(p.label) +
        (p.approved === false ? ' <span class="pm-pending">pending approval</span>' : "") +
        "</a></li>";
    }).join("");

    const lastReviewed = org.lastReviewed
      ? '<p class="pm-footer-line">Last reviewed / updated: <time datetime="' +
        escapeHtml(org.lastReviewed) + '">' + escapeHtml(org.lastReviewed) + "</time></p>"
      : "";

    return '' +
      '<footer class="pm-footer" id="site-footer" role="contentinfo">' +
        '<div class="pm-footer-inner">' +
          '<section class="pm-footer-col" aria-labelledby="pm-f-about">' +
            '<h2 id="pm-f-about" class="pm-footer-h">About this service</h2>' +
            '<p class="pm-org-name">' + escapeHtml(org.appName || "Pashu-Mitra") + "</p>" +
            '<p class="pm-footer-text">' + escapeHtml(org.tagline || "") + "</p>" +
            (pending
              ? '<p class="pm-owner-note"><strong>Ownership:</strong> ' + escapeHtml(owner.name || "") +
                ' — <em>placeholder pending confirmation by the owning organisation</em></p>'
              : '<p class="pm-footer-text">' + escapeHtml(owner.name || "") + "</p>") +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-contact">' +
            '<h2 id="pm-f-contact" class="pm-footer-h">Contact</h2>' +
            '<p class="pm-footer-text">' + escapeHtml(owner.address || "") + "</p>" +
            '<p class="pm-footer-text">Email: ' + escapeHtml(owner.email || "") + "</p>" +
            '<p class="pm-footer-text">Phone: ' + escapeHtml(owner.phone || "") + "</p>" +
            '<p class="pm-footer-text">Hours: ' + escapeHtml(owner.workingHours || "") + "</p>" +
            '<p class="pm-footer-text"><a href="#/contact">Full contact directory</a></p>' +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-use">' +
            '<h2 id="pm-f-use" class="pm-footer-h">Using this site</h2>' +
            '<ul class="pm-footer-list">' +
              '<li><a href="#/about">About Us</a></li>' +
              '<li><a href="#/help">Help</a></li>' +
              '<li><a href="#/feedback">Feedback</a></li>' +
              '<li><a href="#/sitemap">Site Map</a></li>' +
              '<li><a href="#/search">Search</a></li>' +
              '<li><a href="#/policies">Policies</a></li>' +
            "</ul>" +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-policies">' +
            '<h2 id="pm-f-policies" class="pm-footer-h">Policies</h2>' +
            '<ul class="pm-footer-list">' + policyLinks + "</ul>" +
          "</section>" +
        "</div>" +

        '<div class="pm-footer-bar">' +
          '<p class="pm-footer-line">' +
            (org.nationalPortal
              ? externalLink(org.nationalPortal.url, org.nationalPortal.label) + " · "
              : "") +
            '<a href="#/policies/accessibility">Accessibility Statement</a> · ' +
            '<a href="#/policies/privacy">Privacy</a> · ' +
            '<a href="#/policies/terms">Terms</a> · ' +
            '<a href="#/policies/copyright">Copyright</a> · ' +
            '<a href="#/policies/grievance">Grievance</a>' +
          "</p>" +
          lastReviewed +
          '<p class="pm-footer-line">Content on this platform is provided for animal-health ' +
            "service delivery. Policy pages are templates pending approval by the owning " +
            "organisation.</p>" +
        "</div>" +
      "</footer>";
  }

  /* ------------------------------------------------------------ the bar */
  function renderA11yBar() {
    return '' +
      '<div class="pm-a11y-bar" id="pmA11yBar">' +
        '<div class="pm-a11y-inner">' +
          '<div class="pm-a11y-group" role="group" aria-label="Text size">' +
            '<span class="pm-a11y-label" id="pmScaleLabel">Text size</span>' +
            '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(PashuShell.getScaleIndex()-1)" ' +
              'aria-label="Decrease text size">A<span class="pm-a11y-smaller">-</span></button>' +
            '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(1)" ' +
              'aria-label="Reset text size to normal">A</button>' +
            '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(PashuShell.getScaleIndex()+1)" ' +
              'aria-label="Increase text size">A<span class="pm-a11y-bigger">+</span></button>' +
            '<span class="pm-a11y-value" id="pmScaleValue">Normal (100%)</span>' +
          "</div>" +

          '<div class="pm-a11y-group">' +
            '<button type="button" class="pm-a11y-btn pm-a11y-wide" data-a11y-toggle="highContrast" ' +
              'data-a11y-label="High contrast mode" data-a11y-label-on="High contrast mode is on" ' +
              'aria-pressed="false" onclick="PashuShell.togglePref(\'highContrast\')">' +
              '<span aria-hidden="true">◐</span> High contrast</button>' +
            '<button type="button" class="pm-a11y-btn pm-a11y-wide" data-a11y-toggle="reducedMotion" ' +
              'data-a11y-label="Reduce animation" data-a11y-label-on="Animation is reduced" ' +
              'aria-pressed="false" onclick="PashuShell.togglePref(\'reducedMotion\')">' +
              '<span aria-hidden="true">⏸</span> Reduce motion</button>' +
          "</div>" +
        "</div>" +
      "</div>";
  }

  /* ---------------------------------------------------------- site header
   * GIGW Q01 (logo in proper ratio, prominent, alt text, links home)
   *      Q02 (ownership on every important entry page)
   */
  function renderSiteHeader() {
    const org = window.ORG || {};
    const logo = org.logo || {};
    const mark = logo.mark || "🐄";
    // The logo is an <img> so the official asset is used as-is (never redrawn,
    // stretched or cropped): the file's own ratio is kept because no aspect
    // ratio is forced and CSS limits only the height. If the asset is missing
    // the image hides itself and the accessible product name stays visible —
    // a broken-image icon is never shown to a user.
    const logoInner = logo.src
      ? '<img class="pm-logo-img" src="' + escapeHtml(logo.src) + '" alt="' +
        escapeHtml(logo.alt || org.appName || "") + '"' +
        (logo.aspectRatio && logo.aspectRatio !== "auto"
          ? ' style="aspect-ratio:' + escapeHtml(logo.aspectRatio) + '"' : "") +
        ' onerror="this.style.display=\'none\'">'
      : '<span class="pm-logo-mark" aria-hidden="true">' + mark + "</span>";

    return '' +
      '<header class="pm-site-header" id="site-header" role="banner">' +
        '<div class="pm-site-header-inner">' +
          '<a class="pm-brand" href="' + escapeHtml(logo.href || "#/") + '" ' +
            'aria-label="' + escapeHtml((org.appName || "Pashu-Mitra") + " — go to the home page") + '">' +
            logoInner +
            '<span class="pm-brand-text">' +
              '<span class="pm-brand-name">' + escapeHtml(org.appName || "Pashu-Mitra") + "</span>" +
              '<span class="pm-brand-tag">' + escapeHtml(org.tagline || "") + "</span>" +
            "</span>" +
          "</a>" +
          '<p class="pm-owner">' +
            '<span class="sr-only">Owned by: </span>' +
            escapeHtml((org.owner && org.owner.name) || "") +
          "</p>" +
        "</div>" +
      "</header>";
  }

  /* --------------------------------------------------------- boot / init */
  function init() {
    loadPrefs();

    const barHost = document.getElementById("pmA11yBarHost");
    if (barHost) barHost.innerHTML = renderA11yBar();

    const headerHost = document.getElementById("pmSiteHeaderHost");
    if (headerHost) headerHost.innerHTML = renderSiteHeader();

    const footerHost = document.getElementById("pmFooterHost");
    if (footerHost) footerHost.innerHTML = renderFooter();

    applyPrefs();

    // Honour the OS-level preference the first time (never overrides a choice
    // the user has explicitly made and stored).
    try {
      if (!localStorage.getItem(STORE)) {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq && mq.matches) { prefs.reducedMotion = true; savePrefs(); applyPrefs(); }
      }
    } catch (_) {}
  }

  // Export a small, stable API for app.js and inline handlers.
  window.PashuShell = {
    init: init,
    announce: announce,
    setPageMeta: setPageMeta,
    breadcrumbs: breadcrumbTrail,
    externalLink: externalLink,
    escapeHtml: escapeHtml,
    setScaleIndex: setScaleIndex,
    getScaleIndex: function () { return prefs.scaleIndex; },
    togglePref: togglePref,
    prefs: prefs,
    renderFooter: renderFooter,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
