#!/usr/bin/env bash
# One command for the whole local stack.
#
#   bash scripts/start_all.sh          # start everything, wait until ready
#   bash scripts/start_all.sh stop     # stop the API, the console and Postgres
#   bash scripts/start_all.sh status   # what is running
#
# Starts: project Postgres (:5434), checks Redis (:6379) and Ollama (:11434),
# then the API (:8000) and the console (:5173). Logs go to .localdev/*.log.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/.localdev"
mkdir -p "$LOGS"
cd "$ROOT"

up() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for() {  # port, name, seconds
  for _ in $(seq 1 "$3"); do up "$1" && { echo "  ok   $2 (:$1)"; return 0; }; sleep 1; done
  echo "  FAIL $2 did not start on :$1 (see $LOGS)"; return 1
}

start() {
  echo "Starting the local stack"
  bash scripts/local_stack.sh start >/dev/null && echo "  ok   Postgres (:5434)"

  if up 6379; then echo "  ok   Redis (:6379)"
  else
    brew services start redis >/dev/null 2>&1 || true
    wait_for 6379 Redis 15 || echo "       (optional: the app falls back to in-memory caches)"
  fi

  if up 11434; then echo "  ok   Ollama (:11434)"
  else
    brew services start ollama >/dev/null 2>&1 || (nohup ollama serve >"$LOGS/ollama.log" 2>&1 &)
    wait_for 11434 Ollama 30 || exit 1
  fi

  if up 8000; then echo "  ok   API already running (:8000)"
  else
    HF_HUB_DISABLE_XET=1 nohup .venv/bin/python scripts/serve.py >"$LOGS/api.log" 2>&1 &
    wait_for 8000 "API" 120 || exit 1
  fi

  if up 5173; then echo "  ok   Console already running (:5173)"
  else
    [ -d frontend/node_modules ] || (cd frontend && npm install >/dev/null 2>&1)
    (cd frontend && nohup npx vite --port 5173 --strictPort >"$LOGS/vite.log" 2>&1 &)
    wait_for 5173 "Console" 60 || exit 1
  fi

  echo
  echo "Open http://localhost:5173 and click \"Demo engineer\" or \"Demo admin\"."
  echo "(Models finish loading in the background; the first answer can take a minute.)"
}

stop() {
  pkill -f "scripts/serve.py" && echo "Stopped API" || echo "API was not running"
  pkill -f "vite --port 5173" && echo "Stopped console" || echo "Console was not running"
  bash scripts/local_stack.sh stop
  echo "Redis and Ollama were left running (other apps may use them)."
}

status() {
  for pair in "5434:Postgres" "6379:Redis" "11434:Ollama" "8000:API" "5173:Console"; do
    port="${pair%%:*}"; name="${pair#*:}"
    if up "$port"; then echo "  up   $name (:$port)"; else echo "  down $name (:$port)"; fi
  done
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac
