"""SRE-Copilot on Modal: the API and the built console behind one HTTPS URL.

    modal deploy deploy/modal_app.py

Image: deploy/Dockerfile (models baked in). Config and keys: the Modal secret
"sre-copilot-env". Postgres: Neon (DATABASE_URL in that secret). Vector store:
embedded Qdrant on the Modal volume "sre-copilot-data" (QDRANT_PATH=/data/qdrant),
uploaded once with `modal volume put sre-copilot-data deploy/qdrant /qdrant`.

Embedded Qdrant allows one process per store, so the app runs as one container
that serves many requests concurrently. Two small cron jobs keep it warm during
the day (India time) and let it scale to zero overnight, which keeps a month of
uptime inside Modal's free monthly credits.
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parent.parent
APP_NAME = "sre-copilot"
WARM_FROM, WARM_UNTIL = "0 8 * * *", "0 0 * * *"  # 08:00 to midnight, Asia/Kolkata

app = modal.App(APP_NAME)
image = modal.Image.from_dockerfile(ROOT / "deploy" / "Dockerfile", context_dir=ROOT)
data = modal.Volume.from_name("sre-copilot-data", create_if_missing=True)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name("sre-copilot-env")],
    volumes={"/data": data},
    cpu=(0.25, 2.0),  # (reserved, burst limit): billed on what it actually uses
    memory=(2048, 6144),
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


def _set_min_containers(n: int) -> None:
    modal.Function.from_name(APP_NAME, "web").update_autoscaler(min_containers=n)


@app.function(schedule=modal.Cron(WARM_FROM, timezone="Asia/Kolkata"))
def keep_warm():
    _set_min_containers(1)


@app.function(schedule=modal.Cron(WARM_UNTIL, timezone="Asia/Kolkata"))
def allow_sleep():
    _set_min_containers(0)
