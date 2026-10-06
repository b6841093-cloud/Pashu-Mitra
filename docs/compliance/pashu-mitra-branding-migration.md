# Pashu-Mitra branding migration — classification, logo contract and login UX

**Date:** 2026-10-06
**Branch:** `arena/78af3dc6-pashu-shield-updated`
**Scope:** task parts 7 (branding), 8 (logo), 9 (login/demo UX), 11 (dashboards), 12 (A–F classification), 13 (no regressions)

> This document exists so a future rename cannot silently break the deployment.
> It lists **every** remaining "Shield" occurrence in the repository, says which
> class it belongs to, and explains why the internal ones must stay.

---

## 1. Replaceable vs. non-replaceable — the rule

A "Shield" hit is only replaced when a **person** can see or hear the text.
Everything else (identifiers, service names, storage keys, routes, environment
variable names, model data, deployment documentation about the running services)
stays as it is, because renaming it changes a live deployment rather than a label.

| Class | Meaning | Action |
|-------|---------|--------|
| **A** | User-facing text (UI copy, page title, PWA metadata, spoken IVR prompt, SMS/OTP text, generated report title, error page title, alt/aria text) | **replace with "Pashu-Mitra"** |
| **B** | Internal identifier (module, variable, DB path, route, storage key, room/channel name, public URL of the running origin) | **keep** (renaming breaks state or deployment) |
| **C** | Deployment / service identity (`render.yaml`, `vercel.json`, Render service names, `service` field of a health payload, Asterisk dialplan context) | **keep** |
| **D** | Documentation / history (compliance reports, incident reports, deployment guides) | **keep** — it records what the system was called when the events happened; new docs use the new name |
| **E** | Code comment / docstring / model data (non-executed text) | **keep** (harmless; rewriting comments has no user benefit and creates churn) |
| **F** | Accessibility text (alt text, `aria-label`, `sr-only`, notification title) | **replace** — it is user-facing; `alt="Pashu-Mitra …"` unless the image is purely decorative |

---

## 2. Class A — replaced in this pass (verifiable by `frontend/tests/branding_webcall_states.test.mjs`)

| Location | Before | After |
|----------|--------|-------|
| `frontend/org-config.js` → `appName`, `appNameLocal`, `tagline` | `Pashu-Shield` | `Pashu-Mitra` / `पशु-मित्र` |
| `frontend/app.js` → every `t("app_name")`, `t("app.tagline")`, role titles, footer, install prompt, toasts | `Pashu-Shield` | `Pashu-Mitra` |
| `frontend/app.js` → `farmer.otp_sent`, `farmer.otp_missing_hint` (en) | "registered with PashuMitra" | "registered with Pashu-Mitra" |
| `frontend/app.js` → `farmer.helpline_name` and the other three languages | `Pashu-Shield helpline` | `Pashu-Mitra helpline` |
| `frontend/shell.js` → header, footer, page titles, breadcrumbs, sitemap, skip-link text | `Pashu-Shield` | `Pashu-Mitra` (from `ORG.appName`, never hard-coded) |
| `frontend/index.html` → `<title>`, `meta description`, `meta keywords`, favicon, `apple-touch-icon` | old name / emoji icon | `Pashu-Mitra` + official PNG |
| `frontend/manifest.json` → `name`, `short_name`, `description`, icons, shortcuts | `Pashu-Shield` | `Pashu-Mitra` + official PNG (`any` + `maskable`) |
| `frontend/sw.js` → notification title/body, cache comment shown in DevTools | `Pashu-Shield` | `Pashu-Mitra` |
| `frontend/info-pages.js` → About/Contact/Help/Privacy/Sitemap copy | `Pashu-Shield` | `Pashu-Mitra` |
| `frontend/call.js` → web-call card headings, help text, helpline sentence | `Pashu-Shield` | `Pashu-Mitra` |
| `frontend/models/*` | — | **untouched** (whisper tokenizer token `ĠShield`) |
| `backend/otp_service.py` → `_MESSAGES` (en/mr/hi/te) | `PashuMitra: {code} is your login OTP…` | `Pashu-Mitra: {code} is your login OTP…` |
| `backend/ivr_service.py` → `PROMPTS[*]["welcome"]` (spoken on the helpline) | "Welcome to Pashu-Shield." | "Welcome to Pashu-Mitra." (te/hi/mr localised name too) |
| `backend/ivr_service.py` → timeline actor label | `Pashu-Shield Helpline` | `Pashu-Mitra Helpline` |
| `backend/app.py:4737` → reportlab PDF title | `Pashu-Shield {Type} Report` | `Pashu-Mitra {Type} Report` |
| `backend/app.py:4246` → SMS gateway test message | `PashuMitra SMS gateway test message…` | `Pashu-Mitra SMS gateway test message…` |
| `backend/compliance_security.py` → generated error page `<title>` | `… — Pashu-Shield` | `… — Pashu-Mitra` |

Class F items are included above because they live inside the same templates
(`alt="Pashu-Mitra …"` in `shell.js` / `brandLogoHtml()`, the notification title
in `sw.js`, the `sr-only` ownership line in the footer).

---

## 3. Class B / C / D / E — deliberately preserved (complete list)

Every remaining hit in executable code, with the reason:

| File:line | Hit | Class | Why it must not change |
|-----------|-----|-------|------------------------|
| `backend/app.py:386` | `"service": "pashu-shield-backend"` | C | service identity in `/api/health`; monitoring/deploy checks assert it (`test_role_auth.py:661`) |
| `backend/realtime.py:105,107` | `https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app`, `…efyqsdomw…` | B | the **actual** deployed origin; must match byte-for-byte or CORS rejects it |
| `backend/test_webcalling.py:1387,1389,1475` | same origins | B | assertions on the allow-list |
| `backend/tests/deploy/deploy_check.mjs:25` | `https://pashu-shield-backend-hjgr.onrender.com` | C | live backend URL |
| `frontend/vercel.json:4,12` | `"name": "pashu-shield-frontend"`, rewrite → `pashu-shield-backend-hjgr.onrender.com` | C | Vercel project name + `/api` rewrite target; renaming the project is a deployment change, not branding |
| `render.yaml:5,25,223` | `pashu-shield-backend`, `pashu-shield-sqlite`, `pashu-shield-ml` | C | Render service + disk names; existing services cannot be renamed in place |
| `render.yaml:141` | `SIH_ALLOWED_ORIGINS` value | C | origin list, includes the real Vercel host names |
| `ml-backend/main.py:128` | `"service": "pashu-shield-ml"` | C | ML service identity used by `/health` probes |
| `voice/asterisk/extensions.conf.example:2,7` | Stasis app `pashu-shield` | C | Asterisk dialplan context name; a rename needs coordinated PBX change |
| `frontend/tests/*` | URLs, allow-list assertions | B | test fixtures pointing at the real deployment |
| `frontend/models/Xenova/whisper-tiny/{tokenizer,vocab}.json` | `ĠShield` | E | model vocabulary token (byte-pair merge), not text |
| `backend/auth_recovery.py:2`, `captcha_service.py:2`, `compliance_security.py:1`, `ivr_config.py:1,147`, `validation.py:2`, `test_compliance.py:2` | docstring/comment | E | non-executed text; `ivr_config.py:147` is a validation error about the **official helpline number**, and the number is unchanged |
| `docs/**`, `*.md` (69 hits) | historical reports | D | they record events under the old name (incident reports, compliance baselines). This file is the new-name reference |

Verified: `grep -rIn "pashu[- _]*shield"` over executable code returns **25**
lines, all of which are in the table above; **0** are class A.

---

## 4. Logo contract (part 8)

* **Single source:** `window.ORG.logo` in `frontend/org-config.js`
  (`src: "assets/pashu-mitra-logo.png"`, `aspectRatio: "auto"`, `alt: "Pashu-Mitra — …"`).
* **Every location reads that source:** site header (`shell.js`), footer,
  login/OTP/signup (`app.js` → `brandLogoHtml()`), owner/vet/govt/lab dashboard
  header (`owner-brand`), web-call page headers, browser tab + apple touch icon
  (`index.html`), PWA icons (`manifest.json`), service-worker notification
  (falls back to a text title, no emoji mark).
* **Never stretched, never cropped:** no aspect ratio is forced; CSS limits only
  the height (`56px` login, `40px` header, `32px`/`24px` compact contexts) with
  `width:auto; max-width:100%; object-fit:contain`.
* **Never a broken image:** the `<img>` carries
  `onerror="this.hidden=true"`/`this.style.display='none'`, so a missing file
  leaves the accessible product name visible instead of a broken-image icon.
* **Never a redrawn substitute:** no emoji stands in for the logo while
  `logo.src` is set; the old emoji mark is only used if `src` is empty.
* **Not the State Emblem:** `backend/test_compliance.py`
  (`test_75_no_owner_information_is_invented`) asserts the product logo path and
  that no `emblem` asset/name is referenced, and requires the
  "State Emblem of India is deliberately not used" note.
* **Asset status:** `frontend/assets/pashu-mitra-logo.png` is **not in this
  checkout**. The official artwork was shown in the conversation, but the upload
  never reached the workspace filesystem (no `uploads/` directory exists in the
  sandbox, and outbound downloads from the sandbox are blocked), so the file
  could not be copied byte-for-byte. The owner action is one step: place the
  supplied PNG at `frontend/assets/pashu-mitra-logo.png` (locally or via the
  GitHub web uploader on this branch). Every reference is already wired, and
  `frontend/tests/branding_webcall_states.test.mjs` validates the file the
  moment it appears (PNG signature, ≥64 px, sane aspect ratio, <2 MB, no forced
  aspect ratio in CSS) — until then that single check skips with a reason and the
  wordmark fallback is shown.

---

## 5. Login / demo UX (part 9)

* Removed: demo/development warning banners ("Demo mode enabled", "Demo login",
  "Using demo credentials", "Development/demo environment") and any internal
  configuration leakage (`production_override`, mode flags, env names).
  Enforced by the string-literal scan in
  `frontend/tests/branding_webcall_states.test.mjs` ("the demo access card stays
  visible, clean and fully localised").
* Kept — as a normal information card, not a banner: **Demo access**, showing
  the demo mobile number and the demo OTP exactly as the server supplies them
  (`/api/auth/farmer/config` → `demo.mobile`, `demo.otp`), plus the server's own
  notice line. Nothing is hard-coded in the frontend, so the card cannot drift
  from the backend.
* Farmer login flow unchanged and still fully accessible: mobile field
  (`type=tel`, `autocomplete=tel`, `inputmode=numeric`), **Send OTP**, one OTP
  input per digit (`autocomplete=one-time-code`), **Verify OTP**, resend with
  countdown, `aria-describedby` help, error summary in a live region, focus
  return, 44 px targets, four languages (en/mr/hi/te).
* No auto-verify, no self-granted session and no OTP persistence was added. The
  verification code path is untouched — this was a presentation change only.

---

## 6. Dashboards (part 11)

The header is global: `index.html` hosts `#pmSiteHeaderHost`, and
`PashuShell.renderSiteHeader()` renders the logo + `ORG.appName` +
`ORG.appNameLocal` + owner line on **every** route, which includes the farmer,
veterinarian, government and laboratory dashboards, the web-call page and all
public pages. Because the name comes from one object, the four dashboards cannot
diverge.

`frontend/tests/branding_webcall_states.test.mjs` now asserts that the header is
driven by `ORG` (logo `<img>` with `alt`, no emoji mark while a logo is
configured) and that no user-facing "Pashu Shield" string exists anywhere in the
frontend sources. Routes, cards, counts, charts, actions, navigation and RBAC
were not touched by the branding work.

---

## 7. Evidence

```bash
node --test frontend/tests/*.test.mjs   # 80 tests: 78 pass, 2 skipped, 0 fail
bash backend/run_tests.sh               # 10/10 suites, 344 tests
grep -rIn "pashu[- _]*shield" --exclude-dir=node_modules --exclude-dir=.venv \
     --exclude-dir=.git --include='*.py' --include='*.js' --include='*.mjs' \
     --include='*.html' --include='*.json' --include='*.yaml' . | wc -l   # 25, none class A
```

The two skipped frontend tests are the real-browser cases
(`frontend/tests/webcall_browser.test.mjs`): no browser is installable in this
sandbox, so they are reported as **NOT VERIFIED**, never as passes.
