# Pashu-Shield — Compliance Decision Log (DBIM 3.0 / GIGW 3.0 redesign)

**Started:** 2026-10-07 (Phase 0) · **Branch:** `arena/0e6a5de5-pashu-mitra`
Precedence: DBIM wins on visual identity; GIGW/WCAG win on accessibility and security; otherwise stricter wins. Every conflict is recorded here with its resolution.

| ID | Conflict / question | Authorities | Resolution | Status |
|---|---|---|---|---|
| D-01 | Brief orders branch `redesign/dbim-gigw`, but this Arena session is fixed to `arena/0e6a5de5-pashu-mitra` (work elsewhere is not tracked). | Session rule vs brief §Execution | **Session rule wins.** All redesign work lands on `arena/0e6a5de5-pashu-mitra`; one reviewable commit per phase preserved. | Decided |
| D-02 | Brief says DBIM/GIGW "source documents are provided as .md files" — they are **absent** from the repo. F.1 cannot be verified verbatim. | Brief §Authority vs repo reality | **Reconstruct F.1 (43 items) from the brief's enumerated requirements**, each traceable to a brief section; mark as reconstructed in `AUDIT_BEFORE.md`; re-verify against real DBIM 3.0 Annexure F when supplied. Never fabricate section text. | Decided; re-verification pending owner |
| D-03 | Prior programme froze system fonts + indigo palette (exemptions 4.2/4.3); brief mandates Noto Sans + DBIM Green. | Prior `02-change-log.md` vs DBIM 4 / DBIM 2 | **Brief wins (owner-confirmed 2026-10-07):** exemptions 4.2/4.3 superseded; Noto Sans + DBIM Green shipped in Phase 1. Zero-regression holds for *features and APIs*, not brand visuals. | Decided |
| D-04 | DBIM 7.5 wants distinct `/hi/` URLs; the app is a hash-routed static SPA on Vercel. | DBIM 7.5 vs stack (keep, no migration) | **Owner chose real `/xx/` paths now (2026-10-07).** Phase 4 will add a path→hash adapter + Vercel rewrites + hreflang + per-language sitemaps. Regional order after EN+HI: Marathi, then Telugu. | Decided; build in Phase 4 |
| D-05 | JWT in `localStorage` vs Secure/HttpOnly/SameSite cookie ideal. | GIGW 5.3 vs zero-regression (OTP + Socket.IO handshake at risk) | **Keep localStorage** (prior decision, re-affirmed): migrating auth storage risks farmer OTP and call signalling. Mitigate with short expiries, masked logging, CSP, and session-timeout UI. | Decided (reaffirmed) |
| D-06 | CSP enforcement vs Leaflet CDN + inline `onclick` handlers. | GIGW 5.3 vs zero-regression | **Keep report-only** until Phase 8/9 verifies a strict policy (defer Leaflet, audit inline handlers); enforce behind `SIH_CSP_ENFORCE=1` after proof. | Decided |
| D-07 | DBIM primary-button-disabled-until-complete vs keyboard/SR blocking. | DBIM B vs WCAG/GIGW a11y | **A11y wins:** implement as `aria-disabled="true"` + visible announced missing-list (brief Phase 6 already orders this). | Decided |
| D-08 | Colour-group hexes from a scanned PDF (§1.1) vs DBIM Toolkit truth. | Brief §1.1 vs DBIM Toolkit | **Toolkit wins when reachable;** until then use brief hexes, verify contrast computationally, and note "unverified vs Toolkit" in `DESIGN_SYSTEM.md`. No outbound Toolkit access in this sandbox. | Decided; verification pending |
| D-09 | Brief Blue `#0D6EFD` for links is exactly 4.50:1 on white (zero margin) and 3.75:1 on linen (fail). | Brief §1.1 vs WCAG 1.4.3/GIGW 5.2.14 | **WCAG wins:** body links use darker info-blue `#0B5ED7` (5.84/4.86:1); `#0D6EFD` kept for large/bold/UI only. Contrast gate enforces. | Decided (Phase 1) |

*Designed to conform to DBIM 3.0 and GIGW 3.0; CQW/STQC certification pending audit.*
