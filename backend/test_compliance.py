"""
Compliance verification tests for Pashu-Shield.

    cd backend && python test_compliance.py

These tests verify the GIGW / GuDApps / WCAG work that was added to the
application. They are **additive**: they assert new behaviour and never
weaken an existing assertion.

Coverage
  C1.2c  custom error pages; no source code / stack traces in error output
  C1.2d  hardened HTTP response headers (CSP report-only by default)
  C1.2o  server-side input validation
  Q11    feedback collected through an online form + reference number
  L07    no broken internal links advertised by the sitemap/search index
  A12    status is not conveyed by colour alone
  A27    skip link present in the static HTML
  A50    live regions present for status messages
  GuDApps 4.4   server-side validation is authoritative
  GuDApps 4.5   upload allow-list, double-extension and magic-byte defence
"""

import io
import json
import os
import re
import sys
import time
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("IVR_WEBHOOK_SECRET", "compliance-test-secret-not-a-real-credential")
os.environ.setdefault("SIH_SECRET_KEY", "compliance-test-key")
os.environ.setdefault("SIH_FEEDBACK_RATE_LIMIT", "50")   # generous for tests

import compliance_security  # noqa: E402
from app import app, make_token  # noqa: E402
import database  # noqa: E402

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


def read_frontend(name):
    return (FRONTEND / name).read_text(encoding="utf-8")


# Register a deliberately crashing route ONCE, at import time, before any
# request is handled. Flask refuses new route registration after the first
# request, so this cannot be done inside a test method.
@app.get("/api/__boom_test__")
def _boom_route():
    raise RuntimeError("secret-internal-detail-should-never-appear")


def registered_frontend_routes():
    """Every hash route the SPA actually registers.

    Routes are registered two ways: as plain string literals and as template
    literals inside role loops (``route(`#/${role}/cases`, ...)```). Both must
    be expanded, otherwise the check produces false positives.
    """
    ROLES = ("owner", "vet", "govt", "lab")
    found = set()
    for filename in ("app.js", "info-pages.js"):
        source = read_frontend(filename)
        for path in re.findall(r'\broute\(\s*"([^"]+)"', source):
            found.add(path)
        for path in re.findall(r"\broute\(\s*`([^`]+)`", source):
            if "${role}" in path:
                found.update(path.replace("${role}", r) for r in ROLES)
            else:
                found.add(path)
    return found


# --------------------------------------------------------------------------
class SecurityHeadersTest(unittest.TestCase):
    """GIGW 3.0 C1.2d — HTTP response headers."""

    def setUp(self):
        self.client = app.test_client()

    def test_01_core_security_headers_are_present(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        for header in ("X-Content-Type-Options", "X-Frame-Options",
                       "Referrer-Policy", "Permissions-Policy",
                       "Cross-Origin-Opener-Policy"):
            self.assertIn(header, r.headers, f"missing header {header}")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")

    def test_02_permissions_policy_still_allows_webrtc_media(self):
        """Hardening must not break the microphone/camera used by WebRTC."""
        policy = self.client.get("/api/health").headers["Permissions-Policy"]
        self.assertIn("microphone=(self)", policy)
        self.assertIn("camera=(self)", policy)

    def test_03_csp_is_report_only_by_default(self):
        """A strict CSP would break Leaflet/Socket.IO/inline handlers, so the
        default must be report-only (GIGW: progressive enforcement)."""
        r = self.client.get("/api/health")
        self.assertIn("Content-Security-Policy-Report-Only", r.headers)
        self.assertNotIn("Content-Security-Policy", r.headers)

    def test_04_csp_report_only_allows_the_resources_the_app_actually_uses(self):
        policy = self.client.get("/api/health").headers["Content-Security-Policy-Report-Only"]
        # Leaflet is loaded from unpkg in index.html.
        self.assertIn("https://unpkg.com", policy)
        # WebSocket signalling must remain reachable.
        self.assertTrue(("ws:" in policy) or ("wss:" in policy))
        self.assertIn("connect-src", policy)
        self.assertIn("report-uri", policy)

    def test_05_server_header_is_not_advertised(self):
        r = self.client.get("/api/health")
        self.assertNotIn("Server", r.headers)

    def test_06_hsts_only_when_the_request_is_secure(self):
        """Plain-HTTP local development must not be bricked by HSTS."""
        plain = self.client.get("/api/health")
        self.assertNotIn("Strict-Transport-Security", plain.headers)
        secure = self.client.get("/api/health", base_url="https://localhost")
        self.assertIn("Strict-Transport-Security", secure.headers)
        self.assertIn("max-age=", secure.headers["Strict-Transport-Security"])


# --------------------------------------------------------------------------
class SafeErrorHandlingTest(unittest.TestCase):
    """GIGW 3.0 C1.2c / programme §26 — never expose internals."""

    def setUp(self):
        self.client = app.test_client()

    def test_10_api_404_returns_json_without_a_stack_trace(self):
        r = self.client.get("/api/definitely-not-a-real-endpoint")
        self.assertEqual(r.status_code, 404)
        body = r.get_data(as_text=True)
        data = json.loads(body)
        self.assertEqual(data["status"], 404)
        self.assertIn("error", data)
        for leak in ("Traceback", "File \"", "sqlite3", "/home/", "C:\\"):
            self.assertNotIn(leak, body, f"error response leaked: {leak}")

    def test_11_html_404_renders_a_usable_page(self):
        r = self.client.get("/not-a-real-page")
        self.assertEqual(r.status_code, 404)
        html = r.get_data(as_text=True)
        self.assertIn("Page not found", html)
        self.assertIn('role="alert"', html)
        self.assertIn('href="/"', html)
        for leak in ("Traceback", "Werkzeug", "sqlite3"):
            self.assertNotIn(leak, html)

    def test_12_unhandled_exception_is_contained(self):
        """A crashing route must give a safe 500 with a correlation reference.

        The crashing route is registered at import time (see module level),
        because Flask forbids new registrations after the first request.
        """
        r = self.client.get("/api/__boom_test__")
        self.assertEqual(r.status_code, 500)
        body = r.get_data(as_text=True)
        self.assertNotIn("secret-internal-detail-should-never-appear", body)
        self.assertNotIn("Traceback", body)
        self.assertNotIn("RuntimeError", body)
        self.assertIn("reference", json.loads(body))

    def test_13_error_reference_is_unique_per_error(self):
        a = self.client.get("/api/nope-a").get_json()
        b = self.client.get("/api/nope-b").get_json()
        self.assertNotEqual(a.get("reference"), b.get("reference"))

    def test_14_every_programme_status_has_a_handler(self):
        for code in (400, 401, 403, 404, 405, 408, 409, 429, 500, 502, 503):
            self.assertIn(code, app.error_handler_spec.get(None, {}) or
                          app.error_handler_spec.get(app.name, {}) or {},
                          f"no error handler registered for {code}")


# --------------------------------------------------------------------------
class FeedbackValidationTest(unittest.TestCase):
    """GuDApps 4.4.1.1 — server-side validation is authoritative."""

    def test_20_rating_must_be_one_to_five(self):
        for bad in (0, 6, -1, "x", None):
            clean, errors = compliance_security.validate_feedback(
                {"rating": bad, "comments": "This is long enough."})
            self.assertIsNone(clean, f"rating {bad!r} should be rejected")
            self.assertTrue(any(e["field"] == "rating" for e in errors))

    def test_21_comments_length_is_enforced(self):
        clean, errors = compliance_security.validate_feedback(
            {"rating": 5, "comments": "short"})
        self.assertIsNone(clean)
        clean, errors = compliance_security.validate_feedback(
            {"rating": 5, "comments": "x" * 1001})
        self.assertIsNone(clean)

    def test_22_valid_payload_is_accepted_and_normalised(self):
        clean, errors = compliance_security.validate_feedback({
            "rating": "4", "comments": "  The vet call worked well.  ",
            "category": "call", "email": " Farmer@Example.COM ",
        })
        self.assertEqual(errors, [])
        self.assertEqual(clean["rating"], 4, "rating coerced to int")
        self.assertEqual(clean["comments"], "The vet call worked well.", "trimmed")
        self.assertEqual(clean["category"], "call")

    def test_23_email_is_optional_but_must_be_valid_when_present(self):
        clean, _ = compliance_security.validate_feedback(
            {"rating": 5, "comments": "Good service overall."})
        self.assertIsNone(clean["email"])
        clean, errors = compliance_security.validate_feedback(
            {"rating": 5, "comments": "Good service overall.", "email": "not-an-email"})
        self.assertIsNone(clean)
        self.assertTrue(any(e["field"] == "email" for e in errors))

    def test_24_unknown_category_falls_back_safely(self):
        clean, _ = compliance_security.validate_feedback(
            {"rating": 3, "comments": "Neutral experience here.", "category": "<script>"})
        self.assertEqual(clean["category"], "general")

    def test_25_non_dict_payload_is_rejected(self):
        clean, errors = compliance_security.validate_feedback("not a dict")
        self.assertIsNone(clean)
        self.assertTrue(errors)


# --------------------------------------------------------------------------
class FeedbackApiTest(unittest.TestCase):
    """GIGW 3.0 Q11 — online feedback form + acknowledgement/reference."""

    def setUp(self):
        self.client = app.test_client()

    def test_30_submission_returns_a_reference_number(self):
        r = self.client.post("/api/feedback", json={
            "rating": 5, "category": "general",
            "comments": "The dashboard is easy to use on my phone.",
        })
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        data = r.get_json()
        self.assertTrue(data["reference"].startswith("FB-"))
        self.assertEqual(data["status"], "RECEIVED")

    def test_31_reference_can_be_tracked(self):
        ref = self.client.post("/api/feedback", json={
            "rating": 4, "comments": "Tracking test for reference lookup.",
        }).get_json()["reference"]
        r = self.client.get(f"/api/feedback/{ref}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["reference"], ref)
        self.assertEqual(r.get_json()["status"], "RECEIVED")

    def test_32_unknown_reference_returns_404(self):
        r = self.client.get("/api/feedback/FB-19700101-NOPE0")
        self.assertEqual(r.status_code, 404)

    def test_33_invalid_submission_returns_field_errors(self):
        r = self.client.post("/api/feedback", json={"rating": 99, "comments": "x"})
        self.assertEqual(r.status_code, 422)
        fields = r.get_json()["fields"]
        self.assertTrue(any(f["field"] == "rating" for f in fields))
        self.assertTrue(any(f["field"] == "comments" for f in fields))

    def test_34_rate_limit_is_enforced(self):
        """GIGW C1.2k — brute-force / abuse protection."""
        key = f"test:{uuid.uuid4().hex}"
        compliance_security.FEEDBACK_RATE[key] = [
            time.time() for _ in range(compliance_security.FEEDBACK_RATE_LIMIT)
        ]
        self.assertFalse(compliance_security.rate_limit_feedback(key))
        compliance_security.FEEDBACK_RATE.pop(key, None)

    def test_35_feedback_never_logs_free_text_or_email(self):
        """Programme §24 — personal data minimisation in logs."""
        secret_marker = f"SECRET-{uuid.uuid4().hex}"
        with self.assertLogs("compliance_security", level="INFO") as captured:
            self.client.post("/api/feedback", json={
                "rating": 3, "category": "general",
                "comments": f"my private note {secret_marker}",
                "email": f"{secret_marker}@example.com",
            })
        joined = "\n".join(captured.output)
        self.assertNotIn(secret_marker, joined)


# --------------------------------------------------------------------------
class UploadSecurityTest(unittest.TestCase):
    """GuDApps 4.5.1.2 / 4.5.1.3 / 4.5.1.4 — upload defences."""

    def test_40_executable_extensions_are_rejected(self):
        for name in ("x.exe", "x.sh", "x.php", "x.js", "x.html", "x.svg"):
            _, _, reason = compliance_security.safe_filename_parts(name)
            self.assertIsNotNone(reason, f"{name} should be rejected")

    def test_41_double_extensions_are_rejected(self):
        for name in ("report.pdf.exe", "photo.png.php", "scan.jpg.js"):
            _, _, reason = compliance_security.safe_filename_parts(name)
            self.assertIsNotNone(reason, f"{name} should be rejected")

    def test_42_multiple_allowed_extensions_are_rejected(self):
        _, _, reason = compliance_security.safe_filename_parts("image.png.pdf")
        self.assertIsNotNone(reason)

    def test_43_path_traversal_is_stripped(self):
        stem, ext, reason = compliance_security.safe_filename_parts(
            "../../../../etc/passwd.png")
        self.assertIsNone(reason)
        self.assertEqual(ext, "png")
        self.assertEqual(stem, "passwd", "directory part removed")

    def test_44_extension_allow_list_is_enforced(self):
        _, _, reason = compliance_security.safe_filename_parts("data.txt")
        self.assertIsNotNone(reason)
        for name in ("a.jpg", "a.jpeg", "a.png", "a.webp", "a.gif", "a.pdf"):
            _, _, reason = compliance_security.safe_filename_parts(name)
            self.assertIsNone(reason, f"{name} should be allowed")

    def test_45_empty_and_degenerate_names_are_rejected(self):
        for name in ("", "   ", ".", "..", ".png", "noext"):
            _, _, reason = compliance_security.safe_filename_parts(name)
            self.assertIsNotNone(reason, f"{name!r} should be rejected")

    def _storage(self, data):
        class S:
            stream = io.BytesIO(data)
        return S()

    def test_46_magic_bytes_are_checked_not_just_the_client_mime(self):
        # Claims to be a PNG but is actually a shell script.
        fake = self._storage(b"#!/bin/sh\nrm -rf /\n")
        ok, reason = compliance_security.validate_upload(fake, "evil.png", "image/png")
        self.assertFalse(ok)
        self.assertIsNotNone(reason)

    def test_47_genuine_png_is_accepted(self):
        png = self._storage(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        ok, reason = compliance_security.validate_upload(png, "scan.png", "image/png")
        self.assertTrue(ok, reason)

    def test_48_genuine_pdf_is_accepted(self):
        pdf = self._storage(b"%PDF-1.4\n" + b"%" * 64)
        ok, reason = compliance_security.validate_upload(pdf, "report.pdf", "application/pdf")
        self.assertTrue(ok, reason)

    def test_49_oversized_files_are_rejected(self):
        big = self._storage(b"\x89PNG\r\n\x1a\n" + b"\x00" * (1024 * 1024))
        ok, reason = compliance_security.validate_upload(big, "big.png", "image/png",
                                                         max_bytes=1024)
        self.assertFalse(ok)
        self.assertIn("limit", reason)

    def test_50_empty_files_are_rejected(self):
        ok, reason = compliance_security.validate_upload(
            self._storage(b""), "empty.png", "image/png")
        self.assertFalse(ok)


# --------------------------------------------------------------------------
class FrontendComplianceTest(unittest.TestCase):
    """Static assertions on the shipped frontend markup."""

    def test_60_skip_link_is_the_first_focusable_element(self):
        html = read_frontend("index.html")
        match = re.search(r"<body>(.*?)</body>", html, re.S)
        self.assertIsNotNone(match)
        body = match.group(1)
        first_link = re.search(r"<a\s[^>]*>", body)
        self.assertIsNotNone(first_link, "no anchor found in body")
        self.assertIn("pm-skip-link", first_link.group(0))
        self.assertIn('href="#main-content"', first_link.group(0))

    def test_61_live_regions_exist_in_the_initial_html(self):
        """Live regions created later are not reliably announced (WCAG 4.1.3)."""
        html = read_frontend("index.html")
        self.assertIn('id="pmLivePolite"', html)
        self.assertIn('role="status"', html)
        self.assertIn('aria-live="polite"', html)
        self.assertIn('id="pmLiveAssertive"', html)
        self.assertIn('role="alert"', html)
        self.assertIn('aria-live="assertive"', html)

    def test_62_landmarks_are_present(self):
        html = read_frontend("index.html")
        shell = read_frontend("shell.js")
        self.assertIn("<main", html)
        self.assertIn('id="main-content"', html)
        # banner/contentinfo landmarks are emitted by the global shell.
        self.assertIn('id="site-header"', shell)
        self.assertIn('role="banner"', shell)
        self.assertIn('id="site-footer"', shell)
        self.assertIn('role="contentinfo"', shell)

    def test_63_lang_and_metadata_are_declared(self):
        html = read_frontend("index.html")
        # lang must be declared on <html> (other attributes, e.g. the DBIM
        # data-dbim-theme switch, may legitimately sit alongside it).
        self.assertIsNotNone(re.search(r'<html[^>]*\blang="en"', html))
        self.assertIn('name="description"', html)
        self.assertIn('rel="canonical"', html)
        # DBIM Phase 1: the single-token theme switch must name a real group.
        theme = re.search(r'data-dbim-theme="([a-z-]+)"', html)
        self.assertIsNotNone(theme)
        self.assertIn(theme.group(1),
                        ["green", "blue", "burgundy", "purple",
                         "chrome-yellow", "cinnamon-red"])

    def test_64_viewport_does_not_block_zoom(self):
        """WCAG 1.4.4 — user zoom must not be disabled."""
        html = read_frontend("index.html")
        vp = re.search(r'<meta name="viewport" content="([^"]+)"', html)
        self.assertIsNotNone(vp)
        self.assertNotIn("user-scalable=no", vp.group(1))
        self.assertNotIn("maximum-scale=1", vp.group(1))

    def test_65_manifest_does_not_lock_orientation(self):
        """WCAG 1.3.4 — orientation must not be restricted."""
        manifest = json.loads(read_frontend("manifest.json"))
        self.assertNotIn("orientation", manifest,
                         "manifest still locks display orientation")

    def test_66_external_links_use_noopener_noreferrer(self):
        """Programme §41 — safe target=_blank."""
        shell = read_frontend("shell.js")
        self.assertIn('rel="noopener noreferrer"', shell)
        self.assertIn("opens in a new window", shell)

    def test_67_high_contrast_does_not_change_the_default_theme(self):
        """Exemption 4.3 — brand colours preserved when high contrast is off."""
        css = read_frontend("style.css")
        # The original brand palette is intact.
        for token, value in (("--primary:#3d4db8", None), ("--primary-dark:#2c3690", None),
                             ("--bg:#eef0f6", None), ("--green:#1fa971", None),
                             ("--red:#e2483f", None)):
            self.assertIn(token, css, f"brand token altered: {token}")
        # High contrast is scoped to an opt-in class only.
        self.assertIn("html.pm-high-contrast{", css)

    def test_68_font_family_is_unchanged(self):
        """Exemption 4.2 — the existing font stack must not be replaced."""
        css = read_frontend("style.css")
        self.assertIn("-apple-system,BlinkMacSystemFont", css)
        self.assertIn('"Segoe UI"', css)

    def test_69_reduced_motion_is_respected(self):
        css = read_frontend("style.css")
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn("html.pm-reduced-motion", css)

    def test_70_focus_is_visible(self):
        css = read_frontend("style.css")
        self.assertIn(":focus-visible", css)
        self.assertIn("--pm-focus", css)
        # The old rule that removed the outline without replacement must be gone.
        self.assertNotIn(
            ".field input:focus, .field select:focus, .field textarea:focus{outline:none;border-color",
            css)

    def test_71_print_stylesheet_exists_and_hides_navigation(self):
        css = read_frontend("style.css")
        self.assertIn("@media print{", css)
        print_block = css[css.index("@media print{"):]
        self.assertIn(".bottom-nav", print_block)
        self.assertIn("@page", print_block)
        self.assertIn("size:A4", print_block)

    def test_72_info_pages_are_registered(self):
        js = read_frontend("info-pages.js")
        for route in ("#/about", "#/contact", "#/feedback", "#/help",
                      "#/sitemap", "#/search", "#/policies"):
            self.assertIn(f'route("{route}"', js, f"route {route} not registered")

    def test_73_info_routes_are_reachable_without_login(self):
        app_js = read_frontend("app.js")
        self.assertIn("PUBLIC_INFO_ROUTES", app_js)
        for route in ("#/about", "#/contact", "#/feedback", "#/help",
                      "#/sitemap", "#/search", "#/policies"):
            self.assertIn(f'"{route}"', app_js)

    def test_74_sitemap_and_search_reference_only_real_routes(self):
        """GIGW L07 — never advertise a link that does not exist."""
        registered = registered_frontend_routes()
        info = read_frontend("info-pages.js")
        indexed = set(re.findall(r'href: "(#[^"]+)"', info))
        # Parameterised entries such as "#/owner/herds/:id" are indexed only by
        # their static prefix in the sitemap, so compare on the first two
        # segments for those.
        missing = sorted(
            h for h in indexed
            if h not in registered
            and not any(r.split("/:")[0] == h for r in registered if "/:" in r)
        )
        self.assertEqual([], missing, f"index references unregistered routes: {missing}")

    def test_75_no_owner_information_is_invented(self):
        cfg = read_frontend("org-config.js")
        self.assertIn("[OWNER ACTION:", cfg)
        self.assertIn("OWNER_DETAILS_APPROVED = false", cfg)
        # GIGW Q01 — the State Emblem may not be used without authorisation.
        # What matters is that no emblem/logo ASSET is wired up, not that the
        # word is absent from explanatory comments.
        self.assertIn('src: ""', cfg, "no emblem/logo asset may be wired up yet")
        # Every owner-dependent field must still be a marked placeholder.
        for field in ("name", "address", "email", "phone"):
            self.assertIn(f'{field}: "[OWNER ACTION:', cfg,
                          f"owner field '{field}' is no longer a placeholder")
        # Integration status must be reported honestly, never as live.
        for claimed in ('status: "configured"',):   # NB: trailing comma -> tuple
            self.assertNotIn(claimed, cfg,
                             "an integration is claimed as configured")


# --------------------------------------------------------------------------
class ZeroRegressionTest(unittest.TestCase):
    """Confirm the sacred features still exist after the compliance changes."""

    def test_80_all_original_api_routes_still_exist(self):
        rules = {r.rule for r in app.url_map.iter_rules()}
        for required in ("/api/health", "/api/auth/login",
                         "/api/auth/farmer/request-otp",
                         "/api/auth/farmer/verify-otp",
                         "/api/auth/farmer/resend-otp",
                         "/api/webcall/config", "/api/webcall/presence",
                         "/api/webcall/calls", "/api/webcall/calls/current",
                         "/api/webcall/calls/history",
                         "/api/ivr/calls/inbound", "/api/ivr/report",
                         "/api/govt/ai/predict", "/api/govt/export",
                         "/api/lab/queue", "/api/samples", "/api/cases",
                         "/api/animals", "/api/herds", "/api/push/vapid-key",
                         "/api/sync/queue", "/api/notifications"):
            self.assertIn(required, rules, f"route disappeared: {required}")

    def test_81_farmer_login_is_still_otp_only(self):
        """The farmer password route must never come back."""
        rules = {r.rule for r in app.url_map.iter_rules()}
        self.assertNotIn("/api/auth/farmer/login", rules)
        self.assertIn("/api/auth/farmer/request-otp", rules)

    def test_82_turn_credentials_are_never_returned_to_the_client(self):
        conn = database.get_db()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE role='vet' LIMIT 1").fetchone()
            self.assertIsNotNone(row, "no seeded vet account to test with")
            token = make_token(dict(row))
        finally:
            conn.close()
        r = app.test_client().get(
            "/api/webcall/config", headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 200:
            body = r.get_data(as_text=True)
            for secret_env in ("SIH_TURN_CREDENTIAL", "SIH_TURN_USERNAME"):
                value = os.environ.get(secret_env)
                if value and len(value) > 6:
                    self.assertNotIn(value, body, f"{secret_env} leaked to the client")

    def test_83_service_worker_cache_is_versioned(self):
        """The new files must be served, not shadowed by a stale cache."""
        sw = read_frontend("sw.js")
        self.assertTrue(re.search(r"CACHE[^=]*=\s*[\"'][^\"']+[\"']", sw),
                        "service worker cache name not found")


if __name__ == "__main__":
    unittest.main(verbosity=2)
