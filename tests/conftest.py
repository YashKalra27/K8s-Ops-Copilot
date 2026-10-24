"""Unit tests run with no external services: no LLM, Postgres, Qdrant or Redis.

Environment variables override any developer `.env`, so tests behave the same on
every machine.
"""

import os

os.environ.update(
    {
        "REDIS_URL": "",
        "UPSTASH_REDIS_URL": "",
        "UPSTASH_REDIS_TOKEN": "",
        "INPUT_GUARD_BACKEND": "heuristic",
        "PII_BACKEND": "regex",
        "JWT_SECRET": "test-secret-that-is-long-enough-for-hs256-signing",
        "OPENAI_API_KEY": "test",
        "OPENAI_BASE_URL": "http://127.0.0.1:9/v1",
        "DATABASE_URL": "postgresql://invalid:invalid@127.0.0.1:9/none",
        "QDRANT_PATH": "",
        "WARMUP_ON_STARTUP": "false",
        "RATE_LIMIT_REQUESTS": "1000",
    }
)

import pytest  # noqa: E402

from app.middleware import rate_limiter  # noqa: E402
from app.security import token_budget  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_in_memory_state():
    rate_limiter._memory_windows.clear()
    token_budget._memory_used.clear()
    yield
