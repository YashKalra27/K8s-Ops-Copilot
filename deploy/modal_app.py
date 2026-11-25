"""SRE-Copilot on Modal: the API and the built console behind one HTTPS URL.

    modal deploy deploy/modal_app.py

Image: deploy/Dockerfile (models baked in). Config and keys: the Modal secret
"sre-copilot-env". Postgres: Neon (DATABASE_URL in that secret). Vector store:
embedded Qdrant on the Modal volume "sre-copilot-data" (QDRANT_PATH=/data/qdrant),
uploaded once with `modal volume put sre-copilot-data deploy/qdrant /qdrant`.

Embedded Qdrant allows one process per store, so the app runs as one container
that serves many requests concurrently. It scales to zero when idle: the first
visit after a quiet spell cold starts in about 30 s, and the container stays up
for 15 minutes after the last request. Running costs about $0.07 an hour, billed
only while a container is up, so normal use stays inside Modal's free credits.
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
APP_NAME = "sre-copilot"

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(ROOT / "deploy" / "Dockerfile", context_dir=ROOT)
data = modal.Volume.from_name("sre-copilot-data", create_if_missing=True)


@app.function(
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
)
@modal.concurrent(max_inputs=24)
@modal.asgi_app(label=APP_NAME)
def web():
    import os

    os.chdir("/app")
    from app.main import app as fastapi_app

    return fastapi_app

