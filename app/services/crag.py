
import json
import logging
from concurrent.futures import ThreadPoolExecutor

from app.config import settings
from app.core import trace
from app.models import CRAGEvaluation, RetrievedChunk
from app.services.llm_service import generate_with_json
from app.services.web_search import search_web

logger = logging.getLogger(__name__)

_GRADING_PROMPT = """Question: {question}

Passage:
\"\"\"{passage}\"\"\"

Does this passage contain information that helps answer the question (even partly,
such as a cause, a fix, or a definition)?
Respond only with JSON: {{"relevant": "yes" | "partly" | "no", "score": <0.0-1.0>}}"""


def _grade_one(question: str, chunk: RetrievedChunk) -> float:
    result = generate_with_json(
        system_prompt="You judge whether a passage is useful for a question. Respond only with JSON.",
        user_message=_GRADING_PROMPT.format(question=question, passage=chunk.text[:1200]),
        model=settings.llm_model_grader,
        temperature=0.0,
    )
    parsed = json.loads(result.get("text", "{}"))
    label = str(parsed.get("relevant", "")).strip().lower()
    try:
        score = max(0.0, min(1.0, float(parsed.get("score", 0.0))))
    except (TypeError, ValueError):
        score = 0.0
    # The label decides the band (small models give labels more reliably than
    # calibrated numbers); the number only positions the passage inside it.
    hi, lo = settings.crag_relevance_threshold, settings.crag_ambiguous_threshold
    if label == "yes":
        return max(score, hi)
    if label == "partly":
        return min(max(score, lo), hi - 0.01)
    return min(score, lo - 0.01) if label == "no" else score


def grade_passages(question: str, chunks: list[RetrievedChunk]) -> tuple[list[float], str]:
    """Score every (question, passage) pair separately, as the CRAG paper's
    retrieval evaluator does. Grading all passages in one prompt made small
    models give every passage the same score."""
    with ThreadPoolExecutor(max_workers=min(4, len(chunks))) as pool:
        futures = [pool.submit(_grade_one, question, c) for c in chunks]
    scores = []
    for f in futures:
        try:
            scores.append(f.result())
        except Exception:  # noqa: BLE001
            logger.exception("Grading one passage failed")
            scores.append(0.0)
    kept = sum(sc >= settings.crag_ambiguous_threshold for sc in scores)
    return scores, f"{kept} of {len(scores)} passages judged useful"


def grade_chunks(question: str, chunks: list[RetrievedChunk]) -> CRAGEvaluation:
    """Overall evaluation = the best passage's score (CRAG: retrieval is "correct"
    when at least one passage is clearly relevant)."""
    if not chunks:
        return CRAGEvaluation(relevance_score=0.0, relevance_label="irrelevant", confidence=1.0,
                              reasoning="No documents retrieved.")
    try:
        scores, reasoning = grade_passages(question, chunks)
    except Exception:
        logger.exception("Failed to grade chunks")
        return CRAGEvaluation(relevance_score=0.0, relevance_label="error", confidence=0.0,
                              reasoning="Grading failed")
    best = max(scores)
    label = (
        "highly_relevant" if best >= settings.crag_relevance_threshold
        else "ambiguous" if best >= settings.crag_ambiguous_threshold
        else "irrelevant"
    )
    return CRAGEvaluation(relevance_score=best, relevance_label=label, confidence=1.0,
                          reasoning=reasoning, passage_scores=scores)


def should_trigger_web_search(evaluation: CRAGEvaluation) -> bool:
    """Return True if web search fallback should be triggered."""
    return evaluation.relevance_score < settings.crag_relevance_threshold


def _web(question: str) -> list[RetrievedChunk] | None:
    """Tavily results, or None when no API key is configured."""
    with trace.step("Web search (Tavily)", layer="crag") as info:
        try:
            results = search_web(question)
        except ValueError:
            info.update(status="skip", reason="TAVILY_API_KEY not configured")
            logger.warning("Web search triggered but Tavily API key not configured")
            return None
        info.update(results=len(results))
        return results


def crag_pipeline(
    question: str,
    chunks: list[RetrievedChunk],
    enable_crag: bool = True,
) -> tuple[list[RetrievedChunk], CRAGEvaluation, bool]:
    """Corrective RAG. Grade the retrieved chunks, then:
    - correct (score >= relevance threshold): keep them;
    - ambiguous (between the two thresholds): keep them AND add web results;
    - incorrect (below the ambiguous threshold): replace them with web results.
    """
    if not enable_crag:
        trace.record("CRAG grading", status="skip", layer="crag", reason="disabled")
        return (
            chunks,
            CRAGEvaluation(
                relevance_score=1.0,
                relevance_label="skipped",
                confidence=1.0,
                reasoning="CRAG disabled",
            ),
            False,
        )

    if not chunks:
        evaluation = CRAGEvaluation(
            relevance_score=0.0,
            relevance_label="irrelevant",
            confidence=1.0,
            reasoning="No chunks retrieved",
        )
        trace.record("CRAG grading", status="fallback", layer="crag", score=0.0, verdict="no chunks")
        web_chunks = _web(question)
        return (web_chunks or [], evaluation, bool(web_chunks))

    with trace.step("CRAG grading", layer="crag") as info:
        evaluation = grade_chunks(question, chunks)
        score = evaluation.relevance_score
        # Knowledge refinement: drop passages graded below the ambiguous bar, so
        # noise that survived search never reaches the answer prompt.
        if evaluation.passage_scores:
            kept = [c for c, sc in zip(chunks, evaluation.passage_scores, strict=False)
                    if sc >= settings.crag_ambiguous_threshold]
            info.update(passages=[round(x, 2) for x in evaluation.passage_scores], kept=len(kept))
            chunks = kept or chunks
        if score >= settings.crag_relevance_threshold:
            verdict = "correct"
        elif score >= settings.crag_ambiguous_threshold:
            verdict = "ambiguous"
        else:
            verdict = "incorrect"
        info.update(score=round(score, 2), label=evaluation.relevance_label, verdict=verdict)
        if verdict != "correct":
            info["status"] = "fallback"

    if verdict == "correct":
        return (chunks, evaluation, False)

    web_chunks = _web(question)
    if verdict == "ambiguous":
        return (chunks + (web_chunks or []), evaluation, bool(web_chunks))
    return (web_chunks or [], evaluation, bool(web_chunks))
