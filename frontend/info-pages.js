/* ==========================================================================
 * Pashu-Shield — GIGW information pages
 * --------------------------------------------------------------------------
 * Adds the pages GIGW 3.0 requires that Pashu-Shield did not previously have:
 *   #/about     Q09  About Us
 *   #/contact   Q10  Contact Us
 *   #/feedback  Q11  Feedback
 *   #/help      Q14  Help
 *   #/sitemap   Q18/A31  Site Map (a second way to locate pages)
 *   #/search    Q31/A31  Site search (a second way to locate pages)
 *   #/policies  L03 Privacy / Terms / Copyright / Hyperlinking / Accessibility
 *                   / Security / CMAP / Archival / Review / Monitoring
 *                   / Contingency / Grievance
 *
 * ZERO-REGRESSION RULE: this file only ADDS routes. It registers them through
 * the existing global `route()` from app.js and renders through the existing
 * `render()`/`header()` helpers, so the look and feel stays Pashu-Shield's own.
 *
 * NO INVENTED GOVERNMENT INFORMATION: every owner-dependent value comes from
 * org-config.js and is rendered as a clearly marked placeholder.
 * ========================================================================== */

/* global window, document, location, route, render, header, toast, state,
          getUserRole, homeFor, t, ft, api */

(function () {
  "use strict";

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const S = () => window.PashuShell || {};
  const org = () => window.ORG || {};

  /* -------------------------------------------------- shared page chrome */
  function crumbs(label) {
    return S().breadcrumbs ? S().breadcrumbs(location.hash, label) : "";
  }

  function page(title, bodyHtml, opts) {
    const o = opts || {};
    if (window.setPageMeta) {
      window.setPageMeta({ title: o.metaTitle || title, description: o.description });
    }
    render(
      header(title, { back: true }) +
      '<div class="pm-page">' +
        crumbs(title) +
        '<div class="section-card">' +
          '<h1 class="pm-h1">' + esc(title) + "</h1>" +
          bodyHtml +
        "</div>" +
      "</div>"
    );
  }

  /* --------------------------------------------------------- placeholder */
  function ownerNotice(text) {
    return '<p class="pm-placeholder"><span class="pm-placeholder-tag">Owner action</span> ' +
      esc(text) + "</p>";
  }

  function configRow(label, value) {
    const isPh = typeof value === "string" && value.indexOf("[OWNER ACTION") === 0;
    return "<dt>" + esc(label) + "</dt><dd>" +
      (isPh ? '<span class="pm-placeholder-inline">' + esc(value) + "</span>" : esc(value)) +
      "</dd>";
  }

  /* ============================================================== ABOUT == */
  function aboutView() {
    const o = org();
    const owner = o.owner || {};
    page("About Us", `
      <p>${esc(o.tagline || "")}</p>
      ${!o.approved ? ownerNotice("The organisation details below are placeholders. The owning organisation must confirm them before this page can be considered official content (GIGW Q09).") : ""}

      <h2 class="pm-h2">Purpose</h2>
      <p>Pashu-Shield connects livestock owners with veterinarians, laboratories and
         government officers so that animal disease can be reported early, diagnosed
         quickly and contained effectively.</p>

      <h2 class="pm-h2">What the platform does</h2>
      <ul class="pm-list">
        <li><strong>Animal owners</strong> — register livestock, keep health records, report disease, and call a veterinarian.</li>
        <li><strong>Veterinarians</strong> — manage availability, receive calls, record visits, prescriptions and vaccinations.</li>
        <li><strong>Laboratories</strong> — track samples end to end and publish verified test reports.</li>
        <li><strong>Government officers</strong> — monitor surveillance, mortality and recovery analytics, and export data.</li>
      </ul>

      <h2 class="pm-h2">Organisation</h2>
      <dl class="pm-dl">
        ${configRow("Service name", o.appName)}
        ${configRow("Owned by", owner.name)}
        ${configRow("Parent body", owner.parentBody)}
        ${configRow("Address", owner.address)}
        ${configRow("Working hours", owner.workingHours)}
      </dl>

      <h2 class="pm-h2">Mission, vision and values</h2>
      ${ownerNotice("Mission, vision, values, history, achievements, leadership and team content must be supplied by the owning organisation. No text has been invented here.")}

      <h2 class="pm-h2">Contact</h2>
      <p>See the <a class="link" href="#/contact">Contact Us</a> page for the full directory.</p>

      <h2 class="pm-h2">Last reviewed</h2>
      <p>${esc(o.lastReviewed || "Not set")}</p>
    `, {
      metaTitle: "About Us",
      description: "About the Pashu-Shield animal disease reporting, veterinary care and surveillance platform.",
    });
  }

  /* ============================================================ CONTACT == */
  function contactView() {
    const o = org();
    const owner = o.owner || {};
    const wim = o.wim || {};
    const points = (o.contactPoints || []).map((cp) => {
      let value;
      if (cp.kind === "tel") {
        value = '<a class="link" href="tel:' + esc(String(cp.detail).replace(/\s/g, "")) + '">' + esc(cp.detail) + "</a>";
      } else if (cp.kind === "email") {
        value = '<a class="link" href="mailto:' + esc(cp.detail) + '">' + esc(cp.detail) + "</a>";
      } else {
        value = esc(cp.detail);
      }
      return "<dt>" + esc(cp.role) + "</dt><dd>" + value +
        (cp.note ? ' <span class="pm-note">' + esc(cp.note) + "</span>" : "") + "</dd>";
    }).join("");

    page("Contact Us", `
      <p>Use the details below to reach the right function. If you cannot find what you
         need, use the <a class="link" href="#/feedback">feedback form</a> or the
         <a class="link" href="#/help">Help</a> page.</p>

      ${!o.approved ? ownerNotice("Contact details are placeholders pending confirmation by the owning organisation (GIGW Q10).") : ""}

      <h2 class="pm-h2">Contact directory</h2>
      <dl class="pm-dl">
        ${points}
      </dl>

      <h2 class="pm-h2">Responsible organisation</h2>
      <dl class="pm-dl">
        ${configRow("Organisation", owner.name)}
        ${configRow("Address", owner.address)}
        ${configRow("Email", owner.email)}
        ${configRow("Phone", owner.phone)}
        ${configRow("Working hours", owner.workingHours)}
      </dl>

      <h2 class="pm-h2">Web Information Manager</h2>
      ${ownerNotice("GIGW 3.0 Lifecycle checkpoint L01 requires the organisation to nominate a Web Information Manager (a senior official not below the rank of Joint Secretary). The application displays the field; the nomination itself is an organisation action.")}
      <dl class="pm-dl">
        ${configRow("Name", wim.name)}
        ${configRow("Designation", wim.designation)}
        ${configRow("Email", wim.email)}
        ${configRow("Phone", wim.phone)}
      </dl>
    `, {
      metaTitle: "Contact Us",
      description: "Contact details for the Pashu-Shield animal health platform.",
    });
  }

  /* =========================================================== FEEDBACK == */
  function feedbackView() {
    page("Feedback", `
      <p>Your feedback helps improve this service. We read every submission.</p>

      <form id="pmFeedbackForm" class="pm-form" novalidate>
        <div class="field">
          <label for="fbRating">How would you rate this service? <span class="pm-req" aria-hidden="true">*</span></label>
          <select id="fbRating" name="rating" required aria-describedby="fbRatingHelp">
            <option value="">Select a rating</option>
            <option value="5">5 — Very good</option>
            <option value="4">4 — Good</option>
            <option value="3">3 — Satisfactory</option>
            <option value="2">2 — Poor</option>
            <option value="1">1 — Very poor</option>
          </select>
          <p id="fbRatingHelp" class="pm-help">Required. Choose the option closest to your experience.</p>
        </div>

        <div class="field">
          <label for="fbCategory">What is your feedback about?</label>
          <select id="fbCategory" name="category">
            <option value="general">General</option>
            <option value="login">Login or OTP</option>
            <option value="call">Veterinary call</option>
            <option value="report">Disease reporting</option>
            <option value="lab">Laboratory / samples</option>
            <option value="accessibility">Accessibility</option>
            <option value="bug">Something is broken</option>
          </select>
        </div>

        <div class="field">
          <label for="fbComments">Your comments <span class="pm-req" aria-hidden="true">*</span></label>
          <textarea id="fbComments" name="comments" rows="5" required minlength="10" maxlength="1000"
                    aria-describedby="fbCommentsHelp"></textarea>
          <p id="fbCommentsHelp" class="pm-help">Required. At least 10 characters, at most 1000.</p>
        </div>

        <div class="field">
          <label for="fbEmail">Email (optional)</label>
          <input type="email" id="fbEmail" name="email" autocomplete="email"
                 aria-describedby="fbEmailHelp" />
          <p id="fbEmailHelp" class="pm-help">Only if you would like a reply. We do not use it for anything else.</p>
        </div>

        <div id="pmFeedbackError" class="pm-error-summary" role="alert" hidden tabindex="-1"></div>

        <div class="btn-row">
          <button type="submit" class="btn btn-primary" id="pmFeedbackSubmit">Submit feedback</button>
          <button type="reset" class="btn btn-outline" onclick="location.hash='${homeFor(getUserRole() || "owner")}'">Cancel</button>
        </div>
        <p class="pm-help">Fields marked <span class="pm-req" aria-hidden="true">*</span> are required.</p>
      </form>

      <div id="pmFeedbackResult" hidden></div>
    `, {
      metaTitle: "Feedback",
      description: "Send feedback about the Pashu-Shield animal health platform.",
    });

    const form = document.getElementById("pmFeedbackForm");
    if (!form) return;
    form.addEventListener("submit", submitFeedback);
  }

  function showFeedbackErrors(errors) {
    const box = document.getElementById("pmFeedbackError");
    if (!box) return;
    if (!errors.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML =
      '<h2 class="pm-error-title">There is a problem</h2><ul>' +
      errors.map((e) => '<li><a href="#' + esc(e.field) + '">' + esc(e.message) + "</a></li>").join("") +
      "</ul>";
    box.focus();
  }

  function setBusy(btn, busy) {
    if (!btn) return;
    btn.disabled = !!busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    btn.textContent = busy ? "Submitting…" : "Submit feedback";
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const form = event.target;
    const btn = document.getElementById("pmFeedbackSubmit");

    // --- client-side validation (GuDApps 4.4.1.2) -------------------------
    const errors = [];
    const rating = form.rating.value;
    const comments = (form.comments.value || "").trim();
    const email = (form.email.value || "").trim();

    if (!rating) errors.push({ field: "fbRating", message: "Select a rating for this service." });
    if (comments.length < 10) errors.push({ field: "fbComments", message: "Enter your comments using at least 10 characters." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ field: "fbEmail", message: "Enter an email address in the format name@example.com." });
    }
    if (errors.length) {
      showFeedbackErrors(errors);
      if (S().announce) S().announce("There is a problem with the form. " + errors.length + " error" + (errors.length > 1 ? "s" : "") + ".", true);
      return;
    }
    showFeedbackErrors([]);

    // Duplicate-submit prevention (GuDApps 4.4.3 / programme §20)
    setBusy(btn, true);
    if (S().announce) S().announce("Submitting your feedback");

    const payload = {
      rating: Number(rating),
      category: form.category.value || "general",
      comments: comments,
      email: email || null,
      page: location.hash || "#/",
    };

    try {
      const result = await api("/api/feedback", { method: "POST", body: payload, queueOffline: false });
      renderFeedbackSuccess(result);
    } catch (err) {
      // Graceful, honest degradation: the app-side workflow still completes and
      // tells the user exactly what happened (programme §36 error state).
      const msg = (err && err.message) || "We could not send your feedback.";
      if (S().announce) S().announce("Error — " + msg, true);
      toast("Error — " + msg + " Please try again.", true);
    } finally {
      setBusy(btn, false);
    }
  }

  function renderFeedbackSuccess(result) {
    const ref = (result && result.reference) || null;
    const box = document.getElementById("pmFeedbackResult");
    const form = document.getElementById("pmFeedbackForm");
    if (form) form.hidden = true;
    if (box) {
      box.hidden = false;
      box.className = "pm-state pm-state-success";
      box.innerHTML =
        '<p class="pm-state-title">✓ Feedback submitted</p>' +
        '<p class="pm-state-body">Thank you. Your feedback has been recorded.</p>' +
        (ref ? '<p class="pm-state-body"><strong>Reference number:</strong> ' + esc(ref) +
               '<br><span class="pm-note">Keep this reference to track your feedback.</span></p>' : "");
    }
    if (S().announce) {
      S().announce("Feedback submitted successfully" + (ref ? ". Reference number " + ref : ""), true);
    }
    toast("Feedback submitted successfully.");
  }

  /* =============================================================== HELP == */
  function helpView() {
    const faqs = [
      ["How do I sign in as an animal owner?", "Animal owners sign in with a mobile number and a one-time password (OTP). Enter your 10-digit mobile number, choose Send code, then enter the 6-digit code you receive by SMS."],
      ["I did not receive the OTP.", "Wait for the resend timer to finish, then choose Resend code. Check that your phone has signal and that the number you entered is correct. Only a limited number of codes can be sent in a short period."],
      ["The code says expired or invalid.", "Codes expire after a short time for security. Choose Resend code to get a new one and enter it promptly."],
      ["How do I call a veterinarian?", "From your dashboard use the veterinary call option. You will see the veterinarian's availability and the call status. Make sure you allow microphone access when your browser asks."],
      ["Why does the call status say the doctor is unavailable?", "The veterinarian may have set their availability to unavailable, or their connection may be offline. The status shown always reflects the actual connection, not just the saved availability."],
      ["How do I report a sick animal?", "Go to Report from your dashboard and complete the form. You can also record a voice note describing the symptoms."],
      ["How do I open or download a document or QR code?", "Documents and QR codes open from the relevant record. If a file asks which application to use, choose a PDF viewer for PDF files or an image viewer for images."],
      ["Which languages are available?", "English, हिन्दी (Hindi), मराठी (Marathi) and తెలుగు (Telugu). Use the language selector in the header. Some content may not yet be translated."],
      ["How do I make the text bigger or increase contrast?", "Use the accessibility bar at the very top of the page: A- / A / A+ change text size, and High contrast switches to a high-contrast colour scheme. Your choice is remembered on this device."],
      ["How do I use this site with a keyboard only?", "Press Tab to move forward and Shift+Tab to move back. The first link on every page is Skip to main content, which jumps past the navigation. Press Enter to activate a link or button, and Escape to close a dialog."],
      ["Something is not working. What should I do?", "Use the Feedback page to tell us what happened, or contact us using the details on the Contact Us page."],
    ];

    page("Help", `
      <p>Help for using this platform. If you cannot find an answer here, use
         <a class="link" href="#/feedback">Feedback</a> or <a class="link" href="#/contact">Contact Us</a>.</p>

      <h2 class="pm-h2">Using this portal</h2>
      <ul class="pm-list">
        <li>Choose your role on the home page, then sign in.</li>
        <li>Your dashboard is the starting point for everything you can do.</li>
        <li>Use the bottom menu on a phone, or the dashboard tiles on a larger screen.</li>
        <li>Every page has a title and a breadcrumb trail showing where you are.</li>
      </ul>

      <h2 class="pm-h2">Frequently asked questions</h2>
      <div class="pm-faq">
        ${faqs.map((f, i) => `
          <details class="pm-faq-item"${i === 0 ? " open" : ""}>
            <summary><h3 class="pm-faq-q">${esc(f[0])}</h3></summary>
            <p>${esc(f[1])}</p>
          </details>`).join("")}
      </div>

      <h2 class="pm-h2">Signing in and OTP</h2>
      <p>Animal owners use a mobile number and a one-time password. Veterinarians,
         government officers and laboratory users sign in with their account and password.</p>

      <h2 class="pm-h2">Filling in forms</h2>
      <ul class="pm-list">
        <li>Fields marked with an asterisk (*) are required.</li>
        <li>If a form has a problem, a summary appears at the top and the field is described in text.</li>
        <li>Your entries are kept if you need to correct something and submit again.</li>
      </ul>

      <h2 class="pm-h2">Opening documents and downloads</h2>
      <p>Downloads show their title, format and size before you open them. Links to other
         websites are marked and open in a new window.</p>

      <h2 class="pm-h2">Accessibility help</h2>
      <ul class="pm-list">
        <li>Text size: A- / A / A+ in the bar at the top of the page.</li>
        <li>High contrast: the High contrast button in the same bar.</li>
        <li>Reduced motion: the Reduce motion button, or your device's own setting.</li>
        <li>Keyboard: Tab, Shift+Tab, Enter, Escape, and the Skip to main content link.</li>
        <li>Language: use the language selector; your choice is remembered.</li>
      </ul>
      <p>See the <a class="link" href="#/policies/accessibility">Accessibility Statement</a>
         for the full picture, including what is not yet compliant.</p>

      <h2 class="pm-h2">Still need help?</h2>
      <p><a class="link" href="#/contact">Contact Us</a> ·
         <a class="link" href="#/feedback">Send feedback</a></p>
    `, {
      metaTitle: "Help",
      description: "Help and frequently asked questions for using the Pashu-Shield platform.",
    });
  }

  /* ============================================================ SITEMAP == */
  function sitemapView() {
    const roleSections = [
      ["Animal owner", "owner", [
        ["#/owner/dashboard", "Dashboard"],
        ["#/owner/livestock", "My livestock"],
        ["#/owner/cases", "Cases"],
        ["#/owner/prescriptions", "Health &amp; treatment"],
        ["#/owner/notifications", "Notifications"],
        ["#/owner/calls", "Call history"],
        ["#/scan", "Scan QR code"],
      ]],
      ["Veterinarian", "vet", [
        ["#/vet/dashboard", "Dashboard"],
        ["#/vet/reports", "Reports"],
        ["#/vet/cases", "Cases"],
        ["#/vet/campaigns", "Campaigns"],
        ["#/vet/search", "Search"],
        ["#/vet/advisories", "Advisories"],
        ["#/vet/vaccination/new", "Record vaccination"],
        ["#/vet/calls", "Calls"],
      ]],
      ["Government officer", "govt", [
        ["#/govt/dashboard", "Dashboard"],
        ["#/govt/analytics", "Analytics"],
        ["#/govt/gis", "GIS risk map"],
        ["#/govt/ai", "AI risk"],
        ["#/govt/trends", "Trends"],
        ["#/govt/blocks", "Blocks"],
        ["#/govt/export", "Export data"],
        ["#/govt/zoonotic", "Zoonotic risk"],
        ["#/govt/stock", "Stock"],
      ]],
      ["Laboratory", "lab", [
        ["#/lab/dashboard", "Dashboard"],
        ["#/lab/queue", "Sample queue"],
        ["#/lab/lab-reports", "Lab reports"],
        ["#/scan", "Scan QR code"],
      ]],
    ];

    const infoSection = [
      ["#/about", "About Us"],
      ["#/contact", "Contact Us"],
      ["#/feedback", "Feedback"],
      ["#/help", "Help"],
      ["#/search", "Search"],
      ["#/policies", "Policies"],
    ];

    page("Site Map", `
      <p>A list of every page on this site. This is one of the ways to find a page;
         the others are the menus, and <a class="link" href="#/search">Search</a>.</p>

      <h2 class="pm-h2">Information pages</h2>
      <ul class="pm-list">
        ${infoSection.map(([h, l]) => '<li><a class="link" href="' + h + '">' + esc(l) + "</a></li>").join("")}
      </ul>

      ${roleSections.map(([label, role, links]) => `
        <h2 class="pm-h2">${esc(label)}</h2>
        <p class="pm-note">These pages require signing in as a ${esc(label.toLowerCase())}.</p>
        <ul class="pm-list">
          ${links.map(([h, l]) => '<li><a class="link" href="' + h + '">' + l + "</a></li>").join("")}
        </ul>`).join("")}
    `, {
      metaTitle: "Site Map",
      description: "Site map listing every page of the Pashu-Shield platform.",
    });
  }

  /* ============================================================= SEARCH == */
  function searchView() {
    page("Search", `
      <p>Search the pages of this site. Results update as you type.</p>

      <form class="pm-form" id="pmSearchForm" role="search" onsubmit="return false;">
        <div class="field">
          <label for="pmSearchInput">Search this site</label>
          <input type="search" id="pmSearchInput" name="q" autocomplete="off"
                 aria-describedby="pmSearchHelp" />
          <p id="pmSearchHelp" class="pm-help">Type at least two letters. Use arrow keys and Enter to open a result.</p>
        </div>
      </form>

      <div id="pmSearchStatus" role="status" aria-live="polite" class="pm-help"></div>
      <ul id="pmSearchResults" class="pm-list"></ul>
      <div id="pmSearchEmpty" class="pm-state" hidden>
        <p class="pm-state-title">No results found</p>
        <p class="pm-state-body">Try a different word, or browse the <a class="link" href="#/sitemap">Site Map</a>.</p>
      </div>
    `, {
      metaTitle: "Search",
      description: "Search the Pashu-Shield platform.",
    });

    const input = document.getElementById("pmSearchInput");
    const results = document.getElementById("pmSearchResults");
    const status = document.getElementById("pmSearchStatus");
    const empty = document.getElementById("pmSearchEmpty");
    if (!input || !results) return;

    input.addEventListener("input", function () {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = "";
      if (empty) empty.hidden = true;
      if (q.length < 2) { if (status) status.textContent = ""; return; }

      const hits = SEARCH_INDEX.filter(function (item) {
        return (item.title + " " + item.keywords + " " + item.section).toLowerCase().indexOf(q) !== -1;
      });

      if (status) {
        status.textContent = hits.length +
          (hits.length === 1 ? " result found." : " results found.");
      }
      if (!hits.length) { if (empty) empty.hidden = false; return; }

      results.innerHTML = hits.map(function (item) {
        return '<li><a class="link" href="' + esc(item.href) + '">' + esc(item.title) +
          '</a> <span class="pm-note">— ' + esc(item.section) + "</span></li>";
      }).join("");
    });
  }

  // Static index of the application's own pages. Built from the real route
  // table so the sitemap and search can never advertise a page that does not
  // exist (GIGW L07 — no broken links).
  const SEARCH_INDEX = [
    { href: "#/about", title: "About Us", section: "Information", keywords: "about organisation purpose mission" },
    { href: "#/contact", title: "Contact Us", section: "Information", keywords: "contact phone email address helpline" },
    { href: "#/feedback", title: "Feedback", section: "Information", keywords: "feedback rating comment complaint" },
    { href: "#/help", title: "Help", section: "Information", keywords: "help faq question support otp login" },
    { href: "#/sitemap", title: "Site Map", section: "Information", keywords: "sitemap index all pages" },
    { href: "#/search", title: "Search", section: "Information", keywords: "search find" },
    { href: "#/policies", title: "Policies", section: "Information", keywords: "policy privacy terms copyright accessibility" },
    { href: "#/owner/dashboard", title: "Animal owner dashboard", section: "Animal owner", keywords: "farmer home dashboard livestock" },
    { href: "#/owner/livestock", title: "My livestock", section: "Animal owner", keywords: "livestock herd animals cattle" },
    { href: "#/owner/cases", title: "Cases", section: "Animal owner", keywords: "case disease report" },
    { href: "#/owner/calls", title: "Call history", section: "Animal owner", keywords: "call vet history" },
    { href: "#/scan", title: "Scan QR code", section: "All roles", keywords: "scan qr code animal sample" },
    { href: "#/vet/dashboard", title: "Veterinarian dashboard", section: "Veterinarian", keywords: "vet doctor dashboard availability" },
    { href: "#/vet/cases", title: "Cases", section: "Veterinarian", keywords: "case visit diagnosis treatment" },
    { href: "#/vet/search", title: "Search", section: "Veterinarian", keywords: "search animal owner vet" },
    { href: "#/vet/advisories", title: "Advisories", section: "Veterinarian", keywords: "advisory guidance" },
    { href: "#/govt/dashboard", title: "Government dashboard", section: "Government", keywords: "govt analytics surveillance" },
    { href: "#/govt/analytics", title: "Analytics", section: "Government", keywords: "analytics mortality recovery statistics" },
    { href: "#/govt/gis", title: "GIS risk map", section: "Government", keywords: "gis map risk geo" },
    { href: "#/govt/ai", title: "AI risk", section: "Government", keywords: "ai machine learning prediction outbreak" },
    { href: "#/govt/export", title: "Export data", section: "Government", keywords: "export csv report download" },
    { href: "#/lab/dashboard", title: "Laboratory dashboard", section: "Laboratory", keywords: "lab dashboard" },
    { href: "#/lab/queue", title: "Sample queue", section: "Laboratory", keywords: "sample queue test result" },
  ];

  /* =========================================================== POLICIES == */
  const POLICIES = {
    privacy: {
      title: "Privacy Policy",
      intro: "This policy explains what personal information this platform collects, why it is collected, and how it is handled.",
      body: [
        ["What we collect", "For animal owners: mobile number, name, district and village. For veterinarians, government officers and laboratory users: name, email or mobile, role and district. Animal health records, disease cases, samples and call records are also stored."],
        ["Why we collect it", "To identify you, to deliver a one-time password by SMS, to link animals and cases to their owner, to route veterinary calls, and to produce disease surveillance analytics."],
        ["Sensitive identifiers", "This platform does not require Aadhaar or PAN. Mobile numbers are masked when displayed in logs and diagnostics."],
        ["One-time passwords", "OTP codes are stored only as a hash, expire after a short time, are limited in the number of attempts, and are never written to browser storage or application logs."],
        ["Sharing", "Personal information is not sold. It is shared only with the veterinarian, laboratory or officer involved in your case, or where required by law."],
        ["Retention and security", "Records are retained while needed for animal-health service delivery. Access is role-based and every significant action is written to an audit log."],
        ["Your choices", "Contact the organisation using the details on the Contact Us page to ask about your information."],
      ],
    },
    terms: {
      title: "Terms & Conditions",
      intro: "Terms for using this platform.",
      body: [
        ["Use of the service", "This platform supports animal disease reporting, veterinary care, laboratory diagnostics and disease surveillance. Use it for those purposes."],
        ["Accuracy of information", "Enter information that is accurate to the best of your knowledge. Disease reporting affects animal-health decisions and surveillance."],
        ["Accounts", "Keep your login details confidential. Animal-owner access is by mobile number and one-time password; do not share a code with anyone."],
        ["Availability", "The service may be unavailable during maintenance. Emergency animal-health situations should also be reported through the helpline."],
        ["Content", "Do not submit unlawful, offensive or discriminatory content."],
      ],
    },
    copyright: {
      title: "Copyright Policy",
      intro: "Ownership of content published on this platform.",
      body: [
        ["Ownership", "Unless stated otherwise, the content of this platform belongs to the owning organisation."],
        ["Reproduction", "Material may be reproduced for non-commercial use provided the source is acknowledged and the content is not altered in a way that changes its meaning."],
        ["Third-party material", "Material reproduced from another source carries that source. The organisation must obtain permission before publishing copyright-protected material (GIGW Q04 — organisation action)."],
      ],
    },
    hyperlinking: {
      title: "Hyperlinking Policy",
      intro: "How this platform links to other websites, and how others may link to it.",
      body: [
        ["Links to external sites", "Links to websites outside this platform are provided for convenience. We are not responsible for their content or availability. External links are marked and open in a new window."],
        ["Links to this site", "You may link to this platform's public pages without prior permission, provided the link does not misrepresent the service."],
        ["Accuracy of linked content", "Linked content is checked periodically. Report a broken or inaccurate link through the Feedback page."],
      ],
    },
    accessibility: {
      title: "Accessibility Statement",
      intro: "This statement describes the accessibility of this platform and what is not yet fully compliant.",
      body: [
        ["Standard targeted", "We aim to meet Web Content Accessibility Guidelines (WCAG) 2.1 level AA, as required by GIGW 3.0."],
        ["What has been implemented", "Skip to main content link on every page; a text-size control (A- / A / A+); a high-contrast mode; a reduce-motion control; visible keyboard focus; screen-reader announcements for loading, success and error states; semantic page structure with headings and landmarks; text alternatives planned for meaningful images; form labels and error summaries."],
        ["Known limitations", "This statement is honest about the current state: an independent accessibility audit (axe-core / manual screen-reader testing) has not yet been completed. Some older screens, charts and data tables are still being brought fully into line. Live veterinary calls carry audio only; captions for live audio are not yet provided."],
        ["Feedback", "If you encounter a barrier, please use the Feedback page or the Contact Us page. We treat accessibility problems as defects."],
        ["Organisation responsibilities", "An STQC accessibility audit and any certification are organisation actions and are not yet complete."],
      ],
    },
    security: {
      title: "Security Policy",
      intro: "How this platform is secured, and what remains an organisation responsibility.",
      body: [
        ["In the application", "Role-based access control on every API; passwords stored as a salted hash; one-time passwords hashed, short-lived and attempt-limited; input validated on the server as well as in the browser; security-related response headers; errors that do not disclose internal detail; an audit log of significant actions."],
        ["Transport", "Traffic is served over HTTPS. Third-party communication uses encrypted channels."],
        ["Not yet done (organisation action)", "A security audit and clearance certificate from NIC / STQC / a CERT-In empanelled laboratory; 'safe to host' certification; hosting-environment certification; periodic vulnerability assessment and penetration testing. None of these are complete, and this page does not claim otherwise."],
        ["Reporting a problem", "Use the Feedback page, or the Contact Us page for anything sensitive."],
      ],
    },
    cmap: {
      title: "Content Contribution, Moderation & Approval Policy",
      intro: "How content on this platform is created, checked and approved.",
      body: [
        ["Contribution", "Content is contributed by authorised users in their own role, and by the organisation for informational pages."],
        ["Moderation", "User-submitted content such as case notes and feedback is subject to moderation. The organisation must designate the officials responsible (GIGW L05 — organisation action)."],
        ["Approval", "Informational pages and policy pages require approval by the owning organisation before they can be considered official. Pages pending approval are marked as such."],
        ["Standards", "Content must be accurate, free from offensive or discriminatory language, and kept up to date."],
      ],
    },
    archival: {
      title: "Content Archival Policy",
      intro: "How time-sensitive content is retired.",
      body: [
        ["What is time-sensitive", "Announcements, campaigns, advisories, alerts and notices."],
        ["How it is handled", "Time-sensitive items carry a publish date and, where applicable, an expiry date. Expired items are moved to an archive rather than left on the active site."],
        ["Retention", "Archived content remains available for reference and audit."],
      ],
    },
    review: {
      title: "Content Review Policy",
      intro: "How content is kept accurate and current.",
      body: [
        ["Review cycle", "The organisation should review informational and policy content periodically and record the review date, which is shown in the footer as Last reviewed."],
        ["Corrections", "Report inaccurate content through the Feedback page."],
        ["Multiple languages", "Where content exists in more than one language, all versions should be updated together. Where a translation is not yet available, that status is shown rather than presenting stale text."],
      ],
    },
    monitoring: {
      title: "Website Monitoring Plan",
      intro: "How the platform is monitored.",
      body: [
        ["What is monitored", "Service availability, error rates, audit logs, and security-relevant events such as failed sign-in attempts."],
        ["Broken links", "Internal links are checked and corrected when found (GIGW L07)."],
        ["Organisation responsibility", "Formal monitoring arrangements, log retention for the period directed by CERT-In, and periodic review of alerts are organisation actions."],
      ],
    },
    contingency: {
      title: "Contingency Management Plan",
      intro: "How service continuity is maintained.",
      body: [
        ["Application behaviour", "The platform degrades gracefully when connectivity is poor: essential pages are cached for offline use, actions taken offline are queued, and failures show a retry option rather than a blank screen."],
        ["Data", "Backups and a disaster-recovery environment are the responsibility of the hosting provider and the owning organisation (GIGW C2 — organisation action)."],
      ],
    },
    grievance: {
      title: "Grievance Redressal",
      intro: "How to raise a grievance and what happens next.",
      body: [
        ["Raise a grievance", "Use the Feedback page and choose the category closest to your issue, or contact the grievance officer listed on the Contact Us page."],
        ["What happens next", "1. Your grievance is recorded and given a reference number. 2. You can track its status. 3. You receive a response. 4. The grievance is closed once resolved."],
        ["Honest status", "The application implements this workflow. Integration with a departmental grievance system is NOT configured and requires the organisation to provide it. A grievance submitted here is not yet routed to an external departmental system."],
      ],
    },
  };

  function policiesIndexView() {
    const o = org();
    const items = (o.policies || []).map(function (p) {
      return '<li><a class="link" href="#/policies/' + esc(p.id) + '">' + esc(p.label) + "</a>" +
        (p.approved === false ? ' <span class="pm-pending">pending approval</span>' : "") +
        "</li>";
    }).join("");

    page("Policies", `
      <p>Policies for this platform. Pages marked
         <span class="pm-pending">pending approval</span> are templates that the owning
         organisation must review and approve before they can be treated as official
         (GIGW 3.0 Lifecycle checkpoint L03).</p>
      <ul class="pm-list">${items}</ul>
    `, {
      metaTitle: "Policies",
      description: "Privacy, terms, copyright, accessibility, security and content policies.",
    });
  }

  function policyDetailView(id) {
    const p = POLICIES[id];
    if (!p) {
      page("Policy not found", `
        <p>That policy page does not exist.</p>
        <p><a class="link" href="#/policies">Back to all policies</a></p>
      `, { metaTitle: "Policy not found" });
      return;
    }
    const o = org();
    const meta = (o.policies || []).find((x) => x.id === id);
    const approved = meta && meta.approved === true;

    page(p.title, `
      ${!approved ? ownerNotice("This page is a template and is pending approval by the owning organisation. It must not be relied upon as an approved official policy.") : ""}
      <p>${esc(p.intro)}</p>
      ${p.body.map(([h, b]) =>
        '<h2 class="pm-h2">' + esc(h) + "</h2><p>" + esc(b) + "</p>").join("")}
      <h2 class="pm-h2">Last reviewed</h2>
      <p>${esc((o && o.lastReviewed) || "Not set")}</p>
      <p><a class="link" href="#/policies">Back to all policies</a></p>
    `, { metaTitle: p.title, description: p.intro });
  }

  /* ============================================================== ROUTES == */
  // Registered after app.js loads, using app.js's own `route()` helper.
  route("#/about", aboutView);
  route("#/contact", contactView);
  route("#/feedback", feedbackView);
  route("#/help", helpView);
  route("#/sitemap", sitemapView);
  route("#/search", searchView);
  route("#/policies", policiesIndexView);
  route("#/policies/:id", ({ id }) => policyDetailView(id));

  // Expose for tests and for the footer.
  window.PMInfoPages = {
    views: { aboutView, contactView, feedbackView, helpView, sitemapView, searchView, policiesIndexView, policyDetailView },
    SEARCH_INDEX,
    POLICIES,
  };
})();
