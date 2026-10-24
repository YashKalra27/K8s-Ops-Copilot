import threading
import time
from collections import defaultdict, deque

from app.services.redis_client import get_redis

# In-process fallback used when no Redis is configured (single worker only).
_memory_windows: dict[str, deque[float]] = defaultdict(deque)
_memory_lock = threading.Lock()


class RateLimiter:
    """Sliding-window limiter: a sorted set of request timestamps per key."""

    def __init__(self, max_requests: int, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds

    def is_allowed(self, key: str) -> tuple[bool, int, int]:
        client = get_redis()
        now = time.time()
        window_start = now - self.window_seconds

        if client is None:
            return self._is_allowed_memory(key, now, window_start)

        pipe = client.pipeline()
        pipe.zremrangebyscore(key, 0, window_start)
        pipe.zadd(key, {str(now): now})
        pipe.zcard(key)
        pipe.expire(key, self.window_seconds)
        results = pipe.exec()

        request_count = int(results[2])
        remaining = max(0, self.max_requests - request_count)
        allowed = request_count <= self.max_requests

        return allowed, remaining, request_count

    def _is_allowed_memory(self, key: str, now: float, window_start: float) -> tuple[bool, int, int]:
        with _memory_lock:
            window = _memory_windows[key]
            while window and window[0] <= window_start:
                window.popleft()
            window.append(now)
            request_count = len(window)
        remaining = max(0, self.max_requests - request_count)
        return request_count <= self.max_requests, remaining, request_count


def is_allowed_ip(ip: str, route: str, limit: int, window_seconds: int) -> tuple[bool, int, int]:
    limiter = RateLimiter(max_requests=limit, window_seconds=window_seconds)
    key = f"rate_limit:ip:{ip}:{route}"
    return limiter.is_allowed(key)


def is_allowed_user(
    user_id: str, limit: int = 20, window_seconds: int = 60
) -> tuple[bool, int, int]:
    limiter = RateLimiter(max_requests=limit, window_seconds=window_seconds)
    key = f"rate_limit:user:{user_id}"
    return limiter.is_allowed(key)
