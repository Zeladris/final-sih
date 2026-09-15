"""Image features for pre-quality assessment.

Each feature is a simple, inspectable image statistic, so every model output
can be traced back to something visible in the photo:

    dark_ratio        very dark pixels        -> discoloured / damaged grain
    brown_ratio       red-brown, low value    -> damaged or heat-affected grain
    chalky_ratio      bright, unsaturated     -> chalkiness
    green_ratio       green hues              -> immature grain
    hue_spread        spread of hue           -> visual variation / mixing
    texture           mean local gradient     -> foreign matter, husk, debris
    brightness        mean value
    saturation        mean saturation

These are proxies, not measurements. Moisture content, for example, cannot be
seen in a photograph at all and is not claimed.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from PIL import Image, UnidentifiedImageError

FEATURE_NAMES = (
    "dark_ratio",
    "brown_ratio",
    "chalky_ratio",
    "green_ratio",
    "hue_spread",
    "texture",
    "brightness",
    "saturation",
)

ANALYSIS_SIZE = 224
MIN_SIDE_PX = 64


class InvalidImage(ValueError):
    """The bytes are not a usable image."""


@dataclass(frozen=True)
class ImageFeatures:
    vector: np.ndarray
    low_image_quality: bool

    def as_dict(self) -> dict[str, float]:
        return {name: float(value) for name, value in zip(FEATURE_NAMES, self.vector)}


def extract_features(image_bytes: bytes) -> ImageFeatures:
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except (UnidentifiedImageError, OSError) as error:
        raise InvalidImage("The file is not a readable image.") from error

    small = min(image.size) < MIN_SIDE_PX
    rgb = image.convert("RGB").resize((ANALYSIS_SIZE, ANALYSIS_SIZE), Image.Resampling.BILINEAR)

    hsv = np.asarray(rgb.convert("HSV"), dtype=np.float32) / 255.0
    hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    gray = np.asarray(rgb.convert("L"), dtype=np.float32) / 255.0

    dark_ratio = float(np.mean(val < 0.25))
    brown_ratio = float(np.mean(((hue < 0.06) | (hue > 0.95)) & (sat > 0.35) & (val < 0.6)))
    chalky_ratio = float(np.mean((sat < 0.15) & (val > 0.75)))
    green_ratio = float(np.mean((hue > 0.17) & (hue < 0.45) & (sat > 0.25)))

    coloured = hue[sat > 0.15]
    hue_spread = float(np.std(coloured)) if coloured.size > 50 else 0.0

    gradient = np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean()
    texture = float(gradient)

    brightness = float(val.mean())
    saturation = float(sat.mean())

    vector = np.array(
        [dark_ratio, brown_ratio, chalky_ratio, green_ratio, hue_spread, texture, brightness, saturation],
        dtype=np.float64,
    )

    # A photo too small or too dark to judge is flagged, never silently scored.
    low_quality = small or brightness < 0.15

    return ImageFeatures(vector=vector, low_image_quality=low_quality)
