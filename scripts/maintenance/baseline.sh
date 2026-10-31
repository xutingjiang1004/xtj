#!/usr/bin/env bash
# Creates (or refreshes) a read-only checkout of origin/main at output/maintenance/main-wt and serves it on :4174, so the
# working tree can be compared with what is on main (tests, Dock styles, posts-page styles).
#   scripts/maintenance/baseline.sh [ref]      default ref: origin/main
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
REF=${1:-origin/main}
git fetch -q origin main 2>/dev/null || true
WT=output/maintenance/main-wt
mkdir -p output/maintenance
if [ -e "$WT/.git" ]; then
  git -C "$WT" checkout -q --detach "$REF"
else
  git worktree add -q -f --detach "$WT" "$REF"
fi
ln -sfn "$(pwd)/node_modules" "$WT/node_modules"
"$(dirname "$0")/serve.sh" "$(pwd)/$WT" 4174 >/dev/null
echo "baseline $(git -C "$WT" rev-parse --short HEAD) ($REF) at $WT, served on http://127.0.0.1:4174"
