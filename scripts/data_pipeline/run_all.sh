#!/usr/bin/env bash
# Build the knowledge base: signal docs, synthetic runbooks, noise sample.
# NOISE_COUNT=950 reproduces the full 95/5 design (slow to embed on a laptop).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOISE_COUNT="${NOISE_COUNT:-60}"

uv run python scripts/data_pipeline/01_fetch_k8s_docs.py
uv run python scripts/data_pipeline/02_generate_runbooks.py
uv run python scripts/data_pipeline/03_fetch_noise.py --count "$NOISE_COUNT"
echo "Knowledge base ready. Next: make seed  (migrations, demo users, ingestion)"
