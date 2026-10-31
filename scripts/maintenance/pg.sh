#!/usr/bin/env bash
# Starts (or reuses) a disposable local PostgreSQL 16 for the backend/database tests and prints the connection URL.
# The database tests create their own throw-away databases inside it and refuse any non-local address.
#   eval "$(scripts/maintenance/pg.sh)"        -> exports XTJ_TEST_DATABASE_URL
#   scripts/maintenance/pg.sh stop              -> stops it
# Data lives in /tmp/xtj-pg and is thrown away with the container; nothing here ever touches a real database.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
DATA=${XTJ_PG_DATA:-/tmp/xtj-pg}
PORT=${XTJ_PG_PORT:-54329}
if [ -z "$PGBIN" ]; then echo "echo 'PostgreSQL is not installed: database tests cannot run here, say so in the PR'" ; exit 1; fi

run_pg() { # the server refuses to run as root: switch to the postgres system user when needed
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

if [ "${1:-}" = "stop" ]; then
  if [ -d "$DATA" ]; then run_pg "$PGBIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true; fi
  echo "stopped" >&2
  exit 0
fi

if [ ! -d "$DATA" ]; then
  mkdir -p "$DATA"
  if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$DATA"; fi
  run_pg "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust -E UTF8 >/dev/null
fi
if ! run_pg "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  run_pg "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" -l "$DATA/server.log" -w start >/dev/null
fi
echo "export XTJ_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/postgres"
echo "PostgreSQL ready on 127.0.0.1:$PORT (stop with: scripts/maintenance/pg.sh stop)" >&2
