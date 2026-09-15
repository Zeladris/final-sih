"""Quality inference: image -> advisory prediction.

The output is a PRE-quality assessment for operational planning. The official
quality decision is made by authorised centre staff; nothing here certifies,
grades or rejects produce.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from app.inference.context import ContextInput, evaluate as evaluate_context
from app.inference.features import ImageFeatures, extract_features
from app.models.quality.dev_training import RISK_CLASSES, TRAINING_DATA_LABEL
from app.schemas.quality import QualityPrediction, WeatherContext
from app.services.model_registry import family_for, model_name, model_version, registry

CONFIDENCE_THRESHOLD = 0.75
# How far (in training standard deviations) a feature vector may sit from the
# training data before the model's answer is treated as out of its depth.
OUT_OF_DISTRIBUTION_Z = 4.0

RISK_PROCESSING_ADJUSTMENT = {"LOW": 0.0, "MEDIUM": 3.0, "HIGH": 6.0}
QUALITY_WEIGHT = {"LOW": 0.92, "MEDIUM": 0.60, "HIGH": 0.25}


class UnsupportedCropError(ValueError):
    pass


def assess(
    image_bytes: bytes,
    crop_code: str,
    quantity_kg: float,
    context: ContextInput | None = None,
) -> QualityPrediction:
    family = family_for(crop_code)
    if family is None:
        raise UnsupportedCropError(crop_code)

    model = registry.get(family)
    features = extract_features(image_bytes)
    x = features.vector.reshape(1, -1)

    probabilities = model.classifier.predict_proba(x)[0]
    classes = [RISK_CLASSES[int(label)] for label in model.classifier.classes_]
    by_class = dict(zip(classes, (float(p) for p in probabilities)))

    risk = max(by_class, key=lambda key: (by_class[key], -RISK_CLASSES.index(key)))
    confidence = by_class[risk]

    reasons: list[str] = []

    # Confidence is reduced — never inflated — when the photo is poor or unlike
    # anything the model has seen. A low-confidence answer is reported as one.
    z = np.abs((features.vector - model.feature_mean) / model.feature_std)
    if float(z.max()) > OUT_OF_DISTRIBUTION_Z:
        confidence *= 0.5
        reasons.append("IMAGE_NOT_RECOGNISED")
    if features.low_image_quality:
        confidence = min(confidence, 0.5)
        reasons.append("LOW_IMAGE_QUALITY")

    reasons.extend(_visual_reasons(features, model.low_class_mean))

    # An expected-quality index from the class probabilities, 0-100.
    score = 100.0 * sum(QUALITY_WEIGHT[name] * p for name, p in by_class.items())

    # Storage + weather CONTEXT (§5). Bounded, one-directional, explainable:
    # it can only add caution to what the image showed, never improve it.
    ctx = context or ContextInput()
    effect = evaluate_context(ctx)
    if effect.score_penalty or effect.confidence_penalty or effect.raise_risk:
        score = max(0.0, score - effect.score_penalty)
        confidence = max(0.0, confidence - effect.confidence_penalty)
        if effect.raise_risk and risk != "HIGH":
            risk = RISK_CLASSES[min(RISK_CLASSES.index(risk) + 1, len(RISK_CLASSES) - 1)]
    reasons.extend(effect.reasons)

    manual = risk != "LOW" or confidence < CONFIDENCE_THRESHOLD
    if manual:
        reasons.append("MANUAL_CHECK_RECOMMENDED")
    reasons.append("DEVELOPMENT_MODEL")

    minutes = 6.0 + 1.5 * max(0.0, quantity_kg) / 100.0 + RISK_PROCESSING_ADJUSTMENT[risk] + (5.0 if manual else 0.0)

    weather = WeatherContext(
        available=ctx.has_weather,
        temperatureC=ctx.temperature_c,
        humidityPercent=ctx.humidity_percent,
        rainfallRecentMm=ctx.rainfall_recent_mm,
        storageDurationDays=ctx.storage_duration_days,
        storageType=ctx.storage_type,
        relevance=effect.relevance,
    )

    return QualityPrediction(
        modelName=model_name(family),
        modelVersion=model_version(family),
        cropId=crop_code.upper(),
        qualityScore=round(score, 1),
        qualityRisk=risk,
        confidence=round(float(np.clip(confidence, 0.0, 1.0)), 3),
        manualInspectionRequired=manual,
        estimatedProcessingMinutes=round(min(240.0, minutes), 1),
        reasonCodes=list(dict.fromkeys(reasons)),
        inferenceTimestamp=datetime.now(timezone.utc).isoformat(),
        trainingData=TRAINING_DATA_LABEL,
        developmentModel=True,
        features=features.as_dict(),
        weatherContext=weather,
        assessmentSource="AI_WITH_WEATHER_CONTEXT" if ctx.has_weather else "AI",
    )


def _visual_reasons(features: ImageFeatures, low_mean: np.ndarray) -> list[str]:
    """Which visible signals sit well above what a low-risk sample looks like."""
    f = features.as_dict()
    names = ("dark_ratio", "brown_ratio", "chalky_ratio", "green_ratio", "hue_spread", "texture")
    baseline = dict(zip(names, low_mean[: len(names)]))

    def elevated(name: str, factor: float = 2.0) -> bool:
        return f[name] > max(baseline[name] * factor, baseline[name] + 0.02)

    reasons = []
    if elevated("dark_ratio") or elevated("brown_ratio"):
        reasons.append("HIGH_DISCOLOURATION")
    if elevated("green_ratio"):
        reasons.append("IMMATURE_GRAINS_SUSPECTED")
    if elevated("chalky_ratio"):
        reasons.append("CHALKINESS_SUSPECTED")
    if elevated("texture", 1.5):
        reasons.append("FOREIGN_MATTER_SUSPECTED")
    if elevated("hue_spread", 1.6):
        reasons.append("VISUAL_VARIATION")
    return reasons
