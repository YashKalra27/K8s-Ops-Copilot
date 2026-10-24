"""Per-request pipeline trace.

Every stage (security layers, routing, retrieval, grading, generation, caches)
records what it did and how long it took. The trace is returned in
``ChatResponse.metadata.trace`` so a client can show *why* an answer came out
the way it did. It lives in a ContextVar, so services record steps without
passing a trace object through every function signature. LangGraph runs nodes
in a copied context, which still points at the same list, so steps recorded
inside graph nodes land in the request's trace.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_trace: ContextVar[list[dict[str, Any]] | None] = ContextVar("pipeline_trace", default=None)
# Optional callback fired as each step is recorded, so a streaming endpoint can
# push progress to the browser while the request is still running.
_listener: ContextVar[Callable[[dict[str, Any]], None] | None] = ContextVar("trace_listener", default=None)


def start_trace(listener: Callable[[dict[str, Any]], None] | None = None) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    _trace.set(steps)
    _listener.set(listener)
    return steps


def get_trace() -> list[dict[str, Any]]:
    return list(_trace.get() or [])


def record(name: str, status: str = "ok", ms: float = 0.0, layer: str | None = None, **detail: Any) -> None:
    steps = _trace.get()
    if steps is None:
        return
    entry = {"name": name, "layer": layer, "status": status, "ms": round(ms, 1), "detail": detail}
    steps.append(entry)
    listener = _listener.get()
    if listener is not None:
        try:
            listener(entry)
        except Exception:  # noqa: BLE001 - a slow or closed client must never break the request
            pass


@contextmanager
def step(name: str, layer: str | None = None, **detail: Any) -> Iterator[dict[str, Any]]:
    """Time a block. The yielded dict collects extra detail; set ``status`` in it
    to override the default "ok"."""
    info: dict[str, Any] = dict(detail)
    listener = _listener.get()
    if listener is not None and _trace.get() is not None:
        try:
            listener({"event": "begin", "name": name, "layer": layer})
        except Exception:  # noqa: BLE001
            pass
    t0 = time.perf_counter()
    try:
        yield info
    except Exception as exc:
        info.setdefault("error", f"{type(exc).__name__}: {exc}")
        info["status"] = "error"
        raise
    finally:
        status = info.pop("status", "ok")
        record(name, status=status, ms=(time.perf_counter() - t0) * 1000, layer=layer, **info)
