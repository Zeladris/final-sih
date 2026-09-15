"""Trains the development quality models and writes their artifacts (§46).

    python -m training.train            # all families
    python -m training.train paddy      # one family

Run from apps/ml. The Docker build runs this so the image ships with
artifacts and the service never trains at startup.

What this produces is a DEVELOPMENT model trained on synthetic feature
vectors — see app/models/quality/dev_training.py. No accuracy is claimed and
nothing here is a grading or certification model.
"""

from __future__ import annotations

import logging
import sys

from app.models.loader import save
from app.models.quality.dev_training import TRAINING_DATA_LABEL, train_family
from app.services.model_registry import families

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("kisansetu.ml.train")


def main(argv: list[str]) -> int:
    requested = argv[1:] or families()

    unknown = [family for family in requested if family not in families()]
    if unknown:
        logger.error("unknown families: %s (known: %s)", ", ".join(unknown), ", ".join(families()))
        return 2

    for family in requested:
        model = train_family(family)
        path = save(model)
        logger.info("trained family=%s data=%s -> %s", family, TRAINING_DATA_LABEL, path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
