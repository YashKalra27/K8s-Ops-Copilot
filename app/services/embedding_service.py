from app.config import settings
from app.services.llm_service import openai_client
from app.services.query_cache_service import query_cache

_BATCH_SIZE = 64


def embed_texts(
    texts: list[str], model: str | None = None, kind: str = "document"
) -> list[list[float]]:
    """Embed texts. `kind` is "query" for search questions and "document" for
    stored chunks; it selects the model's task prefix when one is configured."""
    if not texts:
        return []
    if model is None:
        model = settings.embedding_model
    prefix = settings.embedding_query_prefix if kind == "query" else settings.embedding_document_prefix
    if prefix:
        texts = [prefix + t for t in texts]

    results: list[list[float] | None] = [None] * len(texts)
    miss_indices: list[int] = []
    miss_texts: list[str] = []

    for i, text in enumerate(texts):
        cached = query_cache.get_embedding(text)
        if cached is not None:
            results[i] = cached
        else:
            miss_indices.append(i)
            miss_texts.append(text)

    # Batch the misses so a large document doesn't hit request-size limits.
    for start in range(0, len(miss_texts), _BATCH_SIZE):
        batch = miss_texts[start : start + _BATCH_SIZE]
        response = openai_client.embeddings.create(input=batch, model=model)
        for offset, item in enumerate(response.data):
            original_idx = miss_indices[start + offset]
            vector = item.embedding
            results[original_idx] = vector
            query_cache.set_embedding(batch[offset], vector)

    if any(r is None for r in results):
        raise RuntimeError("Embedding service returned fewer vectors than inputs")
    return results  # type: ignore[return-value]
