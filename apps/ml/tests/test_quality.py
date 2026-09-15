"""The service's honesty contract: provenance always present, unknown crops
refused, poor inputs lower confidence rather than raise it, same input → same
output, and storage/weather context can only add caution (§5)."""

import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app


def _png(rgb: tuple[int, int, int], size: int = 256, noise: int = 12, seed: int = 1) -> bytes:
    rng = np.random.default_rng(seed)
    base = np.full((size, size, 3), rgb, dtype=np.int16)
    pixels = np.clip(base + rng.integers(-noise, noise, base.shape), 0, 255).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


def _assess(client: TestClient, image: bytes, crop: str = "PADDY_SAMBA", **context):
    data = {"crop_id": crop, "quantity_kg": "450", **{k: str(v) for k, v in context.items()}}
    return client.post(
        "/predict/quality",
        files={"image": ("sample.png", image, "image/png")},
        data=data,
    )


def test_prediction_carries_provenance_and_is_deterministic():
    with TestClient(app) as client:
        golden = _png((205, 160, 70))
        first = _assess(client, golden)
        second = _assess(client, golden)
        assert first.status_code == 200
        body = first.json()
        assert body["trainingData"] == "SYNTHETIC_DEVELOPMENT"
        assert body["developmentModel"] is True
        assert "DEVELOPMENT_MODEL" in body["reasonCodes"]
        assert body["modelVersion"] == "paddy-quality-dev-v1"
        assert body["assessmentSource"] == "AI"
        assert 0 <= body["confidence"] <= 1
        # Same image, same model: same answer, apart from the timestamp.
        a, b = dict(body), dict(second.json())
        a.pop("inferenceTimestamp"), b.pop("inferenceTimestamp")
        assert a == b


def test_unknown_crop_is_refused_not_guessed():
    with TestClient(app) as client:
        response = _assess(client, _png((205, 160, 70)), crop="SUGARCANE")
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "UNSUPPORTED_CROP"


def test_dark_photo_lowers_confidence_and_requires_manual_check():
    with TestClient(app) as client:
        body = _assess(client, _png((12, 10, 8), noise=4)).json()
        assert "LOW_IMAGE_QUALITY" in body["reasonCodes"]
        assert body["confidence"] <= 0.5
        assert body["manualInspectionRequired"] is True


def test_not_an_image_is_rejected():
    with TestClient(app) as client:
        response = client.post(
            "/predict/quality",
            files={"image": ("x.png", b"not an image", "image/png")},
            data={"crop_id": "PADDY", "quantity_kg": "10"},
        )
        assert response.status_code == 422


def test_context_only_adds_caution_and_says_why():
    """Long, exposed, humid storage lowers the score — it never raises it (§5)."""
    with TestClient(app) as client:
        golden = _png((205, 160, 70))
        plain = _assess(client, golden).json()
        contextual = _assess(
            client,
            golden,
            storage_duration_days=40,
            storage_type="OPEN",
            humidity_percent=92,
            rainfall_recent_mm=30,
        ).json()

        assert contextual["qualityScore"] <= plain["qualityScore"]
        assert contextual["confidence"] <= plain["confidence"]
        assert "LONG_STORAGE_DURATION" in contextual["reasonCodes"]
        assert "HUMID_STORAGE_CONDITIONS" in contextual["reasonCodes"]
        assert contextual["assessmentSource"] == "AI_WITH_WEATHER_CONTEXT"
        assert contextual["weatherContext"]["relevance"] in {"LOW", "MEDIUM", "HIGH"}
        assert contextual["weatherContext"]["storageDurationDays"] == 40


def test_fresh_produce_gets_no_contextual_penalty():
    with TestClient(app) as client:
        golden = _png((205, 160, 70))
        plain = _assess(client, golden).json()
        fresh = _assess(client, golden, storage_duration_days=1, storage_type="WAREHOUSE").json()

        assert fresh["qualityScore"] == plain["qualityScore"]
        assert fresh["weatherContext"]["relevance"] == "NONE"


def test_unknown_storage_type_is_refused():
    with TestClient(app) as client:
        response = _assess(client, _png((205, 160, 70)), storage_type="SILO")
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "UNKNOWN_STORAGE_TYPE"
