"""Document upload (admin) and knowledge-base listing. The README documented
POST /documents/upload, but the endpoint did not exist."""

import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from loguru import logger

from app.config import settings
from app.middleware.auth import User, get_current_user, require_admin
from app.models import RetrievedChunk
from app.services.doc_cache_service import DocCacheService
from app.services.document_processor import DocumentProcessor
from app.services.embedding_service import embed_texts
from app.services.vector_store import corpus_stats, upsert_chunks

router = APIRouter(tags=["documents"])

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".html", ".htm", ".md", ".txt"}


def _safe_name(filename: str) -> str:
    name = Path(filename).name.strip().replace(" ", "_")
    return "".join(ch for ch in name if ch.isalnum() or ch in "._-") or "upload"


@router.post("/documents/upload")
def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(require_admin),
) -> dict:
    name = _safe_name(file.filename or "upload")
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415, detail=f"Unsupported file type {suffix or '(none)'}; allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )

    content = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File larger than {settings.max_upload_mb} MB")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    # Dedup cache: identical bytes are never parsed or embedded twice.
    cache = DocCacheService()
    content_hash = cache.compute_content_hash(content)
    existing = cache.get_metadata(content_hash)
    if existing:
        return {"status": "duplicate", "content_hash": content_hash, **existing}

    started = time.perf_counter()
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / name
        path.write_bytes(content)
        chunks_meta = DocumentProcessor().process_document(str(path), source_name=name)

    if not chunks_meta:
        raise HTTPException(status_code=422, detail="No text could be extracted from this file")

    chunks = [RetrievedChunk(text=c["text"], source=c["source"]) for c in chunks_meta]
    embeddings = embed_texts([c.text for c in chunks])
    upsert_chunks(chunks, embeddings, extra_payload={"corpus": "upload", "content_hash": content_hash})

    metadata = {
        "source": name,
        "chunks": len(chunks),
        "bytes": len(content),
        "uploaded_by": user.username,
        "seconds": round(time.perf_counter() - started, 2),
    }
    cache.set_metadata(content_hash, metadata)
    logger.info("Uploaded {} -> {} chunks", name, len(chunks))
    return {"status": "indexed", "content_hash": content_hash, **metadata}


@router.get("/documents")
def list_documents(user: User = Depends(get_current_user)) -> dict:
    return corpus_stats()
