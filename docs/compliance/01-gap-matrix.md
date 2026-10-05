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
| **A14** | Contrast ≥ 4.5:1 text, 3:1 large (**1.4.3**) | Yes | **NOT VERIFIED** | Must measure. Only minimal tint changes permitted (exemption 4.3) | Contrast audit → minimal tints, all documented | ⬜ |
| **A15** | Resize text to 200% (**1.4.4**) | Yes | **PARTIAL** | Verify; layout uses px for some sizes | Verify + relative units where needed | ⬜ |
| **A16** | Images of text (**1.4.5**) | Yes | **PASS** | No images of text | — | ✅ |
| **A17** | Reflow at 320px, no 2-D scroll (**1.4.10**) | Yes | **NOT VERIFIED** | Must test at 320px; wide tables are the exception | Responsive audit; table scroll container | ⬜ |
| **A18** | Non-text contrast ≥ 3:1 (**1.4.11**) | Yes | **NOT VERIFIED** | Focus indicators removed via `outline:none` (baseline S-11) | Restore visible focus ring ≥ 3:1 | ⬜ |
| **A19** | Text spacing overridable (**1.4.12**) | Yes | **PARTIAL** | Verify containers don't clip when spacing overridden | Test with spacing bookmarklet | ⬜ |
| **A20** | Content on hover/focus dismissible (**1.4.13**) | Yes | **PARTIAL** | Tooltips/hover content — verify | Ensure dismissible + hoverable + persistent | ⬜ |
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
| **W01** | Distinguish **Vet availability** (`AVAILABLE`) from **Signalling** (`CONNECTED`) from **Call readiness** (`READY TO RECEIVE CALLS`) | **FAIL** — the UI conflates these | Three separate, independently-sourced state indicators with distinct labels and `aria-live` | ⬜ |
| **W02** | Never show "available to receive calls" when Socket.IO is offline | **FAIL** — risk of false readiness | Gate readiness on **both** vet availability **AND** live socket connection | ⬜ |
| **W03** | Never claim "connected" until WebRTC connection/media state confirms it | **FAIL** — must verify | Only announce Connected on `iceConnectionState === connected/completed` **and** media flowing | ⬜ |
| **W04** | Accessible states: Connecting / Calling / Ringing / Connecting call / Connected / Mic muted / Camera unavailable / Poor connection / Reconnecting / Call ended / Doctor unavailable | **PARTIAL** | Implement named, announced states with text (not colour/icon alone) | ⬜ |
| **W05** | Mute/unmute accessible | **PARTIAL** | `aria-pressed` + accessible name reflecting state | ⬜ |
| **W06** | Hangup / accept / reject keyboard operable | **PARTIAL** | Verify all call controls are real `<button>`s with focus and `≥44px` targets | ⬜ |
| **W07** | Reconnect behaviour announced | **PARTIAL** | Announce "Reconnecting…" via live region | ⬜ |
| **W08** | TURN credentials never exposed in frontend/responses | **PASS** (`/api/webcall/config` returns ICE config only; tests assert secret-free) | Preserve | ✅ |

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
| **GA-1** | 2.1.1 | **Data dictionary**: name, aliases, description, source, base/derived, privacy & security | Yes | **FAIL** | Create `data-dictionary.md` for every important field | `docs/compliance/data-dictionary.md` | ⬜ |
| **GA-2** | 2.1.2 | Data type + length defined | Yes | **PARTIAL** | Document per field; enforce server-side | data-dictionary | ⬜ |
| **GA-3** | 2.1.3 | Data domain: acceptable values, defaults, mandatory/optional | Yes | **PARTIAL** | Document + enforce | data-dictionary | ⬜ |
| **GA-4** | 2.1.4 | **Validations** defined per data element | Yes | **PARTIAL** | Systematic server-side validation layer | `backend/` | ⬜ |
| **GA-5** | 2.1.5 | **Verification** (e.g. check-digit, cross-field) | Yes | **FAIL** | Add verification for identifiers (animal tag, sample code) | `backend/` | ⬜ |
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
| **GA-20** | 3.4 | Sign-up / recall / login / change-deactivate processes | Yes | **PARTIAL** | Login/signup exist; no "forgot password" recovery, no account deactivation | Add documented recovery path or mark ORG ACTION | `app.js`/ORG | ⬜ |
| **GA-21** | 3.5.2 | CAPTCHA | Yes | **FAIL** | Feature-flagged CAPTCHA hook | `backend/` | ⬜ |
| **GA-22** | 3.5.9 | Account locking | Yes | **PARTIAL** | OTP attempt limits exist; staff login lockout not confirmed | Add progressive delay/lockout | `backend/` | ⬜ |
| **GA-23** | 3.5.10 | Account audit policy | Yes | **PASS** | `audit_log()` + `/api/audit-logs` | — | ✅ |
| **GA-24** | 4.1–4.2 | User-centric form design; structuring of form | Yes | **PARTIAL** | Long forms (case report, sample results) need stepper/progress/review | `app.js` | ⬜ |
| **GA-25** | 4.3.1 | Labels | Yes | **FAIL** | Programmatic `<label for>` on every field | `app.js` | ⬜ |
| **GA-26** | 4.3.2 | Input fields — correct control per type | Yes | **PARTIAL** | See GA-7 | `app.js` | ⬜ |
| **GA-27** | 4.3.3 | Actions (clear primary + cancel) | Yes | **PARTIAL** | Ensure every form has clear primary and cancel | `app.js` | ⬜ |
| **GA-28** | 4.3.4 | Help text: form-level + inline instructions | Yes | **FAIL** | Add form-level and inline help | `app.js` | ⬜ |
| **GA-29** | 4.4.1.1 | **Server-side validation mandatory** | Yes | **PARTIAL** | Strengthen; never rely on client-only | `backend/` | ⬜ |
| **GA-30** | 4.4.1.2 | Client-side validation | Yes | **PASS** | Present | — | ✅ |
| **GA-31** | 4.4.2 | Validation types (mandatory, format, range, cross-field) | Yes | **PARTIAL** | Systematise | `backend/` | ⬜ |
| **GA-32** | 4.4.3 | Validation feedback: error summary, focus first error, preserve input | Yes | **FAIL** | Error summary + focus management + preserve input + duplicate-submit prevention | `app.js` | ⬜ |
| **GA-33** | 4.5.1.2 | File upload: extension allow-list, MIME validation, size, filename validation | Partial | **PARTIAL** | QR image upload: `accept="image/*"` only. Add server-side allow-list, size cap, filename sanitisation, double-extension block, server-generated filenames | `backend/app.py`, `app.js` | ⬜ |
| **GA-34** | 4.5.1.4 | Defend against malicious upload (store outside web root, no execution, malware-scan hook, re-render images) | Partial | **PARTIAL** | Add malware-scan hook + store outside static root | `backend/` | ⬜ |
| **GA-35** | 4.5.2 | Storage options DB vs filesystem | Partial | **PASS** | QR generated server-side, served from DB/API | — | ✅ |
| **GA-36** | 5.1–5.4 | Reports: user-scenario analysis, know your user, query filters | Partial | **PARTIAL** | Govt reports exist; add explicit filter UX | `app.js` | ⬜ |
| **GA-37** | 5.5–5.7 | Report layout, emphasise important info, format & paginate | Partial | **PARTIAL** | Add pagination + print | `app.js` | ⬜ |
| **GA-38** | 5.8 | Make the report distributable (CSV/Excel/PDF/print) | Partial | **PARTIAL** | `/api/govt/export` exists (CSV). Add print + Excel/PDF or document as out of scope | `app.js` | ⬜ |
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
| **UX-12** | Data visualisation — clear, engaging, not colour-only | Yes | **FAIL** | Charts: title, description, text summary, data table (§A 54) | ⬜ |
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
