import re

from app.config import settings
from app.core import trace
from app.models import RetrievedChunk
from app.services.embedding_service import embed_texts
from app.services.llm_service import generate
from app.services.vector_store import search

_HYDE_SYSTEM_PROMPT = (
    "You are a helpful assistant. Given a user question, write a brief, plausible answer "
    "(2-3 sentences) that would help retrieve relevant documents. Write only the answer, "
    "no preamble."
)

def _normalize_text(text: str) -> str:
    """Normalize whitespace for deduplication."""
    return re.sub(r"\s+", " ", text.strip())

class HyDERetriever:
    def __init__(self, num_hypotheses: int | None = None) -> None:
        self.num_hypotheses = num_hypotheses or settings.hyde_num_hypotheses

    def retrieve(self, question: str, top_k: int = 5) -> list[RetrievedChunk]:
        if not question or not question.strip():
            return []

        with trace.step("HyDE hypotheses", layer="retrieve") as info:
            hypotheses = self._hypotheses(question)
            info.update(count=len(hypotheses), first=(hypotheses[0][:160] if hypotheses else ""))
        return self._search_all(question, hypotheses, top_k)

    def _hypotheses(self, question: str) -> list[str]:
        hypotheses: list[str] = []
        for _ in range(self.num_hypotheses):
            try:
                response = generate(
                    system_prompt=_HYDE_SYSTEM_PROMPT,
                    user_message=question,
                    model=settings.llm_model_answer,
                    temperature=0.7,
                )
                hypothesis = response.get("text", "").strip()
                if hypothesis:
                    hypotheses.append(hypothesis)
            except Exception:
                continue
        return hypotheses

    def _search_all(self, question: str, hypotheses: list[str], top_k: int) -> list[RetrievedChunk]:
        all_texts = hypotheses + [question]

        if not all_texts:
            return []

        # Hypotheses are answer-shaped text, so they are embedded like documents;
        # the original question is embedded as a query.
        embeddings = embed_texts(hypotheses, kind="document") + embed_texts([question], kind="query")

        all_results: list[RetrievedChunk] = []

        for embedding in embeddings:
            try:
                results = search(embedding, top_k=top_k)
                all_results.extend(results)
            except Exception:
                continue

        deduped: dict[str, RetrievedChunk] = {}

        for chunk in all_results:
            key = _normalize_text(chunk.text)
            if key not in deduped or chunk.score > deduped[key].score:
                deduped[key] = chunk

        merged = sorted(deduped.values(), key=lambda c: c.score, reverse=True)
        return merged[:top_k]

