import math
import threading

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer

from app.models import RetrievedChunk

# Keep hyphenated/camel-case K8s terms (kube-proxy, CrashLoopBackOff) as one token.
_TOKEN_PATTERN = r"(?u)\b[\w][\w\-\.]*[\w]\b|\b\w\b"


class SparseVectorIndex:
    """Okapi BM25 over the chunk texts (the "sparse" half of hybrid search).

    Dense embeddings capture meaning; BM25 rewards exact rare terms such as
    ``ErrImagePull`` or ``maxSurge`` that embeddings tend to blur.
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.vectorizer = CountVectorizer(stop_words="english", token_pattern=_TOKEN_PATTERN)
        self.documents: list[dict] = []
        self.matrix = None  # CSC term-frequency matrix (docs x terms)
        self.idf: np.ndarray | None = None
        self.doc_len_norm: np.ndarray | None = None
        self._lock = threading.RLock()

    def fit(self, documents: list[dict]) -> None:
        with self._lock:
            self.documents = documents
            self.matrix = None
            if not documents:
                return

            texts = [doc.get("text", "") for doc in documents]
            try:
                tf = self.vectorizer.fit_transform(texts)
            except ValueError:
                return
            if tf.shape[1] == 0:
                return

            n_docs = tf.shape[0]
            doc_len = np.asarray(tf.sum(axis=1)).ravel().astype(float)
            avg_len = doc_len.mean() or 1.0
            df = np.asarray((tf > 0).sum(axis=0)).ravel()
            self.idf = np.log(1.0 + (n_docs - df + 0.5) / (df + 0.5))
            self.doc_len_norm = self.k1 * (1 - self.b + self.b * doc_len / avg_len)
            self.matrix = tf.tocsc()

    def search(self, query: str, top_k: int = 20) -> list[RetrievedChunk]:
        """Return top-k chunks by BM25 score."""
        with self._lock:
            if self.matrix is None or not self.documents:
                return []

            term_ids = self.vectorizer.transform([query]).indices
            if len(term_ids) == 0:
                return []

            scores = np.zeros(self.matrix.shape[0])
            for t in set(term_ids.tolist()):
                col = self.matrix.getcol(t)
                rows, freqs = col.indices, col.data.astype(float)
                scores[rows] += self.idf[t] * freqs * (self.k1 + 1) / (freqs + self.doc_len_norm[rows])

            top_indices = np.argsort(scores)[::-1][:top_k]
            results: list[RetrievedChunk] = []
            for idx in top_indices:
                score = float(scores[idx])
                if score <= 0 or math.isnan(score):
                    continue
                doc = self.documents[idx]
                results.append(
                    RetrievedChunk(text=doc.get("text", ""), source=doc.get("source", ""), score=score)
                )
            return results


def fuse_rrf(
    result_lists: list[list[RetrievedChunk]],
    rrf_k: int = 60,
) -> list[RetrievedChunk]:
    """Fuse multiple ranked result lists using Reciprocal Rank Fusion.

    Each list contributes 1 / (k + rank) for every chunk it returned, so a chunk
    ranked well by BOTH retrievers beats one ranked first by only one of them.
    """
    scores: dict[str, float] = {}
    meta: dict[str, dict] = {}

    for result_list in result_lists:
        for rank, chunk in enumerate(result_list):
            key = chunk.text
            scores[key] = scores.get(key, 0.0) + 1.0 / (rrf_k + rank + 1)
            if key not in meta:
                meta[key] = {"text": chunk.text, "source": chunk.source}

    return [
        RetrievedChunk(text=text, source=meta[text]["source"], score=score)
        for text, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ]
