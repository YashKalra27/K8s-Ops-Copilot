"""Copy a Qdrant collection into a new embedded store, re-embedding every chunk
with the current embedding settings (EMBEDDING_BACKEND / EMBEDDING_MODEL).

Payloads (text, source, corpus) are kept as they are, so the BM25 index and the
answers' citations do not change; only the dense vectors are recomputed.

    EMBEDDING_BACKEND=fastembed EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5 \\
    uv run python scripts/reembed_collection.py \\
        --src-path .localdev/qdrant --src k8s_docs_nomic_v2 \\
        --dst-path deploy/qdrant --dst k8s_docs
"""
import argparse
import time

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from app.config import settings
from app.services.embedding_service import embed_texts


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--src-path", required=True)
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst-path", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--batch", type=int, default=64)
    args = ap.parse_args()

    src = QdrantClient(path=args.src_path)
    points, offset = [], None
    while True:
        page, offset = src.scroll(args.src, limit=512, offset=offset, with_payload=True)
        points.extend(page)
        if offset is None:
            break
    src.close()
    print(f"read {len(points)} chunks from {args.src}")

    dst = QdrantClient(path=args.dst_path)
    if dst.collection_exists(args.dst):
        dst.delete_collection(args.dst)
    dst.create_collection(
        args.dst, vectors_config=VectorParams(size=settings.embedding_dim, distance=Distance.COSINE)
    )
    t0 = time.time()
    for start in range(0, len(points), args.batch):
        batch = points[start : start + args.batch]
        vectors = embed_texts([p.payload["text"] for p in batch], kind="document")
        dst.upsert(
            args.dst,
            points=[PointStruct(id=p.id, vector=v, payload=p.payload) for p, v in zip(batch, vectors, strict=True)],
        )
        done = start + len(batch)
        if done % 640 < args.batch or done == len(points):
            print(f"  {done}/{len(points)}  {time.time() - t0:.0f}s", flush=True)
    print(f"wrote {dst.count(args.dst).count} points to {args.dst_path}:{args.dst}")
    dst.close()


if __name__ == "__main__":
    main()
