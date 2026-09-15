"""POST /predict/quality (§11).

Multipart: the produce image plus the small amount of validated context the
model needs — crop, quantity, storage duration/type, and optional weather
figures the API resolved. No farmer identity, no booking id, no PII: this
service is given what it needs to look at a photograph and nothing else.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.inference.context import ContextInput
from app.inference.features import InvalidImage
from app.inference.quality_inference import UnsupportedCropError, assess
from app.schemas.quality import QualityPrediction

router = APIRouter(tags=["quality"])

MAX_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png"}
STORAGE_TYPES = {"OPEN", "COVERED", "WAREHOUSE", "OTHER"}


@router.post("/predict/quality", response_model=QualityPrediction)
async def predict_quality(
    image: UploadFile = File(...),
    crop_id: str = Form(..., min_length=1, max_length=40),
    quantity_kg: float = Form(0, ge=0, le=1_000_000),
    storage_duration_days: int | None = Form(None, ge=0, le=3_650),
    storage_type: str | None = Form(None, max_length=20),
    temperature_c: float | None = Form(None, ge=-60, le=70),
    humidity_percent: float | None = Form(None, ge=0, le=100),
    rainfall_recent_mm: float | None = Form(None, ge=0, le=2_000),
) -> QualityPrediction:
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail={"code": "UNSUPPORTED_MEDIA_TYPE"})

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail={"code": "IMAGE_TOO_LARGE"})

    normalised_storage = (storage_type or "").strip().upper() or None
    if normalised_storage is not None and normalised_storage not in STORAGE_TYPES:
        raise HTTPException(status_code=422, detail={"code": "UNKNOWN_STORAGE_TYPE", "storageType": storage_type})

    context = ContextInput(
        storage_duration_days=storage_duration_days,
        storage_type=normalised_storage,
        temperature_c=temperature_c,
        humidity_percent=humidity_percent,
        rainfall_recent_mm=rainfall_recent_mm,
    )

    try:
        return assess(data, crop_id, quantity_kg, context)
    except UnsupportedCropError:
        raise HTTPException(status_code=422, detail={"code": "UNSUPPORTED_CROP", "crop": crop_id})
    except InvalidImage:
        raise HTTPException(status_code=422, detail={"code": "INVALID_IMAGE"})
