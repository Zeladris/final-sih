"""Storage and weather CONTEXT (§5, §6).

What this is: a bounded adjustment that can add caution to a visual
assessment when the produce has been stored a long time, or stored in
conditions (recent rain, high humidity) that make deterioration more likely.

What this is NOT: evidence of damage. Weather cannot see the grain. So the
rules here are deliberately one-directional and small:

  * context may LOWER the quality score and RAISE the risk — never the reverse;
  * the adjustment is capped, so context alone can never turn a good-looking
    sample into a HIGH-risk one on its own;
  * every adjustment emits its own reason code, so a human can see exactly
    what the context contributed and disagree with it.

The official decision is the staff member's, at the centre, either way (§16).
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Storage duration alone: nothing for fresh produce, growing caution with age.
DURATION_CAUTION = ((30, 1.0), (15, 0.7), (8, 0.4), (4, 0.15))
# Open storage is exposed; a warehouse is not.
STORAGE_TYPE_CAUTION = {"OPEN": 1.0, "OTHER": 0.5, "COVERED": 0.35, "WAREHOUSE": 0.0}

HUMIDITY_CAUTION_FROM = 75.0   # %, above which humid storage starts to matter
RAINFALL_CAUTION_FROM = 10.0   # mm in the recent window
HEAT_CAUTION_FROM = 35.0       # °C

# Caps. Context is a nudge, not a verdict.
MAX_SCORE_PENALTY = 12.0       # points off 100
MAX_CONFIDENCE_PENALTY = 0.10


@dataclass
class ContextInput:
    storage_duration_days: int | None = None
    storage_type: str | None = None
    temperature_c: float | None = None
    humidity_percent: float | None = None
    rainfall_recent_mm: float | None = None

    @property
    def has_weather(self) -> bool:
        return any(
            value is not None
            for value in (self.temperature_c, self.humidity_percent, self.rainfall_recent_mm)
        )


@dataclass
class ContextEffect:
    score_penalty: float = 0.0
    confidence_penalty: float = 0.0
    raise_risk: bool = False
    reasons: list[str] = field(default_factory=list)
    relevance: str = "NONE"


def _duration_caution(days: int | None) -> float:
    if days is None:
        return 0.0
    for threshold, weight in DURATION_CAUTION:
        if days >= threshold:
            return weight
    return 0.0


def evaluate(context: ContextInput) -> ContextEffect:
    """Turns storage + weather context into a small, explainable adjustment."""
    effect = ContextEffect()

    duration = _duration_caution(context.storage_duration_days)
    exposure = STORAGE_TYPE_CAUTION.get((context.storage_type or "").upper(), 0.0)

    if duration >= 0.7:
        effect.reasons.append("LONG_STORAGE_DURATION")
    elif duration > 0:
        effect.reasons.append("MODERATE_STORAGE_DURATION")

    # Weather only matters in combination with time in storage: one rainy day
    # is irrelevant to produce that was harvested this morning.
    weather_caution = 0.0
    if context.humidity_percent is not None and context.humidity_percent >= HUMIDITY_CAUTION_FROM:
        weather_caution = max(weather_caution, min(1.0, (context.humidity_percent - HUMIDITY_CAUTION_FROM) / 20.0))
        effect.reasons.append("HUMID_STORAGE_CONDITIONS")
    if context.rainfall_recent_mm is not None and context.rainfall_recent_mm >= RAINFALL_CAUTION_FROM:
        weather_caution = max(weather_caution, min(1.0, context.rainfall_recent_mm / 50.0))
        effect.reasons.append("RECENT_RAINFALL")
    if context.temperature_c is not None and context.temperature_c >= HEAT_CAUTION_FROM:
        weather_caution = max(weather_caution, 0.3)
        effect.reasons.append("HIGH_TEMPERATURE")

    # The combined caution: storage time is the base, exposure and weather
    # scale it. No time in storage → no contextual penalty at all.
    combined = duration * (0.5 + 0.25 * exposure + 0.25 * weather_caution)
    combined = min(1.0, combined)

    effect.score_penalty = round(MAX_SCORE_PENALTY * combined, 2)
    effect.confidence_penalty = round(MAX_CONFIDENCE_PENALTY * combined, 3)
    # Context can nudge risk up one step, and only when it is substantial.
    effect.raise_risk = combined >= 0.6

    if combined >= 0.6:
        effect.relevance = "HIGH"
    elif combined >= 0.3:
        effect.relevance = "MEDIUM"
    elif combined > 0:
        effect.relevance = "LOW"
    else:
        effect.relevance = "NONE"

    if context.has_weather:
        effect.reasons.append("WEATHER_CONTEXT_APPLIED")

    return effect
