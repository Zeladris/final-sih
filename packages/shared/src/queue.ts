/**
 * AI-assisted quality + Fairness-Aware Dynamic Queue Optimization (Phase 7).
 *
 * The principle (§54): AI estimates operational complexity; a deterministic
 * optimizer decides sequence; fairness constraints stop efficiency becoming
 * unfairness. Quality is an operational INPUT — it never measures who
 * deserves to be served first.
 *
 * Everything here is vocabulary and read models. The algorithm itself lives
 * on the server (apps/api/src/services/queue/optimizer); nothing in a browser
 * ranks anyone.
 */

export const QUEUE_ALGORITHM_VERSION = 'fa-dqo-v2';
export const PROCESSING_TIME_MODEL_VERSION = 'processing-time-det-v1';

export type QualityRisk = 'LOW' | 'MEDIUM' | 'HIGH';

// ---------------------------------------------------------------------------
// AI quality prediction (§4)
// ---------------------------------------------------------------------------

export type PredictionStatus = 'COMPLETED' | 'UNAVAILABLE' | 'FAILED' | 'UNSUPPORTED_CROP';

/**
 * Where an assessment came from (§4, §13).
 *
 * MANUAL_FALLBACK is not a failure to hide: it is the honest statement that
 * no usable AI prediction exists and the centre will assess on arrival.
 */
export const ASSESSMENT_SOURCES = {
  AI: 'AI',
  AI_WITH_WEATHER_CONTEXT: 'AI_WITH_WEATHER_CONTEXT',
  MANUAL_FALLBACK: 'MANUAL_FALLBACK',
} as const;

export type AssessmentSource = (typeof ASSESSMENT_SOURCES)[keyof typeof ASSESSMENT_SOURCES];

/**
 * Storage and weather context (§5).
 *
 * Context, never proof: recent weather cannot see the grain. It is recorded
 * so a reader can tell what shaped the indication, and disagree with it.
 */
export interface QualityWeatherContext {
  available: boolean;
  temperatureC?: number | null;
  humidityPercent?: number | null;
  rainfallRecentMm?: number | null;
  storageDurationDays?: number | null;
  storageType?: string | null;
  relevance: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * The pre-arrival assessment a farmer receives during booking (§3, §4, §15).
 *
 * Advisory. It never grades, certifies or rejects produce, and it never
 * decides whether a booking may be made — a farmer whose assessment failed
 * books exactly as anyone else does (§13).
 */
export interface PreArrivalQualityAssessment {
  assessmentId: string;
  status: PredictionStatus;
  source: AssessmentSource;

  qualityScore: number | null;
  qualityRisk: QualityRisk | null;
  confidence: number | null;
  /** Below the configured threshold: treated with caution, never as certain (§14). */
  lowConfidence: boolean;
  manualInspectionRequired: boolean;
  reasonCodes: string[];

  weatherContext: QualityWeatherContext | null;

  modelName: string | null;
  modelVersion: string | null;
  /** e.g. SYNTHETIC_DEVELOPMENT — shown, never hidden (§8). */
  trainingData: string | null;

  createdAt: string;
}

export interface QualityPredictionView {
  id: string;
  status: PredictionStatus;
  qualityScore: number | null;
  qualityRisk: QualityRisk | null;
  confidence: number | null;
  manualInspectionRequired: boolean | null;
  /** The model's own rough figure; the queue uses the processing estimate. */
  modelProcessingMinutes: number | null;
  modelName: string | null;
  modelVersion: string | null;
  /** e.g. SYNTHETIC_DEVELOPMENT — shown to staff, never hidden. */
  trainingData: string | null;
  reasonCodes: string[];
  /** Below QUALITY_CONFIDENCE_THRESHOLD: treated with caution, never as certain. */
  lowConfidence: boolean;
  hasImage: boolean;
  /** True when the farmer made this during booking, before they arrived (§3). */
  preArrival: boolean;
  source: AssessmentSource | null;
  weatherContext: QualityWeatherContext | null;
  createdAt: string;
}

export type EstimateSource = 'DETERMINISTIC' | 'MODEL' | 'STAFF_OVERRIDE';

export interface ProcessingEstimateView {
  id: number;
  source: EstimateSource;
  estimatedMinutes: number;
  lowerMinutes: number | null;
  upperMinutes: number | null;
  modelVersion: string;
  originalEstimateMinutes: number | null;
  overrideReason: string | null;
  createdAt: string;
}

export interface QualityAssessmentView {
  bookingId: string;
  bookingReference: string;
  cropName: string;
  quantityKg: number;
  /** The staff member's official result, if recorded. AI never sets this. */
  officialResult: 'PASSED' | 'CONDITIONAL' | 'FAILED' | null;
  latestPrediction: QualityPredictionView | null;
  predictions: QualityPredictionView[];
  currentEstimate: ProcessingEstimateView | null;
  estimates: ProcessingEstimateView[];
  /** Whether an AI service is configured at all. */
  aiConfigured: boolean;
  confidenceThreshold: number;
}

// ---------------------------------------------------------------------------
// Queue vocabulary
// ---------------------------------------------------------------------------

export const QUEUE_TRIGGERS = [
  'QUALITY_ASSESSMENT_COMPLETED',
  'PROCESSING_TIME_UPDATED',
  'WORKSTATION_AVAILABLE',
  'WORKSTATION_BUSY',
  'WORKSTATION_OFFLINE',
  'PROCUREMENT_STARTED',
  'PROCUREMENT_COMPLETED',
  'CANDIDATE_REMOVED',
  'CANDIDATE_REQUEUED',
  'TIME_TICK',
  'MANUAL',
] as const;

export type QueueTrigger = (typeof QUEUE_TRIGGERS)[number];

/** Why a candidate is where it is (§30, §41). Localised in the UI, never in the algorithm. */
export const QUEUE_REASON_CODES = [
  'MAX_WAIT_PROTECTION',
  'LONG_WAIT',
  'AGING_PRIORITY',
  'SLOT_DELAY',
  'URGENT_SLOT',
  'PROCESSING_FIT',
  'WORKSTATION_AVAILABLE',
  'WORKSTATION_COMPATIBILITY',
  /** The AI quality score was a usable, non-neutral input to ranking (§23). */
  'QUALITY_OPERATIONAL_SIGNAL',
  /** Confidence was below threshold, so the quality factor was blended toward neutral rather than trusted. */
  'QUALITY_LOW_CONFIDENCE_NEUTRAL',
  'MANUAL_ASSESSMENT',
  'FAIRNESS_PENALTY',
] as const;

export type QueueReasonCode = (typeof QUEUE_REASON_CODES)[number];

/** Why a candidate cannot be served yet (§10). */
export const INELIGIBLE_REASON_CODES = [
  'NOT_QUEUED',
  'BOOKING_NOT_ACTIVE',
  'NOT_WAITING',
  'CROP_NOT_VERIFIED',
  'QUALITY_NOT_READY',
  'QUALITY_FAILED',
  'NO_PROCESSING_ESTIMATE',
  'NO_COMPATIBLE_WORKSTATION',
] as const;

export type IneligibleReasonCode = (typeof INELIGIBLE_REASON_CODES)[number];

export type WorkstationStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';

export interface WorkstationView {
  id: string;
  code: string;
  name: string;
  status: WorkstationStatus;
  /** Empty = every crop. */
  cropIds: string[];
  cropNames: string[];
  currentBookingReference: string | null;
  busySince: string | null;
}

/** The score breakdown behind one ranking. Staff technical view only. */
export interface ScoreBreakdown {
  waitMinutes: number;
  slotLatenessMinutes: number;
  waitScore: number;
  slotLatenessScore: number;
  agingScore: number;
  urgencyScore: number;
  fairnessScore: number;
  processingFitScore: number;
  workstationFitScore: number;
  /** Workflow-effort readiness (risk/confidence/manual flags) — inside efficiency. */
  qualityReadinessScore: number;
  operationalEfficiencyScore: number;
  /** The bounded, top-level AI Quality Factor (§23) — a sibling of fairness/efficiency/urgency, not a part of efficiency. */
  qualityFactorScore: number;
  fairnessPenalty: number;
  finalPriority: number;
  isProtected: boolean;
}

export interface QueueCandidateView {
  bookingId: string;
  bookingReference: string;
  farmerName: string | null;
  cropName: string;
  quantityKg: number;
  enteredAt: string;
  slotEnd: string | null;
  waitMinutes: number;
  rank: number | null;
  eligible: boolean;
  isProtected: boolean;
  estimatedProcessingMinutes: number | null;
  estimateSource: EstimateSource | null;
  estimatedWaitMinutes: number | null;
  qualityResult: string | null;
  qualityRisk: QualityRisk | null;
  qualityConfidence: number | null;
  manualInspectionRequired: boolean;
  reasonCodes: QueueReasonCode[];
  ineligibleReasons: IneligibleReasonCode[];
  /** Workstations this candidate may be started on right now. */
  compatibleAvailableWorkstationIds: string[];
  breakdown: ScoreBreakdown | null;
}

export interface QueueView {
  centreId: string;
  algorithmVersion: string;
  configHash: string;
  snapshotId: string | null;
  generatedAt: string | null;
  trigger: string | null;
  version: number;
  next: QueueCandidateView | null;
  candidates: QueueCandidateView[];
  ineligible: QueueCandidateView[];
  workstations: WorkstationView[];
  policy: QueuePolicySummary;
}

export interface QueuePolicySummary {
  targetWaitMinutes: number;
  maxWaitOverrideMinutes: number;
  fairnessWeight: number;
  efficiencyWeight: number;
  qualityWeight: number;
  urgencyWeight: number;
  penaltyWeight: number;
  qualityConfidenceThreshold: number;
}

export interface SelectCandidateRequest {
  workstationId: string;
  /** Required when the candidate is not the recommended NEXT. */
  overrideReason?: string;
}

// ---------------------------------------------------------------------------
// Metrics and the FCFS comparison (§43, §44)
// ---------------------------------------------------------------------------

export interface WaitStats {
  count: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  maxMinutes: number | null;
}

export interface QueueMetrics {
  date: string;
  /** Waits of farmers already started (selected_at − entered_at). */
  completedWaits: WaitStats;
  currentQueueLength: number;
  longestCurrentWaitMinutes: number | null;
  averageSlotDelayMinutes: number | null;
  processedCount: number;
  farmersPerHour: number | null;
  averageProcessingMinutes: number | null;
  workstationUtilisation: number | null;
  queueLengthOverTime: Array<{ at: string; length: number }>;
  starvationEvents: number;
  fairnessOverrides: number;
  dynamicReorders: number;
  selectionOverrides: number;
  manualQualityReviewRate: number | null;
  mlPredictions: number;
  mlLowConfidenceRate: number | null;
  mlUnavailableCount: number;
}

export interface PolicySimulationResult {
  policy: 'FCFS' | 'FA_DQO';
  waits: WaitStats;
  averageSlotDelayMinutes: number | null;
  starvationEvents: number;
  makespanMinutes: number | null;
  order: string[];
}

export interface QueueComparison {
  date: string;
  /** How many recorded queue entries the simulation replayed. */
  workloadSize: number;
  workstationCount: number;
  /** Both policies replay the same arrivals and estimates. Stated, not hidden. */
  basis: 'RECORDED_ARRIVALS_WITH_ESTIMATED_PROCESSING_TIMES';
  fcfs: PolicySimulationResult | null;
  optimized: PolicySimulationResult | null;
}
