# Production image: API + built console in one container, models baked in.
# Build from the repo root:  docker build -f deploy/Dockerfile .
# Stateful parts live outside: Postgres (DATABASE_URL) and the embedded Qdrant
# store (QDRANT_PATH on a mounted volume). Modal runs it via deploy/modal_app.py.

FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/* && pip install --no-cache-dir uv
WORKDIR /app

COPY pyproject.toml ./
RUN uv pip install --system --no-cache torch torchvision --index-url https://download.pytorch.org/whl/cpu
# Install the dependencies first (layer cache), then the package itself.
RUN mkdir app && touch app/__init__.py && uv pip install --system --no-cache -e . && rm -rf app

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/app \
    HF_HOME=/opt/models/hf FASTEMBED_CACHE_PATH=/opt/models/fastembed \
    HF_HUB_DISABLE_TELEMETRY=1

COPY app/ ./app/
COPY scripts/ ./scripts/
COPY seed/migrations/ ./seed/migrations/
COPY --from=ui /ui/dist ./frontend/dist
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh

# Bake the models in, so a cold start does not download ~1.5 GB.
RUN EMBEDDING_BACKEND=fastembed EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5 \
    LLM_GUARD_SCANNERS=prompt_injection INPUT_GUARD_BACKEND=llm_guard \
    python -c "from app.services.embedding_service import _local_embed; _local_embed(['x'], 'nomic-ai/nomic-embed-text-v1.5'); \
from app.services.reranking import Reranker; Reranker()._load_local_model(); \
from app.security.input_guard import warmup; warmup(); print('models cached')"

EXPOSE 8000
CMD ["bash", "deploy/entrypoint.sh"]
