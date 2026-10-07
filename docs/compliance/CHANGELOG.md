# Pashu-Shield — Redesign Changelog (DBIM 3.0 / GIGW 3.0)

One reviewable commit per phase (brief §Execution). Prior GIGW-programme
history: `docs/compliance/02-change-log.md` (unchanged, still authoritative
for that work).

## Phase 1 — DBIM design system (2026-10-07)

**Commit:** `arena/0e6a5de5-pashu-mitra` (Phase 1). **Regressions:** none —
all 331 backend + 50 frontend tests green; no API, route, auth, call or ML
contract changed.

- Tokens (`frontend/dbim/tokens.css`): Green group default, one-line
  `data-dbim-theme` swap (blue valued; 4 groups fall back pending Toolkit —
  P-TOK-01…04); functional palette; surfaces (white pages, linen cards);
  3px focus; 44px touch; DBIM type scales + mobile breakpoint; spacing/motion.
- Fonts: self-hosted Noto Sans latin + devanagari + Noto Sans Telugu
  (400/500/600/700, WOFF2, unicode-ranged, `display:swap`, latin-400
  preloaded). Supersedes exemption 4.2 (D-03, owner-confirmed).
- Base (`base.css`): legacy palette remapped to tokens (indigo → DBIM Green;
  supersedes exemption 4.3, D-03); links underlined with D-09 link blue;
  button hover/disabled states; `#606060` input borders; essential-text
  floors; table alignment; 44px targets; warning→mustard/ink pattern.
- Components (`components.css` + `dbim.js`): buttons, alerts, focus-trapped
  modal, WAI-APG tabs, accordion, pagination, stepper, tooltips, toasts.
- Icons: 51-symbol line sprite (`icons.svg`) + `DBIM.icon()` (DBIM 3).
- Consent: bottom banner Accept/Reject/Customise, no pre-ticks, en/hi/mr/te,
  `pm_consent_v1` store, `DBIM.consentAllowed()` gate, withdraw API (DBIM 7.6/DPDP).
- Config: `OFFICIAL_GOV_PORTAL=false`, `CCPS_ENABLED=false` (wired in Phase 3).
- PWA/deploy: SW v9 + dbim assets; `vercel.json` cache rules; manifest
  `theme-color #0F5757`.
- CI (`.github/workflows/ci.yml`): contrast gate (24 pairs), DBIM rules
  R1–R6, JS syntax, frontend + backend suites.
- Harness fix (no product assertion weakened): `test_63` asserted the exact
  string `<html lang="en">`; it now matches `lang="en"` robustly alongside
  the `data-dbim-theme` switch and asserts the theme names a real DBIM group.
  Prior exemption tests 67/68 still pass — legacy `style.css` is unedited;
  the re-skin flows entirely through the new token files (D-03).
- Docs: `DESIGN_SYSTEM.md`, `PLACEHOLDERS.md`, this file; `DECISIONS.md`
  updated (D-03 confirmed, D-04→paths, D-09 link blue).

## Phase 0 — Audit before coding (2026-10-07)

- `AUDIT_BEFORE.md`: stack detection, reconstructed F.1 (1 pass / 17 partial /
  24 fail / 1 N-A), GIGW delta, logo audit (no national symbols: pass),
  page/component scores, top-10 fixes. No product code changed.
- `DECISIONS.md` created (D-01…D-08).
