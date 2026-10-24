.PHONY: help up down status install sync local-up local-down seed seed-data api ui ui-build streamlit eval eval-baseline eval-hybrid eval-rerank eval-hyde eval-crag eval-all eval-diff test lint format


help:
	@echo "ADV RAG — Available commands"
	@echo ""
	@echo "  make install       — create venv & install all deps (one-time)"
	@echo "  make sync          — sync deps with pyproject.toml"
	@echo "  make up            — start everything (Postgres, API, console) and wait"
	@echo "  make down          — stop the API, the console and Postgres"
	@echo "  make status        — show which services are running"
	@echo "  make local-up      — start project-local Postgres (:5434) without Docker"
	@echo "  make local-down    — stop it"
	@echo "  make seed          — seed DB + ingest docs into Qdrant"
	@echo "  make seed-data     — download + generate the 95/5 noise corpus (~130-200 MB)"
	@echo "  make api           — start FastAPI backend (:8000)"
	@echo "  make ui            — start the React demo console (:5173)"
	@echo "  make ui-build      — build the console; the API then serves it at /ui"
	@echo "  make streamlit     — start Streamlit UI (:8501)"
	@echo "  make eval          — run baseline + all + diff"
	@echo "  make test          — run pytest"
	@echo "  make lint          — run ruff check"
	@echo "  make format        — run ruff format"


install:
	uv python pin 3.12
	uv venv --python 3.12
	uv sync --extra dev

sync:
	uv sync --extra dev

up:
	bash scripts/start_all.sh start

down:
	bash scripts/start_all.sh stop

status:
	bash scripts/start_all.sh status

local-up:
	bash scripts/local_stack.sh start

local-down:
	bash scripts/local_stack.sh stop

seed:
	uv run python scripts/seed_db.py --noise-sample all

seed-docs:
	uv run python -c "from scripts.seed_db import seed_docs; seed_docs()"

seed-data:
	bash scripts/data_pipeline/run_all.sh

api:
	uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

ui:
	cd frontend && npm install && npm run dev

ui-build:
	cd frontend && npm install && npm run build

streamlit:
	uv run streamlit run scripts/streamlit_app.py


eval-baseline:
	uv run python -m eval.run_ragas --profile naive

eval-hybrid:
	uv run python -m eval.run_ragas --profile hybrid

eval-rerank:
	uv run python -m eval.run_ragas --profile hybrid+rerank

eval-hyde:
	uv run python -m eval.run_ragas --profile hybrid+rerank+hyde --filter hyde

eval-crag:
	uv run python -m eval.run_ragas --profile hybrid+rerank+crag --filter crag

eval-all:
	uv run python -m eval.run_ragas --profile all

eval: eval-baseline eval-all
	$(MAKE) eval-diff

eval-diff:
	@latest_naive=$$(ls -t eval/results/*_naive.json 2>/dev/null | head -1); \
	latest_all=$$(ls -t eval/results/*_all.json 2>/dev/null | head -1); \
	test -n "$$latest_naive" && test -n "$$latest_all" && \
	  uv run python -m eval.diff $$latest_naive $$latest_all || \
	  echo "Need at least one _naive.json and one _all.json in eval/results/"

validate:
	uv run python -m scripts.validate_goldens


test:
	uv run pytest tests/ -q

lint:
	uv run ruff check .

format:
	uv run ruff format .


eval-legacy:
	@echo "Use: make eval-baseline"