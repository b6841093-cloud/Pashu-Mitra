# Pashu-Shield — Placeholders (do-not-invent log)

Every value below is **explicitly not final**. Code renders fallbacks and this
file tracks what the owner must supply. Prior programme placeholders also live
in `frontend/org-config.js` (`[OWNER ACTION: …]`) and `04-needs-owner-input.md`.

| ID | Item | Current fallback | Needed from owner | Phase |
|---|---|---|---|---|
| P-TOK-01…04 | Burgundy / Purple / Chrome Yellow / Cinnamon Red theme hexes | Green fallback + console warning | DBIM Toolkit-verified hexes per group | 1 (done: fallback) |
| P-TOK-05 | Green + Blue hex verification | Brief §1.1 values, contrast-verified computationally | Confirm against https://dbimtoolkit.digifootprint.gov.in | 1 (done: code) |
| P-FONT-01 | Tamil, Kannada, Malayalam, Bengali, Gujarati, Gurmukhi, Odia Noto families | System-font fallback for those scripts | Confirm rollout order; families added per language | 4 |
| P-I18N-01 | hi/mr/te cookie-consent strings | Short drafted strings in `dbim.js` | Human translation review (O-52) | 4 |
| P-BRAND-01… | Logo masters, lockups, favicons, social image | 🐄 emoji + text (unchanged) | Owner picks 1 of 3 concepts (Phase 2) | 2 |
| P-URL-01 | Real `/hi/` `/mr/` `/te/` paths (owner chose paths over hash, D-04) | Hash SPA + `lang` sync (unchanged) | Confirm path strategy + Vercel rewrite map | 4 |
| P-CCPS-01 | CCPS banner/post content | Empty flagged slot (`CCPS_ENABLED=false`) | Toolkit credentials + approved content | 3 |
| P-LINE-01 | Footer lineage + `OFFICIAL_GOV_PORTAL` | Flag added (`false`); lineage line lands with footer rebuild | Confirm independent-initiative wording | 3 |
| P-GOV-01… | Organisation, WIM, policies, integrations, infra, audits | `[OWNER ACTION]` / pending-approval / not-configured (unchanged) | See `04-needs-owner-input.md` O-01…O-56 | 10 |

*Designed to conform to DBIM 3.0 and GIGW 3.0; CQW/STQC certification pending audit.*
