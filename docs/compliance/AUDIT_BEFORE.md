# Pashu-Shield — AUDIT_BEFORE (Phase 0: DBIM 3.0 / GIGW 3.0 redesign)

**Date:** 2026-10-07 · **Branch:** `arena/0e6a5de5-pashu-mitra` · **Baseline commit:** `e3cf925`
**Auditor:** Arena agent (principal UX / a11y / security role) · **Method:** static code reading + computed contrast checks + test/doc review. No browser, Lighthouse, axe, or live-site crawl was available in this sandbox — anything needing a browser is marked **NOT VERIFIED**, never passed.
**Live site (not crawled):** https://pashu-mitra-smoky.vercel.app/

> **Honesty note 1 — source documents.** The brief states DBIM/GIGW source documents "are provided as .md files". They are **not present** in this repo (`docs/compliance/` contains only the prior GIGW-compliance programme files; root `*.md` are product docs). The DBIM F.1 checklist below is therefore **reconstructed from the brief's own enumerated requirements** (43 items, each traceable to a brief section) and must be re-verified against the real DBIM 3.0 Annexure F when available. Recorded as **D-02** in `DECISIONS.md`.
> **Honesty note 2 — prior work respected.** A GIGW-compliance programme (Oct 2026, branch `arena/01a10b85`, merged) already added `org-config.js`, `shell.js`, `info-pages.js`, `compliance_security.py`, feedback API and 12 policy templates. This audit scores the **merged current state**, reuses its gap matrix (`01-gap-matrix.md`) for GIGW detail, and the redesign must preserve all of it (zero-regression rule).
> **Honesty note 3 — never claim certification.** Per brief: "Designed to conform to DBIM 3.0 and GIGW 3.0; CQW/STQC certification pending audit."

---

## 0. Stack detection (brief §Phase 0.1) — KEEP, do not migrate

| Layer | Technology (detected) | Evidence |
|---|---|---|
| Frontend | **Vanilla HTML + CSS + JS SPA**, hash router (`#/…`), no framework/build step | `frontend/index.html`, `app.js` (5,363 lines), `call.js`, `info-pages.js`, `shell.js`, `style.css` (859 lines) |
| Frontend hosting | Vercel static; `/api/*` rewritten to Render backend; security headers at CDN layer, no HSTS/CSP there | `frontend/vercel.json` |
| Backend | **Flask 3.1.3 monolith** (`app.py` ~4,974 lines, 100+ API routes) + `compliance_security.py` (headers, safe errors, upload validation, feedback API) | `backend/app.py`, `backend/compliance_security.py` |
| Database | **SQLite** (`backend/animal_health.db`, tracked in git — known risk F-B3) + migrations in `database.py` | `backend/database.py` |
| Auth | Farmer: **mobile + OTP only** (hashed, 5-min expiry, 5 attempts, 60 s cooldown, masked logging); staff: password + JWT in localStorage; optional Clerk phone auth | `backend/otp_service.py`, `clerk_auth.py`, `demo_auth.py` |
| Real-time / calling | Flask-SocketIO signalling + **WebRTC** audio (STUN; TURN env-dependent) + Web Push (VAPID) | `backend/webcalling.py`, `realtime.py`, `frontend/call.js`, `sw.js` |
| ML | Separate service `ml-backend/` (RF/IsolationForest) + in-repo `animal_ai.py` | `ml-backend/main.py` |
| IVR/telephony | Asterisk templates + HTTP webhook IVR engine + pluggable SMS gateway | `backend/ivr_service.py`, `sms_gateway.py`, `voice/asterisk/` |
| PWA | Service worker (v8 cache) + `manifest.json` (orientation lock already removed) | `frontend/sw.js`, `manifest.json` |
| Maps | Leaflet via **render-blocking CDN** in `<head>` | `index.html:11-13` |
| On-device AI | Whisper-tiny WASM (44 MB models + 37 MB wasm — local only, not shipped to browser cache list except JSON) | `frontend/models/`, `frontend/wasm/` |
| i18n | Runtime dictionary `t()` / `ft()`; langs **en, hi, mr, te**; farmer UI fully keyed; staff UI mostly English | `app.js` `I18N` (~830 lines) |
| Tests | Backend 331 tests green (`run_tests.sh`); frontend 50 tests (48 pass/2 skip); compliance suite 54 green | `docs/compliance/03-test-report.md` |

**Must-not-break list:** all 40+ hash routes (§4), farmer OTP flow, Clerk flow, Socket.IO/WebRTC calling, ML endpoints, IVR/SMS, offline queue + SW caching, per-route metadata, feedback API, security headers.

---

## 1. DBIM Checklist F.1 — reconstructed 43 items (brief-traceable)

Scoring: **Pass / Partial / Fail / N-A / NOT VERIFIED**. Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low.

### Identity & logo (DBIM 5; brief Phase 2)

| # | Item (brief ref) | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-01 | Original single-colour geometric logo+wordmark; **no national symbols, gradients, photo, 3D** (2.1) | **Partial** | 🟠 | No emblem/flag/tricolour anywhere — hard-constraint part PASSES (`org-config.js:32-35`). But the "logo" is a 🐄 **emoji** + system-font text (`shell.js` brand block, `manifest.json` icon). Fix: 3 mark concepts → user pick → SVG masters. |
| F1-02 | Lockup 3B: logo + org name, single language, optional tagline; language switch keeps size/spacing; bold sans outlined identifiers (5.2.4) | **Fail** | 🟠 | Text-only brand (`Pashu-Shield` + English tagline); no outlined identifier; Hindi name `पशु-शील्ड` exists in config but is never rendered as a lockup. Fix: Logo component with `lang`. |
| F1-03 | ONLY black-on-white (header) and white-on-dark (footer) lockups in chrome; key colour elsewhere (5.3, chk-22) | **Fail** | 🟡 | Header brand is indigo `#2c3690` text on white; footer has **no lockup at all** (text "About this service"). Fix: Phase 2/3. |
| F1-04 | Accurate logos, correct proportions, SVG/PNG/WEBP/JPG, each < 100 KB (5.5) | **Fail** | 🟡 | No logo files exist at all (emoji + data-URI emoji manifest icon). Fix: brand kit. |
| F1-05 | Integrity: no stretch/rotate/outline/shadow/bevel/glow; defined clear space; min sizes (≥57 px horizontal, ≥30 px mark); auto mark-only below min | **Fail** | 🟡 | Nothing to enforce yet — no logo, no component. Fix: Logo component + test. |
| F1-06 | Co-branding ≤ 2, authorised-only, identity left/top, own clear space (5.4) | **N-A** | — | No co-brand logos supplied or rendered. Re-audit if supplied. |
| F1-07 | `<Logo variant tone lang>` locking ratio/clear-space/min-size, no style/filter/transform props; links Home "Pashu Shield – Home"; favicon SVG+ICO, apple-touch, maskable PWA, 1200×630 social | **Fail** | 🟠 | No component; brand links home with aria-label "…go to the home page" (close, rename to exact string); favicon entirely missing (no `<link rel=icon>`); manifest icon is an emoji data-URI, not maskable. Fix: Phase 2.7. |
| F1-08 | Naming `pashushield_<standard\|alternate\|mark>_<lang>_<tone>.svg`; `BRAND_GUIDELINES.md`; noindex `/brand` page; logo-rule test | **Fail** | 🟡 | None exist. Fix: Phase 2.8 + 10. |

### Colour (DBIM 2; brief 1.1)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-09 | Exactly ONE primary group; default **Green** `#0F5757/#2D8686/#A6D9D9/#D9F2F2`; single-token swap | **Fail** | 🔴 | Current brand is **indigo** `#3d4db8/#2c3690/#6c7ae0` (`style.css:1-21`), preserved under prior exemption 4.3 — which this redesign explicitly supersedes (needs user confirm, **D-03**). No theme token. Fix: Phase 1 tokens. Hexes unverified vs DBIM Toolkit (no access) — recorded. |
| F1-10 | Gradients only within the group; primary colours digital-only | **Fail** | 🟡 | `linear-gradient(135deg, primary, primary-dark)` header is within-group ✓, but group itself is wrong (see F1-09); demo box uses yellow gradient outside any group. Fix: retoken. |
| F1-11 | All other colours from functional palette; **never Deep Blue `#1D0A69`** | **Fail** | 🟠 | Palette uses ad-hoc indigo/blue/grey tints (`#eef0f6`, `#dfe2f0`, `#7a7f95`…), none from the functional list. Deep Blue `#1D0A69` itself is absent ✓. Fix: retoken. |
| F1-12 | Text ≥ 4.5:1, UI boundaries ≥ 3:1, **CI-enforced**; traps fixed (`#606060` borders/secondary text; Mustard bg-only; Inclusive White only on key/dark) | **Fail** | 🔴 | **Computed (this audit):** muted `#7a7f95` on white = **3.96** ✗; green `#1fa971` on white = **3.01** ✗; orange `#e08a1e` = **2.68** ✗; red `#e2483f` = **4.01** ✗; input border `#dfe2f0` on white ≈ **1.3** ✗. No contrast script/CI. Good news: candidate Green key `#0F5757` + white = **8.33** ✓; `#606060` on white = **6.29** ✓. Fix: Phase 1 + CI script. |
| F1-13 | Links underlined, never colour-alone; status never colour-alone | **Partial** | 🟡 | Footer/crumb/info links underlined ✓; but in-app `.auth-switch a`, `.link` and badge usage are inconsistent; badge colour-only partly fixed via `pm-badge-prefix` (F-C series). Charts still colour-led. Fix: link + chart audit. |

### Typography (DBIM 4; brief 1.2)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-14 | **Noto Sans all scripts** (Latin + 9 listed), self-hosted + subsetted; Regular/Medium/Semi-Bold/Bold only | **Fail** | 🔴 | System stack (`-apple-system…Roboto…`, `style.css:24`) under prior exemption 4.2 — superseded by this redesign (**D-03**). No Devanagari/Telugu guarantee on low-end Android without bundled font. Fix: self-host Noto (en+hi first), subset per language. |
| F1-15 | Desktop/mobile px scales; Small only non-essential; essential ≥ P1; 200% zoom + in-page A−/A/A+ | **Partial** | 🟠 | A−/A/A+ (87.5–150%) + browser zoom exists (`shell.js`) ✓; but scale is ad-hoc (20/17/15/14.5/13/12.5/11.5/11/10.5 px), **essential text at 11–12.5 px** (form labels 12.5, footer 11.5–12.5, badges 11, nav 10.5) violates "essential ≥ P1 (16/14)". No 200%-zoom browser proof (NOT VERIFIED visually). Fix: type-scale tokens, raise essential sizes. |
| F1-16 | Left-aligned body; tables L/R/C aligned; no all-caps sentences; LH 1.2–1.5 (1.5 body); real text, never images of text | **Partial** | 🟡 | Body left ✓; demo title uses `text-transform:uppercase` on a short label (acceptable-ish, change to sentence case); line-heights mostly 1.2–1.6 ✓; tables: `.pm-table-scroll` left-aligns **numbers too** ✗ (need right-aligned numbers, centred headers); no images-of-text ✓. Fix: table CSS + caps. |
| F1-17 | Buttons consistent size/padding; 1–3-word translatable labels; enabled/hover/focus/disabled distinct; visible hover; short nav labels | **Partial** | 🟡 | `.btn` family consistent-ish ✓; focus ring now 3px ✓; **no `:hover` styles on `.btn`** (only `:active`) ✗; disabled = `opacity:.6` only ✗ (needs distinct treatment); some labels long ("Call a Veterinarian" = 3 words ✓ borderline; "Mark as deceased" ✓). Nav labels short ✓. Fix: hover/disabled states. |

### Iconography (DBIM 3; brief 1.3)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-18 | ONE style (line default); DBIM Toolkit Visual Library sourced; custom-style-matched list for missing | **Fail** | 🟠 | Icons are **emoji** (🐄🔔👤📊⚡…) — neither line nor filled, platform-inconsistent, no toolkit sourcing. Fix: line-style SVG set; toolkit check when accessible. |
| F1-19 | SVG/PNG/WEBP only; frames 24/32/48/64 + 2 px padding; proportions kept, never stretched | **Fail** | 🟡 | No icon assets; emoji sized by font-size (19–52 px arbitrary). Fix: icon component with fixed frames. |
| F1-20 | Key-darkest or Inclusive White only; overlay + white icon on images | **Fail** | 🟡 | Emoji are multicoloured by nature. No banner imagery yet (nothing to overlay). Fix: recolour set. |
| F1-21 | Tooltips; icon+text for significant actions; sparing, universal use | **Partial** | 🟡 | Most emoji pair with text labels ✓; but header icon-buttons (🔔👤←) are **icon-only with aria-labels** and no visible tooltip/text ✗; scanner/QR rely on emoji alone in places. Fix: tooltips + label pairing. |

### Components (brief 1.4)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-22 | Full set present + keyboard-operable: header, nav, breadcrumbs, cards, tables, forms, alerts, stepper, modals, toasts, tabs, accordions, pagination, empty/error/loading, cookie banner | **Partial** | 🟠 | Present: header(s), bottom-nav, breadcrumbs (info pages only), cards, tables, forms, alerts, toasts(live-announced ✓), empty/loading/error states ✓. **Missing:** stepper, modals (any? `confirm()` native — check), tabs, accordions, pagination, **cookie banner**. Keyboard: no-trap NOT VERIFIED (no browser). Fix: build missing on tokens. |
| F1-23 | Visible **2 px+ focus ring**; **touch ≥ 44×44**; `prefers-reduced-motion`; no flashing | **Partial** | 🟠 | Focus 3px ✓ (F-C2 fixed). Touch: header buttons 36–40 px ✗, `.btn-sm` 40 px farmer ✗, footer links 24 px ✗, lang-toggle ~24 px ✗ (coarse-pointer rule covers only some). Reduced-motion CSS + toggle ✓. No flashing ✓. Fix: 44 px pass. |
| F1-24 | Page bg Inclusive White; cards/quote on Linen; functional-palette outlines | **Fail** | 🟡 | Page bg `#eef0f6` (bluish grey) ✗; cards white (inverse of spec) ✗; outlines `#dfe2f0/#e5e8f6` ✗. Fix: retoken (white bg, `#EBEAEA` cards). |

### Header / navigation / footer (DBIM 5.4/5.6/A; brief Phase 3)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-25 | **Header 3** sticky-white: engagement bar + global search; Skip first; "अ | A" selector; A−/A/A+ + contrast + SR access; global nav | **Partial** | 🟠 | Skip link first ✓; A−/A/A+ + contrast + reduce-motion bar ✓ (separate slim bar, not integrated Header 3); **no global search in header** (only `#/search` page) ✗; lang selector is a globe+dropdown in-app-header, not "अ | A" ✗; **two stacked headers** (site-header + app-header, neither sticky except farmer variant) ✗; no engagement bar. Fix: unify into sticky Header 3. |
| F1-26 | Dynamic header: Lockup 3B; ≤2 co-brands; login/register profile icon (OTP/Clerk) | **Partial** | 🟡 | Profile/notification icons exist per-role ✓; lockup is text+emoji (F1-01) ✗; co-brands N-A ✓ (none). Fix: with F1-01. |
| F1-27 | Global nav: 3-click, ≤3 levels, task-first most-accessed; A.1 menu (Home/About/Services/Documents/Resources/Connect); persona entries; type+persona tagging | **Fail** | 🟠 | Nav is **role bottom-tabs** (Home/Animals/Cases…), no global IA, no Services/Documents/Resources/Connect, no 3-click structure, no tagging. Depth is shallow ✓ (≤3). Fix: IA rebuild reusing routes (additive). |
| F1-28 | Footer key-bg/white/white-lockup: Website Policy set; Sitemap ≥2 levels; Related links; Help; Feedback; **Last updated DD/MM/YYYY data-driven** | **Partial** | 🟠 | Footer exists with 12 policies (pending-approval marked ✓), Help/Feedback/Sitemap/About/Contact/Search links ✓, National Portal link ✓, last-reviewed (ISO `2026-10-05`, not DD/MM/YYYY ✗, single global date not per-page ✗). BG is navy `#23284a` not key ✗; no lockup ✗; no Related Links section ✗. Fix: footer rebuild on tokens. |
| F1-29 | Footer optional: Archives, social via config, ownership+technical contact, version | **Partial** | 🟢 | Ownership/contact placeholders ✓; no archives, no social (correctly N-A pending org), no version. Fix: add version + archives slot. |
| F1-30 | **Lineage** per `OFFICIAL_GOV_PORTAL` (default false → "independent initiative…"); no endorsement implication | **Fail** | 🟠 | No flag, no lineage sentence. Current copy says "Content on this platform is provided for animal-health service delivery" + ownership placeholders — not an endorsement claim ✓, but the **required disclaimer is absent**, and `india.gov.in` link + dept-style IA could imply officiality. Fix: config flag + footer line (Phase 3). |

### Homepage (DBIM A.4; brief Phase 3)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-31 | Section order: header → carousel → ticker → intro → services → What's new → documents → persona links → important links → social → footer | **Fail** | 🟡 | Landing `#/` is a **role picker**, not a content homepage; none of the sections exist. Fix: new public homepage (routes stay). |
| F1-32 | Banner 1800×338/500/600 ≤500 KB, HTML overlay text + pause; ticker with pause | **Fail** | 🟡 | No carousel/ticker. Fix: build with pause controls. |
| F1-33 | **CCPS slot** flagged OFF with 320×245/640×245/960×245 dims; no fake content; no PM photo/quote | **Pass** | — | No CCPS, no fake banners, no PM photo/quote ✓. Fix: add empty flagged slot + doc. |

### Content / documents / lifecycle (DBIM 6; brief Phase 4)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-34 | Tone concise/impartial/simple/bullets; abbreviations expanded; **British English**; DD/MM/YYYY; uniform titles; spelling CI (en+hi) | **Partial** | 🟡 | Tone mostly simple ✓; dates use `dd Mon yyyy` via `fmtDate` (not DD/MM/YYYY) ✗; spelling CI absent ✗; Hinglish absent ✓; abbreviation expansion inconsistent (OTP/SMS/QR unexplained on first use in places). Fix: copy pass + CI. |
| F1-35 | Accessible PDFs only + type/size in link; HTTPS externals marked + validated; lifecycle (review/archive/maker-checker/tagging) | **Partial** | 🟡 | External links marked + `noopener` ✓ (L04); no published PDFs yet (QR images only, no size/format block) ✗; link-check job absent ✗; archival/review policies exist as templates; maker-checker workflow absent ✗. Fix: lifecycle layer + CI link check. |

### Imagery (DBIM 6; brief Phase 4)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-36 | Budgets (banner ≤500 KB, thumb ≤100 KB, hires ≤5 MB+thumb); WEBP/PNG/JPG; srcset; alt ≤140 chars; licence register; headshots 1:1 | **Partial** | 🟡 | Few images (QR 180px, scanner video, Leaflet tiles) — no budget violations found, no watermarks ✓. Alt: logo alt ✓, QR images **no alt** ✗; no srcset; no register; Leaflet tiles are third-party (attribution needed — check). Fix: media audit + register. |

### Multilingual (DBIM 7.5; brief Phase 4)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-37 | EN+HI complete; selector; `lang`+hreflang; **`/xx/` URLs**; position-preserving switch; glossary; error-feedback link; multilingual search; transcripts; per-lang sitemaps | **Partial** | 🔴 | en/hi/mr/te runtime dictionary (farmer UI strong ✓, staff/policy pages English-only ✗); `<html lang>` synced ✓; visible selector ✓. **Failing:** hash-SPA has no `/hi/` URLs and no hreflang ✗; no sitemap.xml at all ✗; no glossary ✗; search is English page-title index only ✗; no transcripts (voice reports user-generated — partial excuse); Bhashini absent (correctly, flag later). URL-per-language in a hash SPA needs a decision (**D-04**: hash-param `?lang=` vs path routing). |

### Cookies & personalisation (DBIM 7.6, DPDP 2023; brief Phase 4)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-38 | Bottom banner Accept/Reject/Customise; language-matched consent; no pre-tick; essential vs opt-in; minimum data; plain purposes; withdrawable; India storage; deletion | **Fail** | 🔴 | **No banner, no consent layer at all.** `localStorage` holds JWT + prefs + offline queue without consent UX; a11y prefs are strictly-essential-like (fine) but JWT/push lack policy wiring; privacy policy is an unapproved template. No analytics cookies exist (good — nothing to withdraw yet). Fix: consent manager + banner + policy approval track. |

### Search (DBIM 9; brief Phase 5)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-39 | Header search every page; text+voice (+image optional); autocomplete/spell/synonyms; category/persona/date filters; HTML+PDF+image-meta; multilingual; empty-state help; related; feedback link; privacy-safe analytics | **Partial** | 🟠 | `#/search` page: live filter over 23-page static index, empty-state + sitemap link ✓, announced counts ✓. **Missing:** header placement, voice input (Whisper exists for reports — reusable), autocomplete/spelling/synonyms, filters, PDF/image coverage, multilingual queries, related/feedback/analytics. Fix: Phase 5. |

### Forms & data quality (DBIM B, GuDApps; brief Phase 6)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-40 | Instructions top; grouped; minimal fields; single-column; multi-step+stepper+save+review; `*`+“Required”; short sentence-case labels above+clickable; width≈input; radio ≤6 vertical w/ sensible default (never for consent); sorted dropdowns; `aria-disabled` primary + missing-list; progress; no dup-submit; blur validation; input preserved; error summary + `aria-live`; mobile/PIN/IFSC/Aadhaar-Verhoeff (masked, unlogged); master data; ack+ref+print | **Partial** | 🔴 | Strengths: labels above fields ✓; OTP flow has inline errors, cooldown, anti-dup busy-state ✓; feedback API validates server-side + ref number ✓; mobile 10-digit checks exist. **Gaps:** no "Required" word marking (only `required` attr + placeholders) ✗; no error-summary-with-links pattern ✗; no `aria-invalid`/`aria-describedby` except OTP ✗; no stepper/save-progress/review ✗; dropdowns unsorted audit missing; consent pre-select audit missing; Aadhaar not collected ✓ (good); master data partial (species list inline, states/districts JSON for Maharashtra only); ack pages inconsistent. Fix: form system + per-form retrofit (Phase 6). |

### Accessibility (WCAG 2.1 AA, GIGW 5.2, DBIM 8; brief Phase 7)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-41 | Landmarks; one h1; heading logic; full keyboard, no traps, visible focus, route/modal focus mgmt; alt/captions/transcripts; chart/map alternatives; 320px reflow + 400% zoom; CAPTCHA alternative (rate-limit preferred); axe/pa11y/Lighthouse CI + NVDA/TalkBack checklist | **Partial** | 🔴 | Strengths: skip link ✓, landmarks (banner/main/contentinfo) ✓, live regions ✓, focus ring ✓, reduced-motion ✓, per-route titles ✓, rate-limiting instead of CAPTCHA ✓. **Gaps:** info pages render **two `<h1>`** (app header + `pm-h1`) ✗; staff header buttons lack aria-labels ✗; charts (bar/pie SVG/div) have no text/table alternative ✗ (pie has % legend — partial); Leaflet map no alternative ✗; call-state announcements partial; 320px/400%/keyboard-trap/modal-focus/axe/pa11y/Lighthouse **NOT VERIFIED** (no browser) ✗; no CI jobs ✗. Fix: Phase 7 + CI. |

### Security (GIGW 5.3, GuDApps auth, CERT-In; brief Phase 8)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-42 | OTP hardened (expiry/attempts/cooldown/generic errors/masked phone/session-warning/logout); server RBAC; HTTPS+HSTS; CSP/`X-CTO`/frame-ancestors/`Referrer`/`Permissions`; Secure cookies; CSRF; sanitise; param queries; upload checks+malware hook; no secrets; no demo creds/debug in prod; `security.txt`; dep audit for Safe-to-Host; NSSO roadmap | **Partial** | 🔴 | Strengths: OTP expiry/attempts/cooldown/generic anti-enumeration/masked logs ✓; server RBAC + role tests ✓; app-layer headers (X-CTO, frame, Referrer, Permissions, COOP, HSTS-if-secure, CSP **report-only**) ✓; safe error handlers + correlation ids ✓; upload magic-byte validation helpers ✓; param queries (check); no prod secrets in repo ✓. **Gaps:** CSP not enforced ✗; HSTS off on HTTP + no preload ✗; JWT in localStorage (documented, kept) — Secure-cookie migration explicitly out of scope (**D-05**); CSRF N-A (no cookie auth) — note; **no session-timeout warning UI** ✗; **demo creds in repo** (`password123` seed, demo OTP box) ✗; **no `security.txt`/robots** ✗; upload helpers not yet wired to QR flow ✗; no malware-scan hook ✗; no dep audit run ✗; NSSO correctly roadmap-only ✓. Fix: Phase 8. |

### Performance & monitoring (DBIM 10, GIGW 5.1; brief Phase 9)

| # | Item | Verdict | Severity | Evidence / fix |
|---|---|---|---|---|
| F1-43 | Lighthouse mobile Perf ≥90/A11y 100/BP ≥95/SEO ≥95; LCP<2.5 s, CLS<0.1, INP<200 ms (mid-Android/4G); splitting; lazy media; critical-CSS/skeletons; defer; minimal 3P; sized media; modern formats; cache; CDN; 320px→desktop; consented analytics + monthly review; PWA EN+HI/feedback/share/offline shell | **Partial** | 🟠 | Strengths: PWA offline shell + queue ✓; immutable caching for vendor/models ✓; no-store for app shell ✓; CDN (Vercel edge) ✓; responsive CSS ✓. **Gaps:** single **357 KB `app.js`** + 84 KB `call.js`, no splitting ✗; **Leaflet CDN render-blocking in `<head>`** ✗; no lazy-load, no skeletons, no width/height discipline audit ✗; geojson 1.4 MB (lazy? check) ; **no analytics** (decision O-50 open — fine, needs consent design when added); **Lighthouse NOT EXECUTED** ✗. Fix: Phase 9 + CI. |

**F.1 tally:** Pass 1 · Partial 17 · Fail 24 · N-A 1 · (NOT VERIFIED folded into Partial/Fail rationales above; nothing browser-dependent is claimed green.)

### F.2 ministry checklist → marked N-A (this is not a ministry site; adapted where useful)
All F.2 items: **N-A** — Pashu-Shield is an independent service platform, not a Ministry/Department website. Adapted equivalents (About/Services/Documents/Resources/Connect IA, persona entries, content tagging) are tracked under F1-27/F1-31 instead. `OFFICIAL_GOV_PORTAL=false` (to be implemented, F1-30).

---

## 2. GIGW 3.0 matrix — delta on top of `01-gap-matrix.md`

The prior gap matrix (Q01–Q25, A01–A50, C, L) remains the detailed record; statuses below are **re-verified against current code** (changes since are nil — HEAD only merged that work). Full row detail: `docs/compliance/01-gap-matrix.md`.

| GIGW section | Pass | Partial | Fail | N-A / ORG | NOT VERIFIED | Worst items (fix phase) |
|---|---:|---:|---:|---:|---:|---|
| Quality Q01–Q25 | 2 (Q15, Q23 — but Q23 "visual identity" now **reopened** by DBIM retoken) | 10 | 8 (Q02, Q05, Q09–Q12, Q14, Q18 — all **fixed by prior work**, pending browser proof → treat as Partial until verified) | 5 | 0 | Re-verify info pages in browser (Ph 3/7); Q21/Q22/Q24 ORG. |
| Accessibility A01–A50 | 0 claimed | ~22 | ~12 | ~10 (N-A media) | ~6 (tool scans) | A33 focus ✓ fixed; A50 live ✓ fixed; two-h1 (A07/A28), charts (A07/A12), touch (A47), reflow (A17) open. |
| Cybersecurity C1–C3 | partial | partial | 0 code | 4 ORG (audit, certs, DC/DR, VA/PT) | 2 (ZAP, dep audit) | CSP enforce + security.txt + demo-cred removal (Ph 8). |
| Lifecycle L01–L10 | partial (L03 templates ×12, L07 search/sitemap) | partial | 0 code | 3 (WIM, gov.in, monitoring infra) | 1 (link crawl) | Approvals + WIM + crawl CI (Ph 10). |

**Net:** the prior programme closed the structural GIGW gaps (shell, pages, headers, errors, feedback); what remains is **browser/tool proof + DBIM visual identity + consent + form-system + enforcement hardening**. No prior Pass is invalidated except Q23 (identity tokens will change — deliberate, per brief).

---

## 3. Logo audit (brief §Phase 0.3c)

| Check | Result |
|---|---|
| State Emblem / Ashoka Chakra / flag / tricolour / official logos (incl. RTI/Digital India/MyGov/DigiLocker/NIC) | **PASS — none present** anywhere (header, footer, manifest, code, docs). Prior work explicitly refused the emblem (`org-config.js:32-35`). The 🐄 emoji is not an official mark. |
| Original ownable mark | **FAIL** — emoji + system text; not ownable, not single-colour, not geometric. |
| Lockup / variants / integrity / component / naming / favicons / social | **FAIL** — none exist (F1-02…F1-08). |
| Imitation/tracing risk | **PASS** — nothing imitates an official logo. |

---

## 4. Page & component scores (condensed; every route covered)

Legend: 🟢 strong · 🟡 needs DBIM/a11y retrofit, functional · 🔴 structural gap · routes grouped; all preserve-and-refactor (zero-regression).

| Area (routes) | Function | DBIM identity | A11y | Notes / fix |
|---|---|---|---|---|
| Public: `#/`, `#/login/:role`, `#/register/:role`, `#/login/:role/password` | 🟢 | 🔴 | 🟡 | Role picker to become homepage+persona entries (F1-27/31); OTP form is the best form on the site — use as pattern; staff login needs CAPTCHA-alternative note + labels audit. |
| Farmer `#/owner/*` (dashboard, livestock, herds, animals, cases, report, calls, webcall, helpline, surveillance, farm-alerts, campaigns, diseases, prescriptions, lab-reports, notifications, profile) | 🟢 | 🔴 | 🟡 | Strongest i18n (4 langs); emoji icon grid → line SVGs; bottom-nav labels 8.8–11 px → raise; voice report → reuse for search-voice. |
| Vet `#/vet/*` (dashboard, calls, reports, search, vaccination/new, advisories, + shared cases/animals/herds/surveillance/…) | 🟢 | 🔴 | 🟡 | WebRTC controls need keyboard/audible-state audit in browser; search page is vet-record search (distinct from site search — keep both, disambiguate labels). |
| Govt `#/govt/*` (dashboard, analytics, trends, blocks, gis, national, stock, ai, export, zoonotic, + shared) | 🟢 | 🔴 | 🔴 | Charts/maps lack text alternatives (F1-41); GIS Leaflet render-blocking (F1-43); export CSV already open-format ✓ (keep). |
| Lab `#/lab/*` (dashboard, queue, samples/:id) | 🟢 | 🔴 | 🟡 | Sample detail shared across roles — keep RBAC tests. |
| Shared `#/:role/*`, `#/scan`, `#/notifications/settings` | 🟢 | 🔴 | 🟡 | QR scanner: upload needs wiring to magic-byte validators (F1-42). |
| Info `#/about #/contact #/feedback #/help #/sitemap #/search #/policies[/ :id]` | 🟢 | 🔴 | 🟡 | Prior-work pages in good shape; fix double-h1; feedback is the validation exemplar. |
| Global components: skip link, a11y bar, site header, app header, bottom nav, footer, breadcrumbs, toasts, tables, print CSS | 🟢 | 🔴 | 🟡 | Unify dual headers → Header 3; footer → key colour + lockup + lineage; cookie banner + consent new. |
| Backend APIs (auth, OTP, cases, labs, webcall, IVR, SMS, push, feedback, export, health) | 🟢 | N-A | N-A | 331 tests green; do not change contracts. Add `security.txt`, CSP enforce (flag-gated), dep audit. |

**Cross-cutting fails (all pages):** indigo palette, system fonts, emoji icons, no cookie consent, no header search, no `/lang/` URLs, touch-target gaps, essential-text sizes, link/chart colour-alone spots, missing CI gates (contrast, axe, logo, image budgets, links, Lighthouse, audit).

---

## 5. Top 10 fixes by severity × reach (proposed phase order per brief)

1. **Design tokens** (colour Green + functional + type scale + spacing) + contrast CI script — unblocks everything (Ph 1). 🔴
2. **Noto Sans self-hosted + subsetted** (en+hi first) — low-end Android + Devanagari correctness (Ph 1). 🔴
3. **Cookie consent + DPDP wiring** — legal blocker (Ph 4, pulled forward with banner component in Ph 1). 🔴
4. **Logo concepts ×3 → pick → kit + component + tests** (Ph 2 — needs your pick). 🟠
5. **Header 3 + IA + footer + homepage** incl. lineage flag, search box, banner/ticker with pause (Ph 3). 🟠
6. **Form system** (Required marking, error summaries, stepper, validation lib, Verhoeff-ready) + retrofit priority forms (Ph 6). 🔴
7. **A11y closure**: double-h1, chart/map alternatives, touch targets, axe/pa11y/Lighthouse CI + manual checklist (Ph 7). 🔴
8. **Security closure**: CSP enforce (verified), `security.txt`, demo-cred purge from prod builds, session-timeout UI, dep audit (Ph 8). 🔴
9. **Multilingual URL decision + sitemap.xml + hreflang + glossary** (Ph 4). 🔴
10. **Performance**: defer Leaflet, split `app.js`/`call.js` by route, lazy media, budgets CI (Ph 9). 🟠

---

## 6. Decisions needed from you (before/while Phase 1 starts)

- **D-03:** Confirm superseding prior exemptions 4.2/4.3 (system fonts + indigo palette) with Noto Sans + DBIM Green. Recommended: yes.
- **D-04:** Language-URL strategy for the hash SPA: (a) keep hash + `?lang=` + canonical mapping (cheap, keeps Vercel static), or (b) real `/hi/` paths (needs rewrites/adapter). Recommended: (a) now, (b) roadmap.
- **Logo:** pick a concept direction in Phase 2 (3 concepts will be offered; no finalising before your pick).
- **Regional language priority** after EN+HI (current app also has MR+TE — confirm order).
- **Branch:** brief says `redesign/dbim-gigw` but this session is fixed to `arena/0e6a5de5-pashu-mitra` (**D-01**) — all work lands here.

*Designed to conform to DBIM 3.0 and GIGW 3.0; CQW/STQC certification pending audit. No certification is claimed.*
