/* ==========================================================================
   Pashu-Shield — Accessibility helpers (keyboard, focus, dialogs, forms)
   --------------------------------------------------------------------------
   High-value code-level gaps:
     A21 keyboard operable, A22 no trap, A29 focus order, A33 focus visible,
     A44/A45/A46/A47 error handling & labels, A49 name/role/value,
     A50 status messages, A01 accessible names, A30 link purpose,
     UX-07 loading/error states, UX-13 touch targets, A25 reduced motion,
     A17 reflow, A15 200% zoom, multilingual a11y text, auth a11y.

   Zero-regression: additive only, no font/colour change.
   ========================================================================== */
(function () {
  "use strict";

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable]';

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // --------------------------------------------------- focus trap ---
  function trapFocus(container, opts) {
    const o = opts || {};
    const focusable = Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => {
      return el.offsetParent !== null || el === document.activeElement;
    });
    if (!focusable.length) return () => {};
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const previous = document.activeElement;

    function onKeyDown(e) {
      if (e.key === "Escape" && o.onEscape) {
        e.preventDefault();
        o.onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener("keydown", onKeyDown);
    // Focus first element or container
    setTimeout(() => {
      const auto = container.querySelector("[data-autofocus]") || first;
      try { auto.focus(); } catch (_) { container.focus(); }
    }, 0);

    return function release() {
      container.removeEventListener("keydown", onKeyDown);
      if (o.restore !== false && previous && previous.focus) {
        try { previous.focus(); } catch (_) {}
      }
    };
  }

  // --------------------------------------------------- accessible dialog ---
  let activeDialogRelease = null;
  function showAccessibleDialog(containerEl, opts) {
    const o = opts || {};
    if (!containerEl) return () => {};
    containerEl.setAttribute("role", "dialog");
    containerEl.setAttribute("aria-modal", "true");
    if (o.labelledBy) containerEl.setAttribute("aria-labelledby", o.labelledBy);
    if (o.describedBy) containerEl.setAttribute("aria-describedby", o.describedBy);
    containerEl.setAttribute("tabindex", "-1");

    // Ensure Esc closes
    if (activeDialogRelease) activeDialogRelease();
    activeDialogRelease = trapFocus(containerEl, {
      onEscape: o.onClose || (() => { hideAccessibleDialog(containerEl); }),
      restore: true,
    });

    // Announce
    if (window.PashuShell && window.PashuShell.announce && o.announce) {
      window.PashuShell.announce(o.announce, true);
    }

    return function close() {
      hideAccessibleDialog(containerEl);
    };
  }

  function hideAccessibleDialog(containerEl) {
    if (activeDialogRelease) {
      activeDialogRelease();
      activeDialogRelease = null;
    }
    if (containerEl && containerEl.parentNode) {
      try { containerEl.remove(); } catch (_) {}
    }
  }

  // --------------------------------------------------- make cards accessible ---
  function makeCardAccessible(el) {
    if (!el) return;
    if (!el.hasAttribute("role")) el.setAttribute("role", "button");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (!el.hasAttribute("aria-label") && el.textContent) {
      // Use first 80 chars as label if no explicit label
      const txt = el.textContent.trim().slice(0, 80);
      if (txt) el.setAttribute("aria-label", txt);
    }
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  }

  function enhanceAllCards() {
    document.querySelectorAll(".list-card[onclick], .icon-item[onclick], .role-card[onclick]").forEach((el) => {
      if (!el.hasAttribute("tabindex")) {
        makeCardAccessible(el);
      }
    });
  }

  // --------------------------------------------------- form helpers ---
  function ensureId(el, prefix) {
    if (el.id) return el.id;
    const id = prefix + "-" + Math.random().toString(36).slice(2, 8);
    el.id = id;
    return id;
  }

  function addErrorSummary(form, errors) {
    // errors: [{field: id, message: string}]
    let summary = form.querySelector(".pm-error-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.className = "pm-error-summary";
      summary.setAttribute("role", "alert");
      summary.setAttribute("tabindex", "-1");
      form.insertBefore(summary, form.firstChild);
    }
    if (!errors || !errors.length) {
      summary.hidden = true;
      summary.innerHTML = "";
      return;
    }
    summary.hidden = false;
    summary.innerHTML = '<h2 class="pm-error-title">There is a problem</h2><ul>' +
      errors.map((e) => '<li><a href="#' + escapeHtml(e.field) + '">' + escapeHtml(e.message) + "</a></li>").join("") +
      "</ul>";
    try { summary.focus(); } catch (_) {}
    if (window.PashuShell && window.PashuShell.announce) {
      window.PashuShell.announce("There is a problem with the form. " + errors.length + " error" + (errors.length > 1 ? "s" : "") + ".", true);
    }
  }

  function setFieldError(input, message) {
    if (!input) return;
    const id = ensureId(input, "field");
    let err = document.getElementById(id + "-error");
    if (!err) {
      err = document.createElement("p");
      err.id = id + "-error";
      err.className = "pm-field-error";
      err.setAttribute("role", "alert");
      input.parentNode.appendChild(err);
    }
    if (message) {
      err.textContent = message;
      err.hidden = false;
      input.setAttribute("aria-invalid", "true");
      const described = (input.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
      if (!described.includes(err.id)) {
        described.push(err.id);
        input.setAttribute("aria-describedby", described.join(" "));
      }
      input.setAttribute("aria-errormessage", err.id);
    } else {
      err.textContent = "";
      err.hidden = true;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-errormessage");
    }
  }

  function clearAllFieldErrors(form) {
    form.querySelectorAll(".pm-field-error").forEach((el) => {
      el.textContent = "";
      el.hidden = true;
    });
    form.querySelectorAll("[aria-invalid]").forEach((el) => {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-errormessage");
    });
    addErrorSummary(form, []);
  }

  function preventDuplicateSubmit(form, btn) {
    if (!form || !btn) return () => {};
    let busy = false;
    function onSubmit() {
      if (busy) {
        // Prevent duplicate
        return false;
      }
      busy = true;
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      const orig = btn.textContent;
      btn.dataset.origText = orig;
      btn.textContent = btn.dataset.busyText || "Submitting…";
      setTimeout(() => { busy = false; btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = btn.dataset.origText || orig; }, 8000);
      return true;
    }
    function release() {
      busy = false;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      if (btn.dataset.origText) btn.textContent = btn.dataset.origText;
    }
    form.addEventListener("submit", function (e) {
      if (!onSubmit()) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    return release;
  }

  // --------------------------------------------------- loading / error states ---
  function announceLoading(message) {
    if (window.PashuShell && window.PashuShell.announce) {
      window.PashuShell.announce(message || "Loading");
    }
    const live = document.getElementById("pmLivePolite");
    if (live) live.textContent = message || "Loading";
  }

  function announceError(message) {
    if (window.PashuShell && window.PashuShell.announce) {
      window.PashuShell.announce("Error — " + (message || "Something went wrong"), true);
    }
  }

  function addResultCount(container, count, label) {
    if (!container) return;
    let counter = container.querySelector(".pm-result-count");
    if (!counter) {
      counter = document.createElement("div");
      counter.className = "pm-result-count small-muted";
      counter.setAttribute("role", "status");
      counter.setAttribute("aria-live", "polite");
      container.insertBefore(counter, container.firstChild);
    }
    counter.textContent = count + " " + (label || "results");
  }

  // --------------------------------------------------- autocomplete ---
  function enhanceAutocomplete() {
    // Add autocomplete where missing, based on name attributes
    const map = {
      "mobile": "tel",
      "phone": "tel",
      "identifier": "username",
      "email": "email",
      "full_name": "name",
      "name": "name",
      "owner_name": "name",
      "password": "current-password",
      "new_password": "new-password",
      "confirm_password": "new-password",
      "village": "address-level3",
      "district": "address-level2",
      "block": "address-level1",
      "otp": "one-time-code",
      "animal_name": "off",
      "breed": "off",
      "symptoms": "off",
      "description": "off",
    };
    document.querySelectorAll("input[name]").forEach((input) => {
      if (input.hasAttribute("autocomplete")) return;
      const name = input.name;
      if (map[name]) input.setAttribute("autocomplete", map[name]);
      else if (name.includes("tel") || name.includes("mobile")) input.setAttribute("autocomplete", "tel");
      else if (name.includes("email")) input.setAttribute("autocomplete", "email");
    });
    // OTP code
    const otp = document.getElementById("otpCode");
    if (otp && !otp.hasAttribute("autocomplete")) otp.setAttribute("autocomplete", "one-time-code");
  }

  // --------------------------------------------------- responsive / reduced motion ---
  function initResponsiveHelpers() {
    // Ensure tables have scroll container
    document.querySelectorAll("table.data-table").forEach((table) => {
      if (!table.closest(".table-wrap") && !table.closest(".pm-table-scroll")) {
        const wrap = document.createElement("div");
        wrap.className = "pm-table-scroll";
        wrap.setAttribute("tabindex", "0");
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", "Scrollable table");
        table.parentNode.insertBefore(wrap, table);
        wrap.appendChild(table);
      }
    });
  }

  // --------------------------------------------------- multilingual a11y text ---
  const A11Y_I18N = {
    en: {
      close: "Close",
      loading: "Loading",
      error: "Error",
      no_results: "No results found",
      results_found: "results found",
      skip_to_content: "Skip to main content",
      text_size: "Text size",
      high_contrast: "High contrast",
      reduce_motion: "Reduce motion",
    },
    hi: {
      close: "बंद करें",
      loading: "लोड हो रहा है",
      error: "त्रुटि",
      no_results: "कोई परिणाम नहीं मिला",
      results_found: "परिणाम मिले",
      skip_to_content: "मुख्य सामग्री पर जाएं",
      text_size: "पाठ आकार",
      high_contrast: "उच्च कंट्रास्ट",
      reduce_motion: "एनीमेशन कम करें",
    },
    mr: {
      close: "बंद करा",
      loading: "लोड होत आहे",
      error: "त्रुटी",
      no_results: "कोणतेही परिणाम आढळले नाहीत",
      results_found: "परिणाम आढळले",
      skip_to_content: "मुख्य सामग्रीवर जा",
      text_size: "मजकूर आकार",
      high_contrast: "उच्च कॉन्ट्रास्ट",
      reduce_motion: "अॅनिमेशन कमी करा",
    },
    te: {
      close: "మూసివేయి",
      loading: "లోడ్ అవుతోంది",
      error: "లోపం",
      no_results: "ఫలితాలు కనుగొనబడలేదు",
      results_found: "ఫలితాలు కనుగొనబడ్డాయి",
      skip_to_content: "ప్రధాన కంటెంట్‌కు వెళ్లండి",
      text_size: "పాఠ్య పరిమాణం",
      high_contrast: "అధిక కాంట్రాస్ట్",
      reduce_motion: "యానిమేషన్ తగ్గించు",
    },
  };

  function tA11y(key) {
    const lang = (window.state && window.state.lang) || "en";
    const dict = A11Y_I18N[lang] || A11Y_I18N.en;
    return dict[key] || A11Y_I18N.en[key] || key;
  }

  // --------------------------------------------------- init ---
  function initHoverFocusA20() {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.key === "Esc") {
        document.querySelectorAll(".pm-tooltip.pm-tooltip-visible, .pm-hover-card-visible").forEach(function (el) {
          el.classList.remove("pm-tooltip-visible", "pm-hover-card-visible");
          var trigger = el.querySelector("[data-tooltip-trigger]") || el;
          if (trigger && trigger.focus) { try { trigger.focus(); } catch (_) {} }
        });
        document.body.classList.add("pm-a20-dismissed");
        setTimeout(function () { document.body.classList.remove("pm-a20-dismissed"); }, 100);
      }
    });
    document.addEventListener("mouseover", function (e) {
      var tooltip = e.target.closest(".pm-tooltip");
      if (tooltip) { tooltip.classList.add("pm-tooltip-visible"); }
    });
    document.addEventListener("mouseout", function (e) {
      var tooltip = e.target.closest(".pm-tooltip");
      if (tooltip && !tooltip.matches(":hover") && !tooltip.contains(document.activeElement)) {
        var related = e.relatedTarget;
        if (!related || !tooltip.contains(related)) {
          if (!tooltip.matches(":focus-within")) { tooltip.classList.remove("pm-tooltip-visible"); }
        }
      }
    });
    document.addEventListener("focusin", function (e) {
      var tooltip = e.target.closest(".pm-tooltip");
      if (tooltip) tooltip.classList.add("pm-tooltip-visible");
    });
    document.addEventListener("focusout", function (e) {
      var tooltip = e.target.closest(".pm-tooltip");
      if (tooltip) {
        setTimeout(function () {
          if (!tooltip.contains(document.activeElement) && !tooltip.matches(":hover")) {
            tooltip.classList.remove("pm-tooltip-visible");
          }
        }, 100);
      }
    });
  }

  function init() {
    enhanceAllCards();
    enhanceAutocomplete();
    initResponsiveHelpers();
    initHoverFocusA20();

    // Global key handler for Escape to close any open modal
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        const modal = document.getElementById("qrModal") || document.getElementById("pmCallOverlay");
        if (modal && modal.contains(document.activeElement)) {
          const closeBtn = modal.querySelector("[data-close-modal], #pmCallClose, #pmCallHangup, #pmCallReject");
          if (closeBtn) closeBtn.click();
          else {
            try { modal.remove(); } catch (_) {}
          }
        }
      }
    });

    // Mutation observer to enhance dynamically added cards and forms
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(".list-card[onclick], .icon-item[onclick], .role-card[onclick]")) {
            makeCardAccessible(node);
          }
          node.querySelectorAll && node.querySelectorAll(".list-card[onclick], .icon-item[onclick], .role-card[onclick]").forEach(makeCardAccessible);
          if (node.matches && node.matches("table.data-table")) {
            initResponsiveHelpers();
          }
          if (node.querySelectorAll) {
            node.querySelectorAll("table.data-table").forEach(() => initResponsiveHelpers());
            node.querySelectorAll("input[name]").forEach((input) => {
              if (!input.hasAttribute("autocomplete")) {
                const name = input.name;
                if (name === "mobile" || name === "phone") input.setAttribute("autocomplete", "tel");
                if (name === "email") input.setAttribute("autocomplete", "email");
                if (name === "full_name") input.setAttribute("autocomplete", "name");
              }
            });
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.PMA11y = {
    trapFocus,
    showAccessibleDialog,
    hideAccessibleDialog,
    makeCardAccessible,
    enhanceAllCards,
    addErrorSummary,
    setFieldError,
    clearAllFieldErrors,
    preventDuplicateSubmit,
    announceLoading,
    announceError,
    addResultCount,
    enhanceAutocomplete,
    initResponsiveHelpers,
    tA11y,
    init,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
