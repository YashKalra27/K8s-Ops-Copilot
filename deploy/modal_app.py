"""SRE-Copilot on Modal: the API and the built console behind one HTTPS URL.

    modal deploy deploy/modal_app.py

Image: deploy/Dockerfile (models baked in). Config and keys: the Modal secret
"sre-copilot-env". Postgres: Neon (DATABASE_URL in that secret). Vector store:
embedded Qdrant on the Modal volume "sre-copilot-data" (QDRANT_PATH=/data/qdrant),
uploaded once with `modal volume put sre-copilot-data deploy/qdrant /qdrant`.

Embedded Qdrant allows one process per store, so the app runs as one container
that serves many requests concurrently. It scales to zero when idle and stays up
for 15 minutes after the last request; compute is billed only while it is up.

Memory snapshots make the cold start fast: the three models (injection
classifier, reranker, embedder) are loaded once, the container's memory is
saved, and later cold starts restore it instead of loading them again. Nothing
stateful is opened before the snapshot: Postgres, Qdrant and the BM25 index are
set up by the app's start-up hook after every restore. Settings are read at
import, so redeploy after changing the "sre-copilot-env" secret.
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
APP_NAME = "sre-copilot"

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(ROOT / "deploy" / "Dockerfile", context_dir=ROOT)
data = modal.Volume.from_name("sre-copilot-data", create_if_missing=True)


@app.cls(
    image=image,
    secrets=[
        modal.Secret.from_name("sre-copilot-env"),
        modal.Secret.from_dict({"OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"}),
    ],
    volumes={"/data": data},
    # (reserved, burst limit). A full reserved core keeps the injection classifier,
    # reranker and embedder responsive (0.25 throttled them until requests stalled).
    cpu=(1.0, 2.0),
    memory=(3072, 6144),  # (reserved, limit) in MiB
    max_containers=1,
    scaledown_window=15 * 60,
    timeout=10 * 60,
    enable_memory_snapshot=True,
)
@modal.concurrent(max_inputs=24)
class Web:
    @modal.enter(snap=True)
    def load_models(self) -> None:
        """Runs once per snapshot: models only, no connections, files or threads."""
        import os

        os.chdir("/app")
        from app.config import settings
        from app.main import app as fastapi_app
        from app.security.input_guard import warmup as warm_guard
        from app.services.embedding_service import _local_embed
        from app.services.reranking import Reranker

        warm_guard()
        Reranker()._load_local_model()
        if settings.embedding_backend == "fastembed":
            _local_embed(["warmup"], settings.embedding_model)
        self.fastapi_app = fastapi_app

    @modal.asgi_app(label=APP_NAME)
    def serve(self):
        # The app's lifespan hook (WARMUP_ON_STARTUP) then opens Postgres, Qdrant
        # and the BM25 index after the restore; the models are already in memory.
        return self.fastapi_app
