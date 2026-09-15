import { describe, expect, it } from 'vitest';
import { optimizeQueue } from '../../src/services/queue/optimizer/optimizer.js';
import type { QueuePolicy } from '../../src/services/queue/optimizer/policy.js';
import type { CandidateInput, WorkstationInput } from '../../src/services/queue/optimizer/types.js';

/**
 * The guarantees the fairness-aware queue makes (Phase 7 §3, §10, §22, §23).
 * These are properties, not snapshots of today's numbers: they must hold for
 * any sensible configuration.
 */

const POLICY: QueuePolicy = {
  targetWaitMinutes: 60,
  agingThresholdMinutes: 60,
  slotLatenessThresholdMinutes: 30,
  maxWaitOverrideMinutes: 90,
  urgencyWindowMinutes: 30,
  fitScaleMinutes: 15,
  advantageLimit: 3,
  advantageDecayMinutes: 30,
  fairnessWeight: 0.6,
  efficiencyWeight: 0.2,
  qualityWeight: 0.1,
  urgencyWeight: 0.1,
  penaltyWeight: 0.1,
  fairnessWaitWeight: 0.45,
  fairnessLatenessWeight: 0.3,
  fairnessAgingWeight: 0.2,
  fairnessUrgencyWeight: 0.05,
  processingFitWeight: 0.55,
  workstationFitWeight: 0.3,
  qualityReadinessWeight: 0.15,
  qualityConfidenceThreshold: 0.75,
};

const NOW = new Date('2026-09-14T06:00:00.000Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);
const PADDY = 'crop-paddy';
const WHEAT = 'crop-wheat';

function candidate(id: string, overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    entryId: `e-${id}`,
    bookingId: id,
    bookingReference: `BKG-${id}`,
    farmerName: null,
    bookingCreatedAt: minutesAgo(600),
    cropId: PADDY,
    cropName: 'Paddy',
    quantityKg: 400,
    enteredAt: minutesAgo(10),
    slotEndAt: new Date(NOW.getTime() + 120 * 60_000),
    entryState: 'QUEUED',
    operationState: 'WAITING',
    bookingStatus: 'BOOKED',
    cropVerified: true,
    qualityResult: 'PASSED',
    aiRisk: null,
    aiConfidence: null,
    aiManualInspection: null,
    aiQualityScore: null,
    estimatedProcessingMinutes: 12,
    estimateSource: 'DETERMINISTIC',
    priorityAdvantageCount: 0,
    lastAdvantageAt: null,
    previousRank: null,
    ...overrides,
  };
}

const STATIONS: WorkstationInput[] = [
  { id: 'ws-1', code: 'WS-1', cropIds: [], status: 'AVAILABLE', remainingMinutes: null },
];

const rank = (candidates: CandidateInput[], stations = STATIONS) =>
  optimizeQueue(candidates, stations, { now: NOW, centreCloseAt: null, policy: POLICY, previousNextBookingId: null });

describe('fairness-aware queue optimizer', () => {
  it('is deterministic: same inputs, same order, regardless of input order', () => {
    const a = candidate('a', { enteredAt: minutesAgo(20) });
    const b = candidate('b', { enteredAt: minutesAgo(20) });
    const c = candidate('c', { enteredAt: minutesAgo(35) });

    const first = rank([a, b, c]).ranked.map((r) => r.input.bookingId);
    const second = rank([c, b, a]).ranked.map((r) => r.input.bookingId);
    expect(first).toEqual(second);
    expect(first).toEqual(['c', 'a', 'b']); // equal scores fall back to stable booking id
  });

  it('does not let better quality jump a farmer who has waited longer', () => {
    const waitedLong = candidate('long', {
      enteredAt: minutesAgo(50),
      aiRisk: 'HIGH',
      aiConfidence: 0.4,
      aiManualInspection: true,
    });
    const bestQuality = candidate('best', { enteredAt: minutesAgo(15), aiRisk: 'LOW', aiConfidence: 0.99 });

    expect(rank([bestQuality, waitedLong]).next?.input.bookingId).toBe('long');
  });

  it('serves anyone past the maximum wait before everyone else (anti-starvation)', () => {
    const starving = candidate('starving', { enteredAt: minutesAgo(95), estimatedProcessingMinutes: 200 });
    const urgentLate = candidate('late', {
      enteredAt: minutesAgo(60),
      slotEndAt: minutesAgo(45),
      estimatedProcessingMinutes: 5,
    });

    const result = rank([urgentLate, starving]);
    expect(result.next?.input.bookingId).toBe('starving');
    expect(result.next?.reasonCodes).toContain('MAX_WAIT_PROTECTION');
  });

  it('never ranks a candidate that fails a hard constraint, however long they waited', () => {
    const failed = candidate('failed', { enteredAt: minutesAgo(200), qualityResult: 'FAILED' });
    const wheat = candidate('wheat', { cropId: WHEAT });
    const paddyOnly: WorkstationInput[] = [
      { id: 'ws-2', code: 'WS-2', cropIds: [PADDY], status: 'AVAILABLE', remainingMinutes: null },
    ];

    const result = rank([failed, wheat, candidate('ok')], paddyOnly);
    expect(result.ranked.map((r) => r.input.bookingId)).toEqual(['ok']);
    expect(result.ineligible.find((r) => r.input.bookingId === 'failed')?.ineligibleReasons).toContain('QUALITY_FAILED');
    expect(result.ineligible.find((r) => r.input.bookingId === 'wheat')?.ineligibleReasons).toContain(
      'NO_COMPATIBLE_WORKSTATION',
    );
  });

  it('estimates waits from processing times on parallel stations, not position × a constant', () => {
    const twoStations: WorkstationInput[] = [
      { id: 'ws-1', code: 'WS-1', cropIds: [], status: 'AVAILABLE', remainingMinutes: null },
      { id: 'ws-2', code: 'WS-2', cropIds: [], status: 'BUSY', remainingMinutes: 5 },
    ];
    const result = rank(
      [
        candidate('a', { enteredAt: minutesAgo(40), estimatedProcessingMinutes: 20 }),
        candidate('b', { enteredAt: minutesAgo(30), estimatedProcessingMinutes: 10 }),
        candidate('c', { enteredAt: minutesAgo(20), estimatedProcessingMinutes: 10 }),
      ],
      twoStations,
    );
    // a starts now on WS-1; b when WS-2 frees in 5; c when WS-2 frees again at 15.
    expect(result.ranked.map((r) => [r.input.bookingId, r.estimatedWaitMinutes])).toEqual([
      ['a', 0],
      ['b', 5],
      ['c', 15],
    ]);
  });

  it('treats a low-confidence prediction as caution, never as certainty', () => {
    const result = rank([
      candidate('x', { aiRisk: 'LOW', aiConfidence: 0.5, aiManualInspection: false, aiQualityScore: 60 }),
    ]);
    const [x] = result.ranked;
    expect(x!.quality.lowConfidence).toBe(true);
    expect(x!.quality.manualInspectionRequired).toBe(true);
    expect(x!.reasonCodes).toContain('QUALITY_LOW_CONFIDENCE_NEUTRAL');
  });

  it('the top-level quality factor is bounded and blends toward neutral under low confidence (§23)', () => {
    const result = rank([
      candidate('good', { aiQualityScore: 95, aiConfidence: 0.95 }),
      candidate('bad', { aiQualityScore: 10, aiConfidence: 0.95 }),
      candidate('uncertain-good', { aiQualityScore: 95, aiConfidence: 0.2 }),
      candidate('uncertain-bad', { aiQualityScore: 10, aiConfidence: 0.2 }),
      candidate('none'),
    ]);
    const of = (id: string) => result.ranked.find((r) => r.input.bookingId === id)!.breakdown!;

    // A confident, high score reads close to the score itself.
    expect(of('good').qualityFactorScore).toBeGreaterThan(0.85);
    // A confident, low score reads close to the score itself — low, not neutral.
    expect(of('bad').qualityFactorScore).toBeLessThan(0.15);
    // Low confidence pulls BOTH toward neutral, regardless of the score's direction.
    expect(of('uncertain-good').qualityFactorScore).toBeCloseTo(0.59, 1);
    expect(of('uncertain-bad').qualityFactorScore).toBeCloseTo(0.42, 1);
    // No AI signal at all is exactly neutral — neither advantaged nor penalised.
    expect(of('none').qualityFactorScore).toBe(0.5);

    // Never the dominant term: even the best-scored candidate cannot outrank
    // fairness (all five entered the queue at the same instant here).
    expect(of('good').finalPriority - of('none').finalPriority).toBeLessThan(0.1);
  });
});
