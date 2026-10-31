#!/usr/bin/env bash
# The three guard checks plus build, build-consistency and syntax checks. Run it before opening a PR and again after any
# change. Exit code 1 when any check fails.
#   1. no Dock selector in the source diff against origin/main
#   2. every computed style of the Dock identical to main (dock-diff.js)
#   3. posts-page computed styles identical to main (posts-diff.js); a bug fix that must change one runs with
#      XTJ_ALLOW_POSTS_DIFF=1 and explains each listed difference in the PR description
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
HERE=scripts/maintenance
status=0

echo "== 1. Dock selectors in the source diff against origin/main"
git fetch -q origin main 2>/dev/null || true
hits=$(git diff origin/main -- css js index.html ':(exclude)*.min.css' ':(exclude)*.min.js' ':(exclude)js/core.js' ':(exclude)js/maintenance' \
  | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -E 'dock-bar|dock-tab|dock-indicator|dockBar|dock-liquid|\.dt-icon|\.dt-label' || true)
if [ -n "$hits" ]; then echo "$hits" | head -20; echo "FAIL: the diff touches the Dock"; status=1; else echo "ok"; fi

echo "== build, build consistency, syntax"
for step in "npm run build" "npm run test:consistency" "npm run test:syntax"; do
  if $step > output/maintenance/last-step.log 2>&1; then echo "ok: $step"; else echo "FAIL: $step"; tail -15 output/maintenance/last-step.log; status=1; fi
done

if git diff --name-only origin/main | grep -q '^render-api/'; then
  echo "== backend changed: boot the real server and check it (backend-smoke.js)"
  node "$HERE/backend-smoke.js" | tail -4 || status=1
fi

echo "== 2. Dock computed styles against main"
"$HERE/baseline.sh" >/dev/null && "$HERE/serve.sh" >/dev/null
node "$HERE/dock-diff.js" | tail -8 || status=1

echo "== 3. posts-page computed styles against main"
if ! node "$HERE/posts-diff.js"; then
  if [ "${XTJ_ALLOW_POSTS_DIFF:-0}" = "1" ]; then echo "posts-page differences allowed by XTJ_ALLOW_POSTS_DIFF=1: explain each one in the PR"; else status=1; fi
fi

[ $status -eq 0 ] && echo "ALL GUARDS PASSED" || echo "GUARDS FAILED"
exit $status
