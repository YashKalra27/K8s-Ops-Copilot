"""One place that decides which key-value store backs the cache, rate limiter and
token budget.

Order of preference:
1. Upstash Redis (REST API) when UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN are set.
2. A regular Redis server when REDIS_URL is set (e.g. redis://localhost:6379/5).
3. ``None``: callers fall back to their own in-process store, so the service still
   runs on a laptop with no Redis at all (state is then per-process only).
"""

from __future__ import annotations

import threading
from typing import Any

from loguru import logger

from app.config import settings

_client: Any | None = None
_backend: str = "memory"
_initialised = False
_lock = threading.Lock()


class _PlainRedis:
    """Adapts redis-py to the small subset of the Upstash client API we use.

    The only real difference is that Upstash pipelines finish with ``exec()``
    while redis-py pipelines finish with ``execute()``.
    """

    def __init__(self, url: str) -> None:
        import redis

        self._r = redis.Redis.from_url(url, decode_responses=True, socket_timeout=3)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._r, name)

    def pipeline(self) -> Any:
        pipe = self._r.pipeline()
        pipe.exec = pipe.execute  # type: ignore[attr-defined]
        return pipe


def get_redis() -> Any | None:
    global _client, _backend, _initialised
    if _initialised:
        return _client
    with _lock:
        if _initialised:
            return _client
        if settings.upstash_redis_url and settings.upstash_redis_token:
            try:
                from upstash_redis import Redis

                _client = Redis(url=settings.upstash_redis_url, token=settings.upstash_redis_token)
                _backend = "upstash"
            except Exception:
                logger.exception("Upstash Redis init failed; trying REDIS_URL / memory")
        if _client is None and settings.redis_url:
            try:
                candidate = _PlainRedis(settings.redis_url)
                candidate.ping()
                _client = candidate
                _backend = "redis"
            except Exception as exc:
                logger.warning("Redis at REDIS_URL unreachable ({}); using in-memory store", exc)
        if _client is None:
            logger.info("No Redis configured; cache/rate-limit state is in-memory")
        _initialised = True
        return _client


def backend_name() -> str:
    get_redis()
    return _backend
