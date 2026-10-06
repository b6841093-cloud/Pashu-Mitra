# Pashu-Mitra / Pashu-Shield — UI/UX Audit

**Date:** 2026-10-06 · **Branch:** arena/92aa119e-pashu-shield-updated · **Auditor:** Senior GDS UX/UI architect
**Scope:** frontend/index.html, app.js (5660 lines), style.css (966 lines), a11y.js, call.js, captcha.js, shell.js, info-pages.js, org-config.js, sw.js, tests/
**Guidelines:** GIGW 3.0, GIGW 2.0 Compliance Matrix, GuDApps NIC-GDL-DA-1.1, UX4G Handbook / UX Design System
**Constraint:** Do NOT replace branding, fonts, entire palette; only minimal tint for WCAG contrast; preserve all functionality (Farmer OTP-only, Vet/Govt/Lab auth, RBAC, WebRTC/Socket.IO/TURN/STUN, IVR, ML, reports, dashboards, multilingual, PWA, deployment).

> **PDF availability:** The four guideline PDFs attached to task did not arrive in workspace uploads. Official published versions used previously (GIGW 3.0 full, GuDApps Ch1-2, UX Handbook Ch1-2 + executive summary) plus gap-matrix 01-gap-matrix.md as source of truth. No requirements invented.

---

## 1. Visual consistency problems

- **Multiple card radius values:** `--radius-lg 28px`, `--radius-md 18px`, `--radius-sm 12px` exist but hard-coded `border-radius:16px`, `18px`, `20px`, `22px`, `24px` scattered in style.css (list-card 16px, qr-modal-content 24px, bottom-nav 22px). Inconsistent.
- **Shadow system:** Single `--shadow` token `0 6px 20px rgba(45,55,140,0.08)` but also `0 10px 30px rgba(0,0,0,0.25)` in qr-modal, `0 24px 60px rgba(12,16,40,0.35)` in pm-call-card, `0 -4px 18px rgba(0,0,0,0.06)` in bottom-nav. No elevation scale.
- **Colour tokens duplicated:** `:root` defines both `--primary` and `--color-primary` same value, `--muted` and `--color-muted` different values (#5f6480 vs #7a7f95) — confusion. Badge colours use both `--green` and `--green-bg`/`--green-text` but also hard-coded `#e53935`, `#43a047` in places.
- **Button height inconsistency:** `.btn` has no explicit height, only padding 13px 18px, but farmer portal overrides min-height 48px/52px/56px via body.farmer-portal. Primary action vs secondary not visually distinct enough (both full width).
- **Spacing scale not enforced:** `margin:16px`, `20px`, `24px`, `28px`, `padding:20px 16px`, `24px 20px`, etc. arbitrary, not using `--space-*` tokens. `--space-1..7` defined but rarely used.
- **Typography scale uses calc(var(--pm-text-scale,1)) everywhere** — good for a11y, but many hard-coded px still (20px, 28px, etc.) not tokenized.

## 2. Layout problems

- **Page structure inconsistent:** Some dashboards use `hello-banner` + `stat-grid` + `section-card` + `icon-grid`, others use only `section-card`. No consistent hierarchy: header → primary nav → page title → breadcrumb → primary content → secondary → footer. Breadcrumb/context missing on many inner pages (animal detail, case detail, lab sample).
- **Content width jumps:** `#app` max-width changes at 768/1024/1280 but padding also changes, causing visual shift. No consistent max-width container for header/footer.
- **Header has two variants:** `.app-header` and `.owner-app-header` with different sticky behavior, padding, border-radius. Owner header sticky top 0 with overflow, non-owner not sticky.
- **Bottom nav fixed 480px max-width** but `#app` can be 1280px, so nav not centered on large screens? Actually `left:50% transform:translateX(-50%)` + max-width 480/768/1024/1280 in media queries — inconsistent with `#app` max-width.
- **Detail grid 1fr 1fr** breaks on small screens, but farmer portal overrides to 1fr at 420px — good, but not consistent across all detail views (lab sample, vet case).
- **QR modal fixed overlay** with `z-index:1000` but call overlay `z-index:9999` — stacking context not documented.

## 3. Spacing problems

- **Section cards margin 16px** but inside padding 20px 16px — on mobile 16px margin + 16px padding = 32px horizontal waste, content feels cramped.
- **Icon grid gap 22px 8px** — vertical gap large, horizontal small, inconsistent with stat-grid gap 10px.
- **Form field margin-bottom 14px** but form-row gap 10px — inconsistent vertical rhythm.
- **No consistent spacing between sections:** Sometimes 16px margin, sometimes 20px, sometimes no margin.
- **Farmer home actions gap 11px** vs 8px at 380px vs 14px at 768px — arbitrary breakpoints.

## 4. Typography problems

- **Font family preserved** `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif` — good, per exemption 4.2.
- **No typographic scale tokens:** H1, H2, H3 not defined as tokens, only `.section-title 15px`, `.topbar h2 17px`, `.owner-page-title 18px`, `.hello-banner 14px/21px`. No consistent H1/H2/H3 hierarchy — many pages use `section-title` div instead of real heading.
- **Excessive uppercase:** `.demo-box-title` uppercase + letter-spacing .3px, `.data-table th` uppercase — may affect readability for dyslexic users, but okay.
- **Long italic paragraphs:** `.voice-transcript` italic + `font-style:italic` + border-left — okay but not ideal for long text.
- **Tiny text:** `.small-muted 11.5px`, `.stat-card .lbl 11px`, `.badge 11px` — below 12px, may fail readability at 200% zoom, but needed for density.
- **Inconsistent font weights:** 600, 700, 800 mixed — no token.
- **Indian language longer labels:** Telugu/Hindi strings can be longer, but some buttons have `white-space:nowrap` (owner-brand) causing clipping risk, though `overflow-wrap:anywhere` added.

## 5. Colour problems

- **Brand colours preserved** `--primary #3d4db8`, `--primary-dark #2c3690` — good.
- **Multiple palettes:** Original palette + semantic aliases `--color-primary` etc. same values, but `--color-muted #7a7f95` vs `--muted #5f6480` different — confusion.
- **Hard-coded colours:** `#e53935`, `#43a047`, `#ff5c5c`, `#ffb300`, `#6d4c00`, `#8a5a00`, etc. scattered, not tokenized.
- **Gradient overuse:** `linear-gradient(135deg,var(--primary),var(--primary-dark))` in header, `linear-gradient(180deg,#fff8e1,#fffdf5)` in demo-box-otp, `linear-gradient(90deg,var(--primary-light),var(--primary))` in progress-bar — restrained but not documented.
- **Background #eef0f6** light, card #ffffff — good contrast.

## 6. Contrast problems

- **Previously fixed per A14/A18:** --muted darkened #7a7f95→#5f6480 3.96→5.80:1, badge texts darkened to 6-8:1, focus ring --primary-light lightened #6c7ae0→#8a9af0 2.7→3.5:1, --pm-focus #2c3690, high-contrast yellow #ffd54f.
- **Remaining risk:** Demo box `#6d4c00` on `#fff8e1` — need measurement. Helpline number `var(--primary-dark)` on white — okay. Some small-muted #5f6480 on #eef0f6 background — 5.8:1 on white but on #eef0f6 may be lower, need measurement.
- **No colour-only communication:** Badges now have colour+text, but some status dots (ml-status-dot) colour-only? Actually dot + text label nearby, okay.

## 7. Component inconsistencies

- **Cards:** `.section-card`, `.list-card`, `.stat-card`, `.role-card`, `.owner-action-card`, `.pm-call-card`, `.qr-modal-content` — all different radius, padding, shadow. No unified card token.
- **Badges:** `.badge-green/orange/red/blue` consistent now, but also `.auto-escalated-badge` hard-coded red #e53935 white text — not tokenized.
- **Progress bar:** `.progress-wrap` + `.progress-bar` only used in one place, not tokenized.
- **Timeline:** `.timeline-item` with ::before line, dot — unique component, okay.
- **Gis:** `.gis-map`, `.gis-status`, `.risk-chip` — unique.

## 8. Button inconsistencies

- **Primary:** `.btn-primary` background var(--primary) white text, but also `background:var(--red)` inline in deactivate, `background:var(--green)` inline in call accept.
- **Secondary:** `.btn-outline` white + primary border, `.btn-ghost` blue-bg + primary-dark text.
- **Sizes:** `.btn` full width by default, `.btn-sm` width auto, but also `owner-detail-actions .btn` min-height 48px, `farmer-portal .btn` min-height 48px, `pm-call-btn` min-height 48px/52px.
- **Icon-only:** `.header-icon-btn` 40px circle, but no consistent icon-only token.
- **Loading state:** `.btn.is-busy` opacity 0.75 cursor progress, but not all buttons use it, only OTP.
- **Action verbs:** Most buttons use clear verbs (Add Animal, Save Case, Call Vet, Accept Call, End Call) — good per GuDApps, but some still vague "Submit Report", "Save".
- **Disabled:** `.btn[disabled] opacity 0.6` — no focus style for disabled.

## 9. Form inconsistencies

- **Labels:** All have `<label for=id>` + id, zero label without for (verified via grep) — PASS after a11y pass.
- **Autocomplete:** `a11y.js enhanceAutocomplete()` adds tel/email/name/username/current-password/new-password/one-time-code — good.
- **Input types:** Some use `type="date"`, `type="email"`, `type="tel"`, `type="number"` — good, but mobile input uses `type="text"` with pattern? Actually `otp-mobile-row input` type text, should be tel.
- **Required indication:** No consistent `*` or `.pm-req` usage, only `required` attribute.
- **Error handling:** `emptyState`/`loadingState`/`errorState` with live regions, `addErrorSummary`/`setFieldError` with aria-invalid — good after a11y pass.
- **Form row:** `.form-row` flex gap 10px, becomes column at 520px for farmer portal — good, but not all forms use form-row, some use single column.
- **Multi-step:** Farmer report has voice + form, but no progress indicator, no step names.
- **Conditional logic:** Some fields shown only when relevant (village/block/district), but not all.

## 10. Navigation problems

- **Two nav systems:** Top `app-header` with back + title + icons, bottom `bottom-nav` fixed with 5-6 items. Active state `.nav-item.active` color primary — good.
- **Role-specific nav:** Farmer (Home, Livestock, Cases, Health, Notifications), Vet (Home, Reports, Cases, Campaigns, Search, Alerts), Govt (Analytics, GIS, Surveillance, AI, National, Alerts), Lab (Home, Queue, Scan, Reports, Alerts) — separate, no irrelevant exposure — good.
- **Consistent placement:** Bottom nav always fixed bottom, topbar sticky top — good.
- **Breadcrumbs missing:** No breadcrumb/context on inner pages, only back button. GIGW recommends breadcrumb where useful.
- **Skip link:** Present first focusable, reveals on focus, jumps to main-content — PASS.
- **Language toggle:** Farmer has `farmer-language-control` select, non-farmer has `lang-toggle` buttons — two different patterns, inconsistent.

## 11. Mobile/responsive problems

- **Breakpoints:** 320, 360, 375, 380, 390, 414, 420, 480, 520, 768, 1024, 1280 — many, not consistent scale.
- **No horizontal scroll at 320px:** `body.farmer-portal overflow-x:clip`, `#app overflow-x:clip` — good, but some tables `min-width:520px` may cause scroll, but wrapped in `pm-table-scroll` overflow-x:auto with tabindex 0 role region — good.
- **Touch targets:** `pm-a11y-btn` min 44×44, `@media pointer:coarse` min-height 44px for nav-item/btn/header-icon-btn/icon-item, webcall buttons 48px — good after a11y pass, but some small buttons (demo-box-btn, lang-toggle) may still be <44px.
- **Header overflow:** At 380px, owner-brand 11.5px, language control 70px width — may still overflow with long Telugu labels, but `overflow-wrap:anywhere` helps.
- **Cards stacking:** `owner-home-actions` grid 2 columns, `icon-grid` 3→4→5 columns at 768/1024 — okay.
- **Forms single-column:** At 520px, form-row becomes column for farmer portal — good.
- **Modals:** `qr-modal` padding 16px, `pm-call-card` max-width 420px, at 420px padding 16px — okay, but need test at 320px.
- **Bottom nav owner:** At 380px, nav-item font-size 8.8px — tiny, may fail readability.

## 12. Information hierarchy problems

- **Page title treatment inconsistent:** `header()` function returns `app-header` with h1, but `topbar` also has h2, and `section-title` is div with font-weight 700 15px — not real heading. No H1/H2/H3 hierarchy.
- **Primary action not always prominent:** Farmer dashboard has `owner-home-actions` grid with 4 cards equal emphasis, but "Report Problem" should be primary? Currently all equal.
- **Key metrics:** `stat-grid` 3 columns, equal emphasis, no visual distinction for important KPIs vs secondary.
- **Alerts:** Some alerts use `conflict-box` red, some use `badge`, some use `small-muted` — inconsistent emphasis.
- **Empty states:** `emptyState` role=status polite, good, but some empty states have no action (e.g., no animals → no add button).

## 13. Icon inconsistencies

- **Mix of emoji and text symbols:** `icon-circle` uses emoji (🐄, 📋, etc.), `header-icon-btn` uses emoji, `bottom-nav` uses emoji, `stat-card` uses emoji prefix in label (🔴, 🟠). No consistent icon library, only emoji.
- **No SVG icon system:** Only emoji, which may render differently across platforms, but familiar symbolism.
- **Accessible names:** `iconItem()` now has `aria-label` + `role=button tabindex=0 onkeydown` — good after a11y pass.
- **Decorative vs functional:** Emoji icons are functional but also decorative, screen-reader may announce emoji, but aria-label overrides.
- **Size inconsistency:** `icon-circle` 66px→72px→80px→88px at breakpoints, `action-icon` 30px, `header-icon-btn` 40px/38px/36px.

## 14. Modal/dialog problems

- **QR modal:** `role=dialog aria-modal=true aria-label` added, focus trap via `trapFocus`, Esc closes, restore focus — good after a11y pass.
- **Call overlay:** `pm-call-overlay` fixed inset 0 z-index 9999, `pm-call-card` with animation, has timer, status, meta, actions, but no explicit `role=dialog`? Actually call.js may set role.
- **Camp modal:** `campModalWrap` role=dialog — okay.
- **Focus management:** `a11y.js` `showAccessibleDialog` with first/last sentinel, Esc → onClose, restore focus, global Esc handler for qrModal and pmCallOverlay — good.
- **Background interaction:** Modals prevent background? `qr-modal` background rgba(0,0,0,0.6) but no `aria-hidden` on background content.
- **Close action:** QR modal has close button? Not visible in CSS, only overlay click? Need visible close.
- **Action hierarchy:** Call overlay has accept/decline, mute, end — clear hierarchy.

## 15. Table/report problems

- **Data tables:** `.data-table` min-width 520px, th uppercase 11px, hover #f7f8ff, wrapped in `pm-table-scroll` overflow auto with tabindex 0 role region — good after a11y pass.
- **Report layout:** Govt analytics has `barChart`/`pieChart` with accessible summaries, but tables for cases/helpline/lab queue use `list-card` not real table — okay for mobile.
- **Pagination:** `pm-pagination` with info + prev/next aria-label, status role polite, pageSize 10 — good after final pass.
- **Print:** `@media print` hides nav chrome, `@page A4`, `pmPrintSection` opens new window — good.
- **Export:** CSV via Blob, Excel/PDF via backend with openpyxl/reportlab, buttons visible — good.
- **Filtering:** Some reports have filters (date from/to), but not all (cases, lab queue no filters).
- **Sorting:** No sorting UI where supported.

## 16. Dashboard problems

- **Farmer dashboard:** `owner-hello` + `owner-home-actions` 2-col grid + `helplineCard` + `accountActionsCard` + `bottomNav` — simple, good, but primary action not visually distinct, metrics missing (should show animal count, case count?).
- **Vet dashboard:** `hello-banner` + `stat-grid` 6 cards + helpline/IVR read-only + IVR status + vet call host + today's tasks icon-grid + accountActionsCard — information-dense, but all stat-cards equal emphasis, no visual hierarchy for important KPIs.
- **Govt dashboard:** `hello-banner` + stat-grid 6 + helpline reporting + GIS + cases by district barChart + most spread pieChart + farm alerts + AI + trends + blocks + zoonotic + export + accountActionsCard — many sections equal emphasis, no clear primary vs secondary, charts have accessible summaries now but still many sections.
- **Lab dashboard:** hello-banner + stat-grid 4 + quick actions icon-grid + accountActionsCard — simple, good.

## 17. Chart presentation problems

- **Previously fixed:** `barChart`/`pieChart` now have `role=img aria-label` summary, `sr-only` paragraph, `<details>` with data table alternative, caption, th scope, tabindex 0 role region — good after final pass.
- **Remaining:** No line chart for trends (trend-chart-bar is simple bar), no legend for barChart (only label+value), pieChart has legend with color dot + label — okay.
- **Colour-only:** Charts use colour + text label + value + percent, not colour-only — good.
- **Mobile usability:** Charts flex-wrap, at 320px may still be small, but table alternative helps.
- **Title:** Section title present, but chart itself has no H2/H3, only section-title div.

## 18. Empty/loading/error state problems

- **Previously fixed:** `emptyState` role=status polite, `loadingState` role=status polite aria-busy true, `errorState` role=alert assertive with Retry/Go back, `announceLoading`/`announceError`, `pm-result-count` role=status polite — good.
- **Remaining:** Some loading states use `loading` class without role? Actually `loadingState()` adds role, but some inline `<div class="loading">` still exist (e.g., `Loading state analytics…`) with role status aria-busy — okay.
- **Empty with action:** Some empty states have no action (e.g., no samples in queue → no add button), some have action (no animals + hint).
- **Success states:** Toast `role`? Toast has no explicit role, but `announce()` via live regions — okay.

## 19. Multilingual layout problems

- **Supported:** en, hi, mr, te via `I18N` and `ft()` farmer translations, `A11Y_I18N` for a11y strings, `html lang` updates via `setPageMeta`.
- **Longer labels:** Telugu/Hindi can be longer, `overflow-wrap:anywhere` added for many containers, but `owner-brand white-space:nowrap` may clip, `farmer-language-control select` width 70-86px may clip long language names.
- **Buttons:** Some buttons have fixed width or `white-space:normal` now, good.
- **Tables/forms:** Forms become single-column at 520px, good for longer labels.
- **Navigation:** Bottom nav owner at 380px font-size 8.8px tiny, may clip Telugu.

## 20. WebRTC UI problems

- **State honesty preserved:** 7-state model Avail/Socket/Lease/Routable, badges with aria-live, gate routability, farmer Start disabled when signaling offline, W01-W08 tests PASS.
- **Visual states:** CONNECTING, CONNECTED, AVAILABLE, OFFLINE, RECONNECTING, INCOMING CALL, IN CALL, ENDED — implemented via `pm-call-status`, `pm-call-meta` badges.
- **Farmer:** Clear "Call Vet" action via `owner-action-card` 📞, availability state via helplineCard, ringing/connected/hangup via call overlay.
- **Vet:** Clear availability control via `pmVetCallHost` (mountVetCard), incoming-call notification via overlay, caller info, accept/reject, mute, end.
- **Remaining:** Call overlay animation `pmCallPop` .18s ease-out, ring animation `pmCallRing` 1.4s infinite — may need reduced-motion respect. No explicit OFFLINE badge in overlay? Actually status shows.
- **TURN/STUN:** `turn_configured` false in sandbox, `stun_configured` true, diagnostics in health, not visually shown in UI except via health.

## 21. Accessibility-related UI problems

- **Previously fixed many:** Skip link first focusable, live regions in initial HTML, landmarks header/nav/main/footer, lang+metadata, zoom not blocked, orientation not locked, noopener noreferrer, brand palette preserved, reduced motion, focus visible, print, etc.
- **Remaining:** 
  - No real H1/H2/H3 hierarchy, only divs with class section-title.
  - Some tables not real table (list-card) — okay for mobile but not semantic table.
  - Some icon buttons may still have <44px touch target at 380px.
  - Some forms missing `aria-describedby` for hints.
  - Toast has no role=status, but live regions announce.
  - No `aria-current=page` on pagination? Actually `pm-page-indicator aria-current=page` present.
  - No `aria-sort` on sortable tables.

## 22. Unnecessary visual clutter

- **Excessive cards:** Govt dashboard has 10+ section-cards stacked, each with shadow, margin 16px — visually dense, may feel cluttered.
- **Excessive borders:** Demo box has dashed border + left solid border + gradient background — visually busy.
- **Excessive shadows:** Multiple shadow values, not restrained.
- **Excessive colour:** Badges use 4 colours, plus demo box yellow, plus helpline card border primary-light, plus call overlay dark overlay — okay but could be more restrained.
- **Decorative elements:** Emoji icons are decorative but also functional, okay. No giant hero, no blobs, no glassmorphism — good, professional.

## 23. Inconsistent terminology

- **Animal vs Livestock vs Herd:** Farmer portal uses "My Livestock", "My Animals", "My Herds", "Animal ID", "Animal Type" — somewhat consistent, but "Livestock" vs "Animal" mixed.
- **Cases vs Reports vs Incidents:** Vet uses "Incoming Reports", "Active Case Tracking", "User Reports", "Helpline Reports", "Structured Helpline Reports" — similar but not identical.
- **Health vs Treatment vs Prescriptions:** Farmer uses "Health/Treatment" and "Prescriptions" — okay.
- **Call vs Web Call vs Helpline:** "Call Vet", "Web Call", "Helpline", "Pashu-Shield Call" — multiple terms for similar.
- **Dashboard vs Analytics:** Govt uses "Govt Analytics" and "Analytics" — okay.
- **Consistency review needed:** Create terminology map.

## 24. Inconsistent interaction behaviour

- **Clickable cards:** All have `role=button tabindex=0 onclick onkeydown Enter/Space` now — consistent after a11y pass.
- **Buttons:** Some full width, some auto, some min-height 48px, some 40px — inconsistent.
- **Modals:** QR modal closes via button? Call overlay closes via hangup/reject, Esc handler — consistent.
- **Forms:** Some preserve input on error, some don't? Actually `preventDuplicateSubmit` with aria-busy, but not all forms use it.
- **Navigation:** Bottom nav active state via class active color primary — consistent, but topbar back button vs header back inconsistent.
- **Toast:** Auto-hides? Not clear, no dismiss action.
- **Pagination:** Prev/next disabled attribute, but no aria-disabled.
- **Export:** CSV via Blob download, Excel/PDF via fetch blob — consistent.

---

## Summary of critical UI/UX issues for implementation pass

1. **Design tokens not enforced:** Spacing, radius, shadow, colour tokens defined but hard-coded values scattered. Need centralized token layer and consistent usage.
2. **Page structure inconsistent:** No breadcrumb, no consistent H1/H2/H3, no consistent content width container, header has two variants.
3. **Information hierarchy weak:** All stat-cards equal emphasis, no primary vs secondary, govt dashboard many sections equal.
4. **Component inconsistencies:** Multiple card types, badge types, button sizes, icon sizes.
5. **Form UX:** Missing required-field indication, no progress indicator for multi-step, some input types not optimal (mobile should be tel).
6. **Navigation:** Language toggle two patterns, bottom nav tiny at 380px, no breadcrumb.
7. **Responsive:** Many breakpoints arbitrary, not mobile-first scale, some touch targets <44px at small widths.
8. **Visual clutter:** Govt dashboard 10+ cards, demo box busy, multiple shadows.
9. **Terminology:** Animal/Livestock/Herd, Cases/Reports/Incidents, Call/Web Call/Helpline mixed.
10. **WebRTC UI:** Animations may need reduced-motion respect, no explicit OFFLINE visual in overlay, but state honesty preserved.
11. **Accessibility:** No real heading hierarchy, some tables not semantic, some forms missing aria-describedby, toast no role.
12. **Charts:** No line chart, barChart no legend, but accessible summaries now present.

**Next:** Implement design system strengthening, page layout consistency, information hierarchy, header/navigation polish, card/button/form standardization, responsive/mobile-first improvements, visual polish per GIGW/GuDApps/UX4G principles, preserving branding/fonts/palette with minimal tint for WCAG, preserving all functionality.
