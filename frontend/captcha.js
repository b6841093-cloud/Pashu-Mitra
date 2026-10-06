/* ==========================================================================
   Pashu-Shield — CAPTCHA hook (GA-21 / C1.2f)
   --------------------------------------------------------------------------
   Env-driven, no hard-coded secrets. Supports:
     - none (default) — no CAPTCHA, existing tests stay green
     - recaptcha, hcaptcha, turnstile — loads provider script dynamically
     - test — simple math challenge for automated tests
   Accessible alternative: math challenge (text alternative, WCAG 1.1.1)
   Honeypot field included for bot mitigation.
   ========================================================================== */
(function () {
  "use strict";

  let config = { enabled: false, provider: "none", site_key: "", alternative_enabled: true };
  let mathChallenge = null;

  async function loadConfig() {
    try {
      const res = await fetch("/api/captcha/config");
      if (res.ok) {
        const data = await res.json();
        config = data;
      }
    } catch (_) {}
    return config;
  }

  function isEnabled() {
    return config.enabled && config.provider !== "none";
  }

  function renderMathChallenge(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="field" style="border:1px solid #e2e5f0;padding:12px;border-radius:12px;background:#fbfbfe">
        <label for="pmCaptchaAlt">Accessible verification — ${escapeHtml(mathChallenge ? mathChallenge.question : "Loading challenge...")}</label>
        <input id="pmCaptchaAlt" name="captcha_alt_answer" type="number" inputmode="numeric" autocomplete="off" placeholder="Enter answer" aria-describedby="pmCaptchaAltHelp" />
        <p id="pmCaptchaAltHelp" class="pm-help">If you cannot complete the visual CAPTCHA, answer this math question. Audio alternative would be provided by the CAPTCHA provider when configured.</p>
        <input type="hidden" id="pmCaptchaAltToken" value="${escapeAttr(mathChallenge ? mathChallenge.challenge_token : "")}" />
      </div>
    `;
  }

  async function fetchMathChallenge(container) {
    try {
      const res = await fetch("/api/captcha/alternative", { method: "POST" });
      if (res.ok) {
        mathChallenge = await res.json();
        renderMathChallenge(container);
      }
    } catch (_) {}
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  async function renderCaptcha(containerId, opts) {
    const o = opts || {};
    const container = document.getElementById(containerId);
    if (!container) return;
    await loadConfig();
    if (!isEnabled()) {
      container.innerHTML = "";
      // Still render honeypot for bot mitigation (hidden from AT)
      container.innerHTML += `<div aria-hidden="true" style="position:absolute;left:-9999px"><label for="pmHp_${containerId}">Leave this empty</label><input id="pmHp_${containerId}" name="website" tabindex="-1" autocomplete="off" /></div>`;
      return;
    }

    // Honeypot
    let html = `<div aria-hidden="true" style="position:absolute;left:-9999px"><label for="pmHp_${containerId}">Leave this empty</label><input id="pmHp_${containerId}" name="website" tabindex="-1" autocomplete="off" /></div>`;

    if (config.provider === "test") {
      html += `<div class="pm-captcha-test"><p class="pm-help">Test CAPTCHA mode — enter any value to pass, or use accessible alternative below.</p><div class="field"><label for="pmCaptchaToken_${containerId}">Test CAPTCHA token</label><input id="pmCaptchaToken_${containerId}" name="captcha_token" placeholder="test token" /></div></div>`;
    } else if (config.provider === "recaptcha") {
      html += `<div id="pmRecaptcha_${containerId}" class="g-recaptcha" data-sitekey="${escapeAttr(config.site_key)}"></div>`;
      // Load recaptcha script dynamically
      if (!document.getElementById("pmRecaptchaScript")) {
        const s = document.createElement("script");
        s.id = "pmRecaptchaScript";
        s.src = "https://www.google.com/recaptcha/api.js";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
    } else if (config.provider === "hcaptcha") {
      html += `<div id="pmHcaptcha_${containerId}" class="h-captcha" data-sitekey="${escapeAttr(config.site_key)}"></div>`;
      if (!document.getElementById("pmHcaptchaScript")) {
        const s = document.createElement("script");
        s.id = "pmHcaptchaScript";
        s.src = "https://js.hcaptcha.com/1/api.js";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
    } else if (config.provider === "turnstile") {
      html += `<div id="pmTurnstile_${containerId}" class="cf-turnstile" data-sitekey="${escapeAttr(config.site_key)}"></div>`;
      if (!document.getElementById("pmTurnstileScript")) {
        const s = document.createElement("script");
        s.id = "pmTurnstileScript";
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }
    }

    // Accessible alternative
    if (config.alternative_enabled) {
      html += `<div id="pmCaptchaAltWrap_${containerId}"><div class="field"><button type="button" class="btn btn-ghost btn-sm" onclick="window.PMCaptcha.fetchMath('${containerId}')">Need an accessible alternative? Get a math challenge</button></div></div>`;
    }

    container.innerHTML = html;
    // Auto-fetch math challenge if provider is test or alternative requested
    if (config.provider === "test" || o.autoAlt) {
      fetchMathChallenge(document.getElementById(`pmCaptchaAltWrap_${containerId}`));
    }
  }

  function getCaptchaPayload(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return {};
    const payload = {};
    // Provider token
    const tokenInput = container.querySelector("[name=captcha_token]");
    if (tokenInput && tokenInput.value) {
      payload.captcha_token = tokenInput.value;
    } else {
      // Try to get from recaptcha/hcaptcha/turnstile global
      try {
        if (window.grecaptcha && window.grecaptcha.getResponse) {
          const t = window.grecaptcha.getResponse();
          if (t) payload.captcha_token = t;
        }
        if (window.hcaptcha && window.hcaptcha.getResponse) {
          const t = window.hcaptcha.getResponse();
          if (t) payload.captcha_token = t;
        }
        if (window.turnstile && window.turnstile.getResponse) {
          const t = window.turnstile.getResponse(`#pmTurnstile_${containerId}`);
          if (t) payload.captcha_token = t;
        }
      } catch (_) {}
    }
    // Alternative
    const altToken = document.getElementById("pmCaptchaAltToken");
    const altAnswer = document.getElementById("pmCaptchaAlt");
    if (altToken && altAnswer && altAnswer.value) {
      payload.captcha_alternative = {
        challenge_token: altToken.value,
        answer: altAnswer.value,
      };
    }
    // Honeypot
    const hp = document.getElementById(`pmHp_${containerId}`);
    if (hp && hp.value) {
      payload.website = hp.value;
    }
    return payload;
  }

  function clearCaptcha(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
      if (window.grecaptcha && window.grecaptcha.reset) window.grecaptcha.reset();
      if (window.hcaptcha && window.hcaptcha.reset) window.hcaptcha.reset();
      if (window.turnstile && window.turnstile.reset) window.turnstile.reset();
    } catch (_) {}
    const altAnswer = document.getElementById("pmCaptchaAlt");
    if (altAnswer) altAnswer.value = "";
  }

  window.PMCaptcha = {
    loadConfig,
    isEnabled,
    renderCaptcha,
    fetchMath: (containerId) => {
      const wrap = document.getElementById(`pmCaptchaAltWrap_${containerId}`);
      if (wrap) fetchMathChallenge(wrap);
    },
    getPayload: getCaptchaPayload,
    clear: clearCaptcha,
    getConfig: () => config,
  };

  // Auto-load config on startup
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadConfig);
  } else {
    loadConfig();
  }
})();
