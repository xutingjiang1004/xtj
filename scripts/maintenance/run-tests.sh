#!/usr/bin/env bash
# Runs test files one process each, three at a time, with a per-file timeout. One log per file plus _summary.txt
# ("<name> <exit code>" per line) in the output directory.
#   scripts/maintenance/run-tests.sh <tree-dir> <out-dir> [filter]
# filter: a file with test names (one per line, with or without tests/ and .js) or an extended regex on test file names
# (for example 'photo|preview|upload'). No filter runs every tests/*.test.js (about 70 minutes).
# XTJ_TEST_JOBS (default 3) and XTJ_TEST_TIMEOUT (seconds, default 140) tune it.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
TREE=$(cd "$1" && pwd)
mkdir -p "$2"
OUT=$(cd "$2" && pwd)
FILTER=${3:-}
cd "$TREE"
# Database tests skip silently (and count as passed) without a local PostgreSQL: start the disposable one when no URL is set.
if [ -z "${XTJ_TEST_DATABASE_URL:-}" ] && [ -x "$HERE/pg.sh" ]; then eval "$("$HERE/pg.sh" 2>/dev/null)" || true; fi
if [ -z "${CHROMIUM_PATH:-}" ] && [ ! -e /usr/bin/chromium ] && [ -e /opt/pw-browsers/chromium ]; then
  export CHROMIUM_PATH=/opt/pw-browsers/chromium
fi
all() { ls tests/*.test.js | sed 's#.*/##; s#\.js$##'; }
if [ -n "$FILTER" ] && [ -f "$FILTER" ]; then
  names=$(sed 's#.*/##; s#\.js$##' "$FILTER" | grep -v '^$')
elif [ -n "$FILTER" ]; then
  names=$(all | grep -E "$FILTER" || true)
else
  names=$(all)
fi
: > "$OUT/_summary.txt"
export OUT TIMEOUT_S=${XTJ_TEST_TIMEOUT:-140}
printf '%s\n' "$names" | grep -v '^$' | xargs -P "${XTJ_TEST_JOBS:-3}" -I{} bash -c '
  n="$1"
  [ -f "tests/$n.js" ] || { echo "$n 127" >> "$OUT/_summary.txt"; exit 0; }
  timeout "$TIMEOUT_S" node --test "tests/$n.js" > "$OUT/$n.log" 2>&1
  echo "$n $?" >> "$OUT/_summary.txt"
' _ {}
skipped=$(cat "$OUT"/*.log 2>/dev/null | awk '/^# skipped/{n+=$3} END{print n+0}')
echo "ran $(wc -l < "$OUT/_summary.txt") files in $TREE; failing: $(awk '$2!=0' "$OUT/_summary.txt" | wc -l); skipped subtests: $skipped${XTJ_TEST_DATABASE_URL:+ (database tests ran)}"
