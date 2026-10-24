import json
import logging
import queue
import threading
import time
import uuid
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from app.config import settings
from app.core import trace
from app.core.graph import get_graph
from app.middleware.auth import User, get_current_user
from app.middleware.rate_limiter import is_allowed_user
from app.models import ChatResponse, PendingSQLBlock, QueryRequest, SqlExecuteRequest, TraceStep
from app.security.content_moderation import moderate_and_redact, redact_pii
from app.security.input_guard import check_input_safe
from app.security.input_restructuring import count_tokens, restructure_input
from app.security.token_budget import check_budget, consume_budget
from app.services import conversation_service as conversations
from app.services.followup_service import rewrite_followup

router = APIRouter(tags=["query"])
logger = logging.getLogger(__name__)


def _estimate_tokens(question: str) -> int:
    return count_tokens(question) + settings.reserved_output_tokens


def _blocked(status: int, detail: str) -> HTTPException:
    """Raise with the trace so far, so a client can show which layer stopped it."""
    return HTTPException(status_code=status, detail={"message": detail, "trace": trace.get_trace()})


def _finish(result: dict[str, Any], started: float, user: User, estimated: int | None) -> ChatResponse:
    metadata = dict(result.get("metadata") or {})
    response = ChatResponse(
        answer=result.get("final_answer") or "",
        sources=result.get("sources", []),
        confidence=result.get("confidence") or 0.0,
        cache_hit=bool(result.get("cache_hit", False)),
        metadata=metadata,
    )

    # L7b (content moderation out): moderate + redact PII before returning
    with trace.step("Output moderation + PII redaction", layer="L7b") as info:
        out_allowed, redacted, reason = moderate_and_redact(response.answer)
        info.update(redacted=redacted != response.answer)
        if not out_allowed:
            info.update(status="blocked", reason=reason)
    if not out_allowed:
        raise _blocked(500, f"output_blocked: {reason}")
    response.answer = redacted

    if estimated is not None:
        consume_budget(user.username, estimated)

    response.metadata.cache_hit = response.cache_hit
    response.metadata.trace = [TraceStep(**s) for s in trace.get_trace()]
    response.metadata.total_ms = round((time.perf_counter() - started) * 1000, 1)
    return response


# Plain `def` (not async): FastAPI runs these in a worker thread. The graph makes
# blocking LLM and database calls; inside `async def` they froze the event loop,
# so one slow question stalled every other request, including /admin/health.
@router.post("/query", response_model=ChatResponse)
def query(
    body: QueryRequest,
    user: User = Depends(get_current_user),
) -> ChatResponse:
    trace.start_trace()
    return _run_query(body, user)


@router.post("/query/stream")
def query_stream(
    body: QueryRequest,
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Same pipeline as POST /query, streamed as Server-Sent Events so a client
    can watch each stage start and finish while the request runs:

    - ``event: begin``  a stage started   (``{"name", "layer"}``)
    - ``event: step``   a stage finished  (a TraceStep)
    - ``event: result`` the final ChatResponse (may carry ``pending_sql``)
    - ``event: error``  ``{"status", "message", "trace"}`` (same as the HTTP errors)
    """
    events: queue.Queue[tuple[str, Any] | None] = queue.Queue()

    def on_trace(entry: dict[str, Any]) -> None:
        if entry.get("event") == "begin":
            events.put(("begin", {"name": entry["name"], "layer": entry.get("layer")}))
        else:
            events.put(("step", entry))

    def worker() -> None:
        trace.start_trace(listener=on_trace)
        try:
            events.put(("result", _run_query(body, user).model_dump(mode="json")))
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
            events.put(("error", {"status": exc.status_code, **detail}))
        except Exception as exc:  # noqa: BLE001
            events.put(("error", {"status": 500, "message": f"{type(exc).__name__}: {exc}", "trace": trace.get_trace()}))
        finally:
            events.put(None)

    def stream() -> Iterator[str]:
        threading.Thread(target=worker, name="query-stream", daemon=True).start()
        while True:
            try:
                item = events.get(timeout=15)
            except queue.Empty:
                yield ": keep-alive\n\n"  # SSE comment: keeps proxies from closing an idle stream
                continue
            if item is None:
                return
            name, data = item
            yield f"event: {name}\ndata: {json.dumps(data, default=str)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _run_query(body: QueryRequest, user: User) -> ChatResponse:
    """One chat turn: resolve the conversation, run the pipeline, save both messages.
    The caller has started the trace."""
    conv_id = _resolve_conversation(body, user)
    saved = {"user": False}
    try:
        response = _pipeline(body, user, conv_id, saved)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"message": str(exc.detail)}
        _save_failure(conv_id, body.question, saved["user"], exc.status_code, detail)
        exc.detail = {**detail, "conversation_id": conv_id}
        raise
    except Exception as exc:
        detail = {"message": f"{type(exc).__name__}: {exc}", "trace": trace.get_trace()}
        _save_failure(conv_id, body.question, saved["user"], 500, detail)
        raise HTTPException(status_code=500, detail={**detail, "conversation_id": conv_id}) from exc

    response.conversation_id = conv_id
    pending = response.pending_sql.query_id if response.pending_sql else None
    response.message_id = _safe_save(
        conv_id, "assistant", response.answer, response.model_dump(mode="json"), query_id=pending
    )
    return response


def _resolve_conversation(body: QueryRequest, user: User) -> str:
    if body.conversation_id:
        if not conversations.owns(user.username, body.conversation_id):
            raise HTTPException(status_code=404, detail="Conversation not found")
        return body.conversation_id
    # Titles come from the redacted question, so no personal data lands in the sidebar.
    return conversations.create_conversation(user.username, redact_pii(body.question))


def _safe_save(conv_id: str, role: str, content: str, metadata: dict[str, Any], query_id: str | None = None) -> str | None:
    """Saving history must never turn a good answer into an error."""
    try:
        return conversations.add_message(conv_id, role, content, metadata, query_id=query_id)
    except Exception:  # noqa: BLE001
        logger.exception("Could not save a chat message")
        return None


def _save_failure(conv_id: str, question: str, user_saved: bool, status: int, detail: dict[str, Any]) -> None:
    if not user_saved:
        _safe_save(conv_id, "user", redact_pii(question), {})
    error = {"status": status, "message": detail.get("message", ""), "trace": detail.get("trace", [])}
    _safe_save(conv_id, "assistant", "", {"error": error})


def _pipeline(body: QueryRequest, user: User, conv_id: str, saved: dict[str, bool]) -> ChatResponse:
    started = time.perf_counter()
    trace.record("Schema + injection regex", layer="L1", chars=len(body.question))
    trace.record("JWT auth", layer="L4a", user=user.username)

    # L4b: per-user sliding-window rate limit
    allowed, remaining_req, _ = is_allowed_user(
        user.username,
        limit=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    trace.record(
        "Rate limit", status="ok" if allowed else "blocked", layer="L4b", remaining=remaining_req
    )
    if not allowed:
        raise _blocked(429, "Rate limit exceeded")

    # L6: per-user daily token budget
    estimated = _estimate_tokens(body.question)
    ok, remaining = check_budget(user.username, estimated)
    trace.record(
        "Token budget", status="ok" if ok else "blocked", layer="L6", estimated=estimated, remaining=remaining
    )
    if not ok:
        raise _blocked(
            429,
            f"You have {remaining} tokens remaining today; this request estimated to use {estimated}.",
        )

    # L5: input restructuring (truncate / summarize if too long)
    with trace.step("Input restructuring", layer="L5") as info:
        restructured, method = restructure_input(body.question)
        info.update(method=method, tokens=count_tokens(body.question))

    # L2: input guard (prompt injection / banned topics / toxicity)
    with trace.step("Input guard scan", layer="L2") as info:
        guard_allowed, guard_reason = check_input_safe(restructured)
        if not guard_allowed:
            info.update(status="blocked", reason=guard_reason)
    if not guard_allowed:
        raise _blocked(400, f"injection_blocked: {guard_reason}")

    # L7a: content moderation in (PII redaction + toxicity)
    with trace.step("Input moderation + PII redaction", layer="L7a") as info:
        mod_allowed, moderated_in, mod_reason = moderate_and_redact(restructured)
        info.update(redacted=moderated_in != restructured)
        if not mod_allowed:
            info.update(status="blocked", reason=mod_reason)
    if not mod_allowed:
        raise _blocked(400, f"content_blocked: {mod_reason}")

    # Conversation memory: read the history *before* saving this question, then save
    # the redacted question so a reload shows it even while the answer is running.
    history = conversations.history_for_followup(conv_id)
    _safe_save(conv_id, "user", moderated_in, {})
    saved["user"] = True

    question = rewrite_followup(moderated_in, history)
    if question != moderated_in:
        # The rewrite was produced from earlier (partly model-written) turns: scan it too.
        with trace.step("Input guard scan", layer="L2", rewritten=True) as info:
            ok2, reason2 = check_input_safe(question)
            if not ok2:
                info.update(status="blocked", reason=reason2)
        if not ok2:
            raise _blocked(400, f"injection_blocked: {reason2}")

    flags = {
        "top_k": body.top_k,
        "search_mode": body.search_mode,
        "enable_rerank": body.enable_rerank,
        "enable_hyde": body.enable_hyde,
        "enable_crag": body.enable_crag,
        "enable_self_reflective": body.enable_self_reflective,
        "bypass_cache": body.bypass_cache,
    }
    thread_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": thread_id}}

    result = get_graph().invoke(
        {"question": question, "user_id": user.username, "flags": flags},
        config=config,
    )
    standalone = question if question != moderated_in else None

    if "__interrupt__" in result:
        intr = result["__interrupt__"][0].value
        trace.record("Paused for SQL approval", status="hit", layer="hitl", query_id=thread_id)
        # Budget for the paused part is charged now; the resume is charged separately.
        consume_budget(user.username, estimated)
        return ChatResponse(
            answer="",
            sources=[],
            confidence=0.0,
            pending_sql=PendingSQLBlock(
                sql=intr.get("sql", ""),
                query_id=thread_id,
                explanation=intr.get("explanation", ""),
            ),
            metadata={
                "route": intr.get("intent") or result.get("intent") or "sql",
                "trace": trace.get_trace(),
                "total_ms": round((time.perf_counter() - started) * 1000, 1),
                "standalone_question": standalone,
            },
        )

    response = _finish(result, started, user, estimated)
    response.metadata.standalone_question = standalone
    return response


@router.post("/query/sql/execute", response_model=ChatResponse)
def execute_sql(
    body: SqlExecuteRequest,
    user: User = Depends(get_current_user),
) -> ChatResponse:
    started = time.perf_counter()
    trace.start_trace()
    graph = get_graph()
    config = {"configurable": {"thread_id": body.query_id}}

    snapshot = graph.get_state(config)
    values = snapshot.values if snapshot else {}
    # Only the user who asked the question may approve its SQL. Without this, any
    # authenticated user could run someone else's pending query by its id.
    if not values or values.get("user_id") != user.username:
        raise HTTPException(status_code=404, detail="No pending SQL for this query_id")
    if not snapshot.next:
        raise HTTPException(status_code=409, detail="This query has already been answered")

    result = graph.invoke(Command(resume={"approved": body.approved}), config=config)
    response = _finish(result, started, user, estimated=settings.reserved_output_tokens)
    # Replace the "waiting for approval" message in the saved conversation.
    try:
        saved = conversations.update_message_by_query(body.query_id, response.answer, response.model_dump(mode="json"))
    except Exception:  # noqa: BLE001
        logger.exception("Could not update the saved conversation")
        saved = None
    if saved:
        response.conversation_id, response.message_id = saved
        conversations.update_message_by_query(body.query_id, response.answer, response.model_dump(mode="json"))
    return response
