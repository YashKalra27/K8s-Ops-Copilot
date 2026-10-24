#!/usr/bin/env bash
# Run the stateful dependencies WITHOUT Docker (macOS/Linux).
#
#   bash scripts/local_stack.sh start   # project-local Postgres on :5434
#   bash scripts/local_stack.sh stop
#   bash scripts/local_stack.sh status
#
# Postgres data lives in .localdev/postgres (git-ignored), so it never touches
# any Postgres server you already run. Qdrant runs embedded (QDRANT_PATH in .env)
# and the cache falls back to in-memory or a local Redis (REDIS_URL), so neither
# needs a container. If you do have Docker, `docker compose up -d` still works.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.localdev/postgres"
PGPORT="${LOCAL_PG_PORT:-5434}"
LOG="$ROOT/.localdev/postgres.log"

find_pg_bin() {
  for dir in "$(pg_config --bindir 2>/dev/null || true)" \
             /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@16/bin \
             /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/*/bin; do
    if [ -n "$dir" ] && [ -x "$dir/initdb" ]; then echo "$dir"; return; fi
  done
  echo "Postgres binaries not found. Install with: brew install postgresql@17" >&2
  exit 1
}

PGBIN="$(find_pg_bin)"

start() {
  mkdir -p "$ROOT/.localdev"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "Initialising Postgres cluster in $PGDATA"
    pwfile="$(mktemp)"; echo "postgres" > "$pwfile"
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --pwfile="$pwfile" --auth=scram-sha-256 >/dev/null
    rm -f "$pwfile"
  fi
  if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    echo "Postgres already running on :$PGPORT"
  else
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -o "-p $PGPORT -k /tmp" -w start >/dev/null
    echo "Postgres started on :$PGPORT (log: $LOG)"
  fi
  if ! PGPASSWORD=postgres "$PGBIN/psql" -h localhost -p "$PGPORT" -U postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='adv_rag'" | grep -q 1; then
    PGPASSWORD=postgres "$PGBIN/createdb" -h localhost -p "$PGPORT" -U postgres adv_rag
    echo "Created database adv_rag"
  fi
  echo "DATABASE_URL=postgresql://postgres:postgres@localhost:$PGPORT/adv_rag"
}

stop() {
  if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null && echo "Postgres stopped"
  else
    echo "Postgres not running"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) "$PGBIN/pg_ctl" -D "$PGDATA" status || true ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac
