import type { QualityRisk } from '@kisansetu/shared';
import type { QueuePolicy } from './policy.js';
import type { CandidateInput, QualityProfile, WorkstationInput } from './types.js';

/**
 * The normalised score components (§11–§20). Every function returns [0, 1]
 * and depends only on its arguments — no clock, no I/O, no randomness — so
 * the same inputs always produce the same numbers (§23).
 */

export const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const minutesBetween = (later: Date, earlier: Date): number =>
  (later.getTime() - earlier.getTime()) / 60_000;

export function waitMinutesOf(candidate: CandidateInput, now: Date): number {
  return Math.max(0, minutesBetween(now, candidate.enteredAt));
}

/** §13 */
export function waitingScore(waitMinutes: number, policy: QueuePolicy): number {
  return clamp01(waitMinutes / policy.targetWaitMinutes);
}

/** §14 — only lateness past the slot's end counts; arriving early is never punished. */
export function slotLatenessMinutes(candidate: CandidateInput, now: Date): number {
  if (!candidate.slotEndAt) return 0;
  return Math.max(0, minutesBetween(now, candidate.slotEndAt));
}

export function slotLatenessScore(latenessMinutes: number, policy: QueuePolicy): number {
  return clamp01(latenessMinutes / policy.slotLatenessThresholdMinutes);
}

/** §15 — the anti-starvation term. */
export function agingScore(waitMinutes: number, policy: QueuePolicy): number {
  return clamp01(waitMinutes / policy.agingThresholdMinutes);
}

/**
 * §16 — legitimate operational urgency only: the booked slot closing, or the
 * centre closing. Nothing about who the farmer is or what the produce is worth.
 */
export function urgencyScore(
  candidate: CandidateInput,
  now: Date,
  centreCloseAt: Date | null,
  policy: QueuePolicy,
): number {
  const slot = candidate.slotEndAt
    ? clamp01(1 - minutesBetween(candidate.slotEndAt, now) / policy.urgencyWindowMinutes)
    : 0;

  const centre = centreCloseAt
    ? clamp01(1 - minutesBetween(centreCloseAt, now) / (2 * policy.urgencyWindowMinutes))
    : 0;

  return Math.max(slot, centre);
}

/**
 * §17 — does the job fit the working time left today?
 *
 * The bounded form: 1 when it fits, decaying with the overrun when it does
 * not. With no closing time configured every job fits, so short jobs gain no
 * standing advantage — the "short jobs must not dominate" requirement.
 */
export function processingFitScore(
  estimatedMinutes: number | null,
  now: Date,
  centreCloseAt: Date | null,
  policy: QueuePolicy,
): { score: number; windowMinutes: number | null } {
  if (estimatedMinutes === null) return { score: 0, windowMinutes: null };
  if (!centreCloseAt) return { score: 1, windowMinutes: null };

  const window = Math.max(0, minutesBetween(centreCloseAt, now));
  if (estimatedMinutes <= window) return { score: 1, windowMinutes: window };
  return {
    score: clamp01(Math.exp(-(estimatedMinutes - window) / policy.fitScaleMinutes)),
    windowMinutes: window,
  };
}

export function isCompatible(station: WorkstationInput, cropId: string | null): boolean {
  if (station.cropIds.length === 0) return true;
  return cropId !== null && station.cropIds.includes(cropId);
}

/** §18 — compatibility is a hard constraint first; among compatible stations, sooner is better. */
export function workstationFitScore(
  candidate: CandidateInput,
  stations: WorkstationInput[],
  policy: QueuePolicy,
): number {
  const usable = stations.filter(
    (station) => station.status !== 'OFFLINE' && isCompatible(station, candidate.cropId),
  );
  if (usable.length === 0) return 0;

  return Math.max(
    ...usable.map((station) => {
      const untilFree =
        station.status === 'AVAILABLE' ? 0 : (station.remainingMinutes ?? policy.fitScaleMinutes);
      return clamp01(Math.exp(-Math.max(0, untilFree) / policy.fitScaleMinutes));
    }),
  );
}

const RISK_ORDER: Record<QualityRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const RISK_PENALTY: Record<QualityRisk, number> = { LOW: 0, MEDIUM: 0.5, HIGH: 1 };

/**
 * What the queue knows about quality, for workflow-effort purposes only.
 *
 * The staff result is authoritative. AI output, when present, can only ADD
 * caution (a higher risk, a manual-inspection flag) — it can never lower the
 * staff member's assessment. A low-confidence prediction is flagged as such,
 * never rounded up to certainty (§7).
 */
export function qualityProfileOf(candidate: CandidateInput, policy: QueuePolicy): QualityProfile {
  const staffRisk: QualityRisk = candidate.qualityResult === 'CONDITIONAL' ? 'MEDIUM' : 'LOW';
  const staffManual = candidate.qualityResult === 'CONDITIONAL';

  if (candidate.aiRisk === null || candidate.aiConfidence === null) {
    return {
      risk: staffRisk,
      confidence: null,
      manualInspectionRequired: staffManual,
      lowConfidence: false,
    };
  }

  const lowConfidence = candidate.aiConfidence < policy.qualityConfidenceThreshold;
  const risk = RISK_ORDER[candidate.aiRisk] > RISK_ORDER[staffRisk] ? candidate.aiRisk : staffRisk;

  return {
    risk,
    confidence: candidate.aiConfidence,
    manualInspectionRequired: staffManual || lowConfidence || Boolean(candidate.aiManualInspection),
    lowConfidence,
  };
}

/**
 * §9 — QualityReadiness: how ready the produce is for smooth processing.
 * Workflow effort, not farmer worthiness.
 *
 * With no model output, the confidence term uses 1: the information is the
 * staff member's own inspection, which is the authoritative decision rather
 * than a probabilistic guess about it.
 */
export function qualityReadinessScore(profile: QualityProfile): number {
  const confidence = profile.confidence ?? 1;
  const inspectionReadiness = profile.manualInspectionRequired ? 0 : 1;
  return clamp01(
    0.5 * confidence + 0.3 * (1 - RISK_PENALTY[profile.risk]) + 0.2 * inspectionReadiness,
  );
}

/**
 * §23 — the bounded, top-level AI Quality Factor.
 *
 * Distinct from qualityReadinessScore() above: readiness measures workflow
 * EFFORT (is this going to need extra handling?) from risk/confidence/manual
 * flags, and stays inside OperationalEfficiencyScore. This measures the
 * model's own quality SCORE, as a small, independent top-level input to
 * FinalPriority (§24) — never the sole, and never even the dominant, term.
 *
 * `confidence` is the blend weight toward neutral (0.5), continuously rather
 * than a hard cutoff, so the four cases in §23 fall out on their own:
 *   high score, high confidence → close to the score itself (useful signal)
 *   high score, low confidence  → close to 0.5 (mostly neutral)
 *   low score,  high confidence → close to the score itself (still useful)
 *   low score,  low confidence  → close to 0.5 (neutral)
 * No AI score at all (confidence null) is fully neutral — an unscored
 * candidate is neither advantaged nor disadvantaged by it.
 */
export function qualityFactorScore(
  aiQualityScore: number | null,
  aiConfidence: number | null,
): number {
  const NEUTRAL = 0.5;
  const normalizedScore = aiQualityScore === null ? NEUTRAL : clamp01(aiQualityScore / 100);
  const confidence = aiConfidence === null ? 0 : clamp01(aiConfidence);
  return clamp01(confidence * normalizedScore + (1 - confidence) * NEUTRAL);
}

/**
 * §19 — the fairness penalty, with decay.
 *
 * Each efficiency-driven lead adds one; one is forgiven for every decay period
 * since the last. It resets entirely when the farmer leaves the queue, so it
 * can never become permanent.
 */
export function fairnessPenalty(candidate: CandidateInput, now: Date, policy: QueuePolicy): number {
  if (candidate.priorityAdvantageCount <= 0) return 0;
  const decayed = candidate.lastAdvantageAt
    ? Math.floor(minutesBetween(now, candidate.lastAdvantageAt) / policy.advantageDecayMinutes)
    : 0;
  const effective = Math.max(0, candidate.priorityAdvantageCount - Math.max(0, decayed));
  return clamp01(effective / policy.advantageLimit);
}
