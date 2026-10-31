#!/usr/bin/env bash
# Starts the static site server for a directory (default: the working tree) on a port (default 4173) and makes sure the
# server on that port really serves that directory: one left over from an earlier session on another tree is restarted.
#   scripts/maintenance/serve.sh [dir] [port]
set -euo pipefail
DIR=${1:-$(git rev-parse --show-toplevel)}
PORT=${2:-4173}
mkdir -p "$DIR/output/maintenance" 2>/dev/null || true

serves_dir() {
  local served disk
  served=$(curl -s "http://127.0.0.1:$PORT/index.html" | md5sum | cut -d' ' -f1)
  disk=$(md5sum < "$DIR/index.html" | cut -d' ' -f1)
  [ "$served" = "$disk" ]
}

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  if serves_dir; then echo "server already running on :$PORT"; exit 0; fi
  echo "the server on :$PORT serves another tree, restarting it for $DIR" >&2
  pids=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN || true)
  if [ -n "$pids" ]; then kill $pids; sleep 1; fi
fi
(cd "$DIR" && PORT=$PORT nohup node scripts/serve-static.js < /dev/null > "output/maintenance/server-$PORT.log" 2>&1 &)
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then echo "serving $DIR on http://127.0.0.1:$PORT"; exit 0; fi
  sleep 1
done
echo "server did not start; see $DIR/output/maintenance/server-$PORT.log" >&2
exit 1
