import { QUEUE_REASON_CODES } from '@kisansetu/shared';
import type { QueueReasonCode, ScoreBreakdown } from '@kisansetu/shared';
import { ineligibleReasons } from './eligibility.js';
import {
  agingScore,
  clamp01,
  fairnessPenalty,
  isCompatible,
  processingFitScore,
  qualityFactorScore,
  qualityProfileOf,
  qualityReadinessScore,
  slotLatenessMinutes,
  slotLatenessScore,
  urgencyScore,
  waitingScore,
  waitMinutesOf,
  workstationFitScore,
} from './scores.js';
import { estimateWaits } from './waitEstimator.js';
import type {
  CandidateInput,
  OptimizerContext,
  OptimizerResult,
  RankedCandidate,
  WorkstationInput,
} from './types.js';

/**
 * Fairness-Aware Dynamic Queue Optimization, version fa-dqo-v2 (§18–§26).
 *
 *   1. Hard eligibility — failures are not ranked at all (§19).
 *   2. Protected priority — anyone waiting ≥ MAX_WAIT_OVERRIDE is served
 *      before everyone else, ordered by fairness. Nothing below — efficiency,
 *      quality or urgency — can starve them (§25).
 *   3. Everyone else — FinalPriority =
 *        0.60·Fairness + 0.20·Efficiency + 0.10·QualityFactor + 0.10·Urgency − penaltyWeight·Penalty
 *      Quality appears TWICE, deliberately kept separate: inside Efficiency as
 *      workflow-effort readiness (risk/confidence/manual-inspection — §22),
 *      and as its own small, bounded, top-level factor built from the AI's
 *      actual score (§23–§24). Neither is close to fairness's 60%, and low AI
 *      confidence blends the top-level factor toward neutral rather than
 *      letting an uncertain prediction move anyone.
 *   4. Deterministic tie-breaking — no randomness, no LLM (§26).
 *
 * Pure: same candidates + same stations + same context = same order.
 */
export function optimizeQueue(
  candidates: CandidateInput[],
  stations: WorkstationInput[],
  context: OptimizerContext,
): OptimizerResult {
  const { now, policy, centreCloseAt } = context;

  const evaluated: RankedCandidate[] = candidates.map((input) => {
    const reasons = ineligibleReasons(input, stations);
    const quality = qualityProfileOf(input, policy);
    const compatibleAvailableWorkstationIds = stations
      .filter((station) => station.status === 'AVAILABLE' && isCompatible(station, input.cropId))
      .map((station) => station.id)
      .sort();

    if (reasons.length > 0) {
      return {
        input,
        eligible: false,
        ineligibleReasons: reasons,
        rank: null,
        breakdown: null,
        reasonCodes: [],
        quality,
        advantage: false,
        estimatedWaitMinutes: null,
        compatibleAvailableWorkstationIds,
      };
    }

    const waitMinutes = waitMinutesOf(input, now);
    const lateness = slotLatenessMinutes(input, now);

    const W = waitingScore(waitMinutes, policy);
    const L = slotLatenessScore(lateness, policy);
    const A = agingScore(waitMinutes, policy);
    const U = urgencyScore(input, now, centreCloseAt, policy);

    const fairnessScore = clamp01(
      policy.fairnessWaitWeight * W +
        policy.fairnessLatenessWeight * L +
        policy.fairnessAgingWeight * A +
        policy.fairnessUrgencyWeight * U,
    );

    const fit = processingFitScore(input.estimatedProcessingMinutes, now, centreCloseAt, policy);
    const S = workstationFitScore(input, stations, policy);
    const Q = qualityReadinessScore(quality);

    const operationalEfficiencyScore = clamp01(
      policy.processingFitWeight * fit.score +
        policy.workstationFitWeight * S +
        policy.qualityReadinessWeight * Q,
    );

    // §23 — the bounded, TOP-LEVEL quality factor. Reads input.aiConfidence
    // directly rather than quality.confidence: the latter is null whenever
    // aiRisk is absent (qualityProfileOf's "no usable AI profile" case), but
    // a quality score can arrive with its own confidence independently of
    // risk, and this factor must not be zeroed out just because risk is not
    // yet on the entry.
    const QF = qualityFactorScore(input.aiQualityScore, input.aiConfidence);

    const R = fairnessPenalty(input, now, policy);

    const finalPriority = clamp01(
      policy.fairnessWeight * fairnessScore +
        policy.efficiencyWeight * operationalEfficiencyScore +
        policy.qualityWeight * QF +
        policy.urgencyWeight * U -
        policy.penaltyWeight * R,
    );

    const isProtected = waitMinutes >= policy.maxWaitOverrideMinutes;

    const breakdown: ScoreBreakdown = {
      waitMinutes: round(waitMinutes, 2),
      slotLatenessMinutes: round(lateness, 2),
      waitScore: round(W),
      slotLatenessScore: round(L),
      agingScore: round(A),
      urgencyScore: round(U),
      fairnessScore: round(fairnessScore),
      processingFitScore: round(fit.score),
      workstationFitScore: round(S),
      qualityReadinessScore: round(Q),
      operationalEfficiencyScore: round(operationalEfficiencyScore),
      qualityFactorScore: round(QF),
      fairnessPenalty: round(R),
      finalPriority: round(finalPriority),
      isProtected,
    };

    const codes = new Set<QueueReasonCode>();
    if (isProtected) codes.add('MAX_WAIT_PROTECTION');
    if (waitMinutes >= policy.targetWaitMinutes / 2) codes.add('LONG_WAIT');
    if (A >= 0.75) codes.add('AGING_PRIORITY');
    if (lateness > 0) codes.add('SLOT_DELAY');
    if (U >= 0.5) codes.add('URGENT_SLOT');
    // Only meaningful when working time is actually running short.
    if (fit.windowMinutes !== null && fit.windowMinutes <= 4 * policy.fitScaleMinutes && fit.score >= 0.99) {
      codes.add('PROCESSING_FIT');
    }
    if (compatibleAvailableWorkstationIds.length > 0) codes.add('WORKSTATION_AVAILABLE');
    if (
      stations.some(
        (station) =>
          station.status === 'AVAILABLE' &&
          station.cropIds.length > 0 &&
          isCompatible(station, input.cropId),
      )
    ) {
      codes.add('WORKSTATION_COMPATIBILITY');
    }
    if (quality.manualInspectionRequired) codes.add('MANUAL_ASSESSMENT');
    // §23/§30 — the quality factor was either a real signal or, under low
    // confidence, deliberately blended toward neutral. Never both. Computed
    // from input.aiConfidence directly (see QF above), not quality.lowConfidence,
    // which is null whenever aiRisk is absent even if a score/confidence exists.
    const qualityConfidenceLow =
      input.aiConfidence !== null && input.aiConfidence < policy.qualityConfidenceThreshold;
    if (input.aiQualityScore !== null && qualityConfidenceLow) codes.add('QUALITY_LOW_CONFIDENCE_NEUTRAL');
    else if (input.aiQualityScore !== null) codes.add('QUALITY_OPERATIONAL_SIGNAL');
    if (R > 0) codes.add('FAIRNESS_PENALTY');

    return {
      input,
      eligible: true,
      ineligibleReasons: [],
      rank: null,
      breakdown,
      reasonCodes: QUEUE_REASON_CODES.filter((code) => codes.has(code)),
      quality,
      advantage: false,
      estimatedWaitMinutes: null,
      compatibleAvailableWorkstationIds,
    };
  });

  const eligible = evaluated.filter((entry) => entry.eligible).sort(compareRanked);
  const ineligible = evaluated
    .filter((entry) => !entry.eligible)
    .sort((a, b) => a.input.enteredAt.getTime() - b.input.enteredAt.getTime() || stableId(a, b));

  eligible.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  applyWaits(eligible, stations, policy.fitScaleMinutes);
  markAdvantage(eligible, context.previousNextBookingId);

  return { ranked: eligible, ineligible, next: eligible[0] ?? null };
}

/** Re-applies waits for an order chosen elsewhere (e.g. a kept stable order). */
export function applyWaits(
  ordered: RankedCandidate[],
  stations: WorkstationInput[],
  fallbackRemainingMinutes: number,
): void {
  const waits = estimateWaits(
    ordered.map((entry) => ({
      bookingId: entry.input.bookingId,
      cropId: entry.input.cropId,
      estimatedMinutes: entry.input.estimatedProcessingMinutes ?? 0,
    })),
    stations,
    fallbackRemainingMinutes,
  );
  for (const entry of ordered) entry.estimatedWaitMinutes = waits.get(entry.input.bookingId) ?? null;
}

/**
 * §19 — an efficiency-driven lead is recorded only when the NEXT changes to a
 * candidate who is not protected and whom someone else outranks on fairness
 * alone. Counting at every recalculation would inflate it; counting only at
 * a change of NEXT counts actual advantages.
 */
function markAdvantage(ranked: RankedCandidate[], previousNextBookingId: string | null): void {
  const next = ranked[0];
  if (!next?.breakdown || next.input.bookingId === previousNextBookingId) return;
  if (next.breakdown.isProtected) return;

  const overtook = ranked.some(
    (other) =>
      other !== next &&
      other.breakdown !== null &&
      other.breakdown.fairnessScore > next.breakdown!.fairnessScore + 1e-9,
  );
  next.advantage = overtook;
}

/** §23 — deterministic ordering. Near-equal floats are compared at 1e-6. */
export function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  const A = a.breakdown!;
  const B = b.breakdown!;

  if (A.isProtected !== B.isProtected) return A.isProtected ? -1 : 1;

  const primary = A.isProtected
    ? round(B.fairnessScore) - round(A.fairnessScore)
    : round(B.finalPriority) - round(A.finalPriority);
  if (primary !== 0) return primary;

  const wait = round(B.waitScore) - round(A.waitScore);
  if (wait !== 0) return wait;

  const aEnd = a.input.slotEndAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.input.slotEndAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;

  const entered = a.input.enteredAt.getTime() - b.input.enteredAt.getTime();
  if (entered !== 0) return entered;

  const created = a.input.bookingCreatedAt.getTime() - b.input.bookingCreatedAt.getTime();
  if (created !== 0) return created;

  return stableId(a, b);
}

function stableId(a: RankedCandidate, b: RankedCandidate): number {
  if (a.input.bookingId === b.input.bookingId) return 0;
  return a.input.bookingId < b.input.bookingId ? -1 : 1;
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** §43 — the FCFS baseline: queue-entry order, nothing else. */
export function fcfsOrder<T extends { input: CandidateInput }>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      a.input.enteredAt.getTime() - b.input.enteredAt.getTime() ||
      a.input.bookingCreatedAt.getTime() - b.input.bookingCreatedAt.getTime() ||
      (a.input.bookingId < b.input.bookingId ? -1 : a.input.bookingId > b.input.bookingId ? 1 : 0),
  );
}
