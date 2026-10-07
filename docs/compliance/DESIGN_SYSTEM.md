# Pashu-Shield — Design System (DBIM 3.0 Phase 1)

**Status:** Phase 1 foundation. All later phases consume these tokens; no phase
may hard-code a brand colour, font, or icon outside this system.
**Authorities:** DBIM 2 (colour), DBIM 3 (icons), DBIM 4 (type), DBIM 5
(identity), DBIM 7.6 (cookies) + WCAG 2.1 AA + GIGW 3.0 §5.1/5.2.
**Hex provenance:** brief §1.1 (scanned-PDF extraction), **unverified against
the DBIM Toolkit** (no sandbox access) — D-08. Re-verify before CQW filing.

## File map

| File | Purpose |
|---|---|
| `frontend/dbim/tokens.css` | Colour themes, functional palette, type scale, focus, touch, spacing, motion. THE single source of truth. |
| `frontend/dbim/fonts.css` | Self-hosted Noto Sans `@font-face` (latin, devanagari, telugu × 400/500/600/700). |
| `frontend/fonts/*.woff2` | 12 subset files (OFL 1.1, see `OFL-Noto-Sans.txt`). Browser fetches only needed subsets (~27 KB English). |
| `frontend/dbim/base.css` | Legacy var remap (whole app re-skins via tokens) + type/link/button/form/surface/touch/focus rules. |
| `frontend/dbim/components.css` | Buttons, alerts, modal, tabs, accordion, pagination, stepper, tooltip, cookie banner, toasts. |
| `frontend/dbim/icons.svg` | 52-symbol line sprite (DBIM 3). |
| `frontend/dbim/dbim.js` | `DBIM.icon/alert/pagination/openModal/consentAllowed/openPreferences`, tabs/accordion enhancers, consent manager. |
| `tools/check_contrast.py` | CI gate: 24 text/UI pairs ≥ 4.5:1 / 3:1 (WCAG 1.4.3/1.4.11, GIGW 5.2.14). |
| `tools/check_dbim.py` | CI gate R1–R6: Deep-Blue ban, token discipline, Small-Text scope, image budgets, no-emoji-in-chrome. |

## Colour (DBIM 2)

- **Active group: Green** — key `#0F5757`, mid `#2D8686`, soft `#A6D9D9`, pale `#D9F2F2`, ink `#0B3D3D` (hover/pressed).
- **One-line swap:** `<html data-dbim-theme="green|blue">`. Blue group ships with
  brief hexes; burgundy/purple/chrome-yellow/cinnamon-red fall back to green
  with a console warning until Toolkit values land (P-TOK-01…04).
- **Functional palette only** besides the group: Linen `#EBEAEA` (cards),
  White (pages), Deep Earthy Brown `#150202` (text), Black, Liberty Green
  `#198754`, Mustard `#FFC107` (**background only**, ink text), Coral Red
  `#DC3545`, info Blue `#0D6EFD` (large/bold/UI), body-link blue `#0B5ED7`
  (**D-09**: `#0D6EFD` is exactly 4.50:1 on white and 3.75:1 on linen — the
  darker variant gives 5.84/4.86 with real margin; WCAG wins per precedence).
- **Never** Deep Blue `#1D0A69` (R1 fails the build); white text only on key
  or darker (mid `#2D8686` is 4.32:1 — decorative fills only); Mustard never
  as text; `#606060` for input borders/secondary text; links underlined.

## Typography (DBIM 4)

- Noto Sans (+ Noto Sans Telugu in the same stack) for every script; weights
  400/500/600/700 only; `font-display: swap`; latin-400 preloaded.
- Scales via `--dbim-h1/h2/h3/p1/p2/small` with the 768px mobile breakpoint;
  utilities `.dbim-h1…`, `.dbim-p1/p2`, `.dbim-caption` (**Small is
  non-essential captions only** — R3 enforces).
- Body left-aligned, LH 1.5; tables: text left, `td.num` right
  (tabular figures), headers centred; no all-caps; real text always.
- Buttons: 1–3-word labels, consistent padding, distinct hover (`:hover`
  darkens — legacy had none), focus ring, non-opacity disabled states.
- Honours browser zoom to 200% plus the in-page A−/A/A+ control (kept).

## Icons (DBIM 3)

- ONE line style, `currentColor` (key or white only), 24/32/48/64 frames,
  2px padding respected (artwork in 2…22), SVG sprite + `DBIM.icon(name, size)`.
- Decorative: always paired with text labels; significant icon-only controls
  get visible tooltips (`.dbim-tip`) — applied in Phase 3 chrome.
- **Toolkit submission backlog** (custom-drawn, D-08): all 52 symbols —
  home, grid, report, cases, vet, lab, chart, pin, search, bell, user, globe,
  phone, video, mic, calendar, plus-circle, box, file, download, upload,
  adjust, help, info, warn, error, check, check-sm, chev-down/left/right,
  arrow-left, close, menu, external, scan, clock, logout, login, chat, list,
  access, pause, play, mail, tag, drop, spark, mega, lock, refresh, print.

## Components (DBIM 1.4)

Keyboard-operable, 3px focus ring, ≥44px targets, reduced-motion safe.
Usage: see class names in `components.css`; behaviours auto-init via
`data-dbim-tabs` / `data-dbim-accordion`; dialogs via `DBIM.openModal`
(focus-trapped, Esc closes, focus restored); paging via `DBIM.pagination`.

## Consent (DBIM 7.6, DPDP Act 2023)

Bottom banner (Accept all / Reject optional / Customise), no pre-ticks,
language-matched (en/hi/mr/te — O-52 human review still required), choice in
`pm_consent_v1`, withdraw via `DBIM.openPreferences()` (footer link lands in
Phase 3). Loaders must gate on `DBIM.consentAllowed('analytics'|…)`.

## Interpretations (stricter-wins log)

- **D-09** (link blue): above.
- Status badges render at P2 bold with icon/text (not P1): concise labels
  paired with context; full P1 reserved for instructions/errors/labels.
- High-contrast opt-in (`.pm-high-contrast`) is kept as the stronger
  accessibility override; DBIM hues are the default experience.

*Designed to conform to DBIM 3.0 and GIGW 3.0; CQW/STQC certification pending audit.*
