# Pashu-Shield — Needs Owner / Organisation Input

**Date:** 2026-10-05

> **Nothing below has been invented.** Every item requires a real decision, approval or
> credential from the owning organisation or an external body. The application renders
> owner-dependent values as visible `[OWNER ACTION: …]` placeholders and marks policy
> pages as *pending approval* rather than pretending they are official.

---

## 1. Blocking for any compliance claim

These are **not** achievable by application code (programme §63). No claim of GIGW
conformity can be made until they are addressed.

| # | Item | GIGW ref | Why it is external | What is needed |
|---|---|---|---|---|
| O-01 | **gov.in / nic.in domain** | Q21 | **Hard exemption 4.1.** Domain registration is an administrative process. | Register the domain per the `.IN Registration` policy; update DNS and certificate. |
| O-02 | **Security audit + clearance certificate** (NIC / STQC / STQC-empanelled / CERT-In-empanelled lab) | C1.1 | Only an empanelled auditor can issue it. | Commission the audit; provide the certificate for the record. |
| O-03 | **"Safe to host" certification** | C1.1 | Issued by CERT-In/STQC-empanelled cybersecurity auditors. | Commission and file the certificate. |
| O-04 | **STQC / CQW website certification** | Introduction | STQC Directorate process. | Apply and complete the conformity assessment. |
| O-05 | **Nominate a Web Information Manager (WIM)** | L01 | Must be a senior official **not below Joint Secretary rank**. | Nomination + published contact details. The app already renders the WIM fields. |
| O-06 | **Hosting environment in India with DC + DR + BCP, WAF, 180-day log retention** | C2 | Infrastructure procurement. | Confirm or migrate the hosting provider. |
| O-07 | **Periodic VA / PT and annual DR drill** | C2, C1.2 | Requires external testers. | Schedule and evidence. |

---

## 2. Organisation information (currently placeholders)

All of these appear as `[OWNER ACTION: …]` in `frontend/org-config.js` and are rendered
visibly marked so no user can mistake them for approved content.

| # | Field | Where used |
|---|---|---|
| O-08 | Official organisation name | Global header ownership line, footer, About page |
| O-09 | Short name / abbreviation | Header (narrow screens) |
| O-10 | Parent department / ministry | About page |
| O-11 | Official postal address | Footer, Contact page |
| O-12 | Official contact email | Footer, Contact page |
| O-13 | Official contact phone | Footer, Contact page |
| O-14 | Office / public-dealing hours | Footer, Contact page |
| O-15 | Grievance officer — name, designation, email, phone | Contact page |
| O-16 | Mission, vision, values, history, achievements, leadership, team | About page (**intentionally left blank — not invented**) |
| O-17 | Last reviewed date (maintain going forward) | Footer |
| O-18 | Social media accounts (or a formal decision to mark Q24 not applicable) | Footer / Q24 |

---

## 3. Policy text needing legal / organisational approval

Twelve policy templates are implemented as routes and are marked **pending approval** in
the UI. They are drafts written to be accurate about this platform; they must be reviewed
and formally approved before they can be treated as official.

| # | Policy | GIGW ref |
|---|---|---|
| O-19 | Privacy Policy | L03.8, C3.2 |
| O-20 | Terms & Conditions | L03.6 |
| O-21 | Copyright Policy | L03.1 |
| O-22 | Hyperlinking Policy | L03.5 |
| O-23 | Accessibility Statement (its "known limitations" section must be updated after a real audit) | L03 |
| O-24 | Security Policy (the "not yet done" section must stay until the audit exists) | L03.10, C3.1 |
| O-25 | Content Contribution, Moderation & Approval (CMAP) | L03.2 |
| O-26 | Content Archival Policy | L03.3 |
| O-27 | Content Review Policy | L03.4 |
| O-28 | Website Monitoring Plan | L03.7 |
| O-29 | Contingency Management Plan | L03.9 |
| O-30 | Grievance Redressal | L03, programme §44 |

**To mark any of these approved:** set `approved: true` for the matching entry in
`frontend/org-config.js` → `ORG.policies`, and set `OWNER_DETAILS_APPROVED = true` once
the organisation block is confirmed.

---

## 4. External platform integrations

Reported honestly as **not configured** unless and until credentials exist. The
application will not claim a live integration that is not live (GIGW Q22).

| # | Platform | Status | Requirement |
|---|---|---|---|
| O-31 | India Portal | not configured | Organisation-approved API credentials |
| O-32 | DigiLocker | not configured | Organisation-approved API credentials |
| O-33 | Aadhaar identity | not configured | UIDAI approval; **not required** by current workflows |
| O-34 | Meri Pehchaan / NSSO single sign-on | optional | Credentials; **existing auth is preserved either way** |
| O-35 | MyGov | not configured | Optional citizen engagement |
| O-36 | MyScheme | not configured | Optional scheme discovery |
| O-37 | Government Data Platform (open formats) | optional | `/api/govt/export` already provides CSV |

---

## 5. Emblem and branding

| # | Item | Detail |
|---|---|---|
| O-38 | **State Emblem of India** | **Deliberately not used.** Its use is governed by the *State Emblem of India (Prohibition of Improper Use) Act, 2005* and requires authorisation. A neutral 🐄 mark is used instead. If the organisation is authorised and supplies an official logo/emblem, set `ORG.logo.src` and `ORG.logo.alt`. |
| O-39 | Official logo asset | If supplied, provide the file plus a text alternative and the required aspect ratio. |

---

## 6. Operational / infrastructure

| # | Item | Detail |
|---|---|---|
| O-40 | Remove the live database from git | `backend/animal_health.db` is tracked and contains user records. It currently doubles as the demo dataset, so removal needs a decision: replace with a seed script, or accept it as demo data and document it. |
| O-41 | Demo seed credentials | `backend/database.py` seeds demo accounts with `password123`. Must not reach production. |
| O-42 | Web server must not run as root | GIGW C1.2i — deployment configuration. |
| O-43 | Suppress the `Server:` banner | GIGW C1.2d. **The Flask layer removes it, but Gunicorn re-adds it** (`Server: gunicorn`) because it writes the header after the app returns. Needs a proxy/CDN rule or Gunicorn config. |
| O-44 | Enforce CSP | Currently **report-only** by design. After verifying no violations, set `SIH_CSP_ENFORCE=1`. |
| O-45 | CAPTCHA on staff login | GIGW C1.2f / GuDApps 3.5.2. A feature-flagged adapter is planned; a provider key is needed. |
| O-46 | TURN credentials | `SIH_TURN_URLS`, `SIH_TURN_USERNAME`, `SIH_TURN_CREDENTIAL` — WebRTC works over STUN only until TURN is configured. |
| O-47 | SMS gateway credentials | Required for real OTP delivery; currently `MOCK` mode. |
| O-48 | VAPID keys for web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. |
| O-49 | Clerk (optional phone auth) | `CLERK_SECRET_KEY`; India SMS must be enabled in the Clerk dashboard. |
| O-50 | Analytics decision | No analytics is present. If added, it must be consent-based and PII-free. Confirm whether it is wanted at all. |
| O-51 | Departmental grievance backend | The app-side workflow (file → reference → track → resolve) is implemented. Integration with a real departmental system is **not configured**. |

---

## 7. Content

| # | Item | Detail |
|---|---|---|
| O-52 | Translation review | Four languages (en, hi, mr, te). **Do not machine-translate policy, legal or clinical content** without human review. Untranslated content should be flagged, not silently served in English. |
| O-53 | Content accuracy review | GIGW Q25 — spelling/grammar is an organisational process. |
| O-54 | Content moderation roles | GIGW L05 — designate the officials responsible for moderation/approval. |
| O-55 | Campaign / advisory validity dates | GIGW Q07 & Q08 — owners should supply expiry dates so items can move to an archive. |
| O-56 | Downloadable documents | If documents are published, supply title, format, size, language and purpose (GIGW Q06). None exist today. |

---

## 8. Testing that cannot be done here

Recorded in `03-test-report.md` §5. Requires a browser environment:
Lighthouse, axe-core, pa11y, W3C HTML validation, broken-link crawl, OWASP ZAP,
`pip-audit`, cross-browser testing, screen-reader testing, keyboard walkthrough,
zoom/reflow/print checks, and a real two-peer WebRTC call.

---

## 9. Document-availability note

The four guideline PDFs attached to the task brief did **not** arrive in the workspace.
The official published versions were used instead, with the requester's confirmation:

| Ref | Document | Source |
|---|---|---|
| G3 | GIGW 3.0 | https://guidelines.india.gov.in/guidelines/ — read in full |
| G2 | GIGW 2.0 | https://cdnbbsr.s3waas.gov.in/s3c92a10324374fac681719d63979d00fe/uploads/2023/12/2023122162.pdf |
| GA | GuDApps NIC-GDL-DA-1.1 | https://cdnbbsr.s3waas.gov.in/s3c92a10324374fac681719d63979d00fe/uploads/2021/09/2021090182.pdf |
| UX | UX4G UX Handbook | https://www.ux4g.gov.in/images/pdf/UX4G-Handbook.pdf |

**Reading completeness (stated honestly):**
- GIGW 3.0 — **complete** (Quality 1–25, Accessibility 1–50, Cybersecurity 1–3, Lifecycle 1–10).
- GuDApps — Abstract, amendment log, full contents, Ch.1 and Ch.2 headings (≈ first 30 pages). Chapters 3–6 (Authentication, Forms, Reports, Frameworks) were **not** extracted in full.
- UX4G Handbook — About, Executive Summary (all 11 topic summaries) and Ch.1–2 (≈ first 30 pages). **Chapter 11 (Compliance Matrix, pp. 166–251) was not extractable.**
- GIGW 2.0 — contents confirmed; body sections **not** read in full. GIGW 3.0 supersedes it and is treated as the normative baseline.

**Required follow-up:** re-read GuDApps Ch.3–6, UX4G Ch.11, and the GIGW 2.0 body, then
extend the gap matrix if they introduce requirements not already covered by GIGW 3.0.
