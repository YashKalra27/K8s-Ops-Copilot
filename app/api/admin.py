from typing import Any

from fastapi import APIRouter, Depends
from loguru import logger

from app.config import settings
from app.middleware.auth import User, require_admin
from app.services.query_cache_service import query_cache

router = APIRouter(tags=["admin"])


def _ping_postgres() -> tuple[bool, str]:
    try:
        import psycopg2

        conn = psycopg2.connect(settings.database_url, connect_timeout=2)
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM incidents")
        incidents = cur.fetchone()[0]
        cur.close()
        conn.close()
        return True, f"{incidents} incidents in ops DB"
    except Exception as exc:
        logger.debug("Postgres health check failed: {}", exc)
        return False, type(exc).__name__


def _ping_qdrant() -> tuple[bool, str]:
    try:
        from app.services.vector_store import collection_exists, get_client

        client = get_client()
        if not collection_exists():
            return True, "connected, collection not created yet (run the seed)"
        count = client.count(settings.qdrant_collection, exact=False).count
        mode = "embedded" if settings.qdrant_path else "server"
        return True, f"{count} chunks ({mode})"
    except Exception as exc:
        logger.debug("Qdrant health check failed: {}", exc)
        return False, type(exc).__name__


def _ping_redis() -> tuple[bool, str]:
    from app.services.redis_client import backend_name, get_redis

    client = get_redis()
    if client is None:
        return True, "in-memory fallback"
    try:
        client.ping()
        return True, backend_name()
    except Exception as exc:
        logger.debug("Redis health check failed: {}", exc)
        return False, type(exc).__name__


def _ping_llm() -> tuple[bool, str]:
    try:
        from app.services.llm_service import openai_client

        models = {m.id for m in openai_client.models.list()}
        needed = {settings.llm_model_answer, settings.llm_model_grader, settings.embedding_model}
        missing = sorted(m for m in needed if m not in models and f"{m}:latest" not in models)
        endpoint = settings.openai_base_url or "api.openai.com"
        if missing:
            return False, f"{endpoint}: missing models {', '.join(missing)}"
        return True, f"{endpoint} ({settings.llm_model_answer})"
    except Exception as exc:
        logger.debug("LLM health check failed: {}", exc)
        return False, type(exc).__name__


def _ping_tavily() -> tuple[bool, str]:
    # Configuration check only: a real search on every health ping costs credits.
    if settings.tavily_api_key:
        return True, "configured"
    return True, "not configured (CRAG web fallback disabled)"


@router.get("/admin/health")
def health_check() -> dict[str, Any]:
    from app.security.content_moderation import pii_backend
    from app.security.input_guard import guard_backend

    checks = {
        "postgres": _ping_postgres(),
        "qdrant": _ping_qdrant(),
        "redis": _ping_redis(),
        "llm": _ping_llm(),
        "tavily": _ping_tavily(),
    }
    required = ("postgres", "qdrant", "llm")
    all_ok = all(checks[name][0] for name in required) and checks["redis"][0]

    return {
        "status": "ok" if all_ok else "degraded",
        **{name: ok for name, (ok, _) in checks.items()},
        "openai": checks["llm"][0],  # kept for older clients
        "details": {name: detail for name, (_, detail) in checks.items()},
        "config": {
            "llm_endpoint": settings.openai_base_url or "openai",
            "answer_model": settings.llm_model_answer,
            "grader_model": settings.llm_model_grader,
            "embedding_model": settings.embedding_model,
            "input_guard": guard_backend(),
            "pii_redaction": pii_backend(),
            "reranker": f"{settings.reranker_backend}:{settings.reranker_model}",
            "doc_parser": settings.doc_parser,
        },
    }


@router.get("/admin/cache/stats")
async def cache_stats(user: User = Depends(require_admin)) -> dict:
    """Return per-cache hit/miss/set counts."""
    raw = query_cache.stats()

    def _tier(name: str) -> dict:
        return {
            "hits": int(raw.get(name, {}).get("hits", 0)),
            "misses": int(raw.get(name, {}).get("misses", 0)),
            "sets": int(raw.get(name, {}).get("sets", 0)),
            "hit_rate": float(raw.get(name, {}).get("hit_rate", 0.0)),
        }

    return {
        "embedding": _tier("embedding"),
        "rag": _tier("rag_answer"),
        "sql_gen": _tier("sql_gen"),
        "sql_result": _tier("sql_result"),
        "intent_router": _tier("intent"),
    }



@router.post("/admin/cache/clear")
async def cache_clear(user: User = Depends(require_admin)) -> dict:
    """Clear all caches (Redis + in-memory)."""
    cleared = query_cache.clear()
    return {"status": "ok", "cleared": cleared}
