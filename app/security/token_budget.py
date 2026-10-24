"""Per-user daily token budget tracked in Redis (or in memory without Redis)."""

import datetime
import threading

from app.config import settings
from app.services.redis_client import get_redis

_memory_used: dict[str, int] = {}
_memory_lock = threading.Lock()


class TokenBudget:
    def __init__(self, max_tokens: int):
        self.max_tokens = max_tokens

    def _key(self, user_id: str) -> str:
        today = datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%d")
        return f"token_budget:{user_id}:{today}"

    def used(self, user_id: str) -> int:
        client = get_redis()
        key = self._key(user_id)
        if client is None:
            with _memory_lock:
                return _memory_used.get(key, 0)
        used_str = client.get(key)
        return int(used_str) if used_str is not None else 0

    def check_budget(self, user_id: str, estimated_tokens: int) -> tuple[bool, int]:
        remaining = self.max_tokens - self.used(user_id)
        ok = estimated_tokens <= remaining
        return ok, remaining

    def consume(self, user_id: str, actual_tokens: int) -> dict:
        client = get_redis()
        key = self._key(user_id)
        if client is None:
            with _memory_lock:
                _memory_used[key] = _memory_used.get(key, 0) + actual_tokens
                used = _memory_used[key]
        else:
            used = int(client.incrby(key, actual_tokens))

            # Set TTL to seconds-until-midnight on first write
            ttl = client.ttl(key)
            if ttl == -1:
                now = datetime.datetime.now(datetime.UTC)
                midnight = (now + datetime.timedelta(days=1)).replace(
                    hour=0, minute=0, second=0, microsecond=0
                )
                seconds_until_midnight = int((midnight - now).total_seconds())
                client.expire(key, seconds_until_midnight)

        remaining = max(0, self.max_tokens - used)
        return {
            "used": used,
            "limit": self.max_tokens,
            "remaining": remaining,
            "tokens_charged": actual_tokens,
        }


_budget = TokenBudget(max_tokens=settings.max_tokens_per_user_daily)


def check_budget(user_id: str, estimated_tokens: int) -> tuple[bool, int]:
    return _budget.check_budget(user_id, estimated_tokens)


def consume_budget(user_id: str, actual_tokens: int) -> dict:
    return _budget.consume(user_id, actual_tokens)


def budget_status(user_id: str) -> dict:
    used = _budget.used(user_id)
    return {"used": used, "limit": _budget.max_tokens, "remaining": max(0, _budget.max_tokens - used)}
