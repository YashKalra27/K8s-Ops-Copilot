from __future__ import annotations

import threading
import uuid
from collections import Counter
from typing import Any

from loguru import logger
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.config import settings
from app.models import RetrievedChunk

_client: QdrantClient | None = None
_client_lock = threading.Lock()

# The BM25 index mirrors the whole collection. Rebuilding it per query (as the
# original code did) means scrolling every point on every request, so it is
# cached and invalidated whenever new chunks are upserted.
_sparse_index: Any | None = None
_sparse_lock = threading.Lock()


def get_client() -> QdrantClient:
    """Shared client. Embedded mode (QDRANT_PATH) can only be opened once per
    process, and server mode benefits from connection reuse, so never create a
    client per call."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                if settings.qdrant_path:
                    _client = QdrantClient(path=settings.qdrant_path)
                else:
                    _client = QdrantClient(url=settings.qdrant_url, timeout=30)
    return _client


def ensure_collection() -> None:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}

    if settings.qdrant_collection not in existing:
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=VectorParams(size=settings.embedding_dim, distance=Distance.COSINE),
        )
        return

    info = client.get_collection(settings.qdrant_collection)
    vectors = info.config.params.vectors
    size = getattr(vectors, "size", None)
    if size is not None and size != settings.embedding_dim:
        raise RuntimeError(
            f"Collection '{settings.qdrant_collection}' stores {size}-dim vectors but "
            f"EMBEDDING_DIM is {settings.embedding_dim}. Use a new QDRANT_COLLECTION "
            "or delete the old one when switching embedding models."
        )


def collection_exists() -> bool:
    try:
        return settings.qdrant_collection in {
            c.name for c in get_client().get_collections().collections
        }
    except Exception:
        return False


def upsert_chunks(
    chunks: list[RetrievedChunk],
    embeddings: list[list[float]],
    extra_payload: dict | None = None,
) -> None:
    ensure_collection()
    client = get_client()
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embedding,
            payload={"text": chunk.text, "source": chunk.source, **(extra_payload or {})},
        )
        for chunk, embedding in zip(chunks, embeddings, strict=True)
    ]
    for start in range(0, len(points), 256):
        client.upsert(collection_name=settings.qdrant_collection, points=points[start : start + 256])
    invalidate_sparse_index()


def search(query_embedding: list[float], top_k: int = 5) -> list[RetrievedChunk]:
    if not collection_exists():
        return []
    client = get_client()
    results = client.query_points(
        collection_name=settings.qdrant_collection,
        query=query_embedding,
        limit=top_k,
        with_payload=True,
    ).points

    return [
        RetrievedChunk(
            text=p.payload.get("text", ""),
            source=p.payload.get("source", ""),
            score=float(p.score),
        )
        for p in results
    ]


def iter_payloads() -> list[dict]:
    """Every point's payload, paging through the whole collection."""
    if not collection_exists():
        return []
    client = get_client()
    out: list[dict] = []
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=settings.qdrant_collection,
            limit=1000,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in points:
            payload = point.payload or {}
            out.append({**payload, "id": str(point.id)})
        if offset is None:
            break
    return out


def invalidate_sparse_index() -> None:
    global _sparse_index
    with _sparse_lock:
        _sparse_index = None


def _get_sparse_index():
    global _sparse_index
    with _sparse_lock:
        if _sparse_index is None:
            from app.services.sparse_vector_service import SparseVectorIndex

            documents = iter_payloads()
            index = SparseVectorIndex()
            index.fit(documents)
            _sparse_index = index
            logger.info("Built BM25 index over {} chunks", len(documents))
        return _sparse_index


def corpus_stats() -> dict:
    """Chunk counts per source document, for the knowledge-base view. Reuses the
    payloads already held by the cached BM25 index instead of scrolling again."""
    payloads = _get_sparse_index().documents
    per_source = Counter(p.get("source", "") for p in payloads)
    corpus_of = {p.get("source", ""): p.get("corpus", "unknown") for p in payloads}
    sources = [
        {"source": src, "chunks": n, "corpus": corpus_of.get(src, "unknown")}
        for src, n in per_source.most_common()
    ]
    return {"total_chunks": len(payloads), "total_sources": len(sources), "sources": sources}


def sparse_search(query_text: str, top_k: int = 5) -> list[RetrievedChunk]:
    """Pure sparse search using BM25 (no dense embeddings, no fusion)."""
    return _get_sparse_index().search(query_text, top_k=top_k)


def hybrid_search(
    query_embedding: list[float],
    query_text: str,
    top_k: int = 5,
    rrf_k: int | None = None,
    sparse_top_k: int = 20,
) -> list[RetrievedChunk]:
    from app.services.sparse_vector_service import fuse_rrf

    dense_results = search(query_embedding, top_k=sparse_top_k)
    sparse_results = _get_sparse_index().search(query_text, top_k=sparse_top_k)
    fused = fuse_rrf([dense_results, sparse_results], rrf_k=rrf_k or settings.rrf_k)
    return fused[:top_k]
