#!/usr/bin/env python3
"""DBIM static rule gate (brief §1.1-1.4, §2.4; DBIM 2/4/5).

Fails CI when the shipped frontend breaks machine-checkable DBIM rules:
  R1  Deep Blue #1D0A69 (Gov.in root reserve) must never appear.
  R2  New DBIM CSS (frontend/dbim/*.css) must not hard-code non-token brand
      colours outside tokens.css (colours must flow from tokens).
  R3  var(--dbim-small) (Small Text) only in non-essential caption selectors.
  R4  Logo budget: any file under frontend/brand/ must be SVG/PNG/WEBP/JPG and
      under 100 KB (DBIM 5.5). Missing dir = pass (logo lands in Phase 2).
  R5  Banner budget: files under frontend/banners/ must be <= 500 KB;
      thumbnails (frontend/thumbs/) <= 100 KB. Missing dirs = pass (Phase 3).
  R6  No new emoji icons in DBIM chrome (icons must be the line set, DBIM 3).
      Legacy app emoji is grandfathered until its Phase 3/6 retrofit and is
      NOT flagged — only frontend/dbim/* and frontend/brand/* are scanned.

Run:  python3 tools/check_dbim.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DBIM_DIR = FRONTEND / "dbim"

ALLOWED_EXT = {".svg", ".png", ".webp", ".jpg", ".jpeg"}

# Hexes permitted to appear literally in dbim/*.css: functional + theme values
# (mirrors tokens.css) plus transparent helpers. Everything else must be a var().
TOKEN_HEXES = {
    "#0f5757", "#2d8686", "#a6d9d9", "#d9f2f2", "#0b3d3d",  # green group
    "#162f6a", "#214aab", "#a3bbf3", "#d2dfff", "#101f4a",  # blue group
    "#ebeAEA".lower(), "#ffffff", "#150202", "#000000", "#198754", "#ffc107",
    "#dc3545", "#0d6efd", "#0b5ed7", "#c6c6c6", "#8e8e8e", "#606060",
    "#e6f4ec", "#0c4a2a", "#fbe7e9", "#7a1f28", "#e3edfd", "#0a3d91",
    "#063fa0", "#3f3f3f",  # prefers-contrast:more overrides
}

EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0F]"
)

failures = []


def fail(rule, msg):
    failures.append(f"{rule}: {msg}")


def check_r1_no_deep_blue():
    for css in list(FRONTEND.glob("*.css")) + list(DBIM_DIR.glob("*.css")):
        text = css.read_text(encoding="utf-8", errors="replace")
        code = re.sub(r"/\*.*?\*/", "", text, flags=re.S)  # comments may name the ban
        if re.search(r"#1[dD]0[aA]69\b", code):
            fail("R1", f"{css.relative_to(ROOT)} contains reserved Deep Blue #1D0A69")


def check_r2_token_discipline():
    for css in DBIM_DIR.glob("*.css"):
        if css.name == "tokens.css":
            continue
        text = css.read_text(encoding="utf-8", errors="replace")
        text_nocomments = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        for m in re.finditer(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b", text_nocomments):
            raw = "#" + m.group(1)
            h = raw.lower()
            if len(h) == 4:  # expand #rgb
                h = "#" + "".join(c * 2 for c in h[1:])
            if h not in TOKEN_HEXES:
                line = text_nocomments.count("\n", 0, m.start()) + 1
                fail("R2", f"{css.relative_to(ROOT)}:{line} hard-codes {raw} — use a --dbim-* token")


def check_r3_small_text():
    for css in DBIM_DIR.glob("*.css"):
        text = css.read_text(encoding="utf-8", errors="replace")
        text_nocomments = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        # Find selectors whose block references --dbim-small.
        for m in re.finditer(r"([^{}]+)\{[^{}]*var\(--dbim-small\)[^{}]*\}", text_nocomments):
            selector = " ".join(m.group(1).split())
            if "dbim-caption" not in selector and ":root" not in selector and "@media" not in selector:
                fail("R3", f"{css.relative_to(ROOT)} uses Small Text outside .dbim-caption: `{selector[:80]}`")


def check_budget(subdir, limit_kb, rule):
    d = FRONTEND / subdir
    if not d.exists():
        return
    for f in sorted(d.rglob("*")):
        if not f.is_file():
            continue
        if f.suffix.lower() not in ALLOWED_EXT:
            fail(rule, f"{f.relative_to(ROOT)} has non-image format {f.suffix} (DBIM 5.5: SVG/PNG/WEBP/JPG only)")
            continue
        size_kb = f.stat().st_size / 1024
        if size_kb > limit_kb:
            fail(rule, f"{f.relative_to(ROOT)} is {size_kb:.0f} KB (limit {limit_kb} KB)")


def check_r6_no_emoji_in_dbim():
    for folder in (DBIM_DIR, FRONTEND / "brand"):
        if not folder.exists():
            continue
        for f in folder.glob("*.js"):
            text = f.read_text(encoding="utf-8", errors="replace")
            m = EMOJI_RE.search(text)
            if m:
                line = text.count("\n", 0, m.start()) + 1
                fail("R6", f"{f.relative_to(ROOT)}:{line} contains emoji — use DBIM.icon() (DBIM 3)")


def main():
    check_r1_no_deep_blue()
    check_r2_token_discipline()
    check_r3_small_text()
    check_budget("brand", 100, "R4")
    check_budget("banners", 500, "R5")
    check_budget("thumbs", 100, "R5")
    check_r6_no_emoji_in_dbim()
    if failures:
        print(f"DBIM GATE FAILED ({len(failures)}):")
        for msg in failures:
            print("  -", msg)
        return 1
    print("DBIM GATE PASSED: R1-R6 clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
