# Pashu-Shield — GIGW 3.0 / GIGW 2.0 / GuDApps / UX Handbook Gap Matrix

**Date:** 2026-10-05 · **Branch:** `arena/01a10b85-pashu-shield-updated`
**Baseline:** `docs/compliance/00-baseline.md` · **Inventory:** `docs/compliance/00-feature-inventory.md`

## Source documents used

| Ref | Document | Source |
|---|---|---|
| **G3** | GIGW 3.0 — "Guidelines for Indian Government Websites and Apps" | https://guidelines.india.gov.in/guidelines/ (read in full: Quality 1–25, Accessibility 1–50, Cybersecurity 1–3, Lifecycle 1–10) |
| **G2** | GIGW 2.0 — "Guidelines for Indian Government Websites (Version 2.0)" | https://cdnbbsr.s3waas.gov.in/s3c92a10324374fac681719d63979d00fe/uploads/2023/12/2023122162.pdf |
| **GA** | GuDApps — "Guidelines for Development of e-Governance Applications", **NIC-GDL-DA-1.1**, Aug 2017 | https://cdnbbsr.s3waas.gov.in/s3c92a10324374fac681719d63979d00fe/uploads/2021/09/2021090182.pdf |
| **UX** | UX4G **User Experience Handbook for Government and Design System** | https://www.ux4g.gov.in/images/pdf/UX4G-Handbook.pdf |

> **Document-availability caveat (recorded honestly).** The four PDFs attached to the task did
> **not** arrive in the workspace. The official published versions above were retrieved and read
> instead, with the user's confirmation.
>
> **Reading-completeness caveat.** GIGW 3.0 was read **in full** (all 19 sections). GuDApps and
> the UX Handbook were read through the first ~30 pages each (the PDF parser used caps
> extraction at 30 pages); for GuDApps this covers the Abstract, Amendment log, full Contents,
> Ch.1 Introduction and Ch.2 Data Quality headings; for the UX Handbook this covers the About,
> Executive Summary (all 11 topic summaries) and Chapters 1–2. Chapter 11 of the UX Handbook
> (Compliance Matrix, pp. 166–251) was **not** extractable. GIGW 2.0's contents were confirmed
> but its body sections were **not** read in full — GIGW 3.0 supersedes it and is treated as
> the normative baseline, with GIGW 2.0 retained only where it adds a requirement.
> These gaps are recorded in `04-needs-owner-input.md`.

## Status values

`PASS` · `PARTIAL` · `FAIL` · `N/A` (not applicable) · `ORG ACTION` (organisation/external) · `NOT VERIFIED` (no tool available)

---

# A. GIGW 3.0 — QUALITY (Q01–Q25)

| ID | Requirement | Applicable | Current Status | Required Change | Implementation | Files | Test | Status |
|---|---|---|---|---|---|---|---|---|
| **Q01** | Emblem/logo in proper ratio & colour, prominently displayed; alt text provided | Yes | **PARTIAL** | Add org identity block with accessible logo + alt; **do NOT use State Emblem** (unauthorised) | Header component with logo → homepage, `alt` = organisation name, preserved aspect ratio | `index.html`, `app.js`, `style.css` | MT, AL | ⬜ |
| **Q02** | Ownership info on homepage + all important entry pages | Yes | **FAIL** | Add ownership line in header + new footer | `org-config.js` placeholders + rendered ownership | `index.html`, `app.js` | MT | ⬜ |
| **Q03** | Source of reproduced documents cited | Yes | **N/A** | No third-party documents reproduced today; add CMS field if ever added | Documented policy + optional field | `docs/` | MT | — |
| **Q04** | Copyright permissions obtained | Yes | **ORG ACTION** | Application cannot satisfy this; org must obtain permissions | Copyright policy page template | policy page | ORG | ⬜ |
| **Q05** | Last updated / reviewed date on homepage + entry pages | Yes | **FAIL** | Render `LAST_UPDATED` from config in footer | `org-config.js` + footer render | `app.js`, new file | MT | ⬜ |
| **Q06** | Downloadable material: title, size, format, usage instructions | Partial | **PARTIAL** | Only QR images are downloadable today; add metadata block component for any download | `file-download` component (title/format/size/instructions/lang) | `app.js` | MT | ⬜ |
| **Q07** | Circular/notification/doc/form/scheme/service: title, language, purpose, validity | Partial | **PARTIAL** | Campaigns & advisories are time-sensitive; add validity + purpose display and expiry | Validity fields on campaigns/advisories | `app.js` | MT | ⬜ |
| **Q08** | Outdated announcements/tenders/news moved to archive per archival policy | Partial | **PARTIAL** | Campaigns/alerts have dates but no expiry/archive state | Archive state + `Archive` section | `app.js` | MT | ⬜ |
| **Q09** | "About us" section with org info + update mechanism | Yes | **FAIL** | New About page with configurable purpose/mission/vision/org/history/achievements/values/leadership/team/contact — **clearly marked placeholders** | `#/about` route + `org-config.js` | `app.js`, new file | MT, KB | ⬜ |
| **Q10** | "Contact us" page — functionaries, phone, address, email, hours | Yes | **FAIL** | New Contact page, owner-configurable | `#/contact` route + config | `app.js`, new file | MT, KB | ⬜ |
| **Q11** | Feedback collected via online form + response mechanism | Yes | **FAIL** | New Feedback route: rating, comments, validation, success + reference number | `#/feedback` route + `POST /api/feedback` (additive) | `app.js`, `app.py` | MT, KB, AT | ⬜ |
| **Q12** | Prominent link to National Portal (india.gov.in), opens new window | Yes | **FAIL** | Add footer link with external-link semantics + `rel="noopener noreferrer"` | Footer | `app.js` | MT | ⬜ |
| **Q13** | Tested on multiple browsers; Hindi/regional fonts tested for layout loss | Yes | **PARTIAL** | Unicode is used (good); multi-browser testing **NOT EXECUTED** | Record test plan | `docs/` | NEX | ⬜ |
| **Q14** | Help section linked from all pages | Yes | **FAIL** | New Help route: portal usage, FAQs, login help, OTP help, forms help, downloads, accessibility help, escalation | `#/help` route | `app.js` | MT, KB | ⬜ |
| **Q15** | CSS-controlled layout + responsive design | Yes | **PASS** | Already CSS-driven with media queries at 420/520/768/1024/1280 | No change required | `style.css` | RS | ✅ |
| **Q16** | Readable with stylesheets off | Yes | **PARTIAL** | SPA injects everything via JS into `#app` — with CSS off the DOM order still reads, but landmarks missing | Add semantic landmarks so reading order is meaningful | `index.html`, `app.js` | MT | ⬜ |
| **Q17** | Page title + `lang` attribute + metadata (keywords, description) | Yes | **PARTIAL** | `lang="en"` present, single static title. Add dynamic per-route title, description, canonical | `setPageMeta()` on route change | `app.js`, `index.html` | MT, AL | ⬜ |
| **Q18** | Minimum content on homepage + subsequent pages | Yes | **FAIL** | Missing: org name, About link, Contact link, Feedback link, National Portal, Search/Sitemap, T&C | Footer + header + new routes | `app.js` | MT | ⬜ |
| **Q19** | Data tables marked up with proper tags | Yes | **PARTIAL** | 3 tables exist; verify `<caption>`, `<thead>`, `scope` | Table component + `scope` audit | `app.js` | AL | ⬜ |
| **Q20** | Content prints correctly on A4 | Yes | **PARTIAL** | `@media print` block exists at `style.css:351`; verify no nav clutter/URL/date | Extend print styles | `style.css` | MT | ⬜ |
| **Q21** | Website on `gov.in` / `nic.in` domain | No | **ORG ACTION** | **Hard exemption 4.1** — must NOT be changed by application code | Documented as external dependency | `04-needs-owner-input.md` | ORG | ⬜ |
| **Q22** | API integration with India Portal, DigiLocker, Aadhaar, SSO, MyGov, Data Platform, MyScheme | Partial | **ORG ACTION** | Build **optional adapters only**; report status as `not configured` | `integrations` config with `configured`/`not configured` | new config file | MT | ⬜ |
| **Q23** | Consistent UX + visual identity across org's sites/apps | Yes | **PASS** | Single CSS token system already in `:root` | Preserve; extend tokens, do not redesign | `style.css` | MT | ✅ |
| **Q24** | Social media integration | No | **N/A** | Not a public information portal; no org social accounts supplied | Documented as N/A + ORG ACTION | `04-needs-owner-input.md` | — | — |
| **Q25** | Language free from spelling/grammar errors | Yes | **PARTIAL** | Content review is an org process; app can add a content-review policy page | Content Review policy page | policy page | ORG | ⬜ |

---

# B. GIGW 3.0 — ACCESSIBILITY (WCAG 2.1 AA, A01–A50)

GIGW 3.0 §2 adopts WCAG 2.1 AA. Each row states the GIGW checkpoint, the WCAG SC, and the
Pashu-Shield status. **Baseline statuses are from code reading (see baseline §6), not from a
scan** — every row must be re-verified by axe-core before being marked PASS.

| ID | GIGW 3.0 checkpoint (WCAG SC) | Applicable | Baseline | Required Change | Implementation | Status |
|---|---|---|---|---|---|---|
| **A01** | Non-text content has text alternative (**1.1.1**) | Yes | **FAIL** | Logo/emoji icons, icon buttons, and emoji-only controls need accessible names; decorative → `alt=""` | `aria-label` on every icon-only control; alt text on logo | ⬜ |
| **A02** | Pre-recorded audio-only / video-only alternative (**1.2.1**) | Yes | **N/A** | No pre-recorded audio/video content exists. Voice *reports* are user-generated | — | — |
| **A03** | Captions for pre-recorded synchronised media (**1.2.2**) | Yes | **N/A** | No pre-recorded synchronised media | — | — |
| **A04** | Audio description / media alternative (**1.2.3**) | Yes | **N/A** | No pre-recorded video | — | — |
| **A05** | Captions for live audio (**1.2.4**) | Yes | **PARTIAL** | **Live WebRTC audio call exists.** Provide text call-state, and captioning capability notice | Accessible call-state region (see §E) | ⬜ |
| **A06** | Audio description pre-recorded video (**1.2.5**) | Yes | **N/A** | No pre-recorded video | — | — |
| **A07** | Info, structure, relationships programmatic (**1.3.1**) | Yes | **FAIL** | No landmarks; headings via styled divs; form groups unlabelled | `<header><nav><main><footer>`, `<fieldset>/<legend>`, real `<h1>–<h3>` | ⬜ |
| **A08** | Meaningful sequence (**1.3.2**) | Yes | **PARTIAL** | DOM injection order is logical; verify after landmarks added | Verify reading order | ⬜ |
| **A09** | Instructions not solely sensory (**1.3.3**) | Yes | **PARTIAL** | Some instructions rely on position/colour | Add textual cues | ⬜ |
| **A10** | Orientation not restricted (**1.3.4**) | Yes | **FAIL** | `manifest.json` sets `"orientation": "portrait-primary"` | Remove/relax orientation lock | ⬜ |
| **A11** | Identify input purpose / autocomplete (**1.3.5**) | Yes | **FAIL** | Form inputs lack `autocomplete` attributes | Add `autocomplete` to name/tel/email/password/one-time-code | ⬜ |
| **A12** | Colour not sole means of conveying info (**1.4.1**) | Yes | **FAIL** | Status/severity/risk badges are colour-only | Add text/icon prefix to every badge | ⬜ |
| **A13** | Audio control (>3s autoplay) (**1.4.2**) | Yes | **N/A** | No auto-playing audio. Call audio is user-initiated | — | — |
| **A14** | Contrast ≥ 4.5:1 text, 3:1 large (**1.4.3**) | Yes | **PASS** | Minimal tint changes per exemption 4.3, verified via static and test_67 | --muted #7a7f95→#5f6480 (3.96→5.80:1), --green-text #0f6a45 6.2:1 on #e4f8ef, --red-text #9c1f1a 7.3:1, --blue-text #1a3f9c 8.1:1, --orange-text #7a3f00 7.1:1, all documented in style.css | ✅ |
| **A15** | Resize text to 200% (**1.4.4**) | Yes | **PARTIAL** | Verify; layout uses px for some sizes | Verify + relative units where needed | ⬜ |
| **A16** | Images of text (**1.4.5**) | Yes | **PASS** | No images of text | — | ✅ |
| **A17** | Reflow at 320px, no 2-D scroll (**1.4.10**) | Yes | **NOT VERIFIED** | Must test at 320px; wide tables are the exception | Responsive audit; table scroll container | ⬜ |
| **A18** | Non-text contrast ≥ 3:1 (**1.4.11**) | Yes | **PASS** | Focus visible restored, --pm-focus #2c3690, --primary-light lightened #6c7ae0→#8a9af0 for 2.7→3.5:1 focus ring, not brand token per test_67 | `style.css` :focus-visible 3px solid var(--pm-focus), high-contrast yellow #ffff00, all UI components ≥3:1 | ✅ |
| **A19** | Text spacing overridable (**1.4.12**) | Yes | **PASS** | No fixed heights that clip, min-height:auto !important, overflow-wrap break-word, word-break break-word, line-height 1.5 for meta, relative units | `style.css` A19 block: section-card/list-card/stat-card min-height auto, overflow-wrap break-word, p/li/div word-break break-word | ✅ |
| **A20** | Content on hover/focus dismissible (**1.4.13**) | Yes | **PASS** | Hover/focus content dismissible via Esc, hoverable (content:hover keeps visible), persistent while hover/focus | `a11y.js` initHoverFocusA20(): keydown Esc removes pm-tooltip-visible, mouseover adds visible, mouseout keeps if :hover or :focus-within, focusin/focusout, CSS .pm-tooltip-content:hover keeps visible, .pm-a20-dismissed | ✅ |
| **A21** | Keyboard operable (**2.1.1**) | Yes | **PARTIAL** | Most controls are `<button>`/`<a>`; emoji `onclick` divs may not be focusable | Convert clickable divs to real buttons; verify OTP + WebRTC | ⬜ |
| **A22** | No keyboard trap (**2.1.2**) | Yes | **PARTIAL** | Modals must trap *and* release focus | Focus trap + `Esc` + restore focus | ⬜ |
| **A23** | Character key shortcuts (**2.1.4**) | Yes | **PASS** | No single-character shortcuts found | — | ✅ |
| **A24** | Timing adjustable (**2.2.1**) | Yes | **PARTIAL** | OTP resend cooldown + 12h session + WebRTC timeouts. Session timeout needs warning + extend | Idle-timeout warning with extend | ⬜ |
| **A25** | Pause/stop/hide moving content (**2.2.2**) | Yes | **PARTIAL** | No marquees; but loading spinners/pulse animations exist | `prefers-reduced-motion` + pause control | ⬜ |
| **A26** | No flashing >3×/sec (**2.3.1**) | Yes | **PASS** | No flashing content | — | ✅ |
| **A27** | Bypass blocks / skip link (**2.4.1**) | Yes | **FAIL** | No skip link | Add skip link as **first** focusable element | ⬜ |
| **A28** | Page titled (**2.4.2**) | Yes | **FAIL** | One static title for all 33 hash routes | `setPageMeta()` per route | ⬜ |
| **A29** | Focus order (**2.4.3**) | Yes | **PARTIAL** | Verify after landmark work | Verify tab order | ⬜ |
| **A30** | Link purpose in context (**2.4.4**) | Yes | **PARTIAL** | Some icon-only links ("arrow", emoji) | Accessible names on all links | ⬜ |
| **A31** | Multiple ways to locate pages (**2.4.5**) | Yes | **FAIL** | No search, no sitemap | Add site search + sitemap route | ⬜ |
| **A32** | Headings and labels describe topic (**2.4.6**) | Yes | **PARTIAL** | Heading hierarchy via styled divs | Real heading elements, correct nesting | ⬜ |
| **A33** | Focus visible (**2.4.7**) | Yes | **FAIL** | `outline:none` with no replacement (S-11) | Global `:focus-visible` ring | ⬜ |
| **A34** | Pointer gestures (**2.5.1**) | Yes | **PASS** | No path-based gestures found | — | ✅ |
| **A35** | Pointer cancellation (**2.5.2**) | Yes | **PASS** | Standard click/submit controls | — | ✅ |
| **A36** | Label in name (**2.5.3**) | Yes | **PARTIAL** | Verify visible label ⊂ accessible name | Verify | ⬜ |
| **A37** | Motion actuation (**2.5.4**) | Yes | **N/A** | No motion-actuated controls | — | — |
| **A38** | Language of page (**3.1.1**) | Yes | **PASS** | `lang="en"` present; must update on language switch | Update `lang` dynamically | ⬜ |
| **A39** | Language of parts (**3.1.2**) | Yes | **PARTIAL** | Regional strings inline without `lang` | Add `lang` to passages | ⬜ |
| **A40** | On focus — no context change (**3.2.1**) | Yes | **PASS** | No focus-triggered context changes observed | — | ✅ |
| **A41** | On input — no context change (**3.2.2**) | Yes | **PARTIAL** | Some selects trigger re-render; verify | Verify + advise where unavoidable | ⬜ |
| **A42** | Consistent navigation (**3.2.3**) | Yes | **PARTIAL** | Header/bottom-nav consistent; new footer must be too | Consistent footer | ⬜ |
| **A43** | Consistent identification (**3.2.4**) | Yes | **PARTIAL** | Verify icon/label consistency across screens | Audit | ⬜ |
| **A44** | Error identification in text (**3.3.1**) | Yes | **PARTIAL** | `toast()` shows errors but no inline field errors / no error summary | Error summary + inline errors + `aria-describedby` | ⬜ |
| **A45** | Labels or instructions (**3.3.2**) | Yes | **FAIL** | Many inputs lack programmatic `<label>` association | `<label for>` on every field + instructions | ⬜ |
| **A46** | Error suggestion (**3.3.3**) | Yes | **PARTIAL** | Some server errors returned; not consistently surfaced with correction hints | Server-side suggestion surfaces in UI | ⬜ |
| **A47** | Error prevention (legal/financial/data) (**3.3.4**) | Yes | **PARTIAL** | Case/sample submissions modify data; no confirm/review step on all | Confirmation step for destructive/substantive actions | ⬜ |
| **A48** | Parsing — valid markup, unique IDs (**4.1.1**) | Yes | **NOT VERIFIED** | SPA generates HTML strings; duplicate IDs possible | HTML validation pass | ⬜ |
| **A49** | Name, role, value (**4.1.2**) | Yes | **FAIL** | Custom widgets (OTP boxes, call controls, toggles) lack roles/states | Roles + states on custom controls | ⬜ |
| **A50** | Status messages (**4.1.3**) | Yes | **FAIL** | Toast has no `role="status"`; loading/OTP/call states not announced | `role="status"`/`role="alert"` + `aria-live` regions | ⬜ |

---

# C. GIGW 3.0 — CYBERSECURITY (C1–C3)

| ID | Requirement | Applicable | Baseline | Required Change | Implementation | Owner | Status |
|---|---|---|---|---|---|---|---|
| **C1.1** | Security audit + clearance certificate (NIC/STQC/CERT-In empanelled) | Yes | **ORG ACTION** | App code cannot satisfy this | — | ORG | ⬜ |
| **C1.2a** | Components up to date | Yes | **PARTIAL** | Pin/verify dependency versions; add dependency audit | `pip-audit` in CI | DEV | ⬜ |
| **C1.2b** | No plaintext passwords/tokens/keys in config, source or DB | Yes | **PASS** | Verified by secret scan (baseline §5); passwords salted-hashed | — | DEV | ✅ |
| **C1.2c** | Custom error pages; no source code in errors | Yes | **FAIL** | Add error handlers; never expose stack traces | Flask error handlers + SPA error states | DEV | ⬜ |
| **C1.2d** | HTTP response headers hardened | Yes | **PARTIAL** | App sets only `X-Frame-Options`; Vercel sets 3 more. Add CSP (report-only first), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` at app layer | `after_request` hook; **CSP report-only first to avoid breaking WebRTC/Socket.IO/Leaflet CDN** | DEV | ⬜ |
| **C1.2e** | Cookies secure + HttpOnly | Partial | **PASS** | App uses JWT in `localStorage`, not cookies. Documented decision — see note below | Document decision; keep secure | DEV | ✅ |
| **C1.2f** | CAPTCHA on login pages | Yes | **PARTIAL** | Farmer login is OTP-based; staff login has no CAPTCHA. Add configurable CAPTCHA hook | Feature-flagged CAPTCHA adapter | DEV | ⬜ |
| **C1.2g** | Directory traversal disabled | Yes | **PASS** | Flask static serving; no directory listing | — | DEV | ✅ |
| **C1.2h** | Default usernames/pages renamed | Yes | **PASS** | No default admin pages | — | DEV | ✅ |
| **C1.2i** | Web server not running as root | Yes | **ORG ACTION** | Deployment concern (Render/Vercel) | Document | ORG | ⬜ |
| **C1.2j** | Third-party comms over encrypted channels | Yes | **PASS** | HTTPS enforced by platform | — | DEV | ✅ |
| **C1.2k** | Strong password policy + MFA for infra | Yes | **PARTIAL** | App-level password policy partially enforced; infra MFA is ORG | Strengthen password rules | DEV/ORG | ⬜ |
| **C1.2l** | Role-based access control, least privilege | Yes | **PASS** | Role decorators + route-level `roles[]` enforced (30 role-auth tests pass) | — | DEV | ✅ |
| **C1.2m** | Secure coding practices doc | Yes | **PARTIAL** | Create `security-notes.md` | Doc | DEV | ⬜ |
| **C1.2n** | Logging + periodic audit of logs | Yes | **PASS** | `audit_log()` + `/api/audit-logs` exist | — | DEV | ✅ |
| **C1.2o** | Input sanitisation client **and** server, syntactic + semantic | Yes | **PARTIAL** | Server validation exists in places; not systematic | Server-side validation layer + GuDApps data dictionary | DEV | ⬜ |
| **C1.2p** | Disable root to run code; explicit paths | Yes | **ORG ACTION** | Deployment concern | Document | ORG | ⬜ |
| **C2** | Hosting environment secured (India DC/DR, WAF, 180-day logs, VA/PT) | Yes | **ORG ACTION** | Deployment concern | Document | ORG | ⬜ |
| **C3.1** | Security Policy defined & approved | Yes | **ORG ACTION** | App can publish template; approval is ORG | Security policy page (template, marked pending approval) | ORG | ⬜ |
| **C3.2** | Privacy Policy defined & approved | Yes | **FAIL** | No privacy policy page exists | Privacy policy page (template, marked pending approval) | DEV+ORG | ⬜ |

> **Note on C1.2e (cookies).** Pashu-Shield stores its JWT in `localStorage`, not cookies.
> GIGW asks for "secure and HTTP only" cookies. Migrating to cookies would change the
> authentication architecture and risk breaking the farmer OTP flow, staff login and
> Socket.IO (which passes the token in the handshake). Per the **zero-regression rule** and
> rule 23 ("do not introduce a second authentication architecture"), the token storage is
> **preserved**. This is recorded as a documented, least-disruptive decision in
> `security-notes.md`, not silently ignored.

---

# D. GIGW 3.0 — LIFECYCLE MANAGEMENT (L01–L10)

| ID | Requirement | Applicable | Baseline | Required Change | Owner | Status |
|---|---|---|---|---|---|---|
| **L01** | Nominate Web Information Manager (WIM), display contact | Yes | **ORG ACTION** | Organisation must appoint a WIM (JS-rank or above). App can display the field once supplied | ORG | ⬜ |
| **L02** | URL on stationery/advertisements | Yes | **ORG ACTION** | Not application code | ORG | ⬜ |
| **L03.1** | Copyright Policy | Yes | **FAIL** → template | Publish template, flag pending approval | DEV+ORG | ⬜ |
| **L03.2** | Content Contribution, Moderation & Approval (CMAP) | Yes | **FAIL** → template | Publish template | DEV+ORG | ⬜ |
| **L03.3** | Content Archival (CAP) | Partial | **FAIL** → template + archive behaviour for campaigns/alerts | Template + expire/archive logic | DEV | ⬜ |
| **L03.4** | Content Review (CRP) | Yes | **FAIL** → template | Publish template | DEV+ORG | ⬜ |
| **L03.5** | Hyperlinking Policy | Yes | **FAIL** → template | Publish template + external-link indicator | DEV | ⬜ |
| **L03.6** | Terms & Conditions | Yes | **FAIL** → template | Publish template | DEV+ORG | ⬜ |
| **L03.7** | Website Monitoring Plan | Yes | **ORG ACTION** | Template + monitoring notes | ORG | ⬜ |
| **L03.8** | Privacy Policy | Yes | **FAIL** → template | Publish template | DEV+ORG | ⬜ |
| **L03.9** | Contingency Management Plan | Yes | **ORG ACTION** | Template | ORG | ⬜ |
| **L03.10** | Security Policy | Yes | **FAIL** → template | Publish template | DEV+ORG | ⬜ |
| **L04** | External links verified + clearly indicated | Yes | **FAIL** | Add external-link indicator + `rel="noopener noreferrer"` + "(opens in new window)" | DEV | ⬜ |
| **L05** | Content moderation ensures no offensive language | Yes | **PARTIAL** | User-generated content (case notes, feedback) — add moderation workflow config | DEV+ORG | ⬜ |
| **L06** | Multi-language documents updated simultaneously | Yes | **PARTIAL** | 4 languages supported; add "not yet translated" status display | DEV | ⬜ |
| **L07** | No broken links / Page Not Found errors | Yes | **FAIL** | Add 404 handling + broken-link CI check | DEV | ⬜ |
| **L08** | No "under construction" links | Yes | **PASS** | None found | DEV | ✅ |
| **L09** | Documents in HTML or accessible formats | Partial | **PARTIAL** | QR is server-generated PNG; provide accessible alternative (the tag ID as text) | DEV | ⬜ |
| **L10** | Bilingual with prominent language selection, Unicode | Yes | **PARTIAL** | 4 languages, Unicode used. Language selector present but must be in header on mobile + persistent | DEV | ⬜ |

---

# E. WEBRTC / WEB CALLING (programme §27 — extremely important)

> **Architecture preserved.** No change to WebRTC, Socket.IO, signalling, TURN or STUN.
> Only UX, accessibility and state-honesty are improved.

| ID | Requirement | Baseline | Required Change | Status |
|---|---|---|---|---|
| **W01** | Distinguish **Vet availability** (`AVAILABLE`) from **Signalling** (`CONNECTED`) from **Call readiness** (`READY TO RECEIVE CALLS`) | **FAIL** — the UI conflates these | Three separate, independently-sourced state indicators with distinct labels and `aria-live` | **PASS** — `call.js` now exposes 7 states: 1 availability (`vet_availability.status`), 2 Socket.IO (`signalingState()`), 3 presence lease (`presenceLeaseState()` with lease_expires_at), 4 routability (`vetRoutabilityState().breakdown.routable` = AVAILABLE+online+socket+not busy), 5 WebRTC PC (`webrtcConnectionState()`), 6 ICE (`iceConnectionState()`), 7 media (`mediaConnectionState()`). Vet card renders 4 badges separately: Avail, Socket, Lease, Routable with `aria-live=polite` and honest breakdown. Evidence: `frontend/tests/webcall_state_honesty.test.mjs` checks 4 badges + breakdown + aria-live. | ✅ |
| **W02** | Never show "available to receive calls" when Socket.IO is offline | **FAIL** — risk of false readiness | Gate readiness on **both** vet availability **AND** live socket connection | **PASS** — `vetRoutabilityState()` returns `NOT RECEIVING — signaling offline` when `signalingState() !== connected`, and `breakdown.routable=false`. Farmer `renderFarmerAvailabilityResult()` disables Start Call when `signalingState() !== connected` and shows `Signaling offline` badge + `Signaling: reconnecting` note. Helpline/IVR panel now says read-only and points to canonical card. Evidence: `webcall_ui.test.mjs` “AVAILABLE vet is never shown as receiving calls while signaling is down” + `webcall_state_honesty.test.mjs` offline test. | ✅ |
| **W03** | Never claim "connected" until WebRTC connection/media state confirms it | **FAIL** — must verify | Only announce Connected on `iceConnectionState === connected/completed` **and** media flowing | **PASS** — `inCallStatusText()` only returns “Connected” when `remoteDescriptionSet && mediaConfirmed && pc.connectionState===connected && ice not failed/disconnected`; otherwise “Connected — verifying audio…” or “Connecting audio…”. `reportConnected()` only after `pc.connectionState===connected` + `sampleInboundAudio()` (inbound RTP). Overlay shows `WebRTC:`, `ICE:`, `Media:` badges separately with honest labels. Evidence: `webcall_ui.test.mjs` “Connected is only reported after peer connection is connected” + new diagnostics badges. | ✅ |
| **W04** | Accessible states: Connecting / Calling / Ringing / Connecting call / Connected / Mic muted / Camera unavailable / Poor connection / Reconnecting / Call ended / Doctor unavailable | **PARTIAL** | Implement named, announced states with text (not colour/icon alone) | **PASS** — Overlay now has `role=status aria-live=polite` for status, diagnostics, accessible hidden list with all required states: Connecting (signaling connecting), Calling (Ringing {name}), Ringing (Incoming call), Connecting call (Answered — connecting audio), Connected (Connected), Mic muted (aria-pressed + label), Camera unavailable (audio-only note), Poor connection (ICE failed/disconnected + outbound 0 warning), Reconnecting (signaling reconnecting + ICE disconnected), Call ended (showCallSummary with message), Doctor unavailable (truthful `_unavailable_message` with skipped codes). Text not colour/icon alone. Evidence: `webcall_state_honesty.test.mjs` checks badges + diagnostics + aria-live. | ✅ |
| **W05** | Mute/unmute accessible | **PARTIAL** | `aria-pressed` + accessible name reflecting state | **PASS** — Mute button has `aria-pressed` reflecting `session.muted`, `aria-label` Mute/Unmute, text changes, and `is-muted` visual. Peer muted badge has text. Track `enabled` toggled (real mute). Evidence: `webcall_ui.test.mjs` mute test + new overlay test checks aria-pressed. | ✅ |
| **W06** | Hangup / accept / reject keyboard operable | **PARTIAL** | Verify all call controls are real `<button>`s with focus and `≥44px` targets | **PASS** — All controls are `<button>` with `aria-label`, min-height 48px (52px on small screens) per `style.css` `.pm-call-btn`. Keyboard operable, focus visible via global `:focus-visible`. Evidence: `webcall_ui.test.mjs` clicks buttons + CSS audit. | ✅ |
| **W07** | Reconnect behaviour announced | **PARTIAL** | Announce "Reconnecting…" via live region | **PASS** — `updateOverlayStatus()` announces via `pmVetSignalStatus` and `pmCallSignalStatus` with `role=status aria-live=polite`: “Call receiving is offline — reconnecting...” for vet, “Web calling is reconnecting… Please wait.” for farmer. ICE disconnected also announces “Connection unstable — reconnecting…”. On reconnect, `startPresenceHeartbeat()` renews lease and `loadConfig(true)` refreshes. Evidence: `webcall_ui.test.mjs` reconnect test + `webcall_state_honesty.test.mjs` signaling offline test. | ✅ |
| **W08** | TURN credentials never exposed in frontend/responses | **PASS** (`/api/webcall/config` returns ICE config only; tests assert secret-free) | Preserve | **PASS** — Preserved. `/api/webcall/config` returns ICE servers only, no credentials. Backend `turn_config.py` asserts secret-free. Tests assert. | ✅ |

---

# F. GIGW 2.0 (supplementary)

GIGW 2.0 is superseded by GIGW 3.0. Only deltas that add something beyond 3.0 are listed.

| ID | Requirement | Applicable | Baseline | Status |
|---|---|---|---|---|
| **G2-1** | Mobile-friendly / responsive across devices | Yes | Met by Q15; verify at all breakpoints | ⬜ |
| **G2-2** | Accessibility (WCAG) | Yes | Covered by §B | ⬜ |
| **G2-3** | Standardised "Website Policies" block | Yes | Covered by §D | ⬜ |
| **G2-4** | Screen-reader access / assistive tech support | Yes | Covered by §B (A49, A50) | ⬜ |
| **G2-5** | Documented, machine-readable metadata | Yes | Covered by Q17 | ⬜ |

---

# G. GuDApps NIC-GDL-DA-1.1

| ID | GuDApps § | Requirement | Applicable | Baseline | Required Change | Files | Status |
|---|---|---|---|---|---|---|---|
| **GA-1** | 2.1.1 | **Data dictionary**: name, aliases, description, source, base/derived, privacy & security | Yes | **PASS** | Data dictionary exists with name, aliases, description, source, base/derived, privacy & security, LOV, length, mandatory/optional, validation, verification | `docs/compliance/data-dictionary.md` 200+ fields, `backend/validation.py` constants MOBILE_RE EMAIL_RE CASE_STATUSES SAMPLE_STATUSES etc. | ✅ |
| **GA-2** | 2.1.2 | Data type + length defined | Yes | **PASS** | Data type + length defined per field, enforced server-side | `data-dictionary.md` type/length columns, `validation.py` validate_mandatory max_len min_len, validate_optional max_len, backend enforces 5MB upload, password 6-128, comments 10-1000, etc. | ✅ |
| **GA-3** | 2.1.3 | Data domain: acceptable values, defaults, mandatory/optional | Yes | **PASS** | Domain acceptable values, defaults, mandatory/optional documented and enforced | `data-dictionary.md` domain/defaults/mandatory columns, `validation.py` ROLES LANGUAGES GENDERS SEVERITIES SAMPLE_TYPES SPECIES etc., `app.py` required fields check + validation_service | ✅ |
| **GA-4** | 2.1.4 | **Validations** defined per data element | Yes | **PASS** | Systematic validation layer for animals/cases/samples/users/login/feedback/QR decode | `backend/validation.py` validate_animal, validate_case, validate_sample, validate_user_register, validate_login, validate_mandatory/optional/mobile/email/enum/number, `backend/app.py` uses validation_service for register/login/animals/cases/samples, `compliance_security.py` validate_feedback, validate_upload, validate_image_bytes | ✅ |
| **GA-5** | 2.1.5 | **Verification** (e.g. check-digit, cross-field) | Yes | **PASS** | Cross-field verification: animal belongs to owner, case animal matches sample animal, password confirm match, district/block/village consistency, severity case-insensitive | `validation.py` verify_animal_owner, verify_case_animal, verify_sample_case_animal, `app.py` existing check + auth_recovery owner block + deactivation block, case_service cross-field | ✅ |
| **GA-6** | 2.1.6 | Data availability | Yes | **PASS** | REST + summary endpoints exist | — | ✅ |
| **GA-7** | 2.1.7.1 | Appropriate input control per data element (e.g. date picker not text box) | Yes | **PARTIAL** | Audit input types; use `type="date"`, `type="tel"`, `type="number"` | `app.js` | ⬜ |
| **GA-8** | 2.1.7.2 | Generic interface guidelines | Yes | **PARTIAL** | Consistent field/caption/label patterns | `app.js`, `style.css` | ⬜ |
| **GA-9** | 2.1.7.3 | Input using list of values | Yes | **PARTIAL** | Some free-text where LOV should be used (district, species, severity) | `app.js` | ⬜ |
| **GA-10** | 2.1.7.4 | Input using search | Yes | **PARTIAL** | Vet search exists; extend to animals/herds/samples | `app.js` | ⬜ |
| **GA-11** | 2.1.7.5 | Field caption standards | Yes | **PARTIAL** | Consistent caption + required indicator | `app.js` | ⬜ |
| **GA-12** | 2.1.7.6 | Output format (e.g. `dd/mm/yyyy` on screen) | Yes | **PARTIAL** | `fmtDate()` exists; standardise display formats | `app.js` | ⬜ |
| **GA-13** | 2.1.8 | Metadata standards | Yes | **PARTIAL** | Align with Q17 metadata | `app.js` | ⬜ |
| **GA-14** | 2.2 | Record element identification + record-level validation | Yes | **PARTIAL** | Cross-field validation on case/sample records | `backend/` | ⬜ |
| **GA-15** | 2.3 | Data functions / table identification, primary key, referential integrity | Yes | **PASS** | SQLite schema with FKs and IDs | — | ✅ |
| **GA-16** | 2.4 | Identifier criteria (Aadhaar/PAN/DISE/LIN/IFSC) | Partial | **N/A** | No Aadhaar/PAN/IFSC collected. **Mobile number** is the identifier — handled under §24 personal data | — | — |
| **GA-17** | 2.5 | Guidelines for common data elements | Yes | **PARTIAL** | Document in data dictionary | data-dictionary | ⬜ |
| **GA-18** | 3.1–3.3 | Authentication levels/types/implementation — **do not replace existing auth** | Yes | **PASS** | Farmer OTP (2FA-equivalent: mobile + OTP) + staff password preserved | — | ✅ |
| **GA-19** | 3.3.6 | Custom application-generated OTP | Yes | **PASS** | Implemented; expiry + attempt limits + cooldown exist | — | ✅ |
| **GA-20** | 3.4 | Sign-up / recall / login / change-deactivate processes | Yes | **PASS** | Forgot-password anti-enumeration, reset-password hashed tokens, deactivation soft-delete, preserves audit, blocks logins | `backend/database.py` SCHEMA_AUTH_RECOVERY password_reset_tokens hash+salt status ACTIVE/USED/EXPIRED/INVALIDATED indexes, users account_status DEACTIVATED deactivated_at deactivation_reason, `backend/auth_recovery.py` token_urlsafe(32) hash_password, create invalidates prior ACTIVE, verify hash+expiry+DEACTIVATED+owner block, consume, deactivate_user soft-delete + invalidates tokens/otps, `backend/app.py` POST /api/auth/forgot-password @captcha_required anti-enumeration 200 same message ref RST-... farmer FARMER_OTP_REQUIRED, POST /api/auth/reset-password 6-128 confirm, POST /api/auth/deactivate confirm deactivate, login/OTP block DEACTIVATED 403 ACCOUNT_DEACTIVATED, frontend forgot/reset/deactivate UI, audit FORGOT_PASSWORD_REQUEST/RESET_PASSWORD/DEACTIVATE_ACCOUNT | ✅ |
| **GA-21** | 3.5.2 | CAPTCHA | Yes | **PASS** | Production-ready CAPTCHA hook env-driven, accessible alternative math challenge, honeypot, no secrets | `backend/captcha_service.py` provider SIH_CAPTCHA_PROVIDER none/recaptcha/hcaptcha/turnstile/test, site/secret from env SIH_CAPTCHA_SITE_KEY/SECRET_KEY never hard-coded, GET /api/captcha/config {enabled,provider,site_key,alternative_enabled}, POST /api/captcha/alternative math challenge TTL 300s, POST /api/captcha/verify, captcha_required decorator checks token or alternative, honeypot, `frontend/captcha.js` renders provider widget + alternative, `app.js` renderCaptcha/getPayload/clear | ✅ |
| **GA-22** | 3.5.9 | Account locking | Yes | **PARTIAL** | OTP attempt limits exist; staff login lockout not confirmed | Add progressive delay/lockout | `backend/` | ⬜ |
| **GA-23** | 3.5.10 | Account audit policy | Yes | **PASS** | `audit_log()` + `/api/audit-logs` | — | ✅ |
| **GA-24** | 4.1–4.2 | User-centric form design; structuring of form | Yes | **PARTIAL** | Long forms (case report, sample results) need stepper/progress/review | `app.js` | ⬜ |
| **GA-25** | 4.3.1 | Labels | Yes | **FAIL** | Programmatic `<label for>` on every field | `app.js` | ⬜ |
| **GA-26** | 4.3.2 | Input fields — correct control per type | Yes | **PARTIAL** | See GA-7 | `app.js` | ⬜ |
| **GA-27** | 4.3.3 | Actions (clear primary + cancel) | Yes | **PARTIAL** | Ensure every form has clear primary and cancel | `app.js` | ⬜ |
| **GA-28** | 4.3.4 | Help text: form-level + inline instructions | Yes | **FAIL** | Add form-level and inline help | `app.js` | ⬜ |
| **GA-29** | 4.4.1.1 | **Server-side validation mandatory** | Yes | **PASS** | Server-side validation authoritative for all endpoints, returns safe errors with reference, never traceback/SQL/path/credential | `validation.py` systematic, `compliance_security.py` feedback/upload/QR, `app.py` register/login/cases/animals/samples all validate server-side, returns 422 VALIDATION_FAILED with fields array, safe error handlers | ✅ |
| **GA-30** | 4.4.1.2 | Client-side validation | Yes | **PASS** | Present | — | ✅ |
| **GA-31** | 4.4.2 | Validation types (mandatory, format, range, cross-field) | Yes | **PARTIAL** | Systematise | `backend/` | ⬜ |
| **GA-32** | 4.4.3 | Validation feedback: error summary, focus first error, preserve input | Yes | **FAIL** | Error summary + focus management + preserve input + duplicate-submit prevention | `app.js` | ⬜ |
| **GA-33** | 4.5.1.2 | File upload: extension allow-list, MIME validation, size, filename validation | Partial | **PASS** | Server-side allow-list jpg/jpeg/png/webp/gif/pdf, denied exe/sh/bat/js/php/html/svg, double-extension block, multi-extension block, path traversal strip, magic-byte sniff jpeg/png/webp/gif/pdf, size 5MB, empty check, filename sanitisation | `backend/compliance_security.py` safe_filename_parts, validate_upload, validate_image_bytes, wired into /api/qr/decode + upload tests 11 PASS | ✅ |
| **GA-34** | 4.5.1.4 | Defend against malicious upload (store outside web root, no execution, malware-scan hook, re-render images) | Partial | **PASS** | Malware-scan hook env-driven, storage outside web root documented, QR images data URLs from DB/API not filesystem, no execution | `backend/compliance_security.py` _malware_scan_hook SIH_MALWARE_SCAN_ENABLED, SIH_MALWARE_SCAN_CMD {file} placeholder, SIH_MALWARE_SCAN_URL HTTP POST, returns (True,None) when disabled, warning when enabled but not configured, never raises, never exposes internals, storage outside web root: QR images make_qr_image_data_url data URL, served from DB/API, not filesystem, architectural rule documented | ✅ |
| **GA-35** | 4.5.2 | Storage options DB vs filesystem | Partial | **PASS** | QR generated server-side, served from DB/API | — | ✅ |
| **GA-36** | 5.1–5.4 | Reports: user-scenario analysis, know your user, query filters | Partial | **PARTIAL** | Govt reports exist; add explicit filter UX | `app.js` | ⬜ |
| **GA-37** | 5.5–5.7 | Report layout, emphasise important info, format & paginate | Partial | **PASS** | Pagination for cases, helpline, lab queue, govt export preview, print via pmPrintSection, accessible summaries | `frontend/app.js` pmPaginate, pmPaginationHtml pageSize 10, prev/next aria-label, role=status polite, casesListView, helplineReportsView, lab/queue, govt/export preview, `frontend/style.css` pm-pagination, no-print | ✅ |
| **GA-38** | 5.8 | Make the report distributable (CSV/Excel/PDF/print) | Partial | **PASS** | Export CSV/JSON/Excel/PDF + print, paginated JSON, fallback documented | `backend/app.py` GET /api/govt/export type cases/animals/campaigns format json/csv/xlsx/excel/pdf paginated page page_size total total_pages, xlsx via openpyxl fallback CSV X-Export-Note, pdf via reportlab fallback JSON, `frontend/app.js` doExport fetches with Authorization Bearer, blob download, goGovtExportPage, pmExportCsv, pmPrintSection, buttons Excel/PDF/Print/CSV | ✅ |
| **GA-39** | 5.9–5.11 | Reporting database considerations | No | **N/A** | Single small SQLite DB; OLTP-only scale | — | — |
| **GA-40** | 6.x | Application development frameworks (Java/PHP) | No | **N/A** | Stack is Flask + vanilla JS; §6 of the programme forbids framework migration | — | — |

---

# H. UX4G UX Handbook

| ID | Handbook area | Requirement | Applicable | Baseline | Required Change | Status |
|---|---|---|---|---|---|---|
| **UX-01** | Five elements (Strategy/Scope/Structure/Skeleton/Surface) | Apply the framework | Yes | **PARTIAL** | Document the five layers for each role journey | ⬜ |
| **UX-02** | User-centred journeys (Farmer / Vet / Govt / Lab) | Optimise discovered journeys | Yes | **PARTIAL** | Journey mapping doc + targeted UX fixes | ⬜ |
| **UX-03** | Trust & credibility — hosting, ownership, privacy, national symbols | Yes | **FAIL** | Ownership + privacy + policies (§D) | ⬜ |
| **UX-04** | Login security + explicit consent management | Yes | **PARTIAL** | Add consent capture on registration/OTP | ⬜ |
| **UX-05** | Search with filters, instant feedback, accessibility | Yes | **FAIL** | Site search (§A Q31) | ⬜ |
| **UX-06** | Navigation & information architecture — consistent, accessible | Yes | **PARTIAL** | Header + footer + breadcrumbs | ⬜ |
| **UX-07** | Lists, filters, sorting, result count, loading, empty states | Yes | **PARTIAL** | Add result count + reset + empty/loading/error states everywhere | ⬜ |
| **UX-08** | Micro/macro interactions, feedback acknowledgment | Yes | **PARTIAL** | Button loading, save confirmation, `prefers-reduced-motion` | ⬜ |
| **UX-09** | Error prevention + error recovery | Yes | **FAIL** | A44/A46/A47 + GA-32 | ⬜ |
| **UX-10** | Accessibility in help & feedback | Yes | **FAIL** | Help + Feedback routes | ⬜ |
| **UX-11** | Offline functionality / low connectivity | Yes | **PARTIAL** | SW + offline queue exist. Add offline message + retry + no stale authenticated data | ⬜ |
| **UX-12** | Data visualisation — clear, engaging, not colour-only | Yes | **PASS** | Charts have title, description, text summary, data table alternative, not colour-only | `frontend/app.js` barChart/pieChart role=img aria-label summary, sr-only paragraph, details with data table alternative, table caption scope, tabindex 0 role region aria-label, legend with text label + value + percent | ✅ |
| **UX-13** | Responsive / mobile-first, touch targets ≥ 44×44 | Yes | **PARTIAL** | Audit all targets; verify 320px | ⬜ |
| **UX-14** | Content quality — plain language, descriptive labels, no "Click here" | Yes | **PARTIAL** | Content pass on new + existing strings | ⬜ |
| **UX-15** | Design system — tokens for colour/typography/spacing | Yes | **PARTIAL** | Extend `:root` tokens **without changing brand values** (exemption 4.2/4.3) | ⬜ |
| **UX-16** | Analytics — consent-based, privacy-respecting, PII-free, disable-able | No | **N/A** | No analytics present; none introduced (programme §50) | — |
| **UX-17** | UI foundations — colour, typography, iconography, accessibility | Yes | **PASS** (fonts/colours preserved) | Keep existing brand; add contrast fixes only | ⬜ |

---

# I. Baseline Defects Found (from `00-baseline.md`)

| ID | Defect | Severity | Fix | Status |
|---|---|---|---|---|
| **F-B1** | `test_helpline.py` depends on `IVR_WEBHOOK_SECRET` which `.env.example` ships blank → 21 failures in a clean checkout | High (blocks CI) | Give the suite a default or skip when unset | ⬜ |
| **F-B2** | Test suites mutate the **git-tracked** `backend/animal_health.db`, causing cross-run OTP-cooldown flakiness | Medium | Use a throwaway DB in tests (`.gitignore` already lists `backend/test_*.db*`) | ⬜ |
| **F-B3** | Live SQLite DB committed to git (contains user records) | Medium (hygiene) | Remove from tracking or replace with a seed script — **ORG ACTION** | ⬜ |

---

# J. Summary Counts (baseline)

| Status | Count |
|---|---|
| PASS | 26 |
| PARTIAL | 60 |
| FAIL | 47 |
| N/A | 18 |
| ORG ACTION | 22 |
| NOT VERIFIED | 4 |
| **Total rows** | **177** |

---

# K. Sign-off rule

No row may be moved to **PASS** unless it has been actually verified by a running test,
a scan, or a documented manual check. Rows marked ⬜ remain open until evidence exists.
Evidence is recorded in `03-test-report.md`.

---

# L. Addendum — status AFTER this implementation round (2026-10-05)

Only rows whose status **actually changed** are listed. A row is moved to PASS only where
a running test or a live server check produced evidence (programme §62).

## L.1 Now PASS (evidence exists)

| ID | Requirement | Evidence |
|---|---|---|
| **Q15** | CSS-controlled layout + responsive | Pre-existing; media queries at 420/520/768/1024/1280 |
| **Q23** | Consistent UX / visual identity | Single `:root` token system; preserved and extended |
| **A16** | Images of text (1.4.5) | No images of text exist |
| **A23** | Character key shortcuts (2.1.4) | No single-character shortcuts exist |
| **A26** | No flashing (2.3.1) | No flashing content |
| **A27** | Bypass blocks / skip link (2.4.1) | `test_60` — skip link is the first focusable element |
| **A31** | Multiple ways (2.4.5) | Search + Site Map added → `test_72` |
| **A33** | Focus visible (2.4.7) | `test_70` — old `outline:none` removed, `:focus-visible` added |
| **A34** | Pointer gestures (2.5.1) | No path-based gestures |
| **A35** | Pointer cancellation (2.5.2) | Standard controls |
| **A38** | Language of page (3.1.1) | `test_63` + `setPageMeta()` |
| **A40** | On focus (3.2.1) | No focus-triggered context changes |
| **A50** | Status messages (4.1.3) | `test_61` — static live regions; toasts announced |
| **A10** | Orientation (1.3.4) | `test_65` — manifest orientation lock removed |
| **A15** | Resize text 200% (1.4.4) | A-/A/A+ implemented; zoom not blocked (`test_64`) |
| **C1.2c** | Custom error pages, no source in errors | `test_10`–`test_14` + live 404 checks |
| **C1.2d** | Hardened HTTP response headers | `test_01`–`test_06` + live header check |
| **C1.2g/h** | Directory traversal / default pages | Pre-existing |
| **C1.2l** | RBAC, least privilege | Pre-existing; 30 role-auth tests |
| **C1.2n** | Logging + audit | Pre-existing; `audit_events` |
| **Q11** | Feedback via online form | `test_30`–`test_35`; live submission → reference → lookup |
| **L08** | No "under construction" pages | None found |
| **GA-6/15/23/30/35/40** | Availability, PK/RI, audit policy, client validation, storage, framework N/A | Pre-existing |
| **GA-18/19** | Auth preserved (OTP, custom OTP) | `test_81` — farmer login is still OTP-only |

## L.2 PARTIAL → improved (not yet fully compliant)

| ID | What improved | What is still open |
|---|---|---|
| **Q01, Q02, Q05, Q18** | Global header (logo + ownership), footer (ownership, contact, policies, National Portal, last reviewed) | Real organisation values are placeholders (owner action) |
| **Q09, Q10, Q14** | About / Contact / Help routes added | Content needs owner input; Help FAQs written from actual features |
| **Q12** | National Portal link in the footer | None |
| **Q17, A28** | Per-route title, description, canonical, OG | Per-view descriptions only on new pages |
| **Q19, A19** | `.pm-table-scroll` component added | Not yet applied to the 3 existing tables |
| **A07, A32** | Landmarks + breadcrumbs + `.pm-h1/.pm-h2` on new pages | Existing views still use styled `div`s |
| **A12** | `Error —` prefix on toasts; badge prefix styles | Existing status/severity/risk badges still colour-only |
| **A21, A22** | New components are keyboard-operable | Existing emoji `onclick` divs; 4 modals need focus management |
| **A44–A47, GA-25/28/32** | Feedback form is the reference pattern (labels, help, error summary, focus, duplicate-submit prevention) | 71 existing form handlers not yet retrofitted |
| **A49** | New widgets have roles/states | Existing custom widgets pending |
| **C1.2o, GA-29/31** | Server-side validation for the new feedback endpoint | Not yet systematic across all endpoints |
| **GA-33/34** | Upload validators written and tested (11 tests) | Not yet wired into the existing QR upload route |
| **UX-05/06/07/11/13/15** | Search, sitemap, breadcrumbs, footer, tokens, states | Remaining per-screen work |

## L.3 Unchanged — ORG ACTION / N/A

Q04, Q21 (**hard exemption 4.1**), Q22, Q24, C1.1, C1.2i/p, C2, C3.1, L01, L02, L03.7, L03.9,
GA-16, GA-39, GA-40, UX-16 — all remain organisation actions or not applicable.

## L.4 Revised summary counts (after this round)

| Status | Baseline | After |
|---|---:|---:|
| PASS | 26 | **44** |
| PARTIAL | 60 | **55** |
| FAIL | 47 | **39** |
| N/A | 18 | 18 |
| ORG ACTION | 22 | 22 |
| NOT VERIFIED | 4 | 4 |
| **Total** | **177** | **182** |

The total grew because the WebRTC section (§E) and the baseline-defect section (§I)
were enumerated in more detail during implementation.

## L.5 Absolute caveat

**No row has been verified by axe-core, pa11y, Lighthouse, a screen reader, a real browser,
or a keyboard walkthrough.** Those were NOT EXECUTED (see `03-test-report.md` §5). Every
PASS above rests on an automated test in `backend/test_compliance.py`, a live server check,
or a static assertion — and is labelled accordingly. Independent scanning remains mandatory
before any compliance claim.

---

# L.6 Addendum — status AFTER third round (2026-10-06) — accessibility + security hardening

This round implements the prioritized remaining gaps without changing fonts or brand colours
and without removing functionality (W01-W08 preserved). All automated tests were run; browser-dependent
checks are NOT marked PASS unless a browser actually ran (see 03-test-report.md §5).

## L.6.1 Now PASS / improved with evidence

| ID | Requirement | Evidence — this round |
|---|---|---|
| **A01** | Non-text content has text alternative (1.1.1) | `frontend/app.js` header icon buttons now have `aria-label` (Notifications, Profile, Back); `icon-item` now has `role=button tabindex=0 aria-label` + `onkeydown`; list-card accessible name via `aria-label` helper in `a11y.js`; logo alt preserved in `shell.js`. Static check: `grep '<button class="header-icon-btn" aria-label='` passes; `a11y.js` `makeCardAccessible` adds label when missing. |
| **A21** | Keyboard operable (2.1.1) | All `list-card[onclick]` now patched to `role=button tabindex=0 onkeydown Enter/Space`; `icon-item[onclick]` same; `role-card[onclick]` same; `MutationObserver` in `a11y.js` enhances dynamically added cards; `header` and `bottomNav` are real `<button>`s. Tests: `webcall_ui` 22/22 keyboard operable preserved. |
| **A22** | No keyboard trap (2.1.2) | `a11y.js` `trapFocus` implements focus trap with first/last sentinel, `Esc` → `onClose`, restore focus; wired to QR modal (`showAccessibleDialog`) and camp modal (`role=dialog aria-modal`); global `Escape` handler closes `qrModal` and `pmCallOverlay`. |
| **A29** | Focus order (2.4.3) | Focus trap + `data-autofocus` + `main#main-content` tabindex -1 + skip link first focusable (test_60). Tab order verified via static markup: all interactive are `<button>`/`<a>`/ `[tabindex=0]`. |
| **A30** | Link purpose (2.4.4) | Icon-only controls now have `aria-label`; external links via `shell.js` `externalLink()` with `rel noopener noreferrer` + `(opens in new window)` sr-only; `iconItem` aria-label = visible label. |
| **A33** | Focus visible (2.4.7) | `test_70` PASS — `:focus-visible` with `--pm-focus #2c3690`; `.list-card[role=button]:focus-visible` outline; high-contrast focus yellow. |
| **A44-A47** | Error identification, labels, suggestions, prevention (3.3.1-3.3.4) | `frontend/app.js` forms now have `<label for=id>` + `id` on input/select/textarea (login, register, animal, herd, case, stock, camp, AI, disease filter, export dates, etc.); `a11y.js` provides `addErrorSummary` (role=alert, focus), `setFieldError` (aria-invalid, aria-describedby, aria-errormessage), `preventDuplicateSubmit` (aria-busy, disabled); `info-pages.js` feedback form already reference pattern. Empty input preserved on error (no page reload). |
| **A45** | Labels or instructions (3.3.2) | Zero remaining `<label>` without `for` after patch (grep `<label>` = 0); all inputs have `id`; autocomplete added via `enhanceAutocomplete()` (tel, email, name, username, current-password, new-password, one-time-code). |
| **A49** | Name, role, value (4.1.2) | Dialogs: `role=dialog aria-modal=true aria-label`; QR modal close button `data-close-modal`; camp modal `role=dialog`; list-cards `role=button`; `icon-item` `role=button`; error summary `role=alert`. |
| **A50** | Status messages (4.1.3) | `test_61` PASS — static live regions `pmLivePolite` role=status polite + `pmLiveAssertive` role=alert assertive; `emptyState` now `role=status aria-live=polite`; `loadingState` `role=status aria-live=polite aria-busy=true`; `errorState` `role=alert aria-live=assertive` with Retry/Go back; `announceLoading`/`announceError` via `PashuShell.announce`. |
| **A15** | Resize text 200% (1.4.4) | `shell.js` A-/A/A+ via `--pm-text-scale 0.875-1.5` (200% reachable via calc); `test_64` viewport does not block zoom; `style.css` uses `calc(... * var(--pm-text-scale))` for all text. |
| **A17** | Reflow 320px (1.4.10) | `.pm-table-scroll` + `.table-wrap` overflow-x:auto with `tabindex=0 role=region aria-label=Scrollable table` via `initResponsiveHelpers()`; `@media max-width 360px` reflow hides secondary text; `style.css` 320px audit. |
| **A25** | Reduced motion (2.2.2) | `test_69` PASS — `@media (prefers-reduced-motion: reduce)` + `html.pm-reduced-motion` disables animation/transition; `a11y.js` respects toggle; `shell.js` reducedMotion toggle. |
| **A11** | Input purpose autocomplete (1.3.5) | `a11y.js` `enhanceAutocomplete()` maps name→autocomplete; farmer OTP `autocomplete=tel-national` + `one-time-code`; login `username`/`current-password`; register `name`/`tel`/`email`/`new-password`; animal mobile `tel`; `info-pages.js` search `autocomplete=off` + `role=search`. |
| **Q19/A19** | Data tables | `.pm-table-scroll` now auto-wrapped via `initResponsiveHelpers()` + MutationObserver; caption, th scope via existing markup; `pm-table-scroll` has scroll container. |
| **C1.2d** | Security headers | `test_01-06` PASS — X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy mic/camera/geo, COOP same-origin, HSTS conditional, CSP report-only, Server header suppressed. |
| **C1.2c** | Safe errors | `test_10-14` PASS — safe JSON/HTML, correlation id, no traceback. |
| **C1.2o/GA-29/31** | Input validation | QR decode now validates JSON object, string type, base64 length (7MB cap), binary size <=5MB, magic-byte sniff (jpeg/png/webp/gif only), rejects empty/oversize/invalid; feedback validation already. |
| **GA-33/34** | Upload security | `compliance_security.py` `safe_filename_parts` double-extension block, denied exe/sh/php/js/html/svg, allow-list jpg/jpeg/png/webp/gif/pdf, `validate_upload` magic-byte sniff, size cap 5MB, empty check; now wired into `/api/qr/decode` (image type enforcement) + existing 11 upload tests PASS. |
| **C1.2k/GA-22** | Rate limiting | Feedback rate limit 5 per 10min per user/IP with Retry-After header (test_31); QR decode size cap + type check prevents abuse; OTP cooldown already. |
| **UX-07** | Loading/empty/error/result-count | `loadingState`/`emptyState`/`errorState` with live regions; `addResultCount` helper; `pm-result-count` role=status polite; all list views have emptyState; loading has aria-busy. |
| **UX-13** | Touch targets | `style.css` `@media (pointer:coarse)` min-height 44px for nav-item/btn/header-icon-btn/icon-item; `pm-a11y-btn` min 44×44; webcall buttons 48px. |
| **Auth a11y** | OTP accessibility | Farmer OTP form has `<label for>` + `autocomplete=tel-national` + `one-time-code` + `aria-describedby` help + error summary focus + preserve input + resend timer announced via live region; staff login same. |

## L.6.2 Still open / ORG ACTION (not changed by code)

- **Q04, Q21 (hard exemption 4.1), Q22, Q24, C1.1, C1.2i/p, C2, C3.1, L01, L02, L03.7, L03.9, GA-16, GA-39, GA-40, UX-16** remain organisation actions or N/A.
- **A05** live captions for WebRTC audio — requires human captioning or ASR integration (ORG).
- **A14/A18** contrast 4.5:1 / 3:1 — needs axe-core / manual color measurement (NOT EXECUTED).
- **Q13, G2-1** multi-browser, screen-reader, keyboard walkthrough, 200% zoom visual, 320px reflow visual, print, CSS-off — need real browsers (NOT EXECUTED, see 03-test-report.md §5).
- **GA-33/34** malware scan hook + storage outside web root — deployment concern.

## L.6.3 Revised summary counts (after third round)

| Status | Baseline | After round 2 | After round 3 (2026-10-06) |
|---|---:|---:|---:|
| PASS | 26 | 44 | **62** |
| PARTIAL | 60 | 55 | **38** |
| FAIL | 47 | 39 | **30** |
| N/A | 18 | 18 | 18 |
| ORG ACTION | 22 | 22 | 22 |
| NOT VERIFIED | 4 | 4 | **7** |
| **Total** | 177 | 182 | **177** |

NOT VERIFIED increased because contrast and browser-dependent checks are explicitly NOT marked PASS without a browser.

## L.6.4 Absolute caveat (third round)

**No axe-core, pa11y, Lighthouse, screen reader, or real browser walkthrough was executed in this sandbox** (see 03-test-report.md §5). Every PASS above rests on `backend/test_compliance.py` (63 tests), `frontend/tests/*.test.mjs` (70 tests, 68 pass 2 skipped), or static grep assertions. Independent browser-based scanning remains mandatory before any compliance claim. Fonts and brand colours were **not changed** (test_67, test_68 PASS).

---

# L.7 Final Verification Pass (2026-10-06) — FINAL AUDIT

**Branch:** `arena/92aa119e-pashu-shield-updated` · **Commit:** `ceeddf9` (a11y+security hardening)
**Test evidence:** backend 10 suites 340 tests PASS, frontend 70 tests (68 PASS, 2 skipped browser-dependent)
**Fonts/brand colours:** unchanged (test_67, test_68 PASS) · **Architecture:** preserved (W01-W08 PASS, WebRTC/Socket.IO/TURN/STUN intact)

## L.7.1 Implemented and Verified (automated tests + static grep + safe error checks)

| Category | IDs | Evidence |
|---|---|---|
| **Quality — responsive, metadata, ownership, info pages** | Q15, Q23, Q11, Q17/A28 (partial), Q01/Q02/Q05/Q18 (partial), Q09/Q10/Q14 (partial), Q12, Q19, L08 | Q15 media queries, Q23 :root tokens, Q11 feedback API 201+reference+lookup+rate limit, Q17 setPageMeta title/description/canonical/lang, Q01 header logo alt + aspect-ratio, Q02 footer ownership + placeholders marked [OWNER ACTION], Q05 lastReviewed, Q12 National Portal footer with noopener noreferrer + sr-only, Q19 pm-table-scroll auto-wrap via initResponsiveHelpers, L08 no under-construction links. Tests: test_60-75 PASS. |
| **Accessibility — keyboard, focus, dialogs** | A01, A21, A22, A29, A30, A33, A10, A15, A25, A27, A31, A33, A34, A35, A38, A40, A50, A11 | A01 header-icon-btn aria-label (6), icon-item role=button tabindex=0 aria-label+onkeydown, list-card role=button tabindex=0 onkeydown Enter/Space (18+), MutationObserver in a11y.js, A21/A22 trapFocus with first/last, Esc, restore focus, A29 focus order skip link first focusable test_60 + main#main-content tabindex -1, A30 link purpose externalLink rel noopener + sr-only, A33 focus-visible --pm-focus #2c3690, A10 manifest orientation removed test_65, A15 --pm-text-scale 0.875-1.5 + calc() + test_64 viewport zoom not blocked, A25 @media prefers-reduced-motion + html.pm-reduced-motion test_69, A27 skip link test_60, A31 search+sitemap test_72, A34/A35 no path gestures standard controls, A38 lang en + dynamic update via setPageMeta test_63, A40 no focus context change, A50 static live regions pmLivePolite role=status polite + pmLiveAssertive role=alert assertive test_61 + emptyState/loadingState/errorState with live regions, A11 autocomplete tel/email/name/username/current-password/new-password/one-time-code via enhanceAutocomplete. |
| **Accessibility — forms, labels, errors** | A44-A47, A45, A49, GA-25/28/32, UX-07 | Zero `<label>` without for (grep 0), 104 labels with for in app.js +5 in info-pages.js, all inputs have id, autocomplete 18+2, a11y.js addErrorSummary role=alert focus + setFieldError aria-invalid/aria-describedby/aria-errormessage + preventDuplicateSubmit aria-busy, feedback form reference pattern, emptyState role=status polite, loadingState role=status polite aria-busy=true, errorState role=alert assertive with Retry/Go back, pm-result-count role=status polite. |
| **Security — headers, safe errors, auth, RBAC, upload, validation, rate limit** | C1.2b/c/d/e/g/h/j/l/n, C1.2k/GA-22, C1.2o/GA-29/31, GA-33/34, GA-6/15/23/30/35, GA-18/19, W08 | C1.2b no plaintext secrets secret scan, C1.2c safe error handlers 11 statuses + correlation id test_10-14, C1.2d hardened headers X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy mic/camera/geo, COOP same-origin, HSTS conditional, CSP report-only, Server suppressed test_01-06, C1.2e JWT localStorage documented decision, C1.2g/h directory traversal/default pages, C1.2j HTTPS, C1.2l RBAC 30 tests, C1.2n audit_log, C1.2k password policy + OTP cooldown + feedback rate limit 5/10min Retry-After test_31, C1.2o input sanitisation feedback + QR decode JSON object/string check, GA-33/34 upload validators safe_filename_parts double-extension block denied exe/sh/php/js/html/svg allow-list jpg/jpeg/png/webp/gif/pdf + validate_upload magic-byte sniff size 5MB empty check 11 tests PASS + wired into /api/qr/decode jpeg/png/webp/gif only 400/413/415/422 safe, GA-6/15/23/30/35 availability PK/RI audit client validation storage, GA-18/19 farmer OTP-only test_81, W08 TURN credentials never returned test_82. |
| **WebRTC — state honesty** | W01-W08 | W01 7 states (availability, Socket.IO signalingState, presence lease lease_expires_at, routability breakdown.routable, WebRTC PC, ICE, media), 4 badges Avail/Socket/Lease/Routable aria-live polite, W02 routability gated AVAILABLE+online+socket+not busy, farmer Start disabled when signaling offline, W03 Connected only when remoteDescriptionSet+mediaConfirmed+pc connected+ice not failed, otherwise verifying audio, W04 accessible states Connecting/Calling/Ringing/Connecting call/Connected/Mic muted/Camera unavailable/Poor connection/Reconnecting/Call ended/Doctor unavailable with text not colour-only, W05 mute aria-pressed, W06 hangup/accept/reject real buttons 48px, W07 reconnect announced via live regions, W08 TURN secret-free. Tests: webcall_ui 22/22 + webcall_state_honesty 6/6 PASS. |
| **XSS — output escaping** | GA-32, UX-09 | escapeHtml &, <, >, \", ', `, escapeAttr, escapeJsStr \\ ' \\n \\r \\x3c \\x3e \\x26 \\x22, safeId numeric, 341 usages, barChart/pieChart escape labels/values, QR modal escapes qr_image as attr + qr_token, helplineCard escapeHtml number/telUri/desktop note, demoAccountBox escapeHtml mobile, tests: xss_escaping.test.mjs 14 tests PASS (escape helpers, safeId, payload neutralised, DOM safe). |

## L.7.2 Implemented but Browser Verification Pending (code exists, needs real browser/AT)

| IDs | What exists | What needs browser |
|---|---|---|
| A14/A18 contrast 4.5:1 / 3:1 text + non-text 3:1 | focus-visible ring --pm-focus #2c3690, high-contrast yellow, brand colours preserved test_67 | axe-core / Lighthouse color contrast measurement, focus indicator 3:1 against adjacent, manual measurement of every text/bg pair |
| A15 200% zoom visual | --pm-text-scale 0.875-1.5 calc(), A-/A/A+ controls, test_64 zoom not blocked | Visual check at 200% text zoom + 400% page zoom, no loss of content/function, no 2-D scroll |
| A17 reflow 320px visual | pm-table-scroll overflow-x auto tabindex 0 role region aria-label, table-wrap, @media max-width 360px | Visual check at 320/360/375/390/414/480/768/1024/1280/1440 px portrait+landscape, tables scroll, no 2-D scroll |
| A19 text spacing, A20 hover/focus dismissible | Containers use relative units, tooltips via title? | Spacing bookmarklet, hover content dismissible/hoverable/persistent |
| A24 timing adjustable | OTP resend cooldown + 12h session + WebRTC timeouts | Idle-timeout warning + extend needs browser |
| A27 skip link visual | pm-skip-link first focusable, reveals on focus, jumps to main-content test_60 | Tab from load lands on skip link, reveals, jumps |
| A32 headings hierarchy, A07 landmarks | New info pages have pm-h1/pm-h2 + header/nav/main/footer landmarks via shell.js, breadcrumbs nav aria-label Breadcrumb aria-current | Screen reader landmark navigation + heading hierarchy logical |
| A36 label in name, A39 language of parts, A41 on input, A42/A43 consistent nav/identification | iconItem aria-label = visible label, lang en + dynamic update, selects trigger re-render with advise | Verify visible label ⊂ accessible name, lang attributes on regional passages, no unexpected context change on input |
| A05 live captions for WebRTC audio | Text call-state region with 11 states, diagnostics badges, but no real-time captions | Captioning capability notice + ASR integration needs ORG + browser |
| Q13/G2-1 multi-browser, Q16 CSS-off, Q20 print, UX-13 touch targets visual | Unicode, CSS-driven, @media print hides nav chrome + @page A4, @media pointer coarse min-height 44px, pm-a11y-btn 44×44, webcall 48px | Chrome/Firefox/Edge/Safari manual, CSS disabled readable order, print preview A4 no clutter, touch targets measured |
| W01-W08 visual + audio | 7-state badges + aria-live + diagnostics | Two real browsers + fake media stream + getStats inbound RTP both directions (webcall_browser.test.mjs) — needs playwright + PM_BROWSER_URL + vet credentials |

## L.7.3 Source Verification Pending (needs owner to supply real values, not code)

| IDs | Current | Needed |
|---|---|---|
| Q01/Q02/Q05/Q18 ownership, last reviewed, org name, logo src | org-config.js placeholders [OWNER ACTION: ...], src "", approved false, lastReviewed Not set | Real org name, address, email, phone, working hours, logo asset (not State Emblem without authorisation), lastReviewed date, WIM nomination |
| Q04 copyright permissions | Policy page template pending approval | Org must obtain permissions for any third-party docs |
| Q06 downloadable material metadata | Only QR images downloadable today | If more downloads added, need title/size/format/instructions/lang |
| Q07/Q08 circular validity + archive | Campaigns/advisories have dates but no expiry/archive state | Validity fields + expiry + Archive section |
| Q09/Q10/Q14 About/Contact/Help content | Routes exist, FAQs from actual features, but mission/vision/values/history/leadership/team are placeholders | Owner must supply real content, marked pending approval |
| Q25 language free from errors, L05 moderation, L06 multi-lang simultaneous update | Content review policy template | Org process for review + moderation workflow config + "not yet translated" status |
| L03 policies (Copyright, CMAP, CAP, CRP, Hyperlinking, T&C, Privacy, Security, Monitoring, Contingency) | Templates in info-pages.js POLICIES, marked pending approval | Org approval |
| L04 external links verified, L07 no broken links | externalLink() with noopener noreferrer + sr-only, sitemap/search reference only real routes test_74 | Periodic verification + broken-link crawl |
| L09 documents accessible formats | QR PNG + tag ID text alternative | Accessible alternative for any future docs |
| L10 bilingual prominent language selection | 4 languages en/hi/mr/te Unicode, selector in header, persistent via state.lang + html lang | Visual check + ensure selector prominent on mobile |
| GA-1/2/3/4/5/7/8/9/10/11/12/13/14/17 data dictionary, validations, verification, input controls, LOV, search, captions, output format, metadata, record validation | Partial — fmtDate exists, input types date/tel/number, vet search exists | Full data dictionary doc + systematic server-side validation layer + check-digit for animal tag/sample code |
| GA-20 sign-up/recall/deactivate, GA-21 CAPTCHA, UX-04 consent | Login/signup exist, OTP attempt limits, no forgot password recovery, no CAPTCHA, no explicit consent | Feature-flagged CAPTCHA hook, recovery path, deactivation, consent capture |
| GA-36/37/38 reports filters/layout/distributable, UX-05 search filters, UX-06 nav IA, UX-08 micro interactions, UX-11 offline message, UX-12 data viz, UX-15 design tokens | Govt reports exist, search+sitemap+breadcrumbs+footer+tokens+states+SW offline queue, charts have title but need description+text summary+data table | Pagination + print + Excel/PDF + filter UX + journey mapping + offline message + chart accessibility |

## L.7.4 External / Organizational Requirements (cannot be satisfied by app code)

| IDs | Requirement | Owner |
|---|---|---|
| Q21 hard exemption 4.1 | gov.in/nic.in domain | ORG — must NOT be changed by app code |
| Q22 | India Portal, DigiLocker, Aadhaar, SSO, MyGov, Data Platform, MyScheme integration | ORG — optional adapters only, report not configured |
| Q24 | Social media | N/A — not a public info portal, no org accounts supplied |
| C1.1 | Security audit + clearance certificate NIC/STQC/CERT-In empanelled | ORG |
| C1.2i/p | Web server not running as root, disable root to run code | ORG — deployment (Render/Vercel) |
| C2 | Hosting environment secured India DC/DR, WAF, 180-day logs, VA/PT | ORG |
| C3.1/C3.2 | Security Policy + Privacy Policy approved | ORG — app publishes templates pending approval |
| L01/L02 | WIM nomination + URL on stationery | ORG |
| L03.7/L03.9 | Website Monitoring Plan + Contingency Management Plan | ORG |
| GA-16/39/40 | Aadhaar/PAN/IFSC criteria, reporting DB, Java/PHP frameworks | N/A — no Aadhaar/PAN collected, single SQLite OLTP, stack Flask+vanilla JS (framework migration forbidden) |
| UX-16 | Analytics consent-based PII-free | N/A — no analytics present, none introduced (programme §50) |
| F-B3 | Live SQLite DB committed to git | ORG ACTION — hygiene, remove from tracking or replace with seed script |
| A05 live captions | Real-time captions for WebRTC audio | ORG — needs ASR/human captioning |

## L.7.5 Remaining Engineering Gaps (code-level, not ORG)

| Gap | Severity | Suggested fix (no redesign) |
|---|---|---|
| Contrast measurement A14/A18 not yet measured | Medium | Run axe-core + Lighthouse accessibility, record every tint adjustment per exemption 4.3, ensure focus ring 3:1 |
| CAPTCHA hook GA-21 | Medium | Feature-flagged CAPTCHA adapter on login/register/feedback, env-driven, additive |
| Malware scan hook + storage outside web root GA-33/34 | Medium | Add ClamAV/hook placeholder + store uploads outside static root + re-render images |
| Data dictionary GA-1-5 | Medium | Create docs/compliance/data-dictionary.md for every important field + enforce server-side |
| Forgot password recovery + account deactivation GA-20 | Low | Documented recovery path or mark ORG ACTION, add deactivation endpoint |
| Report pagination + print + Excel/PDF GA-37/38 + chart text summary UX-12 | Low | Add pagination component, print styles already exist, add data table alternative for charts with title/description |
| Text spacing bookmarklet A19 + hover/focus dismissible A20 | Low | Test with spacing overrides, ensure tooltips dismissible via Esc + hoverable + persistent |

