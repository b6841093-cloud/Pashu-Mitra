# Pashu-Shield — Data Dictionary (GuDApps 2.1.1–2.1.8)

**Date:** 2026-10-06 · **Source:** `backend/app.py`, `backend/database.py`, `backend/case_service.py`, `backend/otp_service.py`, `backend/compliance_security.py`, `frontend/app.js`

> This dictionary is the authoritative reference for name, aliases, description, source, base/derived, privacy & security, type, length, domain, validation, and verification per GuDApps §2.1.

## Conventions
- **PII:** Mobile, email, full_name, village, district, block are personal data — masked in logs, never in URLs, role-based access.
- **Sensitive:** OTP codes hashed, short-lived, attempt-limited, never in logs or browser storage.
- **Identifiers:** animal_code (e.g. MH-PUN-000001), herd_code, case_no, sample_code, qr_token (aqr_, sqr_), reference FB-YYYYMMDD-XXXXXX.

## Core entities

### users
| Field | Alias | Type | Length | Domain | Mandatory | Source | Base/Derived | Privacy | Validation | Verification |
|---|---|---|---|---|---|---|---|---|---|---|
| id | uid | INTEGER PK | — | >0 | Yes | DB autoincrement | Base | Internal | safeId numeric | Exists check |
| full_name | name | TEXT | 2–100 | Letters, spaces, ., - | Yes | User input | Base | PII | trim, min 2, max 100, no < > | — |
| mobile | phone, identifier | TEXT | 10 digits | [6-9]\d{9} (Indian) | Yes for owner, optional for staff | User input / OTP verified | Base | PII, masked in logs | regex ^[6-9]\d{9}$, unique | OTP verification, check-digit not applicable |
| email | — | TEXT | 5–254 | RFC email | Yes for vet/govt/lab, optional owner | User input | Base | PII | email regex, lowercased, max 254 | — |
| password_hash, salt | — | TEXT | — | — | Yes for vet/govt/lab, No for owner (OTP-only) | hash_password | Derived | Sensitive | min 6 chars before hash, salted hash | verify_password |
| role | — | TEXT | — | owner, vet, govt, lab, admin | Yes | System / registration | Base | Internal | enum check, RBAC decorator | — |
| village, block, district | — | TEXT | 2–100 | Free text, Maharashtra districts preferred LOV | Village optional, district mandatory | User input | Base | PII (location) | trim, max 100, district LOV audit | Cross-field: village→block→district hierarchy |
| preferred_language | — | TEXT | 2 | en, hi, mr, te | Optional | User input | Base | — | enum en/hi/mr/te | — |
| specialization | — | TEXT | 0–100 | Free text | Optional vet/lab | User input | Base | — | max 100, no < > | — |
| created_at | — | TEXT | — | ISO datetime | Yes | DB now | Derived | — | — | — |

### herds
| Field | Type | Domain | Mandatory | Validation | Verification |
|---|---|---|---|---|---|
| id | INTEGER PK | >0 | Yes | safeId | FK |
| herd_code | TEXT | HRD-... or auto | Yes | unique, pattern | Exists |
| owner_id | INTEGER FK users | exists | Yes | FK check, owner role | Cross-field owner_id→users.role=owner |
| village, block, district | TEXT | 2–100 | District mandatory | trim, max 100 | Hierarchy |
| species | TEXT | cattle, buffalo, goat, sheep, etc. | Optional | LOV audit | — |

### animals
| Field | Type | Domain | Mandatory | Validation | Verification |
|---|---|---|---|---|---|
| id | INTEGER PK | >0 | Yes | safeId | — |
| animal_code | TEXT | MH-PUN-000001 pattern | Yes | unique, uppercased, pattern ^[A-Z]{2}-[A-Z]{3,}-\d{6}$ or legacy | Check-digit not applicable, but format verified |
| animal_name | TEXT | 1–100 | Optional | trim, max 100, escapeHtml | — |
| species, breed, gender | TEXT | LOV (species: cattle/buffalo/goat/sheep, gender: Male/Female) | Species mandatory | LOV + free text fallback, max 50 | Cross-field species→breed |
| age | REAL | 0–30 | Optional | number 0–30, step 0.5 | Range |
| owner_id, herd_id | INTEGER FK | exists | owner_id mandatory | FK, owner role | Referential integrity |
| owner_name, mobile, village, district | TEXT | PII | Mandatory for owner flow | trim, mobile regex, max 100 | OTP verified mobile |
| created_at | TEXT | ISO | Yes | — | — |

### cases
| Field | Type | Domain | Mandatory | Validation | Verification |
|---|---|---|---|---|---|
| id | INTEGER PK | >0 | Yes | safeId | — |
| case_no | TEXT | CASE-... | Yes | unique | — |
| animal_id | INTEGER FK | exists | Yes | FK, animal exists | Cross-field animal_id→owner_id |
| symptoms | TEXT | 5–500 | Yes | trim min 5 max 500, escapeHtml | — |
| severity | TEXT | Low, Medium, High, Critical | Yes | enum | — |
| description | TEXT | 0–1000 | Optional | max 1000, escapeHtml | — |
| status | TEXT | NEW, ASSIGNED, UNDER INVESTIGATION, SAMPLE COLLECTED, LAB PENDING, DIAGNOSED, TREATMENT, FOLLOW-UP, RECOVERED, CLOSED | Yes | enum CASE_STATUSES | State machine: NEW→ASSIGNED→...→CLOSED, no skip |
| diagnosis, treatment | TEXT | 0–1000 | Optional | max 1000 | — |
| created_at | TEXT | ISO | Yes | — | — |

### samples
| Field | Type | Domain | Mandatory | Validation | Verification |
|---|---|---|---|---|---|
| id | INTEGER PK | >0 | Yes | safeId | — |
| sample_code | TEXT | SMP-... | Yes | unique | Format verified |
| qr_token | TEXT | sqr_... | Yes | unique, prefix sqr_ | — |
| qr_payload | TEXT | PASHU:SAMPLE:... | Yes | prefix check | — |
| animal_id, case_id | INTEGER FK | exists | Yes | FK | Cross-field case.animal_id == sample.animal_id |
| sample_type | TEXT | Blood Sample, Nasal Swab, Tissue Biopsy, Milk Sample, Fecal Sample | Yes | enum | — |
| status | TEXT | COLLECTED, READY_FOR_PICKUP, PICKED_UP, IN_TRANSIT, ARRIVED_AT_LAB, LAB_RECEIVED, TESTING, RESULT_READY, COMPLETED, REJECTED | Yes | enum SAMPLE_STATUSES | State machine |
| collector_id | INTEGER FK users | exists | Yes | FK, vet/lab role | — |
| collection_lat/lng | REAL | -90–90 / -180–180 | Optional | range, or manual flag | GPS validation |
| is_manual_location | INTEGER | 0/1 | Yes | boolean | If 1, lat/lng may be manual |
| collection_notes | TEXT | 0–500 | Optional | max 500 | — |

### lab_reports, prescriptions, vaccinations, etc.
- Similar: id PK, FKs, enums, max lengths, escapeHtml for free text, safeId for ids, dates ISO, no < > in free text.

### site_feedback (GIGW Q11)
| Field | Type | Domain | Mandatory | Validation | Verification |
|---|---|---|---|---|---|
| id | INTEGER PK | >0 | Yes | safeId | — |
| reference | TEXT | FB-YYYYMMDD-XXXXXX | Yes | unique, pattern ^FB-\d{8}-[A-Z0-9]{6}$ | Lookup by reference |
| rating | INTEGER | 1–5 | Yes | int 1–5 | — |
| category | TEXT | general, login, call, report, lab, accessibility, bug | Yes | enum _ALLOWED_CATEGORIES | Fallback general |
| comments | TEXT | 10–1000 | Yes | trim min 10 max 1000, no < > script | — |
| email | TEXT | optional | No | email regex max 254 or null | — |
| page | TEXT | 0–200 | No | max 200 | — |
| user_id, role | INTEGER/TEXT | FK users / enum | No | FK if present | — |
| created_at, status | TEXT | ISO / RECEIVED, etc. | Yes | — | — |

### QR handling (GuDApps 4.5)
| Field | Type | Domain | Validation |
|---|---|---|---|
| image (base64) | TEXT | data URI or raw base64 | size 7MB b64 cap, binary 5MB, magic-byte jpeg/png/webp/gif only, malware scan hook, 400/413/415/422 safe |
| filename (if file upload) | TEXT | jpg/jpeg/png/webp/gif/pdf | safe_filename_parts double-extension block, denied exe/sh/php/js/html/svg, allow-list, path traversal stripped, empty rejected |

### CAPTCHA (GA-21)
| Field | Type | Domain | Validation |
|---|---|---|---|
| captcha_token | TEXT | provider token | env-driven provider recaptcha/hcaptcha/turnstile/test/none, secret from env SIH_CAPTCHA_SECRET_KEY, verify via provider API, honeypot website field must be empty |
| captcha_alternative | OBJECT | {challenge_token, answer} | math challenge token + int answer, TTL 300s, alternative_enabled flag, accessible text alternative |

### Auth (GA-18/19/20, C1.2k)
| Field | Type | Domain | Validation |
|---|---|---|---|
| mobile | TEXT | 10 digits | regex ^[6-9]\d{9}$, OTP request rate limit, cooldown, attempt limit, hashed OTP, expiry |
| otp | TEXT | 6 digits | digits only, 6 chars, attempt limit, expiry, registration token TTL |
| identifier, password | TEXT | email/mobile + password | email or mobile, password min 6, verify_password, progressive delay, CAPTCHA hook when enabled |
| recovery_token, deactivation | — | — | see GA-20 section: forgot password via email OTP or admin, deactivation soft-delete, preserves farmer OTP-only |

## Systematic server-side validation layer (GuDApps 4.4.1.1)

All endpoints MUST:
1. Check JSON is object (not array/null)
2. Trim strings, reject empty when mandatory
3. Enforce type, length, format, range, enum
4. Cross-field: animal→owner, case→animal, sample→case→animal, etc.
5. Escape output via escapeHtml/Attr/JsStr/safeId (XSS)
6. Return safe errors with reference id, never traceback/SQL/path/credential
7. Log category + reference only, never PII/free text/email/OTP
8. Rate limit + CAPTCHA hook where applicable
9. Audit log significant actions

Implementation: `backend/compliance_security.py` (headers, safe errors, feedback validation, upload validators, malware scan hook), `backend/captcha_service.py` (CAPTCHA hook), `backend/validation.py` (new, systematic), `backend/app.py` (per-route checks), `frontend/a11y.js` + `frontend/captcha.js` (client-side + accessible alternative).

## Verification (GuDApps 2.1.5)

- animal_code, case_no, sample_code: format regex + uniqueness + FK chain
- QR payload: prefix PASHU:ANIMAL: or PASHU:SAMPLE:
- Feedback reference: pattern FB-YYYYMMDD-XXXXXX + lookup
- OTP: hashed, expiry, attempt limit, registration token TTL, cooldown
- WebRTC: 7-state separation, routability breakdown.routable = AVAILABLE+online+socket+not busy, mediaConfirmed via inbound RTP stats

## Privacy & Security (GuDApps 2.1.1, GIGW C1.2)

- PII masked in logs, role-based access, least privilege, JWT in localStorage documented decision (C1.2e), passwords salted hash, OTP hash, no plaintext secrets in source/config/DB (secret scan), TURN credentials never returned, audit log, HSTS conditional, CSP report-only, safe errors, upload hardening, malware scan hook, CAPTCHA hook, honeypot, rate limiting.

## Open items (ORG ACTION)

- Real org values for ownership, WIM, logo asset, lastReviewed
- Security audit cert, hosting env, WAF, 180-day logs, VA/PT
- Malware scanner service (ClamAV or external URL) if SIH_MALWARE_SCAN_ENABLED=1
- CAPTCHA provider secret/site key if SIH_CAPTCHA_PROVIDER != none
- Contrast measurement needs axe-core/Lighthouse (A14/A18) — now fixed via minimal tints, but visual measurement still needs browser
