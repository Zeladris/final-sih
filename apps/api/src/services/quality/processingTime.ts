import { PROCESSING_TIME_MODEL_VERSION } from '@kisansetu/shared';
import type { QualityRisk } from '@kisansetu/shared';

/**
 * Processing-time prediction (§8).
 *
 * The interface is what the queue depends on. The implementation today is a
 * documented deterministic estimator — crop baseline + quantity + quality
 * adjustments — NOT a learned model, and it says so in its version string.
 *
 * Every procurement now records when it started and finished at a station
 * (queue_entries.selected_at → processed_at), which is the training data a
 * learned predictor needs (§45). Swapping it in changes this file, not the
 * optimizer.
 */

export interface ProcessingTimeInput {
  cropCode: string | null;
  quantityKg: number;
  qualityRisk: QualityRisk;
  /** Null when there is no model output (staff assessment only). */
  qualityConfidence: number | null;
  manualInspectionRequired: boolean;
  lowConfidence: boolean;
}

export interface ProcessingTimePrediction {
  estimatedMinutes: number;
  lowerBoundMinutes: number;
  upperBoundMinutes: number;
  confidence: number | null;
  modelVersion: string;
}

export interface ProcessingTimePredictor {
  predict(input: ProcessingTimeInput): Promise<ProcessingTimePrediction>;
}

/**
 * Starting assumptions, in minutes, per crop at the weighing/bagging station.
 * Configuration to be replaced by measured durations — not measurements.
 */
const CROP_BASELINE_MINUTES: Record<string, number> = {
  PADDY: 6,
  WHEAT: 6,
  MAIZE: 7,
  GROUNDNUT: 8,
  BLACK_GRAM: 7,
  GREEN_GRAM: 7,
};
const DEFAULT_BASELINE_MINUTES = 7;
const MINUTES_PER_100_KG = 1.5;
const RISK_ADJUSTMENT: Record<QualityRisk, number> = { LOW: 0, MEDIUM: 3, HIGH: 6 };
const MANUAL_INSPECTION_MINUTES = 5;
/** §7 — low confidence means planning for the slower case, not the likely one. */
const LOW_CONFIDENCE_FACTOR = 1.25;

function baselineFor(cropCode: string | null): number {
  if (!cropCode) return DEFAULT_BASELINE_MINUTES;
  if (cropCode.startsWith('PADDY')) return CROP_BASELINE_MINUTES.PADDY!;
  return CROP_BASELINE_MINUTES[cropCode] ?? DEFAULT_BASELINE_MINUTES;
}

const halfMinute = (value: number): number => Math.round(value * 2) / 2;
const clampMinutes = (value: number): number => Math.min(240, Math.max(3, value));

export class DeterministicProcessingTimePredictor implements ProcessingTimePredictor {
  async predict(input: ProcessingTimeInput): Promise<ProcessingTimePrediction> {
    let minutes =
      baselineFor(input.cropCode) +
      (Math.max(0, input.quantityKg) / 100) * MINUTES_PER_100_KG +
      RISK_ADJUSTMENT[input.qualityRisk] +
      (input.manualInspectionRequired ? MANUAL_INSPECTION_MINUTES : 0);

    if (input.lowConfidence) minutes *= LOW_CONFIDENCE_FACTOR;

    const estimated = halfMinute(clampMinutes(minutes));
    const spread = input.lowConfidence ? 0.6 : 0.3;

    return {
      estimatedMinutes: estimated,
      lowerBoundMinutes: halfMinute(clampMinutes(estimated * 0.8)),
      upperBoundMinutes: halfMinute(clampMinutes(estimated * (1 + spread))),
      confidence: null,
      modelVersion: PROCESSING_TIME_MODEL_VERSION,
    };
  }
}

export const processingTimePredictor: ProcessingTimePredictor =
  new DeterministicProcessingTimePredictor();
