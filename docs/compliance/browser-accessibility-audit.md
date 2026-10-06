# Browser Accessibility Audit — Pashu-Mitra master fix pass

**Date:** 2026-10-06 (second pass — "MASTER FIX PASS")
**Branch:** `arena/78af3dc6-pashu-shield-updated`
**Frontend:** https://pashu-mitra-2bu09eba6-pashu-shield.vercel.app/ (hash route `#/owner/webcall`) + local static `frontend/index.html`
**Backend:** https://pashu-shield-backend-hjgr.onrender.com
**Target:** WCAG 2.1 Level AA (as adopted by GIGW 3.0)
**Honesty statement:** anything that could not be executed in this environment is
marked **NOT VERIFIED** with the reason. No tool result is invented, and the
phrase "100% compliant" is not used anywhere in this document.

---

## 1. What this pass changed (and how accessibility was preserved)

The changes in this pass were branding, login/demo presentation and web-call
state text. Every accessibility mechanism that already existed was kept; the new
markup was written to the same patterns.

| Change | Accessibility treatment |
|--------|-------------------------|
| Product name is now `Pashu-Mitra` (from `window.ORG.appName`, once) | Already-rendered text; no structure change. `sr-only` ownership line, breadcrumb `aria-current`, page titles and `lang` handling untouched. |
| Official logo `<img>` in header, login, OTP/signup, dashboards, web-call, favicon, PWA icon | `alt="Pashu-Mitra"` (never empty unless the image is purely decorative), `width:auto` + `object-fit:contain` (no distortion), height-only caps so 200% zoom and 320 px reflow still work, `onerror` hides a missing asset instead of showing a broken-image glyph. |
| Demo/development **banners removed**; demo credentials moved into a normal information card | The card is a labelled group: `role="group"` + `aria-labelledby="farmerDemoAccountTitle"`; the sign-in hint is wired with `aria-describedby="farmerDemoNote"` and the copy button has an accessible name. No information was removed for screen-reader users — the mobile number and demo OTP are still exposed as text. |
| Farmer OTP login wording | Phone field keeps `type="tel"`, `autocomplete="tel"`, `inputmode="numeric"`; OTP digits keep `autocomplete="one-time-code"`; help text stays attached with `aria-describedby`; the error summary is still a live region that receives focus on failure; the resend countdown is still announced politely. |
| Web-call states (12) | Each state is **text** as well as colour: a badge carries the label, and the state strip is a `role="list"` of `role="listitem"` rows with exactly one `aria-current="true"`. Status changes are announced through the existing `role="status"`/`aria-live="polite"` regions; nothing depends on colour alone. |
| Raw routing codes removed from the visible sentence | The developer detail is now `title`/`data-*` attributes only, so a screen reader no longer reads `NO_LIVE_SESSION · NO_LIVE_SESSION`. The human sentence ("Your connection to the veterinarian service is being restored.") is what is announced. |
| New "Retry connection" button on the farmer and vet cards | A native `<button type="button">` with a text label and the existing `.btn` sizing (≥44 px on coarse pointers). It is revealed only when it can act, and it is reachable in tab order right after the status text. |

Nothing in the change set is keyboard-only, colour-only, pointer-only or
motion-dependent, and no text was replaced by an icon.

---

## 2. Checks executed in this pass

### 2.1 Automated (executed here)

| Check | Command | Result |
|-------|---------|--------|
| Frontend unit/UI tests | `node --test frontend/tests/*.test.mjs` | **80 tests — 78 pass, 0 fail, 2 skipped** (the 2 skipped are the real-browser cases, §3) |
| Branding + state honesty | `node --test frontend/tests/branding_webcall_states.test.mjs` | **10/10 pass** — includes the 12-state text strip, the dashboard header rendering the official logo with `alt`, and the demo card being a labelled group |
| XSS escaping (escapes every user value before `innerHTML`) | `node --test frontend/tests/xss_escaping.test.mjs` | pass (no new unescaped interpolation introduced) |
| OTP login UI | `node --test frontend/tests/otp_login_ui.test.mjs` | pass |
| Web-call UI + honesty | `node --test frontend/tests/webcall_ui.test.mjs webcall_state_honesty.test.mjs` | pass |
| Static HTML shell | code inspection of `frontend/index.html` | `lang="en"`, viewport without `user-scalable=no`, skip link first, `main#main-content`, live regions `#pmLivePolite` (`role="status"`) and `#pmLiveAssertive` (`role="alert"`), one `h1`, manifest + theme colour present |
| Backend suites (do not break the API the UI depends on) | `bash backend/run_tests.sh` | **10/10 suites, 344 tests pass** |

### 2.2 Code-level checks (no browser needed)

| Requirement | Where | Result |
|-------------|-------|--------|
| Keyboard reachability of every control | `a11y.js` (`makeCardAccessible`, `trapFocus`), `call.js` (buttons, not divs), `app.js` (forms) | PASS by inspection |
| Visible focus | `.pm-*:focus-visible` ring in `style.css`, `:focus` fallback under `@supports` | PASS by inspection |
| Touch targets ≥ 44 px | `@media (pointer:coarse)` block covering `.btn`, `.nav-item`, `.header-icon-btn`, `.icon-item` | PASS by inspection |
| Text resize to 200% without loss | `--pm-text-scale` + A-/A/A+ controls; the new logo sizes are height-only (px) and do not clip text | PASS by inspection |
| Reflow at 320 px / 400% zoom | `@media (max-width:360px)` block; header hides only the tagline, never the brand name or the logo; flex/grid wrap | PASS by inspection |
| Reduced motion & high contrast | `@media (prefers-reduced-motion)` + in-app toggles; high-contrast mode is opt-in and unchanged | PASS by inspection |
| Multilingual | All new/changed strings exist in **en, mr, hi, te** (`webcall.*` keys, demo card, nav) | PASS — asserted by the two test files |
| Live-region announcements on state change | `PashuShell.announce()` used by the status paths | PASS by inspection |
| No colour-only meaning | Every badge carries a label; the state strip carries text | PASS (test "the twelve call states are distinguished by text, not colour") |

---

## 3. NOT VERIFIED in this environment (with the exact reason)

| Check | Why it could not run | How to run it |
|-------|----------------------|---------------|
| axe-core / pa11y / Lighthouse scans | No Chrome/Chromium in the sandbox and the browser download is blocked (`npx playwright install chromium` fails) | `npx @axe-core/cli http://localhost:5001/ --tags wcag2a,wcag2aa,wcag21aa`, `npx pa11y --standard WCAG2AA http://localhost:5001/`, `npx lighthouse http://localhost:5001/ --only-categories=accessibility` |
| Real screen reader (NVDA/JAWS/VoiceOver/TalkBack) | No assistive technology available here | Manual pass on the 7 priority journeys (login → OTP → dashboard → web call → accept → mute → hang up) |
| Keyboard walkthrough with a real browser | Same browser limitation | Tab through the same journeys; confirm focus is never lost when the call state changes |
| 200% browser zoom / 320 px device | Same browser limitation | DevTools at 320 px and 200%/400% zoom; confirm no horizontal scrolling and no clipped controls |
| Contrast measurement of the **new** logo asset | The asset file is not in this checkout yet (see below) | Measure the logo's own contrast once the file is added; if any part falls below 3:1 against the header background the asset (not the palette) must be adjusted by the owner |
| Real two-way audio for a screen-reader user (live captions) | No microphone/browser | Known gap A-9 below — the text call state is provided instead |

**The official logo file (`frontend/assets/pashu-mitra-logo.png`) is not present in
this checkout.** The artwork was attached in the conversation, but the upload did
not reach the workspace filesystem (there is no `uploads/` directory in the
sandbox and outbound downloads are blocked), so the bytes could not be copied.
Every reference is wired (`org-config.js` is the single source; `index.html`
favicon/apple-touch-icon and `manifest.json` icons point at the same path) and
the fallback keeps the accessible product name visible; the moment the PNG is
placed in `frontend/assets/`, `node --test frontend/tests/branding_webcall_states.test.mjs`
validates it (signature, dimensions, aspect ratio, size) and no code change is
needed. Until then the rendered result cannot be audited visually and the logo's
own contrast cannot be measured.

---

## 4. Known gaps — unchanged, still honest

| # | Gap | WCAG | Status after this pass |
|---|-----|------|------------------------|
| A-1 | Alt text on every meaningful image | 1.1.1 | **IMPROVED** — the product logo has a dedicated `alt` from `ORG.logo.alt`; decorative emoji marks in role cards still lack a text alternative (icons are decorative next to a visible label, but screen readers read the emoji name) |
| A-2 | Programmatic label on every form field | 3.3.2 / 4.1.2 | PARTIAL — farmer OTP, staff login/registration and Feedback are labelled; some report forms still pending |
| A-3 | `autocomplete` on all personal-data inputs | 1.3.5 | PARTIAL — login/OTP done |
| A-4 | Roles/states on custom widgets | 4.1.2 | PARTIAL — all new widgets (state strip, demo card, retry button) are labelled; legacy OTP boxes still need review |
| A-5 | Inline field errors + error summary on legacy forms | 3.3.1 / 3.3.3 | PARTIAL — reference pattern exists |
| A-6 | Charts: title/desc/text summary/data table | 1.1.1 / GIGW §54 | FAILED (unchanged) |
| A-7 | Tables: caption/`thead`/`scope` | 1.3.1 | PARTIAL (unchanged) |
| A-8 | Contrast measurement of the whole palette | 1.4.3 / 1.4.11 | PARTIAL — token fixes from the previous pass remain; full-palette measurement needs axe-core |
| A-9 | Live captions for live WebRTC audio | 1.2.4 | NOT DONE — the call state is exposed as text instead |
| A-10 | Web-call state honesty | — | **FIXED and extended** — 12 states, text + semantics, raw codes demoted to developer detail |
| A-11 | Dialog focus management everywhere | 2.1.2 | PARTIAL (unchanged) |
| A-12 | `lang` on inline passages in another language | 3.1.2 | NOT DONE — the four localisations are whole-page |
| A-13 | Heading hierarchy | 2.4.6 / 1.3.1 | PARTIAL (unchanged) |
| A-14 | Keyboard walkthrough of every workflow | 2.1.1 | **NOT VERIFIED** — code inspection passes, real browser not available |
| A-15 | 320 px / 200% verification | 1.4.10 | **NOT VERIFIED** — code inspection passes, real browser not available |

---

## 5. Colour changes

No new colour was introduced in this pass. The palette, the focus ring and the
high-contrast mode are the ones recorded in the previous audit
(`style.css` `:root`, and the C-1…C-7 log in git history). The logo is rendered
as supplied by the owner — it is never recoloured, and the header background was
not changed to fit it.

---

## 6. Overall result for this pass

* **Preserved and extended:** keyboard paths, focus visibility, labels,
  `autocomplete`/`one-time-code`, `aria-describedby`, error summary, live
  regions, `sr-only` text, 44 px targets, 200% text scaling, 320 px reflow,
  reduced motion, high contrast, multilingual coverage (en/mr/hi/te) —
  **PASS by code inspection + the 80 frontend tests**.
* **Newly verified by tests:** the twelve web-call states are textual, the
  dashboard header renders the official logo with an accessible name, the demo
  card is a labelled group and no development-style wording is rendered.
* **NOT VERIFIED here:** browser-based scanners, real assistive technology,
  real zoom/reflow, real two-way audio captions, and the logo asset itself
  (missing from the checkout).
* **Claimed:** nothing beyond the above. No "100% compliant" statement is made.
