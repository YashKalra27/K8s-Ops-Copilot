import datetime
import decimal
import json
import threading
import uuid
from typing import Any

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from psycopg_pool import ConnectionPool

from app.config import settings
from app.core import trace
from app.core.state import GraphState
from app.models import RetrievedChunk
from app.security.spotlighting import build_spotlighted_context
from app.services.llm_service import generate
from app.services.rag_service import answer_rag, retrieve, synthesize_hybrid
from app.services.router_service import classify_intent
from app.services.sql_service import SQLService, check_sql

sql_service = SQLService()


def _safe_json_default(obj: Any) -> Any:
    """Fallback serializer for non-JSON-native types."""
    if isinstance(obj, datetime.datetime | datetime.date | datetime.time):
        return obj.isoformat()
    if isinstance(obj, datetime.timedelta):
        return str(obj)
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def _safe_json_dumps(obj: Any, **kwargs: Any) -> str:
    """json.dumps with a safe fallback for exotic types."""
    return json.dumps(obj, default=_safe_json_default, **kwargs)


def route_intent(state: GraphState) -> dict:
    """LLM-based intent router for sql/rag/hybrid."""
    intent = classify_intent(state["question"])
    return {"intent": intent}


def retrieve_rag(state: GraphState) -> dict:
    """Hybrid route, documents leg. Only retrieves: the SQL leg must still wait
    for human approval. (The original called run_rag here, which executed the
    SQL inline *before* approval and passed file names instead of chunk text.)"""
    chunks, evaluation, used_web = retrieve(state["question"], flags=state.get("flags", {}))
    return {
        "retrieved_chunks": chunks,
        "spotlighted_context": build_spotlighted_context(chunks),
        "crag_evaluation": evaluation,
        "used_web_fallback": used_web,
    }


def generate_sql_node(state: GraphState) -> dict:
    with trace.step("Text2SQL generate", layer="sql") as info:
        try:
            result = sql_service.generate_sql(state["question"])
        except Exception as exc:  # noqa: BLE001
            info.update(status="error", error=f"{type(exc).__name__}: {exc}")
            return {"generated_sql": None, "sql_error": f"SQL generation failed: {exc}"}
        sql = result["sql"]
        ok, reason = check_sql(sql)
        info.update(sql=sql, cache="hit" if result.get("cache_hit") else "miss", fixes=result.get("fixes", 0))
        if ok and result.get("error"):
            ok, reason = False, f"still invalid after {result.get('fixes', 0)} corrections: {result['error']}"
        if not ok:
            # SELECT-only enforcement happens BEFORE a human is asked to approve.
            info.update(status="blocked", reason=reason)
            return {
                "generated_sql": sql,
                "sql_explanation": result["explanation"],
                "sql_error": f"Generated SQL was blocked ({reason}).",
            }
    return {
        "generated_sql": sql,
        "sql_explanation": result["explanation"],
        "sql_error": None,
    }


def _after_sql_generation(state: GraphState) -> str:
    return "generate_answer" if state.get("sql_error") else "request_sql_approval"


def request_sql_approval(state: GraphState) -> dict:
    approval = interrupt(
        {
            "type": "sql_approval_required",
            "sql": state["generated_sql"],
            "explanation": state.get("sql_explanation", ""),
            "intent": state.get("intent"),
        }
    )
    approved = bool(approval.get("approved", False))
    trace.record("Human approval", status="ok" if approved else "blocked", layer="hitl", approved=approved)
    return {"sql_approved": approved}


def execute_sql(state: GraphState) -> dict:
    """Execute approved SQL and store results."""
    if not state.get("sql_approved"):
        return {"sql_rows": [], "sql_error": "SQL query was not approved."}

    sql = state.get("generated_sql") or ""
    with trace.step("Execute SQL (read-only)", layer="sql") as info:
        try:
            rows = sql_service.execute_sql(sql)
            info.update(rows=len(rows))
            return {"sql_rows": rows}
        except Exception as exc:  # noqa: BLE001
            info.update(status="error", error=str(exc)[:200])
            return {"sql_rows": [], "sql_error": f"SQL execution failed: {exc}"}


def _summarize_rows(question: str, sql: str, rows: list[dict]) -> str:
    """Turn result rows into a short plain-language answer."""
    preview = _safe_json_dumps(rows[:30], indent=1)
    system = (
        "You are an SRE assistant. Answer the question in 1-3 sentences using ONLY the "
        "SQL result rows provided. State the key numbers or names explicitly. If the rows "
        "are empty, say no matching records were found. Plain text, no JSON."
    )
    user = f"Question: {question}\nSQL: {sql}\nRows ({len(rows)} total, first 30 shown):\n{preview}"
    with trace.step("Summarize SQL rows", layer="generate") as info:
        out = generate(system, user)
        info["rows"] = len(rows)
        return out["text"].strip()


def generate_answer(state: GraphState) -> dict:
    intent = state.get("intent", "rag")

    if intent == "sql":
        sql = state.get("generated_sql") or ""
        rows = state.get("sql_rows") or []
        error = state.get("sql_error")
        if error:
            answer = error
            confidence = 0.0
        else:
            answer = _summarize_rows(state["question"], sql, rows)
            confidence = 0.9 if rows else 0.6
        return {
            "final_answer": answer,
            "sources": ["database query"] if not error else [],
            "confidence": confidence,
            "metadata": {"route": "sql", "sql": sql or None, "sql_rows": rows[:50]},
        }

    if intent == "hybrid":
        return _generate_hybrid_answer(state)

    response = answer_rag(state["question"], flags=state.get("flags", {}))
    return {
        "final_answer": response.answer,
        "sources": response.sources,
        "confidence": response.confidence,
        "cache_hit": response.cache_hit,
        "metadata": response.metadata.model_dump(exclude={"trace"}),
        "reflection_iterations": response.metadata.reflection_iterations,
        "refined_question": response.metadata.refined_question,
    }


def _generate_hybrid_answer(state: GraphState) -> dict:
    rows = state.get("sql_rows") or []
    chunks: list[RetrievedChunk] = state.get("retrieved_chunks") or []
    error = state.get("sql_error")
    answer = synthesize_hybrid(state["question"], rows, chunks)
    if error:
        answer = f"{answer}\n\n(Note: the database part was not used. {error})"
    evaluation = state.get("crag_evaluation")
    doc_sources = list(dict.fromkeys(c.source for c in chunks if c.source))
    return {
        "final_answer": answer,
        "sources": (["database query"] if rows else []) + doc_sources,
        "confidence": 0.85 if rows and chunks else 0.6,
        "metadata": {
            "route": "hybrid",
            "sql": state.get("generated_sql"),
            "sql_rows": rows[:50],
            "retrieved_chunks": [
                {"text": c.text, "source": c.source, "score": c.score} for c in chunks
            ],
            "crag_score": evaluation.relevance_score if evaluation else None,
            "crag_label": evaluation.relevance_label if evaluation else None,
            "used_web_fallback": bool(state.get("used_web_fallback")),
        },
    }


def finalize(state: GraphState) -> dict:
    return {}


def _get_checkpointer() -> PostgresSaver:
    # A pool (not one shared connection) so concurrent requests don't interleave
    # statements on the same socket.
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        PostgresSaver(conn=conn).setup()
    pool = ConnectionPool(
        conninfo=settings.database_url,
        min_size=1,
        max_size=10,
        kwargs={"autocommit": True, "prepare_threshold": 0},
        open=True,
    )
    return PostgresSaver(conn=pool)


def build_graph(checkpointer=None):
    builder = StateGraph(GraphState)
    builder.add_node("route_intent", route_intent)
    builder.add_node("retrieve_rag", retrieve_rag)
    builder.add_node("generate_sql_node", generate_sql_node)
    builder.add_node("request_sql_approval", request_sql_approval)
    builder.add_node("execute_sql", execute_sql)
    builder.add_node("generate_answer", generate_answer)
    builder.add_node("finalize", finalize)

    builder.add_edge(START, "route_intent")
    builder.add_conditional_edges(
        "route_intent",
        lambda s: s.get("intent", "rag"),
        {"sql": "generate_sql_node", "rag": "generate_answer", "hybrid": "retrieve_rag"},
    )
    builder.add_edge("retrieve_rag", "generate_sql_node")
    builder.add_conditional_edges(
        "generate_sql_node",
        _after_sql_generation,
        {"request_sql_approval": "request_sql_approval", "generate_answer": "generate_answer"},
    )
    builder.add_edge("request_sql_approval", "execute_sql")
    builder.add_edge("execute_sql", "generate_answer")
    builder.add_edge("generate_answer", "finalize")
    builder.add_edge("finalize", END)

    return builder.compile(checkpointer=checkpointer if checkpointer is not None else _get_checkpointer())


# Built lazily so importing the API (tests, tooling) doesn't need a live Postgres.
_graph = None
_graph_lock = threading.Lock()


def get_graph():
    global _graph
    if _graph is None:
        with _graph_lock:
            if _graph is None:
                _graph = build_graph()
    return _graph
