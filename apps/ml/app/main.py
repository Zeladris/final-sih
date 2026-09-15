"""KisanSetu ML service (§9, §39).

Node owns authorization, business rules, persistence, queue decisions and
state transitions. This service owns inference only. It holds no data, reads
no database and is reached only by the API server — it should not be exposed
publicly.

Models are LOADED once at startup from artifacts built by `training/train.py`
(the Docker build runs it). Nothing here trains per request, and nothing
retrains on every start (§46).

Run locally:  uvicorn app.main:app --port 8000
Run in Docker: see apps/ml/Dockerfile / docker-compose.yml
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.quality import router as quality_router
from app.models.quality.dev_training import TRAINING_DATA_LABEL
from app.services.model_registry import CROP_FAMILY, families, model_version, registry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Load every family's artifact once, before the first request.
    registry.warm()
    yield


app = FastAPI(title="KisanSetu ML", version="2.0.0", lifespan=lifespan)
app.include_router(quality_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "modelsLoaded": registry.loaded()}


@app.get("/v1/models")
def models() -> dict:
    return {
        "models": [
            {"family": family, "modelVersion": model_version(family), "trainingData": TRAINING_DATA_LABEL}
            for family in families()
        ],
        "crops": {"PADDY*": "paddy", **CROP_FAMILY},
        "notice": "Development models trained on synthetic data. Advisory only; not a grading or certification model.",
    }
