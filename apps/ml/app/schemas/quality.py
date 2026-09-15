"""Response schema — the contract apps/api validates (§4)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class WeatherContext(BaseModel):
    """Context that shaped the answer. Context, never proof of damage (§5)."""

    available: bool
    temperatureC: float | None = None
    humidityPercent: float | None = None
    rainfallRecentMm: float | None = None
    storageDurationDays: int | None = None
    storageType: str | None = None
    relevance: Literal["NONE", "LOW", "MEDIUM", "HIGH"] = "NONE"


class QualityPrediction(BaseModel):
    modelName: str
    modelVersion: str
    cropId: str
    qualityScore: float = Field(ge=0, le=100)
    qualityRisk: Literal["LOW", "MEDIUM", "HIGH"]
    confidence: float = Field(ge=0, le=1)
    manualInspectionRequired: bool
    estimatedProcessingMinutes: float = Field(ge=0, le=600)
    reasonCodes: list[str]
    inferenceTimestamp: str
    # Provenance. Always present, always shown: see dev_training.py.
    trainingData: str
    developmentModel: bool
    # The raw image statistics behind the answer, for explainability.
    features: dict[str, float]
    weatherContext: WeatherContext | None = None
    assessmentSource: Literal["AI", "AI_WITH_WEATHER_CONTEXT"] = "AI"
