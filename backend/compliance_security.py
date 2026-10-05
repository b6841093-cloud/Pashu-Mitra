"""Pashu-Shield — application-side security, error handling and upload hardening.

GIGW 3.0 Cybersecurity (C1.2*) and GuDApps (4.4 validation, 4.5 upload security).

DESIGN RULES OBSERVED
---------------------
* **Additive only.** Nothing here changes an existing route, response contract,
  authentication mechanism or database column. `install(app)` registers
  response headers and error handlers; both are additive Flask hooks.
* **No silent breakage.** A strict Content-Security-Policy would break the
  existing Leaflet CDN, vendored Socket.IO client and the SPA's inline
  `onclick` handlers. CSP is therefore **report-only by default** and is only
  enforced when `SIH_CSP_ENFORCE=1` is set, after an operator has verified it.
* **No stack traces, ever.** Every error handler returns a safe body.
* **Secrets are never printed.** Logging reports a category and a correlation
  id, not request bodies or credentials.
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
import time
import uuid
from functools import wraps

from flask import Response, g, jsonify, request

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Configuration (all environment driven; nothing is hard-coded)
# --------------------------------------------------------------------------

def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


HSTS_MAX_AGE = int(os.environ.get("SIH_HSTS_MAX_AGE", "31536000"))          # 1 year
CSP_ENFORCE = _flag("SIH_CSP_ENFORCE", False)                              # report-only default
CSP_REPORT_URI = os.environ.get("SIH_CSP_REPORT_URI", "/api/security/csp-report")

# Upload hardening (GuDApps 4.5.1.2 / 4.5.1.3 / 4.5.1.4)
UPLOAD_MAX_BYTES = int(os.environ.get("SIH_UPLOAD_MAX_BYTES", str(5 * 1024 * 1024)))  # 5 MB
UPLOAD_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "pdf"}
UPLOAD_ALLOWED_MIME = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
}
# Extensions that must never be accepted even inside a double extension.
UPLOAD_DENIED_EXTENSIONS = {
    "exe", "sh", "bat", "cmd", "com", "dll", "js", "mjs", "vbs", "ps1", "psm1",
    "jar", "py", "php", "phtml", "php3", "php4", "php5", "pl", "rb", "cgi",
    "htaccess", "htpasswd", "ini", "svg", "html", "htm", "xhtml",
}

# Rate limiting for the feedback endpoint (GuDApps 3.5 / GIGW C1.2k)
FEEDBACK_RATE_LIMIT = int(os.environ.get("SIH_FEEDBACK_RATE_LIMIT", "5"))    # submissions
FEEDBACK_RATE_WINDOW = int(os.environ.get("SIH_FEEDBACK_RATE_WINDOW", "600"))  # per 10 min

_FEEDBACK_RATE: dict[str, list[float]] = {}

# Public alias so the in-memory limiter can be inspected/repopulated by tests
# and by operators. It is intentionally the same object, not a copy.
FEEDBACK_RATE = _FEEDBACK_RATE


# --------------------------------------------------------------------------
# Security response headers
# --------------------------------------------------------------------------

def _csp_directives() -> str:
    """Build the Content-Security-Policy.

    The policy deliberately allows what the application genuinely needs today
    (Leaflet from unpkg, its own origin, WebSocket/Socket.IO, inline handlers
    during the report-only phase). Tighten it only after verifying a full
    regression run with `SIH_CSP_ENFORCE=1`.
    """
    connect = "'self'"
    socket_path = os.environ.get("SIH_SOCKET_PATH", "/socket.io")
    # Socket.IO may be served from the same origin or a configured public URL.
    socket_public = os.environ.get("SIH_SOCKET_PUBLIC_URL", "")
    if socket_public:
        connect += " " + socket_public

    return (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com; "
        "style-src 'self' 'unsafe-inline' https://unpkg.com; "
        "img-src 'self' data: blob: https://unpkg.com https://*.tile.openstreetmap.org; "
        f"connect-src {connect} https://unpkg.com wss: ws:; "
        "font-src 'self' data:; "
        "media-src 'self' blob: mediastream:; "
        "worker-src 'self' blob:; "
        "frame-ancestors 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        f"report-uri {CSP_REPORT_URI};"
    )


def install_headers(app):
    """Add security headers to every response."""

    @app.after_request
    def _security_headers(resp: Response):
        # GIGW C1.2d — harden HTTP response headers.
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        resp.headers.setdefault(
            "Permissions-Policy",
            "microphone=(self), camera=(self), geolocation=(self)",
        )
        resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")

        # HSTS is only meaningful over HTTPS; set it only on a secure request so
        # local HTTP development is not broken by an un-clearable policy.
        if request.is_secure or _flag("SIH_HSTS_ALWAYS", False):
            resp.headers.setdefault(
                "Strict-Transport-Security",
                f"max-age={HSTS_MAX_AGE}; includeSubDomains",
            )

        # CSP: report-only until an operator has verified enforcement.
        policy = _csp_directives()
        header = "Content-Security-Policy" if CSP_ENFORCE else "Content-Security-Policy-Report-Only"
        resp.headers[header] = policy

        # Never advertise the server stack (GIGW C1.2d "obscure banners").
        resp.headers.pop("Server", None)
        return resp

    return app


# --------------------------------------------------------------------------
# Safe error handling  (GIGW C1.2c / programme §26)
# --------------------------------------------------------------------------

_ERROR_COPY = {
    400: ("Bad request", "The request could not be understood. Check the details and try again."),
    401: ("Sign in required", "You need to sign in to do that."),
    403: ("Not allowed", "You do not have permission to do that."),
    404: ("Page not found", "We could not find that page or record."),
    405: ("Method not allowed", "That action is not supported here."),
    408: ("Request timed out", "The request took too long. Please try again."),
    409: ("Conflict", "That change conflicts with the current record. Refresh and try again."),
    413: ("File too large", "The file is larger than the allowed limit."),
    415: ("Unsupported file type", "That file type is not accepted."),
    422: ("Could not process", "Some of the information provided could not be processed."),
    429: ("Too many requests", "You have done that too often. Please wait and try again."),
    500: ("Something went wrong", "An unexpected error occurred. Please try again."),
    502: ("Upstream error", "A dependent service did not respond correctly."),
    503: ("Service unavailable", "The service is temporarily unavailable. Please try again shortly."),
}

_API_PREFIX = "/api/"


def _is_api() -> bool:
    return request.path.startswith(_API_PREFIX)


def _error_body(status: int, detail: str | None = None):
    title, message = _ERROR_COPY.get(status, ("Error", "An error occurred."))
    body = {
        "error": message,
        "title": title,
        "status": status,
    }
    # A short, safe, human-readable hint may be surfaced, but never a stack
    # trace, SQL text, filesystem path or credential.
    if detail:
        body["detail"] = detail
    # Correlation id lets a user quote an error without us exposing internals.
    body["reference"] = getattr(g, "error_reference", None)
    return body


def _html_error_page(status: int, detail: str | None = None) -> Response:
    title, message = _ERROR_COPY.get(status, ("Error", "An error occurred."))
    reference = getattr(g, "error_reference", "")
    safe_title = title.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    safe_message = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    safe_detail = ""
    if detail:
        safe_detail = (
            '<p class="pm-state-body">'
            + detail.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            + "</p>"
        )
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{status} — {safe_title} — Pashu-Shield</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
  <a class="pm-skip-link" href="#main-content">Skip to main content</a>
  <main id="main-content" tabindex="-1">
    <div class="pm-state pm-state-error" style="margin-top:48px">
      <p class="pm-state-title" role="alert">Error — {status}: {safe_title}</p>
      <p class="pm-state-body">{safe_message}</p>
      {safe_detail}
      <p class="pm-state-body" style="margin-top:14px">
        <a class="link" href="/">Go to the home page</a> ·
        <a class="link" href="/#/help">Help</a> ·
        <a class="link" href="/#/contact">Contact Us</a>
      </p>
      <p class="pm-state-body" style="opacity:.8">Reference: {reference}</p>
    </div>
  </main>
</body>
</html>"""
    return Response(html, status=status, mimetype="text/html")


def install_error_handlers(app):
    """Register safe handlers for every status the programme enumerates."""

    def _make(code, detail=None):
        def handler(err):
            # Correlation id for support, without leaking internals.
            g.error_reference = uuid.uuid4().hex[:12]
            # Log category + id only. Never the exception text (may contain SQL,
            # paths or credentials) at anything above DEBUG.
            if code >= 500:
                log.error("http_error status=%s reference=%s path=%s",
                          code, g.error_reference, request.path)
            else:
                log.info("http_error status=%s reference=%s path=%s",
                         code, g.error_reference, request.path)
            if _is_api():
                return jsonify(_error_body(code, detail)), code
            return _html_error_page(code, detail)
        return handler

    for code, (_, _) in _ERROR_COPY.items():
        app.register_error_handler(code, _make(code))

    @app.errorhandler(Exception)
    def _unhandled(err):  # pragma: no cover - exercised by real failures
        g.error_reference = uuid.uuid4().hex[:12]
        # Full detail stays in the server log; the client gets only a reference.
        log.exception("unhandled_exception reference=%s path=%s",
                      g.error_reference, request.path)
        if _is_api():
            return jsonify(_error_body(500)), 500
        return _html_error_page(500)

    return app


# --------------------------------------------------------------------------
# Feedback endpoint  (GIGW Q11 — feedback collected through an online form)
# --------------------------------------------------------------------------

FEEDBACK_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS site_feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    reference     TEXT NOT NULL UNIQUE,
    rating        INTEGER NOT NULL,
    category      TEXT NOT NULL DEFAULT 'general',
    comments      TEXT NOT NULL,
    email         TEXT,
    page          TEXT,
    user_id       INTEGER,
    role          TEXT,
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'RECEIVED'
);
CREATE INDEX IF NOT EXISTS idx_site_feedback_created ON site_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_site_feedback_status  ON site_feedback(status);
"""

_ALLOWED_CATEGORIES = {
    "general", "login", "call", "report", "lab", "accessibility", "bug",
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_feedback_table(conn):
    """Idempotent, additive schema for feedback. Never alters existing tables."""
    conn.executescript(FEEDBACK_TABLE_SQL)
    conn.commit()


def _client_key() -> str:
    """Rate-limit key. Prefers the authenticated user, falls back to IP."""
    uid = None
    try:
        uid = g.get("user", {}).get("uid") if hasattr(g, "get") else None
    except Exception:
        uid = None
    if uid:
        return f"u:{uid}"
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return "ip:" + fwd.split(",")[0].strip()
    return "ip:" + (request.remote_addr or "unknown")


def rate_limit_feedback(key: str) -> bool:
    """Return True when the request is allowed. In-memory, per-process."""
    now = time.time()
    window_start = now - FEEDBACK_RATE_WINDOW
    hits = [t for t in _FEEDBACK_RATE.get(key, []) if t > window_start]
    if len(hits) >= FEEDBACK_RATE_LIMIT:
        _FEEDBACK_RATE[key] = hits
        return False
    hits.append(now)
    _FEEDBACK_RATE[key] = hits
    return True


def validate_feedback(payload: dict):
    """Server-side validation (GuDApps 4.4.1.1).

    Returns (clean, errors). Never trusts the client.
    """
    errors = []
    if not isinstance(payload, dict):
        return None, [{"field": "body", "message": "Expected a JSON object."}]

    rating = payload.get("rating")
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        rating = None
    if rating is None or rating < 1 or rating > 5:
        errors.append({"field": "rating", "message": "Select a rating between 1 and 5."})

    category = str(payload.get("category") or "general").strip().lower()
    if category not in _ALLOWED_CATEGORIES:
        category = "general"

    comments = str(payload.get("comments") or "").strip()
    if len(comments) < 10:
        errors.append({"field": "comments",
                       "message": "Enter comments of at least 10 characters."})
    if len(comments) > 1000:
        errors.append({"field": "comments",
                       "message": "Comments must be 1000 characters or fewer."})

    email = payload.get("email")
    email = str(email).strip() if email is not None else ""
    if email:
        if len(email) > 254 or not _EMAIL_RE.match(email):
            errors.append({"field": "email",
                           "message": "Enter a valid email address, or leave it empty."})
    else:
        email = None

    page = str(payload.get("page") or "")[:200] or None

    if errors:
        return None, errors

    clean = {
        "rating": rating,
        "category": category,
        "comments": comments,
        "email": email,
        "page": page,
    }
    return clean, []


def install_feedback(app, get_db, init_db=None):
    """Register POST /api/feedback and GET /api/feedback/<reference>."""

    @app.post("/api/feedback")
    def submit_feedback():
        ref = uuid.uuid4().hex[:12]
        key = _client_key()
        if not rate_limit_feedback(key):
            retry_after = str(FEEDBACK_RATE_WINDOW)
            resp = jsonify({
                "error": "You have sent feedback too often. Please wait and try again.",
                "status": 429,
                "code": "FEEDBACK_RATE_LIMITED",
                "reference": ref,
            })
            resp.headers["Retry-After"] = retry_after
            return resp, 429

        payload = request.get_json(silent=True)
        clean, errors = validate_feedback(payload)
        if errors:
            return jsonify({
                "error": "The feedback could not be submitted.",
                "status": 422,
                "code": "VALIDATION_FAILED",
                "fields": errors,
                "reference": ref,
            }), 422

        # Reference number for the user (GIGW Q11 acknowledgement).
        reference = "FB-" + time.strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:6].upper()
        user_id = None
        role = None
        try:
            user = g.get("user") if hasattr(g, "get") else None
            if user:
                user_id = user.get("uid")
                role = user.get("role")
        except Exception:
            pass

        conn = get_db()
        try:
            ensure_feedback_table(conn)
            conn.execute(
                "INSERT INTO site_feedback"
                " (reference, rating, category, comments, email, page, user_id, role, created_at, status)"
                " VALUES (?,?,?,?,?,?,?,?,?, 'RECEIVED')",
                (reference, clean["rating"], clean["category"], clean["comments"],
                 clean["email"], clean["page"], user_id, role,
                 time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
            )
            conn.commit()
        except sqlite3.Error:
            log.exception("feedback_insert_failed reference=%s", reference)
            return jsonify({
                "error": "We could not record your feedback. Please try again.",
                "status": 500,
                "reference": ref,
            }), 500
        finally:
            conn.close()

        # Log the category and reference only — never the free-text content or
        # the email address (programme §24 personal data minimisation).
        log.info("feedback_received reference=%s rating=%s category=%s",
                 reference, clean["rating"], clean["category"])

        return jsonify({
            "ok": True,
            "reference": reference,
            "status": "RECEIVED",
            "message": "Thank you. Your feedback has been recorded.",
        }), 201

    @app.get("/api/feedback/<reference>")
    def lookup_feedback(reference):
        """Track a feedback submission by reference number (GIGW §44 flow)."""
        conn = get_db()
        try:
            ensure_feedback_table(conn)
            row = conn.execute(
                "SELECT reference, status, created_at, category"
                " FROM site_feedback WHERE reference = ?",
                (str(reference)[:64],),
            ).fetchone()
        except sqlite3.Error:
            log.exception("feedback_lookup_failed")
            return jsonify({"error": "Could not look up that reference.", "status": 500}), 500
        finally:
            conn.close()
        if not row:
            return jsonify({
                "error": "No feedback found with that reference number.",
                "status": 404,
            }), 404
        return jsonify({
            "reference": row["reference"],
            "status": row["status"],
            "created_at": row["created_at"],
            "category": row["category"],
        })

    @app.post("/api/security/csp-report")
    def csp_report():
        """Receive Content-Security-Policy violation reports.

        Accepts a report and records only its category. Report bodies may
        contain URLs, so they are never echoed back or logged in full.
        """
        try:
            data = request.get_json(silent=True) or {}
            violated = ""
            try:
                violated = str(
                    (data.get("csp-report") or {}).get("violated-directive", "")
                )[:120]
            except Exception:
                violated = ""
            log.warning("csp_violation directive=%s", violated or "unknown")
        except Exception:
            pass
        return Response(status=204)

    return app


# --------------------------------------------------------------------------
# Upload hardening (GuDApps 4.5.1.2 / 4.5.1.3 / 4.5.1.4)
# --------------------------------------------------------------------------

def safe_filename_parts(filename: str):
    """Split a filename and detect dangerous patterns.

    Returns (stem, extension, rejection_reason). Guards against:
      * empty / missing names
      * path traversal and separators
      * double extensions (e.g. `report.pdf.exe`)
      * denied executable or script extensions anywhere in the name
    """
    if not filename or not str(filename).strip():
        return None, None, "The file has no name."

    name = str(filename).strip().replace("\\", "/")
    name = name.split("/")[-1].split("\\")[-1]        # strip any directory part
    if name in ("", ".", ".."):
        return None, None, "The file name is not allowed."

    lowered = name.lower()
    parts = [p for p in lowered.split(".") if p]
    if not parts:
        return None, None, "The file has no extension."

    # Denied extension anywhere -> reject (catches double extensions).
    for part in parts[1:]:
        if part in UPLOAD_DENIED_EXTENSIONS:
            return None, None, "That file type is not allowed."

    ext = parts[-1]
    if ext not in UPLOAD_ALLOWED_EXTENSIONS:
        return None, None, "That file type is not allowed."

    # More than one extension on an allowed base is suspicious, e.g. `x.png.pdf`.
    if len(parts) > 2:
        return None, None, "File names with multiple extensions are not allowed."

    stem = ".".join(parts[:-1])
    if not stem:
        return None, None, "The file name is not allowed."
    return stem, ext, None


def validate_upload(storage, filename: str, declared_mime: str | None = None,
                    max_bytes: int | None = None):
    """Validate an upload. Returns (ok, reason).

    `storage` is the werkzeug FileStorage. Browser-supplied MIME types are NOT
    trusted: the extension allow-list and a content sniff are authoritative.
    """
    limit = max_bytes or UPLOAD_MAX_BYTES

    stem, ext, reason = safe_filename_parts(filename)
    if reason:
        return False, reason

    try:
        storage.stream.seek(0, 2)
        size = storage.stream.tell()
        storage.stream.seek(0)
    except Exception:
        return False, "The file could not be read."
    if size <= 0:
        return False, "The file is empty."
    if size > limit:
        return False, f"The file is larger than the {limit // (1024 * 1024)} MB limit."

    # Magic-byte sniff — never trust the client-supplied content type alone.
    header = storage.stream.read(12)
    storage.stream.seek(0)
    sniffed = None
    if header.startswith(b"\xff\xd8\xff"):
        sniffed = "image/jpeg"
    elif header.startswith(b"\x89PNG\r\n\x1a\n"):
        sniffed = "image/png"
    elif header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        sniffed = "image/webp"
    elif header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        sniffed = "image/gif"
    elif header.startswith(b"%PDF-"):
        sniffed = "application/pdf"

    if sniffed is None:
        return False, "The file contents do not match an allowed image or PDF file."
    if sniffed not in UPLOAD_ALLOWED_MIME:
        return False, "That file type is not allowed."
    if declared_mime:
        base = str(declared_mime).split(";")[0].strip().lower()
        if base in UPLOAD_ALLOWED_MIME and base != sniffed:
            # Client and content disagree -> trust the content, but reject the
            # mismatch rather than accepting an ambiguous file.
            return False, "The file type does not match its contents."

    return True, None


def install(app, get_db=None):
    """Install every additive security feature."""
    install_headers(app)
    install_error_handlers(app)
    if get_db is not None:
        install_feedback(app, get_db)
    return app
