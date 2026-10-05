# Pashu-Shield — Security Notes

**Date:** 2026-10-05 · **Branch:** `arena/01a10b85-pashu-shield-updated`
**Refs:** GIGW 3.0 §Cybersecurity (C1–C3), GuDApps §3 (Authentication), programme §7, §22–§26

---

## 1. Secret handling — scan result

**A repository-wide scan found no hard-coded production credentials.**

Pattern searched: `SECRET|secret|_KEY|api_key|password|token|credential|TURN_` across
`.py .js .html .json .yaml .yml`, excluding `node_modules`, `vendor`, minified bundles and
`frontend/models`.

| Finding | Verdict |
|---|---|
| `SIH_SECRET_KEY` read from env with an ephemeral fallback + warning (`app.py:63`) | ✅ Good practice |
| Demo seed users with `password123` (`database.py:1438`) | ⚠ Seed data — **must not reach production** → owner O-41 |
| Test fixtures (`sk_test_dummy`, `metered-pass`, `turn-pass-secret`) | ✅ Correct — tests only |
| `PEPPER_SOURCE_FALLBACK = "SIH_SECRET_KEY"` | ✅ An env-var **name**, not a value |

`.gitignore` already excludes `.env`, `.env.*` (keeping `!.env.example`) and `*.db-wal`.

**No secret was printed, echoed or committed at any point in this work.**

---

## 2. Controls already present (verified, preserved)

| Control | Evidence |
|---|---|
| Role-based access control with least privilege | `@auth_required(roles=[...])` + route-level `roles[]`; **30 role-auth tests pass** |
| Passwords stored as salted hash, never plaintext | `users.password_hash` + `users.salt` |
| OTP hashed with per-code salt; expiring; attempt-limited; single-use | `otp_codes.otp_hash` / `otp_salt` / `attempts` / `max_attempts` / `expires_at` |
| Audit logging | `audit_log()` + `/api/audit-logs` + `audit_events` table |
| IVR webhook HMAC authentication | `ivr_security.ivr_webhook_required` |
| Socket.IO handshake requires a valid JWT | `test_webcalling` tests 50–51 |
| SMS gateway diagnostics are secret-free by design | `test_farmer_otp_login` tests G14–G16 |
| No directory listing / no default admin pages | Flask static serving |

---

## 3. Controls added in this round

| # | Control | Implementation | Verified |
|---|---|---|---|
| S-1 | Security response headers | `compliance_security.install_headers` — `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS (secure requests only) | ✅ `test_01`–`test_06`, live |
| S-2 | Content-Security-Policy — **report-only** | `SIH_CSP_ENFORCE=1` to enforce | ✅ `test_03`, `test_04` |
| S-3 | Safe error handling for 11 statuses + catch-all | `install_error_handlers`; JSON for `/api/*`, HTML otherwise; correlation id | ✅ `test_10`–`test_14`, live |
| S-4 | Server-side feedback validation | `validate_feedback` — never trusts the client | ✅ `test_20`–`test_25` |
| S-5 | Feedback rate limiting | In-memory, per user/IP, windowed | ✅ `test_34` |
| S-6 | Upload hardening helpers | Extension allow-list, double-extension and multi-extension rejection, path-traversal stripping, size cap, **magic-byte sniffing**, MIME-mismatch rejection | ✅ `test_40`–`test_50` |
| S-7 | Privacy in logs | Feedback free text and email are **never** logged | ✅ `test_35` |

---

## 4. Documented decision: JWT stored in `localStorage`, not cookies

**Guideline:** GIGW C1.2e — "Cookies should be secure and HTTP only."

**Decision: NOT changed. The current `localStorage` token storage is preserved.**

**Rationale (zero-regression rule, programme §23):**
1. Pashu-Shield issues a JWT that the SPA attaches as `Authorization: Bearer …`.
2. The **Socket.IO handshake** for WebRTC signalling also carries that token. Moving to
   cookies would change the signalling authentication path — the single highest-risk
   integration in the product.
3. Migrating token storage would change the farmer OTP flow and all three staff login
   flows simultaneously.
4. Programme §23 states: *"Do not introduce a second authentication architecture
   unnecessarily."*

**Risk accepted and mitigated:**
- `localStorage` tokens are readable by JavaScript, so **XSS is the residual risk**.
- Mitigations already in place: Flask escapes output; the SPA builds HTML strings, so
  user-supplied content must be escaped on insert (**open work — see §6**).
- The CSP (once enforced) is the primary structural defence against injected scripts.

**Recommendation to the owner:** after XSS-hardening and CSP enforcement are verified,
revisit migration to `HttpOnly; Secure; SameSite=Strict` cookies **with** an explicit
Socket.IO `auth` transport, as a separate, independently-tested change.

---

## 5. Documented decision: CSP is report-only by default

Enforcing CSP today would break the application, because it legitimately depends on:

| Dependency | Why it needs the policy relaxed |
|---|---|
| **Leaflet from `unpkg.com`** | Loaded via `<script>`/`<link>` in `index.html` |
| **Vendored Socket.IO client** | Local, but uses `eval`-style transports |
| **Inline `onclick="…"` handlers** | Used extensively throughout `app.js` |
| **Inline `<script>` for SW registration** | In `index.html` |
| **WebRTC `blob:` / `mediastream:`** | Media and workers |
| **WASM workers** (Whisper) | `worker-src blob:` |

**Plan:** keep report-only → collect violations at `/api/security/csp-report` → refactor
inline handlers to delegated listeners → then set `SIH_CSP_ENFORCE=1`.

---

## 6. Known open security work (honest status)

| # | Item | Risk | Ref |
|---|---|---|---|
| W-1 | **Systematic server-side validation across all existing endpoints** (currently partial) | Medium | GA-29, GA-31, C1.2o |
| W-2 | **Output escaping audit** across the SPA's HTML-string rendering | **High** — XSS is the main residual risk given §4 | C1.2o |
| W-3 | Wire the new upload validators into the existing QR-upload route | Medium | GA-33, GA-34 |
| W-4 | CAPTCHA on staff login (feature-flagged adapter) | Medium | C1.2f, GA-21 |
| W-5 | Account lockout / progressive delay on staff login | Medium | C1.2k, GA-22 |
| W-6 | Malware-scanning hook for uploads | Medium | GA-34 |
| W-7 | Store uploads outside the public web root | Medium | GA-34 |
| W-8 | Dependency audit in CI (`pip-audit`) | Low | C1.2a |
| W-9 | Session idle timeout with warning + extend | Medium | A24 (2.2.1), programme §23 |
| W-10 | Server banner suppression at the proxy/CDN (Gunicorn re-adds it) | Low | C1.2d, O-43 |

**Explicitly NOT done, because it is not application code:** security audit certificate,
"safe to host" certificate, STQC/CQW certification, hosting-environment hardening,
VA/PT, DR drills. See `04-needs-owner-input.md` §1.

---

## 7. What the application must never do

Assertions enforced by the new test suite:

- Never return a stack trace, SQL text, filesystem path or credential in an HTTP response (`test_10`–`test_12`).
- Never return TURN credentials to the client (`test_82`).
- Never log an OTP, an OTP token, or a full phone number (existing `test_demo_account` test 27).
- Never log feedback free text or email (`test_35`).
- Never claim a government integration is live when it is not (`test_75`).
- Never accept an upload whose *content* contradicts its declared type (`test_46`).

---

## 8. Reporting a vulnerability

Use the **Feedback** page (`#/feedback`) choosing the closest category, or the
**Contact Us** page for anything sensitive. The organisation must publish a formal
security contact and incident channel — owner action.
