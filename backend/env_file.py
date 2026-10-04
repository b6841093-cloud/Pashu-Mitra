"""Minimal ``.env`` loader (no third-party dependency).

Reads ``KEY=VALUE`` lines from the project-root ``.env`` and then
``backend/.env`` into ``os.environ``. Real environment variables always win
(``setdefault``), so Render/production settings are never overridden by a
stray local file. Must be imported before any module that reads the
environment at import time.
"""
from __future__ import annotations

import os
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_CANDIDATES = (_HERE.parent / ".env", _HERE / ".env")


def _parse_line(line: str):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return None
    if line.startswith("export "):
        line = line[len("export "):].lstrip()
    key, _, value = line.partition("=")
    key = key.strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    elif " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    return (key, value) if key else None


def load_env_files() -> None:
    for path in _CANDIDATES:
        try:
            text = path.read_text(encoding="utf-8-sig")
        except OSError:
            continue
        for line in text.splitlines():
            parsed = _parse_line(line)
            # Blank values in .env must not mask a real setting or a default.
            if parsed and parsed[1] != "":
                os.environ.setdefault(*parsed)


load_env_files()
