"""Development training data for the quality models.

READ THIS BEFORE TRUSTING ANY OUTPUT.

No labelled produce-quality photographs are available to this project. The
models are therefore trained on SYNTHETIC feature vectors drawn from
hand-specified distributions per risk class. That is enough to exercise the
full pipeline end to end — upload, inference, confidence, reason codes,
persistence, queue effects — and it is labelled as exactly that everywhere
it surfaces (`trainingData: "SYNTHETIC_DEVELOPMENT"`).

It is NOT a validated grading model. No accuracy figure is claimed, because
accuracy against synthetic labels would measure how well the model learned
our own assumptions, not produce quality. Replacing this module with training
on real, labelled samples is the upgrade path; the API does not change.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import RandomForestClassifier

from app.inference.features import FEATURE_NAMES

RISK_CLASSES = ("LOW", "MEDIUM", "HIGH")
TRAINING_DATA_LABEL = "SYNTHETIC_DEVELOPMENT"
SAMPLES_PER_CLASS = 1200
SEED = 20260914


@dataclass(frozen=True)
class FamilyProfile:
    """Per-crop-family appearance assumptions: (mean, sd) per feature, per class."""

    brightness: tuple[float, float]
    saturation: tuple[float, float]
    # Defect-feature means for LOW / MEDIUM / HIGH risk.
    dark: tuple[float, float, float]
    brown: tuple[float, float, float]
    chalky: tuple[float, float, float]
    green: tuple[float, float, float]
    hue_spread: tuple[float, float, float]
    texture: tuple[float, float, float]


FAMILY_PROFILES: dict[str, FamilyProfile] = {
    # Golden paddy: chalkiness and immature (green) grain are the typical issues.
    "paddy": FamilyProfile(
        brightness=(0.68, 0.08),
        saturation=(0.45, 0.08),
        dark=(0.02, 0.07, 0.16),
        brown=(0.01, 0.04, 0.10),
        chalky=(0.04, 0.11, 0.20),
        green=(0.02, 0.07, 0.14),
        hue_spread=(0.04, 0.07, 0.11),
        texture=(0.06, 0.09, 0.13),
    ),
    # Wheat and maize: discolouration and foreign matter dominate.
    "cereal": FamilyProfile(
        brightness=(0.66, 0.09),
        saturation=(0.50, 0.09),
        dark=(0.03, 0.08, 0.17),
        brown=(0.02, 0.06, 0.13),
        chalky=(0.03, 0.07, 0.12),
        green=(0.01, 0.04, 0.09),
        hue_spread=(0.04, 0.07, 0.12),
        texture=(0.07, 0.10, 0.15),
    ),
    # Groundnut and pulses: shrivelled/dark seed and mixing.
    "pulse_oilseed": FamilyProfile(
        brightness=(0.58, 0.10),
        saturation=(0.38, 0.09),
        dark=(0.04, 0.10, 0.20),
        brown=(0.03, 0.08, 0.16),
        chalky=(0.02, 0.05, 0.09),
        green=(0.01, 0.03, 0.07),
        hue_spread=(0.05, 0.09, 0.14),
        texture=(0.08, 0.11, 0.16),
    ),
}


def _sample_class(profile: FamilyProfile, risk_index: int, rng: np.random.Generator, n: int) -> np.ndarray:
    def defect(means: tuple[float, float, float], spread: float) -> np.ndarray:
        mean = means[risk_index]
        return np.clip(rng.normal(mean, max(0.008, mean * spread), n), 0.0, 1.0)

    columns = {
        "dark_ratio": defect(profile.dark, 0.45),
        "brown_ratio": defect(profile.brown, 0.5),
        "chalky_ratio": defect(profile.chalky, 0.45),
        "green_ratio": defect(profile.green, 0.5),
        "hue_spread": defect(profile.hue_spread, 0.35),
        "texture": defect(profile.texture, 0.3),
        "brightness": np.clip(rng.normal(*profile.brightness, n), 0.0, 1.0),
        "saturation": np.clip(rng.normal(*profile.saturation, n), 0.0, 1.0),
    }
    return np.column_stack([columns[name] for name in FEATURE_NAMES])


@dataclass
class TrainedModel:
    family: str
    classifier: RandomForestClassifier
    feature_mean: np.ndarray
    feature_std: np.ndarray
    low_class_mean: np.ndarray


def train_family(family: str) -> TrainedModel:
    profile = FAMILY_PROFILES[family]
    rng = np.random.default_rng(SEED + sum(ord(c) for c in family))

    features = []
    labels = []
    for index, _ in enumerate(RISK_CLASSES):
        block = _sample_class(profile, index, rng, SAMPLES_PER_CLASS)
        features.append(block)
        labels.extend([index] * SAMPLES_PER_CLASS)

    X = np.vstack(features)
    y = np.array(labels)

    classifier = RandomForestClassifier(
        n_estimators=150,
        max_depth=8,
        min_samples_leaf=5,
        random_state=0,
    )
    classifier.fit(X, y)

    return TrainedModel(
        family=family,
        classifier=classifier,
        feature_mean=X.mean(axis=0),
        feature_std=X.std(axis=0) + 1e-6,
        low_class_mean=X[y == 0].mean(axis=0),
    )
