# Pashu-Shield — Accessibility Notes

**Date:** 2026-10-05 · **Standard targeted:** WCAG 2.1 Level AA (as adopted by GIGW 3.0 §2)
**Branch:** `arena/01a10b85-pashu-shield-updated`

---

## 1. Honest status statement

> **An independent accessibility audit has NOT been completed.**
> axe-core, pa11y, Lighthouse, W3C HTML validation and screen-reader testing were
> **NOT EXECUTED** in this environment (no browser, no assistive technology).
> Everything in §2 was implemented; nothing in §2 has been *scanner-verified*.
> The Accessibility Statement page (`#/policies/accessibility`) states this publicly and
> must be updated after a real audit.

---

## 2. Implemented in this round

### 2.1 Structure and navigation

| Item | WCAG | Implementation | Evidence |
|---|---|---|---|
| Skip link, first focusable element | 2.4.1 (A27) | `.pm-skip-link` → `#main-content`, reveals on focus | `test_60` |
| Landmarks | 1.3.1 (A07) | `<header role="banner">`, `<main>`, `<footer role="contentinfo">`, `<nav>` breadcrumbs | `test_62` |
| Breadcrumbs | 2.4.8 / GIGW Q18 | `PashuShell.breadcrumbs()` with `aria-current="page"` | shell.js |
| Two ways to find a page | 2.4.5 (A31) | **Search** (`#/search`) **and** Site Map (`#/sitemap`) alongside menus | `test_72` |
| Per-route page titles | 2.4.2 (A28) | `setPageMeta()` on every render | live |
| Language of page | 3.1.1 (A38) | `<html lang>` kept in sync with the selected language | `test_63` |

### 2.2 Visual

| Item | WCAG | Implementation | Evidence |
|---|---|---|---|
| Visible focus | 2.4.7 (A33), 1.4.11 (A18) | Global `:focus-visible` 3px ring + `@supports` fallback; **removed the `outline:none` that had no replacement** | `test_70` |
| Text resize to 200% | 1.4.4 (A15) | A- / A / A+ control. All 135 px font sizes → `calc(Npx * var(--pm-text-scale,1))`, **identical at 1.0** | `test_67` |
| Zoom not blocked | 1.4.4 | No `user-scalable=no` / `maximum-scale=1` | `test_64` |
| Orientation not locked | 1.3.4 (A10) | Removed `"orientation": "portrait-primary"` from the manifest | `test_65` |
| Reduced motion | 2.2.2 (A25) | `@media (prefers-reduced-motion: reduce)` **and** an in-app Reduce motion toggle | `test_69` |
| High contrast | 1.4.3 (A14) | Opt-in `html.pm-high-contrast` with its **own** palette; the default brand theme is unchanged | `test_67` |
| Touch targets ≥ 44px | 2.5.5 / UX4G | `@media (pointer:coarse)` minimums + 44px a11y-bar controls | CSS |
| Print (A4) | GIGW Q20 | `@page { size:A4 }`, navigation hidden, link URLs shown after links | `test_71` |

### 2.3 Assistive technology

| Item | WCAG | Implementation | Evidence |
|---|---|---|---|
| Status messages | 4.1.3 (A50) | `#pmLivePolite` (`role="status"`) + `#pmLiveAssertive` (`role="alert"`) declared **statically**; every toast announced (errors assertively) | `test_61` |
| Status not colour-only | 1.4.1 (A12) | Error toasts prefixed with **`Error —`**; badge prefix styles added; feedback/error pages use text + `role="alert"` | `test_61`, code |
| External links identified | GIGW L04 | Indicator icon, `(external site, opens in a new window)` in a `.sr-only` span, `rel="noopener noreferrer"` | `test_66` |
| Screen-reader-only utility | — | `.sr-only` (clip-based, not `display:none`) | CSS |

### 2.4 Forms (new pages)

The Feedback form implements the full GuDApps/WCAG form contract and is the reference
pattern for retrofitting existing forms:

visible `<label for>` on every field · required indication (`*` + the word "required" in
help text) · `aria-describedby` help text · correct input types · `autocomplete` ·
client **and** server validation · error summary in a `role="alert"` that takes focus ·
per-field error links · duplicate-submit prevention (button disabled +
`aria-busy`) · success confirmation with a reference number.

---

## 3. Known gaps — NOT yet done

These are recorded honestly. Each is in the gap matrix.

| # | Gap | WCAG | Notes |
|---|---|---|---|
| A-1 | **Alt text on all meaningful images; `alt=""` on decorative ones** | 1.1.1 (A01) | The app uses emoji heavily. Emoji used as icons need accessible names or `aria-hidden`. |
| A-2 | **Programmatic labels on every existing form field** | 3.3.2 (A45), 4.1.2 (A49) | Many fields in the 71 existing form handlers lack `<label for>`. |
| A-3 | **`autocomplete` on all personal-data inputs** | 1.3.5 (A11) | Done for the new Feedback form; existing forms pending. |
| A-4 | **Roles/states on custom widgets** (OTP boxes, call controls, toggles) | 4.1.2 (A49) | |
| A-5 | **Inline field-level errors + error summary on existing forms** | 3.3.1 (A44), 3.3.3 (A46) | The reference pattern now exists; retrofit pending. |
| A-6 | **Charts: title, description, text summary, data table** | 1.1.1 / GIGW §54 | `barChart()` and `pieChart()` emit inline SVG with no accessible name or text equivalent. The pie chart **relies on colour** for its legend. |
| A-7 | **Tables: `<caption>`, `<thead>`, `scope`** | 1.3.1 (A19) | Only 3 tables exist; `.pm-table-scroll` component added but not yet applied. |
| A-8 | **Contrast measurement across the whole palette** | 1.4.3 (A14), 1.4.11 (A18) | Not measured — no scanner. Must be measured before any claim. |
| A-9 | **Live captions for the live WebRTC audio call** | 1.2.4 (A05) | Not provided. Text call-state is provided instead; captions are a substantial feature. |
| A-10 | **WebRTC state honesty: availability vs signalling vs call readiness** | — | Planned (gap matrix §E). The UI must not say "ready to receive calls" when Socket.IO is offline, nor "connected" before WebRTC/media state confirms it. |
| A-11 | **Focus management in dialogs** (trap + `Esc` + restore) | 2.1.2 (A22) | 4 modals exist. |
| A-12 | **`lang` on passages in another language** | 3.1.2 (A39) | Hindi/Marathi/Telugu strings are inline without `lang`. |
| A-13 | **Heading hierarchy across existing views** | 2.4.6 (A32), 1.3.1 | Headings are styled `div`s in places. |
| A-14 | **Keyboard walkthrough** of every workflow | 2.1.1 (A21) | Not executed — no browser. |
| A-15 | **320px reflow verification** | 1.4.10 (A17) | Not executed — no browser. |

---

## 4. Brand preservation (hard exemptions 4.2 and 4.3)

| Constraint | How it was honoured |
|---|---|
| **Do not change the font family** | No `font-family` was added, removed or replaced. Text scaling changes **size only**. Asserted by `test_68`. |
| **Do not redesign the colour palette** | The `:root` block is unchanged. New semantic tokens (`--color-primary` etc.) are **aliases that reference the same values**. Asserted by `test_67`. |
| **Minimal tint only where WCAG requires it** | One change so far: `manifest.json` `theme_color` `#3f51b5` → `#3d4db8` to match the CSS brand token (a drift correction, not a redesign). |

### Colour-change log (format required by exemption 4.3)

| # | Original | New | Reason | WCAG ref | Where used |
|---|---|---|---|---|---|
| C-1 | `theme_color: #3f51b5` | `#3d4db8` | Manifest had drifted from the CSS brand token `--primary` | N/A (brand consistency, not contrast) | `manifest.json` |

**No text/background colour was changed.** Contrast remediation is pending measurement
(A-8). When it happens, every change will be recorded here in the same format.

---

## 5. How to verify (next environment)

```bash
# Start the app
cd backend && gunicorn app:app --bind 0.0.0.0:5001 --worker-class gthread \
  --workers 1 --threads 100 --timeout 120

# Accessibility scans
npx @axe-core/cli http://localhost:5001/
npx pa11y --standard WCAG2AA http://localhost:5001/
npx lighthouse http://localhost:5001/ --form-factor=mobile \
  --only-categories=accessibility,best-practices,performance
```

Then complete the manual checklists in `03-test-report.md` §7 (keyboard, screen reader,
visual/responsive, colour & contrast).

---

## 6. Testing assistive technology

Recommended combinations:
- **Windows:** NVDA + Firefox; JAWS + Chrome
- **macOS / iOS:** VoiceOver + Safari
- **Android:** TalkBack + Chrome

Priority journeys to test:
1. Farmer OTP login (mobile → request → code → success)
2. Farmer disease report
3. Vet availability toggle + incoming call
4. Lab sample detail + result entry
5. Government analytics
6. Feedback submission
7. Accessibility bar (text size, high contrast, motion)
