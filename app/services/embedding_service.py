import threading

from app.config import settings
from app.services.llm_service import openai_client
from app.services.query_cache_service import query_cache

_BATCH_SIZE = 64
_local_model = None
_local_lock = threading.Lock()


def _local_embed(texts: list[str], model: str) -> list[list[float]]:
    """In-process ONNX embeddings (EMBEDDING_BACKEND=fastembed).

    A batch is padded to its longest text and attention memory grows with the
    square of that length, so texts are embedded shortest-first in batches that
    shrink as the texts get longer (one long chunk in a batch of 64 can need ~10 GB).
    """
    global _local_model
    with _local_lock:
        if _local_model is None:
            from fastembed import TextEmbedding

            _local_model = TextEmbedding(model_name=model)
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        out: list[list[float]] = [[] for _ in texts]
        start = 0
        while start < len(order):
            longest = len(texts[order[min(start + 31, len(order) - 1)]])  # characters
            size = 32 if longest <= 2_000 else 8 if longest <= 5_000 else 2
            batch = order[start : start + size]
            vectors = _local_model.embed([texts[i] for i in batch], batch_size=size)
            for i, vector in zip(batch, vectors, strict=True):
                out[i] = vector.tolist()
            start += size
        return out


def _embed_batch(texts: list[str], model: str) -> list[list[float]]:
    if settings.embedding_backend == "fastembed":
        return _local_embed(texts, model)
    response = openai_client.embeddings.create(input=texts, model=model)
    return [item.embedding for item in response.data]


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
        for offset, vector in enumerate(_embed_batch(batch, model)):
            original_idx = miss_indices[start + offset]
            results[original_idx] = vector
            query_cache.set_embedding(batch[offset], vector)

    if any(r is None for r in results):
        raise RuntimeError("Embedding service returned fewer vectors than inputs")
    return results  # type: ignore[return-value]
