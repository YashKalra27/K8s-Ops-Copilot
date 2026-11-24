#!/usr/bin/env bash
# Plain-Docker start (any container host): serve the API + console on $PORT.
set -euo pipefail
cd /app
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --proxy-headers
