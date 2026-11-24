"""One-off: rebuild the hosted vector store on Modal (more CPU and RAM than a laptop).

    modal volume put sre-copilot-data .localdev/qdrant /src-qdrant
    modal run deploy/modal_reembed.py

Reads the local collection uploaded to /src-qdrant, re-embeds every chunk with the
hosted embedding settings (from the "sre-copilot-env" secret) and writes the store
the app uses at /data/qdrant. Stop the app first: embedded Qdrant allows one process.
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
app = modal.App("sre-copilot-reembed")
image = modal.Image.from_dockerfile(ROOT / "deploy" / "Dockerfile", context_dir=ROOT)
data = modal.Volume.from_name("sre-copilot-data")


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("sre-copilot-env")],
    volumes={"/data": data},
    cpu=8.0,
    memory=16384,
    timeout=60 * 60,
)
def reembed(src_collection: str = "k8s_docs_nomic_v2") -> None:
    import os
    import shutil
    import subprocess

    shutil.rmtree("/data/qdrant", ignore_errors=True)
    subprocess.run(
        ["python", "scripts/reembed_collection.py", "--src-path", "/data/src-qdrant",
         "--src", src_collection, "--dst-path", "/data/qdrant", "--dst", os.environ["QDRANT_COLLECTION"]],
        cwd="/app", env={**os.environ, "REDIS_URL": ""}, check=True,
    )
    data.commit()
