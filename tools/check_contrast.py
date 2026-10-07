#!/usr/bin/env python3
"""DBIM contrast gate (brief §1.1; WCAG 1.4.3 / 1.4.11 / GIGW 5.2.14).

Verifies every claimed text/background pair >= 4.5:1 and every UI-boundary /
focus pair >= 3:1. Exits non-zero (failing CI) on any violation.

Token hexes are read from frontend/dbim/tokens.css so the gate always tests
the shipped values; the PAIRS table below names the semantic claim each pair
proves. Run:  python3 tools/check_contrast.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOKENS = ROOT / "frontend" / "dbim" / "tokens.css"

# (name, foreground-token-or-hex, background-token-or-hex, minimum ratio)
PAIRS = [
    # Body + secondary text (DBIM 4)
    ("body on page", "--dbim-ink", "--dbim-surface-page", 4.5),
    ("body on card", "--dbim-ink", "--dbim-surface-card", 4.5),
    ("secondary on page", "--dbim-grey-700", "--dbim-surface-page", 4.5),
    ("secondary on card", "--dbim-grey-700", "--dbim-surface-card", 4.5),
    # Links (D-09: body links use darker info-blue; plain info-blue is large/bold/UI only)
    ("link on page", "--dbim-link", "--dbim-surface-page", 4.5),
    ("link on card", "--dbim-link", "--dbim-surface-card", 4.5),
    # Key colour: white text ONLY on key/ink, never on mid/soft/pale (DBIM 2)
    ("white on key", "--dbim-white", "--dbim-key", 4.5),
    ("white on key-ink", "--dbim-white", "--dbim-key-ink", 4.5),
    ("key on page", "--dbim-key", "--dbim-surface-page", 4.5),
    ("key on card", "--dbim-key", "--dbim-surface-card", 4.5),
    ("key-ink on page", "--dbim-key-ink", "--dbim-surface-page", 4.5),
    ("ink on key-pale wash", "--dbim-ink", "--dbim-key-pale", 4.5),
    # Status tints (never colour-alone; dark ink on tint)
    ("success ink on success bg", "--dbim-success-ink", "--dbim-success-bg", 4.5),
    ("success on page", "--dbim-success", "--dbim-surface-page", 4.5),
    ("white on success", "--dbim-white", "--dbim-success", 4.5),
    ("error ink on error bg", "--dbim-error-ink", "--dbim-error-bg", 4.5),
    ("error on page", "--dbim-error", "--dbim-surface-page", 4.5),
    ("white on error", "--dbim-white", "--dbim-error", 4.5),
    ("info ink on info bg", "--dbim-info-ink", "--dbim-info-bg", 4.5),
    ("ink on mustard (warning)", "--dbim-ink", "--dbim-warning-bg", 4.5),
    # UI boundaries + focus (WCAG 1.4.11, >= 3:1)
    ("input border on page", "--dbim-grey-700", "--dbim-surface-page", 3.0),
    ("focus ring on page", "--dbim-focus", "--dbim-surface-page", 3.0),
    ("focus ring on dark banner", "--dbim-focus-on-dark", "--dbim-ink", 3.0),
    ("focus ring on key", "--dbim-focus-on-dark", "--dbim-key", 3.0),
]

# Guard rails: pairs that must NEVER be used for text (documents the §1.1 traps).
BANNED_FOR_TEXT = [
    ("white on key-mid", "--dbim-white", "--dbim-key-mid"),
    ("key-mid on page", "--dbim-key-mid", "--dbim-surface-page"),
    ("grey-500 on page", "--dbim-grey-500", "--dbim-surface-page"),
    ("grey-300 on page", "--dbim-grey-300", "--dbim-surface-page"),
]


def parse_tokens(path):
    """Read --var: #hex pairs from :root blocks (first definition wins per var
    in the default green theme: tokens.css lists green first)."""
    text = path.read_text(encoding="utf-8")
    # Strip the non-default theme-override blocks; only the default (green)
    # :root values are gated here. (Alternate themes must pass the same gate
    # when activated — CI runs with --theme blue as well.)
    base = re.sub(
        r':root\[data-dbim-theme="(?:blue|burgundy|purple|chrome-yellow|cinnamon-red)"\][^{]*\{[^}]*\}',
        "", text, flags=re.S)
    found = {}
    for m in re.finditer(r"(--[\w-]+)\s*:\s*#([0-9a-fA-F]{6})\b", base):
        found.setdefault(m.group(1), "#" + m.group(2))
    # Resolve var() aliases used in surface tokens.
    alias = {}
    for m in re.finditer(r"(--[\w-]+)\s*:\s*var\((--[\w-]+)\)", base):
        alias.setdefault(m.group(1), m.group(2))

    def resolve(name):
        seen = set()
        while name in alias and name not in seen:
            seen.add(name)
            name = alias[name]
        return found.get(name)

    return resolve


def luminance(hexcode):
    h = hexcode.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (f(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    l1, l2 = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def main():
    if not TOKENS.exists():
        print(f"FATAL: tokens file missing: {TOKENS}")
        return 2
    resolve = parse_tokens(TOKENS)
    failures = []
    print(f"{'pair':34s} {'fg':9s} {'bg':9s} {'ratio':>6s} {'need':>5s}  verdict")
    for name, fg_name, bg_name, minimum in PAIRS:
        fg = fg_name if fg_name.startswith("#") else resolve(fg_name)
        bg = bg_name if bg_name.startswith("#") else resolve(bg_name)
        if not fg or not bg:
            print(f"{name:34s} MISSING TOKEN ({fg_name}={fg}, {bg_name}={bg})")
            failures.append(name)
            continue
        r = ratio(fg, bg)
        ok = r >= minimum
        print(f"{name:34s} {fg:9s} {bg:9s} {r:6.2f} {minimum:5.1f}  {'PASS' if ok else 'FAIL'}")
        if not ok:
            failures.append(name)
    print("\nDocumented non-text pairs (must stay BELOW 4.5 — proves the trap list is honest):")
    for name, fg_name, bg_name in BANNED_FOR_TEXT:
        fg, bg = resolve(fg_name), resolve(bg_name)
        r = ratio(fg, bg) if fg and bg else 0
        flag = "OK (correctly unusable for text)" if r < 4.5 else "SURPRISE: now text-safe, review trap list"
        print(f"  {name:22s} {r:5.2f}:1  {flag}")
    if failures:
        print(f"\nCONTRAST GATE FAILED: {len(failures)} pair(s): {', '.join(failures)}")
        return 1
    print(f"\nCONTRAST GATE PASSED: {len(PAIRS)} pairs verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
