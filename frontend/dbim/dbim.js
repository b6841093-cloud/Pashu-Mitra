/* ==========================================================================
 * Pashu-Shield — DBIM behaviour layer (Phase 1)
 * --------------------------------------------------------------------------
 * DBIM 3 (icons) + DBIM 7.6/DPDP (consent) + DBIM 1.4 (components).
 * Zero-dependency, additive: nothing here removes or renames an existing
 * feature. Loaded after org-config.js, before shell.js (see index.html).
 * ========================================================================== */
/* global document, window, localStorage */
(function () {
  "use strict";

  var SPRITE = "dbim/icons.svg";

  /* ---------------------------------------------------------------- icons
   * DBIM 3: ONE line style, currentColor (key or white only), 24/32/48/64px
   * frames. Icons are decorative and MUST be paired with text (brief §1.3). */
  function icon(name, size) {
    var cls = "dbim-icon" + (size && size !== 24 ? " dbim-icon--" + size : "");
    return '<svg class="' + cls + '" aria-hidden="true" focusable="false">' +
      '<use href="' + SPRITE + '#i-' + name + '"></use></svg>';
  }

  /* ---------------------------------------------------------------- theme
   * Brief §1.1: single-token theme swap via <html data-dbim-theme>. Groups
   * without Toolkit-verified hexes fall back to green (tokens.css) and warn. */
  var UNVALUED = ["burgundy", "purple", "chrome-yellow", "cinnamon-red"];
  function checkTheme() {
    var t = document.documentElement.getAttribute("data-dbim-theme") || "green";
    if (UNVALUED.indexOf(t) !== -1 && window.console) {
      window.console.warn("[DBIM] theme '" + t + "' has no Toolkit-verified " +
        "hexes yet (PLACEHOLDERS.md P-TOK-*); green fallback is active.");
    }
  }

  /* -------------------------------------------------------------- consent
   * DBIM 7.6 + DPDP Act 2023: bottom banner, Accept / Reject / Customise,
   * consent in the user's language, NO pre-ticked boxes, withdrawable.
   * Categories: essential (always on — session + prefs + offline queue),
   * functionality / analytics / social (opt-in; nothing loads until allowed).
   * NOTE (hi/mr/te): short banner strings drafted for Phase 1 — O-52 human
   * translation review still required before any compliance claim. */
  var CONSENT_KEY = "pm_consent_v1";
  var LANG = (window.state && window.state.lang) ||
    (function () { try { return localStorage.getItem("pm_lang"); } catch (e) { return null; } })() ||
    "en";

  var STR = {
    en: {
      text: "We use essential cookies to keep you signed in and remember your preferences. Optional cookies need your permission.",
      accept: "Accept all", reject: "Reject optional", customise: "Customise",
      policy: "Privacy Policy", title: "Cookie preferences",
      save: "Save choices", essential: "Essential (always on)",
      essentialD: "Sign-in session, language and accessibility preferences, offline queue.",
      func: "Functionality", funcD: "Remembers extra conveniences such as map position.",
      analytics: "Analytics", analyticsD: "Helps us understand which pages are used. No personal data.",
      social: "Social", socialD: "Used only if social feeds are embedded in future.",
      saved: "Your cookie choices were saved."
    },
    hi: {
      text: "आपको साइन इन रखने और आपकी पसंद याद रखने के लिए हम आवश्यक कुकीज़ का उपयोग करते हैं। वैकल्पिक कुकीज़ के लिए आपकी अनुमति चाहिए।",
      accept: "सभी स्वीकारें", reject: "वैकल्पिक अस्वीकारें", customise: "पसंद चुनें",
      policy: "गोपनीयता नीति", title: "कुकी प्राथमिकताएँ",
      save: "पसंद सहेजें", essential: "आवश्यक (हमेशा चालू)",
      essentialD: "साइन-इन सत्र, भाषा और सरलता पसंद, ऑफ़लाइन कतार।",
      func: "कार्यात्मकता", funcD: "मानचित्र स्थिति जैसी अतिरिक्त सुविधा याद रखता है।",
      analytics: "विश्लेषण", analyticsD: "कौन से पृष्ठ उपयोग होते हैं, यह समझने में मदद करता है। कोई व्यक्तिगत डेटा नहीं।",
      social: "सोशल", socialD: "केवल भविष्य में सोशल फ़ीड जुड़ने पर उपयोग होगा।",
      saved: "आपकी कुकी पसंद सहेज ली गई।"
    },
    mr: {
      text: "आपण साइन इन राहावे आणि आपल्या पसंती लक्षात राहाव्यात यासाठी आम्ही आवश्यक कुकीज वापरतो. पर्यायी कुकीजसाठी आपली परवानगी आवश्यक आहे.",
      accept: "सर्व स्वीकारा", reject: "पर्यायी नाकारा", customise: "पसंती निवडा",
      policy: "गोपनीयता धोरण", title: "कुकी प्राधान्ये",
      save: "पसंती जतन करा", essential: "आवश्यक (नेहमी चालू)",
      essentialD: "साइन-इन सत्र, भाषा आणि सुलभता पसंती, ऑफलाइन रांग।",
      func: "कार्यक्षमता", funcD: "नकाशा स्थान यांसारख्या अतिरिक्त सोयी लक्षात ठेवते.",
      analytics: "विश्लेषण", analyticsD: "कोणती पृष्ठे वापरली जातात हे समजण्यास मदत करते. वैयक्तिक डेटा नाही.",
      social: "सोशल", socialD: "भविष्यात सोशल फीड जोडल्यासच वापरले जाईल.",
      saved: "आपली कुकी पसंती जतन केली."
    },
    te: {
      text: "మీరు సైన్ ఇన్‌లో ఉండటానికి మరియు మీ ప్రాధాన్యతలను గుర్తుంచుకోవడానికి మేము అవసరమైన కుకీలను వాడతాము. ఐచ్ఛిక కుకీలకు మీ అనుమతి అవసరం.",
      accept: "అన్నీ అంగీకరించు", reject: "ఐచ్ఛికం తిరస్కరించు", customise: "అనుకూలీకరించు",
      policy: "గోప్యతా విధానం", title: "కుకీ ప్రాధాన్యతలు",
      save: "ఎంపికలు భద్రపరచు", essential: "అవసరమైనవి (ఎల్లప్పుడూ ఆన్)",
      essentialD: "సైన్-ఇన్ సెషన్, భాష మరియు ప్రాప్యత ప్రాధాన్యతలు, ఆఫ్‌లైన్ క్యూ.",
      func: "కార్యాచరణ", funcD: "మ్యాప్ స్థానం వంటి అదనపు సౌకర్యాలను గుర్తుంచుకుంటుంది.",
      analytics: "విశ్లేషణ", analyticsD: "ఏ పేజీలు వాడబడుతున్నాయో అర్థం చేసుకోవడానికి. వ్యక్తిగత డేటా లేదు.",
      social: "సోషల్", socialD: "భవిష్యత్తులో సోషల్ ఫీడ్‌లు జోడిస్తే మాత్రమే వాడతాము.",
      saved: "మీ కుకీ ఎంపికలు భద్రపరచబడ్డాయి."
    }
  };
  function S() { return STR[LANG] || STR.en; }

  function readConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      return (c && typeof c === "object") ? c : null;
    } catch (e) { return null; }
  }
  function writeConsent(c) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch (e) {}
  }
  /* Gate for future loaders: DBIM.consentAllowed('analytics'). Default deny. */
  function consentAllowed(cat) {
    if (cat === "essential") return true;
    var c = readConsent();
    return !!(c && c[cat] === true);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function announce(msg) {
    if (window.PashuShell && window.PashuShell.announce) window.PashuShell.announce(msg);
  }

  function bannerHtml() {
    var s = S();
    return '<div class="dbim-cookie" role="region" aria-label="' + esc(s.title) + '">' +
      '<div class="dbim-cookie-inner">' +
        "<p>" + esc(s.text) + ' <a href="#/policies/privacy">' + esc(s.policy) + "</a></p>" +
        '<div class="dbim-cookie-actions">' +
          '<button type="button" class="dbim-btn dbim-btn--primary" data-consent="all">' +
            esc(s.accept) + "</button>" +
          '<button type="button" class="dbim-btn dbim-btn--secondary" data-consent="none">' +
            esc(s.reject) + "</button>" +
          '<button type="button" class="dbim-btn dbim-btn--secondary" data-consent="custom">' +
            esc(s.customise) + "</button>" +
        "</div>" +
      "</div></div>";
  }

  function modalHtml() {
    var s = S();
    var c = readConsent() || {};
    function row(key, title, desc, locked) {
      var on = locked ? true : c[key] === true;  /* never pre-ticked (D: unchecked default) */
      return '<label class="dbim-consent-row">' +
        '<input type="checkbox" data-cat="' + key + '"' +
        (on ? " checked" : "") + (locked ? " disabled" : "") + ">" +
        "<span><strong>" + esc(title) + "</strong><span>" + esc(desc) + "</span></span></label>";
    }
    return '<div class="dbim-modal-backdrop" data-modal-backdrop>' +
      '<div class="dbim-modal" role="dialog" aria-modal="true" aria-labelledby="dbimConsentH">' +
        '<h2 id="dbimConsentH">' + esc(s.title) + "</h2>" +
        row("essential", s.essential, s.essentialD, true) +
        row("functionality", s.func, s.funcD, false) +
        row("analytics", s.analytics, s.analyticsD, false) +
        row("social", s.social, s.socialD, false) +
        '<div class="dbim-modal-actions">' +
          '<button type="button" class="dbim-btn dbim-btn--primary" data-consent="save">' +
            esc(s.save) + "</button>" +
        "</div>" +
      "</div></div>";
  }

  /* Focus trap for modal dialogs (WCAG 2.1.2 no trap + 2.4.3 order + Esc). */
  var lastFocus = null;
  function trapFocus(container, e) {
    var f = container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function openModal(html) {
    lastFocus = document.activeElement;
    var wrap = document.createElement("div");
    wrap.id = "dbimModalHost";
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    var dlg = wrap.querySelector(".dbim-modal");
    var keyH = function (e) {
      if (e.key === "Escape") { closeModal(); return; }
      if (e.key === "Tab") trapFocus(dlg, e);
    };
    wrap.addEventListener("keydown", keyH);
    wrap._keyH = keyH;
    var first = dlg.querySelector("button, input");
    if (first) first.focus();
    return wrap;
  }
  function closeModal() {
    var wrap = document.getElementById("dbimModalHost");
    if (wrap) wrap.parentNode.removeChild(wrap);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function saveChoice(choice) {
    var c;
    if (choice === "all") {
      c = { essential: true, functionality: true, analytics: true, social: true };
    } else if (choice === "none") {
      c = { essential: true, functionality: false, analytics: false, social: false };
    } else { return; }
    c.v = 1;
    c.at = new Date().toISOString().slice(0, 10);
    writeConsent(c);
    dismissBanner();
    announce(S().saved);
  }
  function saveCustom() {
    var wrap = document.getElementById("dbimModalHost");
    var c = { essential: true, v: 1, at: new Date().toISOString().slice(0, 10) };
    ["functionality", "analytics", "social"].forEach(function (k) {
      var box = wrap && wrap.querySelector('input[data-cat="' + k + '"]');
      c[k] = !!(box && box.checked);
    });
    writeConsent(c);
    closeModal();
    dismissBanner();
    announce(S().saved);
  }
  function dismissBanner() {
    var b = document.getElementById("dbimCookieHost");
    if (b) b.parentNode.removeChild(b);
  }
  function maybeShowBanner() {
    if (readConsent()) return;  /* choice stored -> stay silent (easy withdraw below) */
    var host = document.createElement("div");
    host.id = "dbimCookieHost";
    host.innerHTML = bannerHtml();
    document.body.appendChild(host);
  }
  /* Withdraw / change: footer link + API (DPDP: consent must be withdrawable). */
  function openPreferences() {
    openModal(modalHtml());
  }

  /* ------------------------------------------------------ tabs/accordion
   * Progressive enhancement via data attributes:
   *   <div class="dbim-tabs" data-dbim-tabs> ... role=tablist/tab/tabpanel
   *   <div class="dbim-accordion" data-dbim-accordion> buttons toggle panels.
   * Keyboard: arrows move between tabs (WAI-APG); buttons natively keyboard-ok. */
  function initTabs(root) {
    var tabs = (root || document).querySelectorAll("[data-dbim-tabs]");
    Array.prototype.forEach.call(tabs, function (wrap) {
      if (wrap._dbimInit) return; wrap._dbimInit = true;
      var tablist = wrap.querySelector('[role="tablist"]');
      if (!tablist) return;
      var tabEls = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
      function select(tab, focus) {
        tabEls.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", on ? "true" : "false");
          t.tabIndex = on ? 0 : -1;
          var panel = document.getElementById(t.getAttribute("aria-controls"));
          if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
      }
      tabEls.forEach(function (t, i) {
        t.addEventListener("click", function () { select(t, false); });
        t.addEventListener("keydown", function (e) {
          var j = null;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tabEls.length;
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tabEls.length) % tabEls.length;
          if (e.key === "Home") j = 0;
          if (e.key === "End") j = tabEls.length - 1;
          if (j !== null) { e.preventDefault(); select(tabEls[j], true); }
        });
      });
      var current = tabEls.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0] || tabEls[0];
      if (current) select(current, false);
    });
  }

  function initAccordions(root) {
    var accs = (root || document).querySelectorAll("[data-dbim-accordion]");
    Array.prototype.forEach.call(accs, function (acc) {
      if (acc._dbimInit) return; acc._dbimInit = true;
      Array.prototype.forEach.call(acc.querySelectorAll("button[aria-expanded]"), function (btn) {
        btn.addEventListener("click", function () {
          var open = btn.getAttribute("aria-expanded") === "true";
          btn.setAttribute("aria-expanded", open ? "false" : "true");
          var panel = document.getElementById(btn.getAttribute("aria-controls"));
          if (panel) panel.hidden = open;
        });
      });
    });
  }

  /* ------------------------------------------------------------- alerts --
   * DBIM.alert(kind, title, body) -> HTML string for inline page alerts
   * (role=alert for error, role=status otherwise). Icon + text, never colour-alone. */
  var ALERT_ICON = { success: "check", warning: "warn", error: "error", info: "info" };
  function alert(kind, title, body) {
    var k = ALERT_ICON[kind] ? kind : "info";
    var role = k === "error" ? 'role="alert"' : 'role="status"';
    return '<div class="dbim-alert dbim-alert--' + k + '" ' + role + ">" +
      icon(ALERT_ICON[k]) +
      "<div><strong>" + esc(title) + "</strong>" +
      (body ? "<div>" + body + "</div>" : "") + "</div></div>";
  }

  /* --------------------------------------------------------- pagination --
   * DBIM.pagination(current, total, hrefFor) -> nav HTML. hrefFor(page) maps
   * to the real URL/hash; windowed with gaps (1 … 4 5 [6] 7 8 … 20). */
  function pagination(current, total, hrefFor) {
    current = Math.max(1, Math.min(total, current | 0)); total = Math.max(1, total | 0);
    if (total <= 1) return "";
    hrefFor = hrefFor || function (p) { return "#page=" + p; };
    var pages = [1];
    for (var p = current - 2; p <= current + 2; p++) if (p > 1 && p < total) pages.push(p);
    if (total > 1) pages.push(total);
    var items = [];
    var prev = 0;
    pages.forEach(function (p) {
      if (p - prev > 1) items.push('<li><span class="dbim-page-gap" aria-hidden="true">…</span></li>');
      items.push("<li>" + (p === current
        ? '<span aria-current="page">' + p + "</span>"
        : '<a href="' + esc(hrefFor(p)) + '" aria-label="Page ' + p + '">' + p + "</a>") + "</li>");
      prev = p;
    });
    return '<nav aria-label="Pagination"><ul class="dbim-pagination">' + items.join("") + "</ul></nav>";
  }

  /* ------------------------------------------------------------ init ---- */
  function init() {
    checkTheme();
    maybeShowBanner();
    initTabs(document);
    initAccordions(document);
    document.addEventListener("click", function (e) {
      var t = e.target && e.target.closest ? e.target.closest("[data-consent]") : null;
      if (!t) {
        var pref = e.target && e.target.closest ? e.target.closest("[data-dbim-consent-prefs]") : null;
        if (pref) { e.preventDefault(); openPreferences(); }
        return;
      }
      var action = t.getAttribute("data-consent");
      if (action === "custom") openModal(modalHtml());
      else if (action === "save") saveCustom();
      else saveChoice(action);
    });
    /* Re-run enhancers after SPA route renders (app.js render() is sync). */
    window.addEventListener("hashchange", function () {
      window.setTimeout(function () { initTabs(document); initAccordions(document); }, 0);
    });
  }

  window.DBIM = {
    icon: icon,
    alert: alert,
    pagination: pagination,
    openModal: openModal,
    closeModal: closeModal,
    consentAllowed: consentAllowed,
    openPreferences: openPreferences,
    initTabs: initTabs,
    initAccordions: initAccordions,
    init: init
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
