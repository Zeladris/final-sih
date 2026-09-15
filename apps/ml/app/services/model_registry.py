"""Crop-aware model registry (§8).

crop code -> crop family -> loaded model. Adding a crop is a registry entry;
adding a real model for a family replaces its training function. Unknown crops
are refused explicitly rather than guessed with the nearest model.

Crop support is data-driven (this table), not hard-coded to three crops.
"""

from __future__ import annotations

from app.models.loader import ModelStore
from app.models.quality.dev_training import TrainedModel

MODEL_VERSION_SUFFIX = "dev-v1"

# Crop codes come from the platform's crop catalogue (public.crops.code).
CROP_FAMILY: dict[str, str] = {
    "PADDY": "paddy",
    "WHEAT": "cereal",
    "MAIZE": "cereal",
    "GROUNDNUT": "pulse_oilseed",
    "BLACK_GRAM": "pulse_oilseed",
    "GREEN_GRAM": "pulse_oilseed",
}


def families() -> list[str]:
    return sorted(set(CROP_FAMILY.values()))


def family_for(crop_code: str) -> str | None:
    code = crop_code.strip().upper()
    if code.startswith("PADDY"):
        return "paddy"
    return CROP_FAMILY.get(code)


def model_name(family: str) -> str:
    return f"{family.replace('_', '-')}-quality"


def model_version(family: str) -> str:
    return f"{model_name(family)}-{MODEL_VERSION_SUFFIX}"


class ModelRegistry:
    """Thin naming layer over the artifact store; the store owns the loading."""

    def __init__(self) -> None:
        self._store = ModelStore()

    def get(self, family: str) -> TrainedModel:
        return self._store.get(family)

    def warm(self) -> None:
        """Loads every family once, at startup. Loads — does not train (§46)."""
        for family in families():
            self.get(family)

    def loaded(self) -> list[str]:
        return self._store.loaded()


registry = ModelRegistry()
