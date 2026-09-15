import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AssessmentSource,
  EstimateSource,
  PreArrivalQualityAssessment,
  PredictionStatus,
  ProcessingEstimateView,
  QualityPredictionView,
  QualityRisk,
  QualityWeatherContext,
} from '@kisansetu/shared';
import { unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * AI predictions and processing estimates. Both tables are append-only in the
 * database; this file only ever inserts and reads.
 */

export interface PredictionRow {
  id: string;
  /** Null while the assessment is still pre-booking (§4: bookingId is optional). */
  booking_id: string | null;
  farmer_user_id: string | null;
  assessment_status: PredictionStatus;
  quality_score: string | number | null;
  quality_risk: QualityRisk | null;
  confidence: string | number | null;
  manual_inspection_required: boolean | null;
  estimated_processing_minutes: string | number | null;
  model_name: string | null;
  model_version: string | null;
  training_data: string | null;
  reason_codes: string[] | null;
  image_path: string | null;
  storage_duration_days: number | null;
  storage_type: string | null;
  weather_context: QualityWeatherContext | null;
  assessment_source: AssessmentSource | null;
  created_at: string;
}

const PREDICTION_COLUMNS =
  'id, booking_id, farmer_user_id, assessment_status, quality_score, quality_risk, confidence, ' +
  'manual_inspection_required, estimated_processing_minutes, model_name, model_version, ' +
  'training_data, reason_codes, image_path, storage_duration_days, storage_type, ' +
  'weather_context, assessment_source, created_at';

const n = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

export function toPredictionView(row: PredictionRow, threshold: number): QualityPredictionView {
  const confidence = n(row.confidence);
  return {
    id: row.id,
    status: row.assessment_status,
    qualityScore: n(row.quality_score),
    qualityRisk: row.quality_risk,
    confidence,
    manualInspectionRequired: row.manual_inspection_required,
    modelProcessingMinutes: n(row.estimated_processing_minutes),
    modelName: row.model_name,
    modelVersion: row.model_version,
    trainingData: row.training_data,
    reasonCodes: row.reason_codes ?? [],
    lowConfidence: confidence !== null && confidence < threshold,
    hasImage: row.image_path !== null,
    // A farmer-owned prediction is one made during booking; a counter
    // assessment is requested by staff and has no farmer_user_id.
    preArrival: row.farmer_user_id !== null,
    source: row.assessment_source,
    weatherContext: row.weather_context,
    createdAt: row.created_at,
  };
}

/**
 * The farmer-facing view of a pre-arrival assessment (§4, §15).
 *
 * Deliberately smaller than the staff view: no raw model feature vector, no
 * image path. A farmer is owed the indication and its provenance, not the
 * internals.
 */
export function toPreArrivalView(
  row: PredictionRow,
  threshold: number,
): PreArrivalQualityAssessment {
  const confidence = n(row.confidence);
  const completed = row.assessment_status === 'COMPLETED';

  return {
    assessmentId: row.id,
    status: row.assessment_status,
    // No usable prediction means the centre assesses on arrival, and the row
    // says exactly that rather than implying a result it does not have (§13).
    source: completed ? (row.assessment_source ?? 'AI') : 'MANUAL_FALLBACK',
    qualityScore: n(row.quality_score),
    qualityRisk: row.quality_risk,
    confidence,
    lowConfidence: confidence !== null && confidence < threshold,
    manualInspectionRequired: row.manual_inspection_required === true,
    reasonCodes: row.reason_codes ?? [],
    weatherContext: row.weather_context,
    modelName: row.model_name,
    modelVersion: row.model_version,
    trainingData: row.training_data,
    createdAt: row.created_at,
  };
}

export async function insertPrediction(
  adminDb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<PredictionRow> {
  return unwrap<PredictionRow>(
    await adminDb.from('quality_predictions').insert(row).select(PREDICTION_COLUMNS).single(),
    'quality.insertPrediction',
  );
}

export async function findPredictionById(
  db: SupabaseClient,
  id: string,
): Promise<PredictionRow | null> {
  return unwrapMaybe<PredictionRow>(
    await db.from('quality_predictions').select(PREDICTION_COLUMNS).eq('id', id).maybeSingle(),
    'quality.findPredictionById',
  );
}

export async function listPredictions(db: SupabaseClient, bookingId: string): Promise<PredictionRow[]> {
  return unwrap<PredictionRow[]>(
    await db
      .from('quality_predictions')
      .select(PREDICTION_COLUMNS)
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: false }),
    'quality.listPredictions',
  );
}

export async function latestCompletedPrediction(
  db: SupabaseClient,
  bookingId: string,
): Promise<PredictionRow | null> {
  return unwrapMaybe<PredictionRow>(
    await db
      .from('quality_predictions')
      .select(PREDICTION_COLUMNS)
      .eq('booking_id', bookingId)
      .eq('assessment_status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'quality.latestCompleted',
  );
}

export interface EstimateRow {
  id: number;
  booking_id: string;
  source: EstimateSource;
  estimated_minutes: string | number;
  lower_minutes: string | number | null;
  upper_minutes: string | number | null;
  model_version: string;
  original_estimate_minutes: string | number | null;
  override_reason: string | null;
  created_at: string;
}

const ESTIMATE_COLUMNS =
  'id, booking_id, source, estimated_minutes, lower_minutes, upper_minutes, model_version, ' +
  'original_estimate_minutes, override_reason, created_at';

export function toEstimateView(row: EstimateRow): ProcessingEstimateView {
  return {
    id: Number(row.id),
    source: row.source,
    estimatedMinutes: Number(row.estimated_minutes),
    lowerMinutes: n(row.lower_minutes),
    upperMinutes: n(row.upper_minutes),
    modelVersion: row.model_version,
    originalEstimateMinutes: n(row.original_estimate_minutes),
    overrideReason: row.override_reason,
    createdAt: row.created_at,
  };
}

export async function insertEstimate(
  adminDb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<EstimateRow> {
  return unwrap<EstimateRow>(
    await adminDb.from('processing_estimates').insert(row).select(ESTIMATE_COLUMNS).single(),
    'quality.insertEstimate',
  );
}

export async function listEstimates(db: SupabaseClient, bookingId: string): Promise<EstimateRow[]> {
  return unwrap<EstimateRow[]>(
    await db
      .from('processing_estimates')
      .select(ESTIMATE_COLUMNS)
      .eq('booking_id', bookingId)
      .order('id', { ascending: false }),
    'quality.listEstimates',
  );
}

export async function latestOfficialResult(
  db: SupabaseClient,
  bookingId: string,
): Promise<'PASSED' | 'CONDITIONAL' | 'FAILED' | null> {
  const row = unwrapMaybe<{ result: 'PASSED' | 'CONDITIONAL' | 'FAILED' }>(
    await db
      .from('quality_assessments')
      .select('result')
      .eq('booking_id', bookingId)
      .order('assessed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'quality.latestOfficial',
  );
  return row?.result ?? null;
}

export async function findCropCode(db: SupabaseClient, cropId: string | null): Promise<string | null> {
  if (!cropId) return null;
  const row = unwrapMaybe<{ code: string }>(
    await db.from('crops').select('code').eq('id', cropId).maybeSingle(),
    'quality.cropCode',
  );
  return row?.code ?? null;
}
