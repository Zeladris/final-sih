import { createHash } from 'node:crypto';
import { QUEUE_ALGORITHM_VERSION } from '@kisansetu/shared';
import type { QueuePolicySummary } from '@kisansetu/shared';
import { env } from '../../../config/env.js';

/**
 * Queue policy (§21, §47).
 *
 * Every weight and threshold is configuration, read on the server. None of
 * them is claimed to be optimal; they are the documented starting values.
 *
 * The algorithm version names the LOGIC. The config hash names the WEIGHTS.
 * Both are stored on every snapshot and decision, so a historical ranking can
 * always be reproduced with exactly the numbers that produced it (§46).
 */
export interface QueuePolicy {
  targetWaitMinutes: number;
  agingThresholdMinutes: number;
  slotLatenessThresholdMinutes: number;
  maxWaitOverrideMinutes: number;
  urgencyWindowMinutes: number;
  fitScaleMinutes: number;
  advantageLimit: number;
  advantageDecayMinutes: number;

  fairnessWeight: number;
  efficiencyWeight: number;
  /** Weight of the top-level, bounded AI Quality Factor — fa-dqo-v2 (§23–§24). */
  qualityWeight: number;
  urgencyWeight: number;
  penaltyWeight: number;

  fairnessWaitWeight: number;
  fairnessLatenessWeight: number;
  fairnessAgingWeight: number;
  fairnessUrgencyWeight: number;

  processingFitWeight: number;
  workstationFitWeight: number;
  qualityReadinessWeight: number;

  qualityConfidenceThreshold: number;
}

export function policyFromEnv(): QueuePolicy {
  return {
    targetWaitMinutes: env.QUEUE_TARGET_WAIT_MINUTES,
    agingThresholdMinutes: env.QUEUE_AGING_THRESHOLD_MINUTES,
    slotLatenessThresholdMinutes: env.QUEUE_SLOT_LATENESS_THRESHOLD_MINUTES,
    maxWaitOverrideMinutes: env.QUEUE_MAX_WAIT_OVERRIDE_MINUTES,
    urgencyWindowMinutes: env.QUEUE_URGENCY_WINDOW_MINUTES,
    fitScaleMinutes: env.QUEUE_FIT_SCALE_MINUTES,
    advantageLimit: env.QUEUE_ADVANTAGE_LIMIT,
    advantageDecayMinutes: env.QUEUE_ADVANTAGE_DECAY_MINUTES,

    fairnessWeight: env.QUEUE_FAIRNESS_WEIGHT,
    efficiencyWeight: env.QUEUE_EFFICIENCY_WEIGHT,
    qualityWeight: env.QUEUE_QUALITY_WEIGHT,
    urgencyWeight: env.QUEUE_URGENCY_WEIGHT,
    penaltyWeight: env.QUEUE_PENALTY_WEIGHT,

    fairnessWaitWeight: env.QUEUE_FAIRNESS_WAIT_WEIGHT,
    fairnessLatenessWeight: env.QUEUE_FAIRNESS_LATENESS_WEIGHT,
    fairnessAgingWeight: env.QUEUE_FAIRNESS_AGING_WEIGHT,
    fairnessUrgencyWeight: env.QUEUE_FAIRNESS_URGENCY_WEIGHT,

    processingFitWeight: env.QUEUE_PROCESSING_FIT_WEIGHT,
    workstationFitWeight: env.QUEUE_WORKSTATION_FIT_WEIGHT,
    qualityReadinessWeight: env.QUEUE_QUALITY_READINESS_WEIGHT,

    qualityConfidenceThreshold: env.QUALITY_CONFIDENCE_THRESHOLD,
  };
}

/** Stable hash of the policy: same numbers, same hash, regardless of key order. */
export function policyHash(policy: QueuePolicy): string {
  const canonical = JSON.stringify(
    Object.keys(policy)
      .sort()
      .map((key) => [key, policy[key as keyof QueuePolicy]]),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export const ALGORITHM_VERSION = QUEUE_ALGORITHM_VERSION;

export function policySummary(policy: QueuePolicy): QueuePolicySummary {
  return {
    targetWaitMinutes: policy.targetWaitMinutes,
    maxWaitOverrideMinutes: policy.maxWaitOverrideMinutes,
    fairnessWeight: policy.fairnessWeight,
    efficiencyWeight: policy.efficiencyWeight,
    qualityWeight: policy.qualityWeight,
    urgencyWeight: policy.urgencyWeight,
    penaltyWeight: policy.penaltyWeight,
    qualityConfidenceThreshold: policy.qualityConfidenceThreshold,
  };
}
