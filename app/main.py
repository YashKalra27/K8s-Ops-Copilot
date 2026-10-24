import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api import admin, auth, conversations, documents, query
from app.config import settings


def _warmup() -> None:
    """Load the heavy models once at startup instead of on the first request."""
    from app.core.graph import get_graph
    from app.security.input_guard import warmup as warm_guard
    from app.services.reranking import Reranker
    from app.services.vector_store import sparse_search

    get_graph()
    warm_guard()
    Reranker()._load_local_model()
    sparse_search("warmup", top_k=1)
    logger.info("Warm-up complete")


def _warmup_safely() -> None:
    try:
        _warmup()
    except Exception:
        logger.exception("Warm-up failed; models will load on first request")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # In a background thread: a slow first-time model download must not keep
    # the server from accepting requests (health checks, sign-in, cached answers).
    if settings.warmup_on_startup:
        threading.Thread(target=_warmup_safely, name="warmup", daemon=True).start()
    yield


app = FastAPI(
    title="ADV RAG",
    version="1.0.0",
    description="Kubernetes IT-Ops copilot: Text2SQL + advanced RAG + caching + LLM security.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(query.router)
app.include_router(documents.router)
app.include_router(conversations.router)

# Serve the built demo console (frontend/dist) at /ui when it exists.
_UI_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _UI_DIST.is_dir():
    app.mount("/ui", StaticFiles(directory=_UI_DIST, html=True), name="ui")


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/ui/" if _UI_DIST.is_dir() else "/docs")
