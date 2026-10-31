#!/usr/bin/env bash
# The standard "did I break anything" run: tests on the working tree, then only the failing files on main, then a diff
# of failing test names. Exit code 1 means a failure that main does not have. Output goes to a new timestamped folder
# under output/maintenance/tests (git-ignored); the folder is printed at the end.
#   scripts/maintenance/test-compare.sh [filter]     filter as for run-tests.sh (regex on file names, or a list file)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
HERE=scripts/maintenance
OUT=output/maintenance/tests/run-$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"
"$HERE/run-tests.sh" . "$OUT/new" "${1:-}"
node "$HERE/compare-tests.js" "$OUT/new" --failing > "$OUT/failing.txt"
echo "results in $OUT"
if [ ! -s "$OUT/failing.txt" ]; then echo "no failing files"; exit 0; fi
"$HERE/baseline.sh" >/dev/null
"$HERE/run-tests.sh" output/maintenance/main-wt "$OUT/base" "$OUT/failing.txt"
node "$HERE/compare-tests.js" "$OUT/new" "$OUT/base"
