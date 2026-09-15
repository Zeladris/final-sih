import type {
  BookingStatus,
  EstimateSource,
  IneligibleReasonCode,
  OperationState,
  QualityResult,
  QualityRisk,
  QueueReasonCode,
  ScoreBreakdown,
  WorkstationStatus,
} from '@kisansetu/shared';
import type { QueuePolicy } from './policy.js';

/**
 * Optimizer inputs and outputs.
 *
 * Deliberately absent from CandidateInput: anything about the farmer as a
 * person (identity, landholding, wealth), and anything about the produce's
 * money value. The optimizer cannot use what it is never given (§16).
 * `farmerName` travels alongside for display only and is never read by a score.
 */
export interface CandidateInput {
  entryId: string;
  bookingId: string;
  bookingReference: string;
  farmerName: string | null;
  bookingCreatedAt: Date;
  cropId: string | null;
  cropName: string;
  quantityKg: number;

  enteredAt: Date;
  slotEndAt: Date | null;

  entryState: string;
  operationState: OperationState;
  bookingStatus: BookingStatus;
  cropVerified: boolean | null;

  /** The staff member's official result. */
  qualityResult: QualityResult | null;
  /** The AI's advisory output, when a prediction completed. */
  aiRisk: QualityRisk | null;
  aiConfidence: number | null;
  aiManualInspection: boolean | null;
  /** 0–100, the model's own quality score. Feeds the top-level QualityFactor (§23), never the sole determinant. */
  aiQualityScore: number | null;

  estimatedProcessingMinutes: number | null;
  estimateSource: EstimateSource | null;

  priorityAdvantageCount: number;
  lastAdvantageAt: Date | null;
  previousRank: number | null;
}

export interface WorkstationInput {
  id: string;
  code: string;
  /** Empty = accepts every crop. */
  cropIds: string[];
  status: WorkstationStatus;
  /** For a BUSY station: how long until it is expected to be free. */
  remainingMinutes: number | null;
}

export interface OptimizerContext {
  now: Date;
  /** Today's centre closing time, if the centre has one configured. */
  centreCloseAt: Date | null;
  policy: QueuePolicy;
  /** NEXT from the previous published snapshot, for the fairness penalty. */
  previousNextBookingId: string | null;
}

export interface QualityProfile {
  risk: QualityRisk;
  /** Null when there is no model output — the staff decision stands alone. */
  confidence: number | null;
  manualInspectionRequired: boolean;
  lowConfidence: boolean;
}

export interface RankedCandidate {
  input: CandidateInput;
  eligible: boolean;
  ineligibleReasons: IneligibleReasonCode[];
  rank: number | null;
  breakdown: ScoreBreakdown | null;
  reasonCodes: QueueReasonCode[];
  quality: QualityProfile;
  /** True when this ranking gave the candidate an efficiency-driven lead (§19). */
  advantage: boolean;
  estimatedWaitMinutes: number | null;
  compatibleAvailableWorkstationIds: string[];
}

export interface OptimizerResult {
  ranked: RankedCandidate[];
  ineligible: RankedCandidate[];
  next: RankedCandidate | null;
}
