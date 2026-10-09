/* ==========================================================================
 * Pashu-Mitra — Global Shell: Government Utility Bar, Accessibility Controls,
 *                Institutional Brand Header, Primary Navigation, Breadcrumbs,
 *                Announcements, Page Metadata, and Government Service Footer.
 * --------------------------------------------------------------------------
 * Indian Government Digital Service / GIGW 3.0 / WCAG 2.1 AA Compliance
 *   A27 (2.4.1) skip link / bypass blocks      -> skipLink() + #site-header
 *   A50 (4.1.3) status messages                -> announce()
 *   A15 (1.4.4) resize text 200%               -> textScale() (A- / A / A+)
 *   A14 (1.4.3) contrast / high contrast       -> highContrast toggle
 *   A25 (2.2.2) pause animation                -> reducedMotion toggle
 *   A38 (3.1.1) language of page               -> language select + <html lang>
 *   A28 (2.4.2) page titled                    -> setPageMeta()
 *   Q01 (emblem/logo), Q02 (ownership)         -> header
 *   Q05 (last updated), Q09-Q12, Q18 minimum   -> footer
 *   L04 external link indication               -> externalLink()
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

    // Text scale — font-size only. The font FAMILY is never modified.
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
        ? shellT("textNormal")
        : pct + "%";
    }
  }

  function setScaleIndex(i) {
    prefs.scaleIndex = Math.min(SCALES.length - 1, Math.max(0, i));
    savePrefs();
    applyPrefs();
    const msg = prefs.scaleIndex === DEFAULT_SCALE_INDEX
      ? shellT("textReset")
      : shellT("textSet") + Math.round(SCALES[prefs.scaleIndex] * 100) + "%";
    announce(msg);
  }

  function togglePref(key) {
    prefs[key] = !prefs[key];
    savePrefs();
    applyPrefs();
    if (key === "highContrast") {
      announce(prefs[key] ? shellT("highContrastOn") : shellT("highContrastOff"));
    }
    if (key === "reducedMotion") {
      announce(prefs[key] ? shellT("reduceMotionOn") : shellT("reduceMotionOff"));
    }
  }

  function setLanguage(lang) {
    if (!["en", "hi", "mr", "te"].includes(lang)) return;
    prefs.lang = lang;
    savePrefs();
    if (window.state) {
      window.state.lang = lang;
      // app.js reads "pm_lang" at boot; the shell select must update the SAME
      // key or the app would silently reset to English on the next reload.
      try { localStorage.setItem("pm_lang", lang); } catch (_) {}
      try { localStorage.setItem("lang", lang); } catch (_) {}
    }
    document.documentElement.lang = lang;
    const select = document.getElementById("pmGlobalLangSelect");
    if (select) select.value = lang;
    const selectMobile = document.getElementById("pmGlobalLangSelectMobile");
    if (selectMobile) selectMobile.value = lang;

    if (typeof window.router === "function") {
      window.router();
    }
    updateNavigation();
    const langNames = shellT("langNames") || { en: "English", hi: "Hindi", mr: "Marathi", te: "Telugu" };
    announce(shellT("langChanged") + (langNames[lang] || lang));
  }

  /**
   * Called by app.js setLang(): the app changed its own language state, so the
   * shell re-renders every translated string and re-syncs its controls.
   */
  function syncAppLanguage(lang) {
    if (!["en", "hi", "mr", "te"].includes(lang)) return;
    prefs.lang = lang;
    savePrefs();
    document.documentElement.lang = lang;
    updateNavigation();
    const footerHost = document.getElementById("pmFooterHost");
    if (footerHost) footerHost.innerHTML = renderFooter();
  }

  /* ------------------------------------------------- screen-reader announcer
   * WCAG 4.1.3 Status Messages (GIGW A50).
   */
  let politeTimer = null;
  function announce(message, assertive) {
    const id = assertive ? "pmLiveAssertive" : "pmLivePolite";
    const region = document.getElementById(id);
    if (!region) return;
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

    const lang = (o.lang || (window.state && window.state.lang) || "en");
    document.documentElement.lang = lang;

    let link = document.getElementById("pmCanonical");
    if (!link) {
      link = document.createElement("link");
      link.id = "pmCanonical";
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = window.location.href;

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
  function crumbLabelFor(key) {
    const map = { "#/": "crumbHome", "#/home": "crumbHome", "#/about": "fAboutUs", "#/contact": "contact", "#/feedback": "fFeedback", "#/help": "help", "#/sitemap": "fSiteMap", "#/search": "search", "#/policies": "fPolicies", owner: "crumbOwner", vet: "crumbVet", govt: "crumbGovt", lab: "crumbLab" };
    return map[key] || null;
  }

  function breadcrumbTrail(routePath, extraLabel) {
    const parts = String(routePath || "").split("/").filter(Boolean);
    const trail = [{ href: "#/home", label: shellT("crumbHome") }];
    if (parts[0] && crumbLabelFor(parts[0])) {
      trail.push({ href: "#/", label: shellT(crumbLabelFor(parts[0])) });
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

  /* ================================================================= i18n ==
   * The global shell (utility bar, header, primary navigation, footer) is
   * part of the Farmer-facing interface, so every visible string is
   * translated for all four portal languages. The product name "Pashu-Mitra"
   * is a BRAND NAME and is deliberately never translated.
   */
  const SHELL_I18N = {
    en: {
      identityTitle: "Animal Health & Livestock Services",
      identitySub: "पशु स्वास्थ्य एवं पशुधन सेवा",
      skipToMain: "Skip to Main Content",
      textSize: "Text size",
      decreaseText: "Decrease text size",
      resetText: "Reset text size to normal",
      increaseText: "Increase text size",
      textNormal: "Normal (100%)",
      textReset: "Text size reset to normal",
      textSet: "Text size set to ",
      highContrast: "High contrast",
      highContrastOn: "High contrast mode is on",
      highContrastOff: "High contrast mode off",
      reduceMotion: "Reduce motion",
      reduceMotionOn: "Animations reduced",
      reduceMotionOff: "Animations enabled",
      help: "Help",
      contact: "Contact",
      search: "Search",
      portalLang: "Portal Language",
      langChanged: "Language changed to ",
      searchLabel: "Search",
      searchAria: "Search animal health portal",
      farmerOtpLogin: "Farmer OTP Login",
      officerAccess: "Officer Access",
      signOut: "Sign out",
      signOutAria: "Sign out of Pashu-Mitra",
      notificationsAria: "View notifications",
      goHomeAria: "go to the home page",
      roleOwner: "Farmer",
      roleVet: "Veterinarian",
      roleGovt: "Government Officer",
      roleLab: "Laboratory Diagnostician",
      nav: {
        owner: [["#/owner/dashboard", "Home", "🏠"], ["#/owner/livestock", "My Livestock", "🐄"], ["#/owner/cases", "Cases", "📋"], ["#/owner/prescriptions", "Health & Treatment", "💊"], ["#/owner/webcall", "Web Call", "📞"], ["#/owner/notifications", "Notifications", "🔔"], ["#/owner/profile", "Profile", "👤"]],
        vet: [["#/vet/dashboard", "Dashboard", "📊"], ["#/vet/cases", "Cases", "🩺"], ["#/vet/calls", "Web Calls", "📞"], ["#/vet/advisories", "Advisories", "📢"], ["#/vet/search", "Livestock", "🔍"], ["#/vet/campaigns", "Campaigns", "💉"], ["#/vet/reports", "Reports", "📋"], ["#/vet/profile", "Profile", "👤"]],
        govt: [["#/govt/dashboard", "Dashboard", "📊"], ["#/govt/surveillance", "Surveillance", "🌐"], ["#/govt/blocks", "Districts", "🏘️"], ["#/govt/trends", "Trends", "📈"], ["#/govt/gis", "GIS Map", "🗺️"], ["#/govt/ai", "AI Outbreak", "🧠"], ["#/govt/export", "Reports & Export", "📥"], ["#/govt/profile", "Profile", "👤"]],
        lab: [["#/lab/dashboard", "Dashboard", "📊"], ["#/lab/queue", "Sample Queue", "🧪"], ["#/scan", "QR Scanner", "📷"], ["#/lab/lab-reports", "Reports", "📋"], ["#/lab/notifications", "Alerts", "🔔"], ["#/lab/profile", "Profile", "👤"]],
        public: [["#/home", "Home", "🏛️"], ["#/login/owner", "Farmer Portal", "🧑‍🌾"], ["#/login/vet", "Veterinary Portal", "🩺"], ["#/login/govt", "Government Portal", "🏛️"], ["#/login/lab", "Laboratory Portal", "🧪"], ["#/about", "About Us", "ℹ️"], ["#/contact", "Contact", "📞"], ["#/help", "Help", "❓"]],
      },
      fAbout: "About this service",
      fContact: "Contact",
      fUse: "Using this site",
      fPolicies: "Policies",
      fEmail: "Email: ",
      fHelpline: "Emergency Animal Helpline: ",
      fHours: "Hours: ",
      fDirectory: "Full contact directory",
      fOwnership: "Ownership:",
      fPending: "placeholder pending confirmation by the owning organisation",
      fAboutUs: "About Us",
      fFeedback: "Feedback",
      fSiteMap: "Site Map",
      fLastReviewed: "Last reviewed / updated: ",
      fAccessibility: "Accessibility Statement",
      fPrivacy: "Privacy",
      fTerms: "Terms",
      fCopyright: "Copyright",
      fGrievance: "Grievance",
      fContentNote: "Content on this platform is provided for animal-health service delivery. Policy pages are templates pending approval by the owning organisation.",
      extNewWindow: "(external site, opens in a new window)",
      extSite: "(external site)",
      crumbHome: "Home",
      crumbOwner: "Animal Owner",
      crumbVet: "Veterinarian",
      crumbGovt: "Government",
      crumbLab: "Laboratory",
      langNames: { en: "English", hi: "Hindi", mr: "Marathi", te: "Telugu" },
    },
    hi: {
      identityTitle: "पशु स्वास्थ्य एवं पशुधन सेवा",
      identitySub: "Animal Health & Livestock Services",
      skipToMain: "मुख्य सामग्री पर जाएँ",
      textSize: "पाठ आकार",
      decreaseText: "पाठ आकार घटाएँ",
      resetText: "पाठ आकार सामान्य करें",
      increaseText: "पाठ आकार बढ़ाएँ",
      textNormal: "सामान्य (100%)",
      textReset: "पाठ आकार सामान्य किया गया",
      textSet: "पाठ आकार सेट: ",
      highContrast: "उच्च कंट्रास्ट",
      highContrastOn: "उच्च कंट्रास्ट मोड चालू",
      highContrastOff: "उच्च कंट्रास्ट मोड बंद",
      reduceMotion: "एनिमेशन कम करें",
      reduceMotionOn: "एनिमेशन कम किए गए",
      reduceMotionOff: "एनिमेशन चालू",
      help: "सहायता",
      contact: "संपर्क",
      search: "खोज",
      portalLang: "पोर्टल भाषा",
      langChanged: "भाषा बदली गई: ",
      searchLabel: "खोज",
      searchAria: "पशु स्वास्थ्य पोर्टल खोजें",
      farmerOtpLogin: "किसान OTP लॉगिन",
      officerAccess: "अधिकारी प्रवेश",
      signOut: "लॉग आउट",
      signOutAria: "Pashu-Mitra से लॉग आउट करें",
      notificationsAria: "सूचनाएँ देखें",
      goHomeAria: "मुख्य पृष्ठ पर जाएँ",
      roleOwner: "किसान",
      roleVet: "पशु चिकित्सक",
      roleGovt: "सरकारी अधिकारी",
      roleLab: "प्रयोगशाला विशेषज्ञ",
      nav: {
        owner: [["#/owner/dashboard", "होम", "🏠"], ["#/owner/livestock", "मेरा पशुधन", "🐄"], ["#/owner/cases", "मामले", "📋"], ["#/owner/prescriptions", "स्वास्थ्य व उपचार", "💊"], ["#/owner/webcall", "वेब कॉल", "📞"], ["#/owner/notifications", "सूचनाएँ", "🔔"], ["#/owner/profile", "प्रोफ़ाइल", "👤"]],
        vet: [["#/vet/dashboard", "डैशबोर्ड", "📊"], ["#/vet/cases", "मामले", "🩺"], ["#/vet/calls", "वेब कॉल", "📞"], ["#/vet/advisories", "सलाह", "📢"], ["#/vet/search", "पशुधन", "🔍"], ["#/vet/campaigns", "अभियान", "💉"], ["#/vet/reports", "रिपोर्ट", "📋"], ["#/vet/profile", "प्रोफ़ाइल", "👤"]],
        govt: [["#/govt/dashboard", "डैशबोर्ड", "📊"], ["#/govt/surveillance", "निगरानी", "🌐"], ["#/govt/blocks", "ज़िले", "🏘️"], ["#/govt/trends", "प्रवृत्तियाँ", "📈"], ["#/govt/gis", "जीआईएस नक्शा", "🗺️"], ["#/govt/ai", "एआई प्रकोप", "🧠"], ["#/govt/export", "रिपोर्ट व निर्यात", "📥"], ["#/govt/profile", "प्रोफ़ाइल", "👤"]],
        lab: [["#/lab/dashboard", "डैशबोर्ड", "📊"], ["#/lab/queue", "नमूना कतार", "🧪"], ["#/scan", "क्यूआर स्कैन", "📷"], ["#/lab/lab-reports", "रिपोर्ट", "📋"], ["#/lab/notifications", "अलर्ट", "🔔"], ["#/lab/profile", "प्रोफ़ाइल", "👤"]],
        public: [["#/home", "होम", "🏛️"], ["#/login/owner", "किसान पोर्टल", "🧑‍🌾"], ["#/login/vet", "पशु चिकित्सा पोर्टल", "🩺"], ["#/login/govt", "सरकारी पोर्टल", "🏛️"], ["#/login/lab", "प्रयोगशाला पोर्टल", "🧪"], ["#/about", "हमारे बारे में", "ℹ️"], ["#/contact", "संपर्क", "📞"], ["#/help", "सहायता", "❓"]],
      },
      fAbout: "इस सेवा के बारे में",
      fContact: "संपर्क",
      fUse: "इस साइट का उपयोग",
      fPolicies: "नीतियाँ",
      fEmail: "ईमेल: ",
      fHelpline: "आपातकालीन पशु हेल्पलाइन: ",
      fHours: "समय: ",
      fDirectory: "पूर्ण संपर्क निर्देशिका",
      fOwnership: "स्वामित्व:",
      fPending: "स्वामी संगठन द्वारा पुष्टि हेतु लंबित",
      fAboutUs: "हमारे बारे में",
      fFeedback: "प्रतिक्रिया",
      fSiteMap: "साइट मैप",
      fLastReviewed: "अंतिम समीक्षा / अद्यतन: ",
      fAccessibility: "सुगम्यता विवरण",
      fPrivacy: "गोपनीयता",
      fTerms: "शर्तें",
      fCopyright: "कॉपीराइट",
      fGrievance: "शिकायत",
      fContentNote: "इस प्लेटफ़ॉर्म पर दी गई सामग्री पशु स्वास्थ्य सेवा हेतु है। नीति पृष्ठ स्वामी संगठन की स्वीकृति हेतु लंबित हैं।",
      extNewWindow: "(बाहरी साइट, नई विंडो में खुलती है)",
      extSite: "(बाहरी साइट)",
      crumbHome: "होम",
      crumbOwner: "पशु स्वामी",
      crumbVet: "पशु चिकित्सक",
      crumbGovt: "सरकार",
      crumbLab: "प्रयोगशाला",
      langNames: { en: "English", hi: "हिन्दी", mr: "मराठी", te: "తెలుగు" },
    },
    mr: {
      identityTitle: "पशु आरोग्य व पशुधन सेवा",
      identitySub: "Animal Health & Livestock Services",
      skipToMain: "मुख्य मजकुराकडे जा",
      textSize: "मजकूराचा आकार",
      decreaseText: "मजकूराचा आकार कमी करा",
      resetText: "मजकूराचा आकार सामान्य करा",
      increaseText: "मजकूराचा आकार वाढवा",
      textNormal: "सामान्य (100%)",
      textReset: "मजकूराचा आकार सामान्य केला",
      textSet: "मजकूराचा आकार सेट: ",
      highContrast: "जास्त कॉन्ट्रास्ट",
      highContrastOn: "जास्त कॉन्ट्रास्ट मोड सुरू",
      highContrastOff: "जास्त कॉन्ट्रास्ट मोड बंद",
      reduceMotion: "ॲनिमेशन कमी करा",
      reduceMotionOn: "ॲनिमेशन कमी केले",
      reduceMotionOff: "ॲनिमेशन सुरू",
      help: "मदत",
      contact: "संपर्क",
      search: "शोध",
      portalLang: "पोर्टल भाषा",
      langChanged: "भाषा बदलली: ",
      searchLabel: "शोध",
      searchAria: "पशु आरोग्य पोर्टल शोधा",
      farmerOtpLogin: "शेतकरी OTP लॉगिन",
      officerAccess: "अधिकारी प्रवेश",
      signOut: "बाहेर पडा",
      signOutAria: "Pashu-Mitra मधून बाहेर पडा",
      notificationsAria: "सूचना पहा",
      goHomeAria: "मुख्य पृष्ठावर जा",
      roleOwner: "शेतकरी",
      roleVet: "पशुवैद्यक",
      roleGovt: "शासकीय अधिकारी",
      roleLab: "प्रयोगशाळा तज्ज्ञ",
      nav: {
        owner: [["#/owner/dashboard", "मुख्यपृष्ठ", "🏠"], ["#/owner/livestock", "माझे पशुधन", "🐄"], ["#/owner/cases", "प्रकरणे", "📋"], ["#/owner/prescriptions", "आरोग्य व उपचार", "💊"], ["#/owner/webcall", "वेब कॉल", "📞"], ["#/owner/notifications", "सूचना", "🔔"], ["#/owner/profile", "प्रोफाइल", "👤"]],
        vet: [["#/vet/dashboard", "डॅशबोर्ड", "📊"], ["#/vet/cases", "प्रकरणे", "🩺"], ["#/vet/calls", "वेब कॉल", "📞"], ["#/vet/advisories", "सल्ला", "📢"], ["#/vet/search", "पशुधन", "🔍"], ["#/vet/campaigns", "मोहीम", "💉"], ["#/vet/reports", "अहवाल", "📋"], ["#/vet/profile", "प्रोफाइल", "👤"]],
        govt: [["#/govt/dashboard", "डॅशबोर्ड", "📊"], ["#/govt/surveillance", "संसर्ग नियंत्रण", "🌐"], ["#/govt/blocks", "जिल्हे", "🏘️"], ["#/govt/trends", "कल", "📈"], ["#/govt/gis", "जीआयएस नकाशा", "🗺️"], ["#/govt/ai", "एआय उत्पात", "🧠"], ["#/govt/export", "अहवाल व निर्यात", "📥"], ["#/govt/profile", "प्रोफाइल", "👤"]],
        lab: [["#/lab/dashboard", "डॅशबोर्ड", "📊"], ["#/lab/queue", "नमुना रांग", "🧪"], ["#/scan", "क्यूआर स्कॅन", "📷"], ["#/lab/lab-reports", "अहवाल", "📋"], ["#/lab/notifications", "सूचना", "🔔"], ["#/lab/profile", "प्रोफाइल", "👤"]],
        public: [["#/home", "मुख्यपृष्ठ", "🏛️"], ["#/login/owner", "शेतकरी पोर्टल", "🧑‍🌾"], ["#/login/vet", "पशुवैद्यक पोर्टल", "🩺"], ["#/login/govt", "शासकीय पोर्टल", "🏛️"], ["#/login/lab", "प्रयोगशाळा पोर्टल", "🧪"], ["#/about", "आमच्याविषयी", "ℹ️"], ["#/contact", "संपर्क", "📞"], ["#/help", "मदत", "❓"]],
      },
      fAbout: "या सेवेविषयी",
      fContact: "संपर्क",
      fUse: "या संकेतस्थळाचा वापर",
      fPolicies: "धोरणे",
      fEmail: "ईमेल: ",
      fHelpline: "आपत्कालीन पशु हेल्पलाइन: ",
      fHours: "वेळ: ",
      fDirectory: "संपूर्ण संपर्क नोंदणी",
      fOwnership: "मालकी:",
      fPending: "मालक संस्थेच्या पुष्टीसाठी प्रलंबित",
      fAboutUs: "आमच्याविषयी",
      fFeedback: "अभिप्राय",
      fSiteMap: "साइट नकाशा",
      fLastReviewed: "शेवटचे पुनरावलोकन / अद्ययावत: ",
      fAccessibility: "सुलभता विधान",
      fPrivacy: "गोपनीयता",
      fTerms: "अटी",
      fCopyright: "कॉपिराइट",
      fGrievance: "तक्रार",
      fContentNote: "या व्यासपीठावरील मजकूर पशुआरोग्य सेवेसाठी आहे. धोरण पृष्ठे मालक संस्थेच्या मान्यतेसाठी प्रलंबित आहेत.",
      extNewWindow: "(बाह्य संकेतस्थळ, नवीन विंडोमध्ये उघडते)",
      extSite: "(बाह्य संकेतस्थळ)",
      crumbHome: "मुख्यपृष्ठ",
      crumbOwner: "पशुमालक",
      crumbVet: "पशुवैद्यक",
      crumbGovt: "शासन",
      crumbLab: "प्रयोगशाळा",
      langNames: { en: "English", hi: "हिन्दी", mr: "मराठी", te: "తెలుగు" },
    },
    te: {
      identityTitle: "పశు ఆరోగ్య & పశుసంపద సేవలు",
      identitySub: "Animal Health & Livestock Services",
      skipToMain: "ముఖ్య కంటెంట్‌కు వెళ్లండి",
      textSize: "టెక్స్ట్ పరిమాణం",
      decreaseText: "టెక్స్ట్ పరిమాణం తగ్గించండి",
      resetText: "టెక్స్ట్ పరిమాణాన్ని సాధారణం చేయండి",
      increaseText: "టెక్స్ట్ పరిమాణం పెంచండి",
      textNormal: "సాధారణం (100%)",
      textReset: "టెక్స్ట్ పరిమాణం సాధారణం చేయబడింది",
      textSet: "టెక్స్ట్ పరిమాణం సెట్: ",
      highContrast: "అధిక కాంట్రాస్ట్",
      highContrastOn: "అధిక కాంట్రాస్ట్ మోడ్ ఆన్",
      highContrastOff: "అధిక కాంట్రాస్ట్ మోడ్ ఆఫ్",
      reduceMotion: "యానిమేషన్ తక్కువ చేయండి",
      reduceMotionOn: "యానిమేషన్ తగ్గించబడింది",
      reduceMotionOff: "యానిమేషన్ ఆన్",
      help: "సహాయం",
      contact: "సంప్రదించండి",
      search: "వెతుకు",
      portalLang: "పోర్టల్ భాష",
      langChanged: "భాష మార్చబడింది: ",
      searchLabel: "వెతుకు",
      searchAria: "పశు ఆరోగ్య పోర్టల్‌ను వెతకండి",
      farmerOtpLogin: "రైతు OTP లాగిన్",
      officerAccess: "అధికారి ప్రవేశం",
      signOut: "సైన్ అవుట్",
      signOutAria: "Pashu-Mitra నుండి సైన్ అవుట్",
      notificationsAria: "నోటిఫికేషన్లు చూడండి",
      goHomeAria: "హోమ్ పేజీకి వెళ్లండి",
      roleOwner: "రైతు",
      roleVet: "పశువైద్యుడు",
      roleGovt: "ప్రభుత్వ అధికారి",
      roleLab: "ప్రయోగశాల నిపుణుడు",
      nav: {
        owner: [["#/owner/dashboard", "హోమ్", "🏠"], ["#/owner/livestock", "నా పశువులు", "🐄"], ["#/owner/cases", "కేసులు", "📋"], ["#/owner/prescriptions", "ఆరోగ్యం & చికిత్స", "💊"], ["#/owner/webcall", "వెబ్ కాల్", "📞"], ["#/owner/notifications", "నోటిఫికేషన్లు", "🔔"], ["#/owner/profile", "ప్రొఫైల్", "👤"]],
        vet: [["#/vet/dashboard", "డాష్‌బోర్డ్", "📊"], ["#/vet/cases", "కేసులు", "🩺"], ["#/vet/calls", "వెబ్ కాల్స్", "📞"], ["#/vet/advisories", "సలహాలు", "📢"], ["#/vet/search", "పశుసంపద", "🔍"], ["#/vet/campaigns", "క్యాంపెయిన్లు", "💉"], ["#/vet/reports", "నివేదికలు", "📋"], ["#/vet/profile", "ప్రొఫైల్", "👤"]],
        govt: [["#/govt/dashboard", "డాష్‌బోర్డ్", "📊"], ["#/govt/surveillance", "పర్యవేక్షణ", "🌐"], ["#/govt/blocks", "జిల్లాలు", "🏘️"], ["#/govt/trends", "ధోరణలు", "📈"], ["#/govt/gis", "జిఐఎస్ మ్యాప్", "🗺️"], ["#/govt/ai", "ఏఐ వ్యాధివ్యాప్తి", "🧠"], ["#/govt/export", "నివేదికలు & ఎగుమతి", "📥"], ["#/govt/profile", "ప్రొఫైల్", "👤"]],
        lab: [["#/lab/dashboard", "డాష్‌బోర్డ్", "📊"], ["#/lab/queue", "నమూనా క్యూ", "🧪"], ["#/scan", "క్యూఆర్ స్కాన్", "📷"], ["#/lab/lab-reports", "నివేదికలు", "📋"], ["#/lab/notifications", "హెచ్చరికలు", "🔔"], ["#/lab/profile", "ప్రొఫైల్", "👤"]],
        public: [["#/home", "హోమ్", "🏛️"], ["#/login/owner", "రైతు పోర్టల్", "🧑‍🌾"], ["#/login/vet", "పశువైద్య పోర్టల్", "🩺"], ["#/login/govt", "ప్రభుత్వ పోర్టల్", "🏛️"], ["#/login/lab", "ప్రయోగశాల పోర్టల్", "🧪"], ["#/about", "మా గురించి", "ℹ️"], ["#/contact", "సంప్రదించండి", "📞"], ["#/help", "సహాయం", "❓"]],
      },
      fAbout: "ఈ సేవ గురించి",
      fContact: "సంప్రదింపు",
      fUse: "ఈ సైట్ వాడకం",
      fPolicies: "విధానాలు",
      fEmail: "ఇమెయిల్: ",
      fHelpline: "అత్యవసర పశు హెల్ప్‌లైన్: ",
      fHours: "సమయం: ",
      fDirectory: "పూర్తి సంప్రదింపు డైరెక్టరీ",
      fOwnership: "యాజమాన్యం:",
      fPending: "యజమాని సంస్థ ఆమోదం కోసం పెండింగ్",
      fAboutUs: "మా గురించి",
      fFeedback: "అభిప్రాయం",
      fSiteMap: "సైట్ మ్యాప్",
      fLastReviewed: "చివరి సమీక్ష / నవీకరణ: ",
      fAccessibility: "ప్రవేశపెట్టుకోగలిగిన ప్రకటన",
      fPrivacy: "గోప్యత",
      fTerms: "నిబంధనలు",
      fCopyright: "కాపీరైట్",
      fGrievance: "ఫిర్యాదు",
      fContentNote: "ఈ ప్లాట్‌ఫారమ్‌లోని కంటెంట్ పశు ఆరోగ్య సేవ కోసం అందించబడింది. విధాన పేజీలు యజమాని సంస్థ ఆమోదం కోసం పెండింగ్‌లో ఉన్నాయి.",
      crumbHome: "హోమ్",
      crumbOwner: "పశువుల యజమాని",
      crumbVet: "పశువైద్యుడు",
      crumbGovt: "ప్రభుత్వం",
      crumbLab: "ప్రయోగశాల",
      langNames: { en: "English", hi: "हिन्दी", mr: "मराठी", te: "తెలుగు" },
    },
  };

  function shellLang() {
    if (window.state && typeof window.state.lang === "string") return window.state.lang;
    if (prefs.lang) return prefs.lang;
    return "en";
  }

  function shellT(key) {
    const dict = SHELL_I18N[shellLang()] || SHELL_I18N.en;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : SHELL_I18N.en[key];
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
      (newWin ? shellT("extNewWindow") : shellT("extSite")) +
      "</span>";
  }

  /* ------------------------------------------------------------- footer */
  function renderFooter() {
    const org = window.ORG || {};
    const owner = org.owner || {};
    const pending = !org.approved;
    const ft = shellT;

    const policyLinks = (org.policies || []).map(function (p) {
      return '<li><a href="#/policies/' + p.id + '">' + escapeHtml(p.label) +
        (p.approved === false ? ' <span class="pm-pending">' + escapeHtml(ft("fPending")) + "</span>" : "") +
        "</a></li>";
    }).join("");

    const lastReviewed = org.lastReviewed
      ? '<p class="pm-footer-line">' + escapeHtml(ft("fLastReviewed")) + '<time datetime="' +
        escapeHtml(org.lastReviewed) + '">' + escapeHtml(org.lastReviewed) + "</time></p>"
      : "";

    return '' +
      '<footer class="pm-footer" id="site-footer" role="contentinfo">' +
        '<div class="pm-footer-inner">' +
          '<section class="pm-footer-col" aria-labelledby="pm-f-about">' +
            '<h2 id="pm-f-about" class="pm-footer-h">' + escapeHtml(ft("fAbout")) + '</h2>' +
            '<p class="pm-org-name">' + escapeHtml(org.appName || "Pashu-Mitra") + "</p>" +
            '<p class="pm-footer-text">' + escapeHtml(org.tagline || "Animal Health & Livestock Services Platform") + "</p>" +
            (pending
              ? '<p class="pm-owner-note"><strong>' + escapeHtml(ft("fOwnership")) + '</strong> ' + escapeHtml(owner.name || "") +
                ' — <em>' + escapeHtml(ft("fPending")) + "</em></p>"
              : '<p class="pm-footer-text">' + escapeHtml(owner.name || "") + "</p>") +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-contact">' +
            '<h2 id="pm-f-contact" class="pm-footer-h">' + escapeHtml(ft("fContact")) + '</h2>' +
            '<p class="pm-footer-text">' + escapeHtml(owner.address || "") + "</p>" +
            '<p class="pm-footer-text">' + escapeHtml(ft("fEmail")) + escapeHtml(owner.email || "") + "</p>" +
            '<p class="pm-footer-text">' + escapeHtml(ft("fHelpline")) + "<strong>7382210251</strong></p>" +
            '<p class="pm-footer-text">' + escapeHtml(ft("fHours")) + escapeHtml(owner.workingHours || "Mon–Sat 09:00–18:00 IST") + "</p>" +
            '<p class="pm-footer-text"><a href="#/contact">' + escapeHtml(ft("fDirectory")) + "</a></p>" +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-use">' +
            '<h2 id="pm-f-use" class="pm-footer-h">' + escapeHtml(ft("fUse")) + '</h2>' +
            '<ul class="pm-footer-list">' +
              '<li><a href="#/about">' + escapeHtml(ft("fAboutUs")) + "</a></li>" +
              '<li><a href="#/help">' + escapeHtml(ft("help")) + "</a></li>" +
              '<li><a href="#/feedback">' + escapeHtml(ft("fFeedback")) + "</a></li>" +
              '<li><a href="#/sitemap">' + escapeHtml(ft("fSiteMap")) + "</a></li>" +
              '<li><a href="#/search">' + escapeHtml(ft("search")) + "</a></li>" +
              '<li><a href="#/policies">' + escapeHtml(ft("fPolicies")) + "</a></li>" +
            "</ul>" +
          "</section>" +

          '<section class="pm-footer-col" aria-labelledby="pm-f-policies">' +
            '<h2 id="pm-f-policies" class="pm-footer-h">' + escapeHtml(ft("fPolicies")) + '</h2>' +
            '<ul class="pm-footer-list">' + policyLinks + "</ul>" +
          "</section>" +
        "</div>" +

        '<div class="pm-footer-bar">' +
          '<p class="pm-footer-line">' +
            (org.nationalPortal
              ? externalLink(org.nationalPortal.url, org.nationalPortal.label) + " · "
              : "") +
            '<a href="#/policies/accessibility">' + escapeHtml(ft("fAccessibility")) + "</a> · " +
            '<a href="#/policies/privacy">' + escapeHtml(ft("fPrivacy")) + "</a> · " +
            '<a href="#/policies/terms">' + escapeHtml(ft("fTerms")) + "</a> · " +
            '<a href="#/policies/copyright">' + escapeHtml(ft("fCopyright")) + "</a> · " +
            '<a href="#/policies/grievance">' + escapeHtml(ft("fGrievance")) + "</a>" +
          "</p>" +
          lastReviewed +
          '<p class="pm-footer-line">' + escapeHtml(ft("fContentNote")) + "</p>" +
        "</div>" +
      "</footer>";
  }

  /* ------------------------------------------------------------ the bar
   * Government Utility Bar (GIGW 3.0 / NIC guidelines):
   * Left: Government / Service Identity
   * Right: Skip link, Font resizer (A-/A/A+), High contrast, Reduce motion, Language, Help, Contact, Search
   */
  function renderA11yBar() {
    const currentLang = shellLang();
    const T = shellT;
    return '' +
      '<div class="pm-a11y-bar" id="pmA11yBar">' +
        '<div class="pm-flag-stripe" aria-hidden="true"></div>' +
        '<div class="pm-a11y-inner">' +
          '<div class="pm-util-identity">' +
            '<span class="pm-util-title">' + escapeHtml(T("identityTitle")) + '</span>' +
            '<span class="pm-util-sub" lang="' + (currentLang === "hi" ? "en" : "hi") + '">' + escapeHtml(T("identitySub")) + '</span>' +
          "</div>" +
          '<div class="pm-util-tools">' +
            '<a class="pm-skip-link-inline" href="#main-content">' + escapeHtml(T("skipToMain")) + '</a>' +
            '<div class="pm-a11y-group" role="group" aria-label="' + escapeHtml(T("textSize")) + '">' +
              '<span class="pm-a11y-label" id="pmScaleLabel">' + escapeHtml(T("textSize")) + '</span>' +
              '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(PashuShell.getScaleIndex()-1)" ' +
                'aria-label="' + escapeHtml(T("decreaseText")) + '">A<span class="pm-a11y-smaller">-</span></button>' +
              '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(1)" ' +
                'aria-label="' + escapeHtml(T("resetText")) + '">A</button>' +
              '<button type="button" class="pm-a11y-btn" onclick="PashuShell.setScaleIndex(PashuShell.getScaleIndex()+1)" ' +
                'aria-label="' + escapeHtml(T("increaseText")) + '">A<span class="pm-a11y-bigger">+</span></button>' +
              '<span class="pm-a11y-value" id="pmScaleValue">' + escapeHtml(T("textNormal")) + '</span>' +
            "</div>" +

            '<div class="pm-a11y-group">' +
              '<button type="button" class="pm-a11y-btn pm-a11y-wide" data-a11y-toggle="highContrast" ' +
                'data-a11y-label="' + escapeHtml(T("highContrast")) + '" data-a11y-label-on="' + escapeHtml(T("highContrastOn")) + '" ' +
                'aria-pressed="false" onclick="PashuShell.togglePref(\'highContrast\')">' +
                '<span aria-hidden="true">◐</span> ' + escapeHtml(T("highContrast")) + '</button>' +
              '<button type="button" class="pm-a11y-btn pm-a11y-wide" data-a11y-toggle="reducedMotion" ' +
                'data-a11y-label="' + escapeHtml(T("reduceMotion")) + '" data-a11y-label-on="' + escapeHtml(T("reduceMotionOn")) + '" ' +
                'aria-pressed="false" onclick="PashuShell.togglePref(\'reducedMotion\')">' +
                '<span aria-hidden="true">⏸</span> ' + escapeHtml(T("reduceMotion")) + '</button>' +
            "</div>" +

            '<div class="pm-util-links">' +
              '<a href="#/help" class="pm-util-link">' + escapeHtml(T("help")) + '</a>' +
              '<a href="#/contact" class="pm-util-link">' + escapeHtml(T("contact")) + '</a>' +
              '<a href="#/search" class="pm-util-link">' + escapeHtml(T("search")) + '</a>' +
            "</div>" +

            '<div class="pm-util-lang">' +
              '<label for="pmGlobalLangSelect" class="sr-only">' + escapeHtml(T("portalLang")) + '</label>' +
              '<select id="pmGlobalLangSelect" class="pm-lang-select" onchange="PashuShell.setLanguage(this.value)" aria-label="' + escapeHtml(T("portalLang")) + '">' +
                '<option value="en"' + (currentLang === "en" ? ' selected' : '') + '>English</option>' +
                '<option value="hi"' + (currentLang === "hi" ? ' selected' : '') + '>हिन्दी</option>' +
                '<option value="mr"' + (currentLang === "mr" ? ' selected' : '') + '>मराठी</option>' +
                '<option value="te"' + (currentLang === "te" ? ' selected' : '') + '>తెలుగు</option>' +
              '</select>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>";
  }

  /* ---------------------------------------------------------- site header
   * GIGW Q01 (logo in proper ratio, prominent, alt text, links home)
   *      Q02 (ownership on every important entry page)
   * Government Main Brand Header + Role-specific Primary Navigation Bar
   */
  function getActiveUser() {
    try {
      if (window.state && window.state.user) return window.state.user;
      const raw = localStorage.getItem("user");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function getNavItemsForRole(role) {
    // Translated navigation (the labels come from the shell i18n dictionary;
    // routes are unchanged).
    const nav = shellT("nav") || SHELL_I18N.en.nav;
    const key = role === "owner" ? "owner" : role === "vet" ? "vet" : role === "govt" ? "govt" : role === "lab" ? "lab" : "public";
    const items = nav[key] || SHELL_I18N.en.nav[key] || [];
    return items.map(function (item) {
      return { href: item[0], label: item[1], icon: item[2] };
    });
  }

  function renderPrimaryNavigation() {
    const user = getActiveUser();
    const role = user ? user.role : null;
    const items = getNavItemsForRole(role);
    const currentHash = (window.location && window.location.hash) || "#/";

    const linksHtml = items.map((item) => {
      const isExact = currentHash === item.href;
      const isParent = item.href !== "#/" && currentHash.startsWith(item.href);
      const isActive = isExact || isParent;
      return (
        '<a href="' + escapeHtml(item.href) + '" class="pm-nav-link' + (isActive ? ' active' : '') + '"' +
          (isActive ? ' aria-current="page"' : '') + '>' +
          '<span class="pm-nav-icon" aria-hidden="true">' + item.icon + '</span> ' +
          '<span>' + escapeHtml(item.label) + '</span>' +
        '</a>'
      );
    }).join("");

    return (
      '<nav class="pm-primary-nav" id="pmPrimaryNav" aria-label="Primary Navigation">' +
        '<div class="pm-nav-inner">' +
          linksHtml +
        '</div>' +
      '</nav>'
    );
  }

  function renderSiteHeader() {
    const org = window.ORG || {};
    const logo = org.logo || {};
    const user = getActiveUser();
    const role = user ? user.role : null;

    const logoInner = (
      '<img class="pm-logo-img" src="' + escapeHtml(logo.src || 'assets/pashu-mitra-logo.png') + '" alt="' +
      escapeHtml(logo.alt || org.appName || "Pashu-Mitra") + '"' +
      (logo.aspectRatio && logo.aspectRatio !== "auto"
        ? ' style="aspect-ratio:' + escapeHtml(logo.aspectRatio) + '"' : "") +
      ' onerror="this.style.display=\'none\'">'
    );

    let userSection = "";
    if (user) {
      const roleBadge = {
        owner: shellT("roleOwner"),
        vet: shellT("roleVet"),
        govt: shellT("roleGovt"),
        lab: shellT("roleLab")
      }[role] || role;
      const notifHref = "#/" + role + "/notifications";
      userSection = (
        '<div class="pm-header-user-panel">' +
          '<a href="' + notifHref + '" class="pm-header-icon-btn" aria-label="' + escapeHtml(shellT("notificationsAria")) + '">🔔</a>' +
          '<div class="pm-user-badge-wrap">' +
            '<span class="pm-user-role-chip">' + escapeHtml(roleBadge) + '</span>' +
            '<span class="pm-user-name-text">' + escapeHtml(user.full_name || "") + '</span>' +
          '</div>' +
          '<button type="button" class="pm-header-logout-btn" onclick="logout()" aria-label="' + escapeHtml(shellT("signOutAria")) + '">' + escapeHtml(shellT("signOut")) + '</button>' +
        '</div>'
      );
    } else {
      userSection = (
        '<div class="pm-header-auth-actions">' +
          '<a href="#/login/owner" class="pm-auth-cta-farmer">' + shellT("farmerOtpLogin") + '</a>' +
          '<a href="#/officer-access" class="pm-auth-cta-staff">' + shellT("officerAccess") + '</a>' +
        '</div>'
      );
    }

    return '' +
      '<header class="pm-site-header" id="site-header" role="banner">' +
        '<div class="pm-site-header-inner">' +
          '<a class="pm-brand" href="' + escapeHtml(logo.href || "#/home") + '" ' +
            'aria-label="' + escapeHtml((org.appName || "Pashu-Mitra") + " — " + shellT("goHomeAria")) + '">' +
            logoInner +
            '<span class="pm-brand-text">' +
              '<span class="pm-brand-name">' + escapeHtml(org.appName || "Pashu-Mitra") + "</span>" +
              '<span class="pm-brand-tag">' + escapeHtml(shellLang() === "en" ? (org.tagline || "Animal Health & Livestock Services") : shellT("identityTitle")) + "</span>" +
            "</span>" +
          "</a>" +
          '<div class="pm-header-actions">' +
            '<button type="button" class="pm-header-search-btn" onclick="location.hash=\'#/search\'" aria-label="' + escapeHtml(shellT("searchAria")) + '">🔍 <span class="pm-search-label">' + escapeHtml(shellT("searchLabel")) + '</span></button>' +
            userSection +
          "</div>" +
          '<p class="pm-owner">' +
            '<span class="sr-only">Owned by: </span>' +
            escapeHtml((org.owner && org.owner.name) || "") +
          "</p>" +
        "</div>" +
        renderPrimaryNavigation() +
      "</header>";
  }

  function updateNavigation() {
    const barHost = document.getElementById("pmA11yBarHost");
    if (barHost) barHost.innerHTML = renderA11yBar();
    const headerHost = document.getElementById("pmSiteHeaderHost");
    if (headerHost) {
      headerHost.innerHTML = renderSiteHeader();
    }
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

    // Listen for hash changes to update active navigation tabs
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("hashchange", updateNavigation);
    }

    try {
      if (!localStorage.getItem(STORE)) {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq && mq.matches) { prefs.reducedMotion = true; savePrefs(); applyPrefs(); }
      }
    } catch (_) {}
  }

  // Export stable API
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
    setLanguage: setLanguage,
    syncAppLanguage: syncAppLanguage,
    updateNavigation: updateNavigation,
    prefs: prefs,
    renderFooter: renderFooter,
    // Renderers exposed for tests and for hosts that need to re-render a
    // single piece of chrome without a full navigation.
    renderSiteHeader: renderSiteHeader,
    renderA11yBar: renderA11yBar,
    renderPrimaryNavigation: renderPrimaryNavigation,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
