from __future__ import annotations

import json

from loguru import logger

from app.config import settings
from app.core import trace
from app.models import (
    ChatResponse,
    CRAGEvaluation,
    ResponseMetadata,
    RetrievedChunk,
    RetrievedChunkPreview,
)
from app.security.output_validator import validate_with_retry
from app.security.spotlighting import build_spotlighted_context
from app.security.system_prompt import build_system_prompt
from app.services.crag import crag_pipeline
from app.services.embedding_service import embed_texts
from app.services.hyde import HyDERetriever
from app.services.llm_service import generate
from app.services.query_cache_service import query_cache
from app.services.reranking import Reranker
from app.services.router_service import classify_intent
from app.services.self_reflective import reflect_on_answer, should_regenerate
from app.services.sql_service import SQLService
from app.services.vector_store import hybrid_search, search, sparse_search


def _flag(flags: dict | None, key: str, default):
    if not isinstance(flags, dict):
        return default
    return flags.get(key, default)


def _previews(chunks: list[RetrievedChunk]) -> list[RetrievedChunkPreview]:
    return [RetrievedChunkPreview(text=c.text, source=c.source, score=c.score) for c in chunks]


def _unique_sources(chunks: list[RetrievedChunk]) -> list[str]:
    return list(dict.fromkeys(c.source for c in chunks if c.source))


# --------------------------------------------------------------------------- retrieval


def retrieve(
    question: str, flags: dict | None = None
) -> tuple[list[RetrievedChunk], CRAGEvaluation, bool]:
    """Search -> (rerank) -> CRAG. Returns (chunks, crag_evaluation, used_web)."""
    final_top_k = int(_flag(flags, "top_k", 5))
    mode = _flag(flags, "search_mode", "hybrid")
    rerank = bool(_flag(flags, "enable_rerank", settings.reranking_enabled_by_default))
    hyde = bool(_flag(flags, "enable_hyde", settings.hyde_enabled_by_default))
    enable_crag = bool(_flag(flags, "enable_crag", settings.crag_enabled_by_default))

    retrieve_k = max(settings.reranker_initial_top_k, final_top_k) if rerank else final_top_k

    with trace.step("Retrieve", layer="retrieve") as info:
        if hyde:
            info["mode"] = "hyde"
            chunks = HyDERetriever().retrieve(question, top_k=retrieve_k)
        elif mode == "sparse":
            info["mode"] = "sparse (BM25)"
            chunks = sparse_search(question, top_k=retrieve_k)
        elif mode == "hybrid":
            info["mode"] = "hybrid (dense + BM25, RRF)"
            query_embedding = embed_texts([question], kind="query")[0]
            chunks = hybrid_search(query_embedding, question, top_k=retrieve_k)
        else:
            info["mode"] = "dense"
            query_embedding = embed_texts([question], kind="query")[0]
            chunks = search(query_embedding, top_k=retrieve_k)
        info.update(candidates=len(chunks), top_sources=_unique_sources(chunks)[:5])

    if rerank and chunks:
        with trace.step("Rerank (cross-encoder)", layer="retrieve") as info:
            before = _unique_sources(chunks[:final_top_k])
            chunks = Reranker().rerank(question, chunks, top_k=final_top_k)
            info.update(kept=len(chunks), before=before, after=_unique_sources(chunks))
    else:
        chunks = chunks[:final_top_k]
        if not rerank:
            trace.record("Rerank (cross-encoder)", status="skip", layer="retrieve", reason="disabled")

    chunks, evaluation, used_web = crag_pipeline(
        question=question,
        chunks=chunks,
        enable_crag=enable_crag,
    )
    logger.info(
        "CRAG | enabled={} score={} label={} used_web={}",
        enable_crag,
        evaluation.relevance_score,
        evaluation.relevance_label,
        used_web,
    )
    return chunks, evaluation, used_web


# --------------------------------------------------------------------------- generation


def _parse_answer(raw: str, retry_fn) -> tuple[str, list[str], float, bool]:
    """L9: validate the model's JSON against the response schema, retrying with the
    validation error. Returns (answer, cited_sources, confidence, schema_ok).
    If the model never produces valid JSON, the raw text is still returned (so a
    small local model degrades to a plain answer instead of a 500)."""
    with trace.step("Output schema validation", layer="L9") as info:
        try:
            parsed = validate_with_retry(raw, retry_fn)
            info["result"] = "valid"
            return parsed.answer, parsed.sources, parsed.confidence, True
        except Exception as exc:  # noqa: BLE001
            info.update(status="fallback", result=f"invalid after retries ({type(exc).__name__})")
            text = raw.strip()
            try:
                data = json.loads(text)
                if isinstance(data, dict) and isinstance(data.get("answer"), str):
                    text = data["answer"]
            except json.JSONDecodeError:
                pass
            return text, [], 0.5, False


def generate_rag_answer(
    question: str,
    chunks: list[RetrievedChunk],
    flags: dict | None = None,
) -> ChatResponse:
    enable_self_reflective = bool(
        _flag(flags, "enable_self_reflective", settings.self_reflective_enabled_by_default)
    )

    if not chunks:
        # Nothing relevant survived retrieval + grading. Answering anyway would be
        # the model's unsupported memory presented as fact, so say so plainly.
        trace.record("Generate answer", status="skip", layer="generate", reason="no relevant passages")
        web = " and web search is not configured" if not settings.tavily_api_key else ""
        return ChatResponse(
            answer=(
                "I could not find documentation in the knowledge base that answers this"
                f"{web}, so I won't guess. Try rephrasing, or ask about a Kubernetes topic "
                "the docs cover."
            ),
            sources=[],
            confidence=0.0,
            metadata=ResponseMetadata(route="rag"),
        )

    spotlighted = build_spotlighted_context(chunks)
    system = build_system_prompt()
    trace.record(
        "Spotlighting", layer="L8", chunks=len(chunks), sources=_unique_sources(chunks)[:5]
    )

    def _raw(q: str) -> str:
        with trace.step("Generate answer", layer="generate") as info:
            out = generate(system, f"{spotlighted}\n\nQuestion: {q}", json_mode=True)
            info.update(model=settings.llm_model_answer, tokens=out["usage"].get("total_tokens", 0))
            return out["text"]

    def _retry(prompt: str, _error: str) -> str:
        return generate(system, prompt, json_mode=True)["text"]

    working_q = question
    answer, cited, confidence, _ = _parse_answer(_raw(working_q), _retry)

    # Self-RAG: reflect on the answer; refine the question and retry if weak.
    iterations = 0
    last_score: float | None = None
    final_refined: str | None = None
    if enable_self_reflective:
        while True:
            with trace.step("Self-RAG reflection", layer="reflect") as info:
                reflection = reflect_on_answer(question=working_q, answer=answer, context=spotlighted)
                last_score = float(reflection.reflection_score)
                regenerate = should_regenerate(reflection, iterations)
                info.update(
                    score=round(last_score, 2),
                    regenerate=regenerate,
                    refined=reflection.refined_question if regenerate else "",
                )
            if not regenerate:
                break
            final_refined = reflection.refined_question or working_q
            working_q = final_refined
            answer, cited, confidence, _ = _parse_answer(_raw(working_q), _retry)
            iterations += 1
    else:
        trace.record("Self-RAG reflection", status="skip", layer="reflect", reason="disabled")

    # Keep only citations that point at chunks we actually supplied; a model can
    # invent plausible file names.
    actual = _unique_sources(chunks)
    sources = [s for s in cited if s in actual] or actual

    return ChatResponse(
        answer=answer,
        sources=sources,
        confidence=max(0.0, min(1.0, float(confidence))),
        metadata=ResponseMetadata(
            route="rag",
            retrieved_chunks=_previews(chunks),
            reflection_iterations=iterations,
            reflection_score=last_score,
            refined_question=final_refined,
        ),
    )


def _cache_context(flags: dict | None) -> dict:
    return {
        "search_mode": _flag(flags, "search_mode", "hybrid"),
        "enable_hyde": bool(_flag(flags, "enable_hyde", settings.hyde_enabled_by_default)),
        "enable_rerank": bool(_flag(flags, "enable_rerank", settings.reranking_enabled_by_default)),
        "enable_crag": bool(_flag(flags, "enable_crag", settings.crag_enabled_by_default)),
        "enable_self_reflective": bool(
            _flag(flags, "enable_self_reflective", settings.self_reflective_enabled_by_default)
        ),
        "top_k": int(_flag(flags, "top_k", 5)),
    }


def answer_rag(question: str, flags: dict | None = None) -> ChatResponse:
    """Documentation path used by the LangGraph `rag` route: answer cache ->
    retrieve -> generate. Does not re-classify intent."""
    cache_ctx = _cache_context(flags)
    bypass = bool(_flag(flags, "bypass_cache", False))

    if not bypass:
        with trace.step("RAG answer cache", layer="cache") as info:
            cached = query_cache.get_rag_answer(question, cache_ctx)
            info.update(status="hit" if cached else "miss")
        if cached is not None:
            resp = ChatResponse(**cached)
            resp.cache_hit = True
            resp.metadata.cache_hit = True
            resp.cost_saved = "~1 LLM call"
            return resp

    chunks, evaluation, used_web = retrieve(question, flags)
    response = generate_rag_answer(question, chunks, flags)
    response.metadata.crag_score = evaluation.relevance_score
    response.metadata.crag_label = evaluation.relevance_label
    response.metadata.used_web_fallback = used_web

    query_cache.set_rag_answer(question, response.model_dump(exclude={"metadata": {"trace"}}), cache_ctx)
    return response


# --------------------------------------------------------------------------- inline paths
# Used by the eval harness (service mode), which runs every route end to end
# without the human SQL approval step. The API always goes through LangGraph.


def _run_sql_inline(question: str) -> ChatResponse:
    svc = SQLService()
    try:
        gen = svc.generate_sql(question)
        sql = gen["sql"]
        rows = svc.execute_sql(sql)
        if not rows:
            answer = "No results."
            row_chunks: list[RetrievedChunkPreview] = []
        else:
            answer = f"Query results:\n```\n{json.dumps(rows, indent=2, default=str)}\n```"
            row_chunks = [
                RetrievedChunkPreview(text=json.dumps(row, default=str), source="query_results", score=1.0)
                for row in rows
            ]
        return ChatResponse(
            answer=answer,
            sources=["query_results"],
            confidence=0.9,
            metadata=ResponseMetadata(route="sql", retrieved_chunks=row_chunks, sql=sql, sql_rows=rows[:50]),
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("SQL path failed: {}", exc)
        return ChatResponse(
            answer=f"SQL generation/execution failed: {exc}",
            sources=[],
            confidence=0.0,
            metadata=ResponseMetadata(route="sql", retrieved_chunks=[]),
        )


def _run_hybrid_inline(
    question: str, flags: dict | None
) -> tuple[ChatResponse, list[RetrievedChunk]]:
    chunks, _evaluation, _used_web = retrieve(question, flags=flags)
    svc = SQLService()
    rows: list[dict] = []
    sql_text = ""

    try:
        gen = svc.generate_sql(question)
        sql_text = gen.get("sql", "")
        rows = svc.execute_sql(sql_text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Hybrid SQL leg failed: {}", exc)

    raw = synthesize_hybrid(question, rows, chunks)
    response = ChatResponse(
        answer=raw,
        sources=["query_results"] + _unique_sources(chunks),
        confidence=0.8,
        metadata=ResponseMetadata(
            route="hybrid", retrieved_chunks=_previews(chunks), sql=sql_text or None, sql_rows=rows[:50]
        ),
    )
    return response, chunks


def synthesize_hybrid(question: str, rows: list[dict], chunks: list[RetrievedChunk]) -> str:
    """Combine SQL rows and retrieved documents into one answer."""
    spotlighted = build_spotlighted_context(chunks)
    system = (
        build_system_prompt().split("RESPONSE FORMAT:")[0]
        + "Synthesize the database query results AND the retrieved documents into a single "
        "coherent answer. Cite [database query] for SQL results and [filename] for documents. "
        "Respond in plain text (no JSON)."
    )
    sql_section = ""
    if rows:
        sql_section = (
            f"\n=== Database Results ({len(rows)} rows) ===\n```\n"
            f"{json.dumps(rows[:50], indent=2, default=str)}\n```\n"
        )
    else:
        sql_section = "\n=== Database Results ===\n(no rows returned or query not run)\n"
    with trace.step("Generate hybrid answer", layer="generate") as info:
        out = generate(system, f"{sql_section}{spotlighted}\n\nQuestion: {question}")
        info.update(rows=len(rows), chunks=len(chunks))
        return out["text"]


def run_rag(question: str, flags: dict | int | None = None) -> ChatResponse:
    """Route + answer in one call (no human approval). Kept for scripts and the
    eval harness; the API uses the LangGraph graph instead."""
    flags = flags if isinstance(flags, dict) else None
    intent = classify_intent(question)
    if intent == "sql":
        return _run_sql_inline(question)
    if intent == "hybrid":
        response, _ = _run_hybrid_inline(question, flags)
        return response
    return answer_rag(question, flags)


def run_rag_with_trace(
    question: str, flags: dict | int | None = None
) -> tuple[ChatResponse, list[RetrievedChunk]]:
    flags = flags if isinstance(flags, dict) else None
    intent = classify_intent(question)
    if intent == "sql":
        response = _run_sql_inline(question)
        # Expose SQL rows as RetrievedChunks so eval can score them
        chunks = [
            RetrievedChunk(text=cp.text, source=cp.source, score=cp.score)
            for cp in response.metadata.retrieved_chunks
        ]
        return response, chunks
    if intent == "hybrid":
        return _run_hybrid_inline(question, flags)
    chunks, evaluation, used_web = retrieve(question, flags=flags)
    response = generate_rag_answer(question, chunks, flags=flags)
    response.metadata.crag_score = evaluation.relevance_score
    response.metadata.used_web_fallback = used_web
    return response, chunks


run_rag_with_trace_no_cache = run_rag_with_trace
