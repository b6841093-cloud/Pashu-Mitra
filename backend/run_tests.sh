#!/usr/bin/env bash
# =============================================================================
# Pashu-Shield — backend test runner
#
# Runs every backend suite with:
#   1. Database isolation.  backend/animal_health.db is TRACKED IN GIT, so a
#      test run mutates a version-controlled file and leaves OTP rate-limit
#      cooldowns behind, which makes later runs fail spuriously
#      (baseline defect F-B2). This script snapshots the DB, runs the suites
#      against a throwaway copy, and restores the original afterwards.
#   2. Sufficient environment. Suites need IVR_WEBHOOK_SECRET and
#      SIH_SECRET_KEY; long random values are generated so that secret-leak
#      assertions cannot trivially match on a short string.
#
# Usage:  ./backend/run_tests.sh
# =============================================================================
set -uo pipefail

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
if [ ! -x ".venv/bin/python" ] && [ -x "../.venv/bin/python" ]; then
  PY="../.venv/bin/python"
elif [ -x "../.venv/bin/python" ]; then
  PY="../.venv/bin/python"
fi

DB="animal_health.db"
SNAPSHOT="$(mktemp -t pashu-db-XXXXXX)"
STAMP="$(date +%s)"

# Long, non-trivial values so that "secret must not appear in output"
# assertions cannot pass/fail by accident on a one-character match.
export IVR_WEBHOOK_SECRET="${IVR_WEBHOOK_SECRET:-helpline-test-secret-$STAMP}"
export SIH_SECRET_KEY="${SIH_SECRET_KEY:-jwt-test-secret-$STAMP-not-a-real-key}"

restore_db() {
  if [ -s "$SNAPSHOT" ]; then
    cp "$SNAPSHOT" "$DB"
  fi
}
trap restore_db EXIT

[ -f "$DB" ] && cp "$DB" "$SNAPSHOT"

SUITES=(
  test_regression
  test_role_auth
  test_farmer_otp_login
  test_webcalling
  test_demo_account
  test_clerk_login
  test_helpline
  test_all_features
  test_animal_qr_medication
  test_ml_service
  test_compliance
)

pass=0
fail=0
failed_suites=()

for suite in "${SUITES[@]}"; do
  [ -f "$suite.py" ] || continue
  # Each suite gets a pristine database so order cannot matter.
  if [ -s "$SNAPSHOT" ]; then
    cp "$SNAPSHOT" "$DB"
  else
    rm -f "$DB"
  fi

  out="$("$PY" "$suite.py" 2>&1)"
  if printf '%s' "$out" | grep -qE '^(OK|OK \()'; then
    printf '  PASS  %-24s %s\n' "$suite" \
      "$(printf '%s' "$out" | grep -E '^Ran ' | head -1)"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-24s %s\n' "$suite" \
      "$(printf '%s' "$out" | grep -E '^(FAILED|Ran )' | tr '\n' ' ')"
    fail=$((fail + 1))
    failed_suites+=("$suite")
    printf '%s\n' "$out" | tail -40 | sed 's/^/        /'
  fi
done

echo
echo "-----------------------------------------------"
printf 'Suites passed: %d\nSuites failed: %d\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then
  printf 'Failing suites: %s\n' "${failed_suites[*]}"
  exit 1
fi
echo "All backend suites passed."
