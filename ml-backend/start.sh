#!/bin/bash
set -euo pipefail

# Support invocation from outside ml-backend without relying on the caller's cwd.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Render supplies PORT. For local execution use, for example, PORT=8000 ./start.sh.
: "${PORT:?Set PORT (Render provides it automatically)}"
echo "Starting Pashu-Shield ML Backend on 0.0.0.0:${PORT} using existing trained artifacts."

# Never train or overwrite deployed models on startup. main.py logs artifact
# failures; health reports them and affected inference endpoints return 503.
exec uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --timeout-keep-alive 120
