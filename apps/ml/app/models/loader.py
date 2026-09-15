"""Model artifact loading (§46).

Loading and training are separate concerns:

    training/train.py  →  app/models/artifacts/<family>.joblib  →  loader.py

The service LOADS artifacts at startup and never trains as a side effect of
serving a request. The Docker image runs the trainer at BUILD time, so a
container starts with its artifacts already on disk (§9, §46).

If an artifact is missing (a bare developer checkout that has not run the
trainer yet) the loader says so loudly and trains that one family in-process
as a convenience — writing the artifact out so the next start is a load, not
a train. That fallback is logged as a warning, never silent.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import joblib

from app.models.quality.dev_training import TrainedModel, train_family

logger = logging.getLogger("kisansetu.ml")

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
# Bumped whenever the training data or feature set changes, so a stale
# artifact from an older build is never loaded into a newer service.
ARTIFACT_FORMAT = "v1"


def artifact_path(family: str) -> Path:
    return ARTIFACT_DIR / f"{family}-{ARTIFACT_FORMAT}.joblib"


def save(model: TrainedModel) -> Path:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = artifact_path(model.family)
    joblib.dump(model, path)
    return path


def load(family: str) -> TrainedModel:
    """Loads a family's artifact, training it once if it has never been built."""
    path = artifact_path(family)

    if path.exists():
        model = joblib.load(path)
        logger.info("loaded model artifact family=%s path=%s", family, path.name)
        return model

    logger.warning(
        "no artifact for family=%s at %s — training it in-process once. "
        "Run `python -m training.train` (the Docker build does) to avoid this.",
        family,
        path.name,
    )
    model = train_family(family)
    try:
        save(model)
    except OSError as error:  # read-only filesystem in a container is fine
        logger.warning("could not persist artifact family=%s: %s", family, error)
    return model


class ModelStore:
    """Process-wide, loaded once. Never reloaded per request (§9)."""

    def __init__(self) -> None:
        self._models: dict[str, TrainedModel] = {}
        self._lock = threading.Lock()

    def get(self, family: str) -> TrainedModel:
        with self._lock:
            if family not in self._models:
                self._models[family] = load(family)
            return self._models[family]

    def loaded(self) -> list[str]:
        return sorted(self._models)
