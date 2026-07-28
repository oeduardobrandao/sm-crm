#!/usr/bin/env bash
#
# Runs the pgTAP-style SQL tests against the local Supabase DB.
# Each test file is a self-contained psql script (begin/.../rollback blocks that
# assert behaviour and roll back). Prints a PASS/FAIL line per file and exits
# non-zero if any file fails.
#
# Two sets run, in this order:
#   1. supabase/tests/entitlements/[0-9]*.sql -- per-plan limits and feature gates.
#   2. supabase/tests/*.sql                   -- per-RPC suites (import_commit_row,
#      post_media_set_from_uploads, tiktok_publishing_rpcs, user_has_password).
# (2) used to be runnable only by hand, so in practice it was never run; the RPCs
# it covers are SECURITY DEFINER security boundaries, which is exactly the code
# that must not rot untested. Both sets pass, so nothing here newly fails.
#
# Override the DB URL with SUPABASE_DB_URL if needed.
set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

# Resolve the test dirs relative to this script (repo-root independent).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TESTS_DIR="$REPO_ROOT/supabase/tests/entitlements"
RPC_TESTS_DIR="$REPO_ROOT/supabase/tests"

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found on PATH. Install the Postgres client (e.g. 'brew install libpq')." >&2
  exit 127
fi

if [ ! -d "$TESTS_DIR" ]; then
  echo "ERROR: tests dir not found: $TESTS_DIR" >&2
  exit 1
fi

# psql's \i in the test files uses paths relative to the CWD, so run from the repo root.
cd "$REPO_ROOT"

failures=0
ran=0

run_test_file() {
  local f="$1" rel out
  rel="${f#"$REPO_ROOT"/}"
  ran=$((ran + 1))
  if out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "PASS $rel"
  else
    echo "FAIL $rel"
    echo "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  fi
}

# Numbered test files only (sorted); _helpers.sql is excluded by the glob.
for f in "$TESTS_DIR"/[0-9]*.sql; do
  [ -e "$f" ] || { echo "ERROR: no test files matched in $TESTS_DIR" >&2; exit 1; }
  run_test_file "$f"
done

# Standalone per-RPC suites at the top level of supabase/tests (sorted).
# Non-recursive, so supabase/tests/entitlements/ is not re-run here.
for f in "$RPC_TESTS_DIR"/*.sql; do
  [ -e "$f" ] || { echo "ERROR: no test files matched in $RPC_TESTS_DIR" >&2; exit 1; }
  run_test_file "$f"
done

echo "----------------------------------------"
echo "ran=$ran  failures=$failures"

if [ "$failures" -ne 0 ]; then
  exit 1
fi
