import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extensionOf } from '@kisansetu/shared';
import type { QualityAssessmentView, QualityRisk } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import * as ops from '../../repositories/operationsRepository.js';
import * as quality from '../../repositories/qualityRepository.js';
import { validateUpload } from '../documents/documentService.js';
import type { UploadedFile } from '../documents/documentService.js';
import {
  activeQualityProvider,
  isQualityModelConfigured,
  QualityModelUnavailable,
  UnsupportedCrop,
} from './qualityProvider.js';
import { processingTimePredictor } from './processingTime.js';
import type { AuthContext } from '../../types/request.js';

/**
 * AI-assisted pre-quality assessment (§4–§7, §31–§33).
 *
 * The AI result is ADVISORY. It is stored in its own append-only table, shown
 * to staff with its model version, confidence and training-data provenance,
 * and used by the queue only as an estimate of workflow effort. The official
 * quality decision is still recorded by a staff member (Phase 5 `quality`
 * step), and nothing here can set it.
 *
 * If the model is unavailable the attempt is recorded and the process carries
 * on manually — procurement is never blocked on AI (§33).
 */

export const PRODUCE_PHOTOS_BUCKET = 'produce-photos';

interface ScopedBooking {
  booking: ops.BookingRow;
  operation: ops.OperationRow | null;
  cropCode: string | null;
}

async function loadAtCentre(auth: AuthContext, bookingId: string): Promise<ScopedBooking> {
  const centreId = auth.scope.centreId;
  if (!centreId) throw forbidden('No procurement centre is assigned to this account.');

  const booking = await ops.findBooking(auth.db, bookingId);
  if (!booking || booking.centre_id !== centreId) {
    throw notFound('This booking is not available at your centre.');
  }

  const [operation, cropCode] = await Promise.all([
    ops.findOperation(auth.db, bookingId),
    quality.findCropCode(auth.db, booking.crop_id),
  ]);

  return { booking, operation, cropCode };
}

export async function getAssessment(
  auth: AuthContext,
  bookingId: string,
): Promise<QualityAssessmentView> {
  const { booking } = await loadAtCentre(auth, bookingId);
  const threshold = env.QUALITY_CONFIDENCE_THRESHOLD;

  const [predictions, estimates, officialResult] = await Promise.all([
    quality.listPredictions(auth.db, bookingId),
    quality.listEstimates(auth.db, bookingId),
    quality.latestOfficialResult(auth.db, bookingId),
  ]);

  const predictionViews = predictions.map((row) => quality.toPredictionView(row, threshold));
  const estimateViews = estimates.map(quality.toEstimateView);

  return {
    bookingId,
    bookingReference: booking.booking_reference,
    cropName: booking.crop,
    quantityKg: Number(booking.expected_quantity_kg),
    officialResult,
    latestPrediction: predictionViews[0] ?? null,
    predictions: predictionViews,
    currentEstimate: estimateViews[0] ?? null,
    estimates: estimateViews,
    aiConfigured: isQualityModelConfigured(),
    confidenceThreshold: threshold,
  };
}

/**
 * POST …/quality-assessment — photo in, advisory prediction out.
 *
 * Runs only during the quality-check step: after it, the staff decision has
 * been made and a prediction could no longer inform it.
 */
export async function runAiAssessment(
  auth: AuthContext,
  bookingId: string,
  file: UploadedFile,
): Promise<QualityAssessmentView> {
  const { booking, operation, cropCode } = await loadAtCentre(auth, bookingId);

  if (!operation || operation.state !== 'QUALITY_CHECK') {
    throw conflict('An AI pre-assessment can only be run during the quality check.');
  }

  // Same rules as any photograph: declared type, extension and bytes agree.
  validateUpload(file, 'FARMER_PHOTO');

  const path = `${booking.centre_id}/${bookingId}/${randomUUID()}.${extensionOf(file.originalname) || 'jpg'}`;
  const stored = await supabaseAdminClient.storage
    .from(PRODUCE_PHOTOS_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (stored.error) {
    logger.error('produce photo upload failed', { bookingId, reason: stored.error.message });
    throw conflict('The photo could not be stored. Please try again.');
  }

  const base = {
    booking_id: bookingId,
    centre_id: booking.centre_id,
    crop_id: booking.crop_id,
    image_bucket: PRODUCE_PHOTOS_BUCKET,
    image_path: path,
    requested_by: auth.userId,
  };

  let prediction: quality.PredictionRow;

  try {
    if (!cropCode) throw new UnsupportedCrop('unknown');

    const output = await activeQualityProvider().assess({
      cropCode,
      quantityKg: Number(booking.expected_quantity_kg),
      image: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });

    prediction = await quality.insertPrediction(supabaseAdminClient, {
      ...base,
      assessment_status: 'COMPLETED',
      quality_score: output.qualityScore,
      quality_risk: output.qualityRisk,
      confidence: output.confidence,
      manual_inspection_required: output.manualInspectionRequired,
      estimated_processing_minutes: output.estimatedProcessingMinutes,
      model_name: output.modelName,
      model_version: output.modelVersion,
      training_data: output.trainingData,
      reason_codes: output.reasonCodes,
      inference_at: output.inferenceTimestamp,
    });
  } catch (cause) {
    const status = cause instanceof UnsupportedCrop ? 'UNSUPPORTED_CROP'
      : cause instanceof QualityModelUnavailable ? 'UNAVAILABLE'
      : 'FAILED';

    if (status === 'FAILED') logger.error('quality prediction failed', { bookingId, reason: (cause as Error).message });

    prediction = await quality.insertPrediction(supabaseAdminClient, {
      ...base,
      assessment_status: status,
      failure_reason:
        cause instanceof QualityModelUnavailable ? cause.code : (cause as Error).message.slice(0, 200),
    });
  }

  // A completed prediction refines the processing estimate — unless staff
  // have already set one by hand, which AI does not override (§32).
  if (prediction.assessment_status === 'COMPLETED') {
    const latest = (await quality.listEstimates(supabaseAdminClient, bookingId))[0];
    if (latest?.source !== 'STAFF_OVERRIDE') {
      await recordDeterministicEstimate(supabaseAdminClient, {
        bookingId,
        centreId: booking.centre_id,
        cropCode,
        quantityKg: Number(booking.expected_quantity_kg),
        officialResult: null,
        prediction,
        actorId: auth.userId,
      });
    }
  }

  return getAssessment(auth, bookingId);
}

/**
 * The estimate the queue will use, combining what is known: the staff result
 * (authoritative) and the latest AI prediction (can only add caution).
 */
export async function recordDeterministicEstimate(
  adminDb: SupabaseClient,
  input: {
    bookingId: string;
    centreId: string;
    cropCode: string | null;
    quantityKg: number;
    officialResult: 'PASSED' | 'CONDITIONAL' | 'FAILED' | null;
    prediction: quality.PredictionRow | null;
    actorId: string | null;
  },
): Promise<quality.EstimateRow> {
  const threshold = env.QUALITY_CONFIDENCE_THRESHOLD;
  const staffRisk: QualityRisk = input.officialResult === 'CONDITIONAL' ? 'MEDIUM' : 'LOW';
  const order: Record<QualityRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

  const ai = input.prediction;
  const aiRisk = ai?.quality_risk ?? null;
  const aiConfidence = ai?.confidence === null || ai?.confidence === undefined ? null : Number(ai.confidence);
  const lowConfidence = aiConfidence !== null && aiConfidence < threshold;

  const risk = aiRisk && order[aiRisk] > order[staffRisk] ? aiRisk : staffRisk;
  const manual =
    input.officialResult === 'CONDITIONAL' || lowConfidence || ai?.manual_inspection_required === true;

  const predicted = await processingTimePredictor.predict({
    cropCode: input.cropCode,
    quantityKg: input.quantityKg,
    qualityRisk: risk,
    qualityConfidence: aiConfidence,
    manualInspectionRequired: manual,
    lowConfidence,
  });

  return quality.insertEstimate(adminDb, {
    booking_id: input.bookingId,
    centre_id: input.centreId,
    prediction_id: ai?.id ?? null,
    source: 'DETERMINISTIC',
    estimated_minutes: predicted.estimatedMinutes,
    lower_minutes: predicted.lowerBoundMinutes,
    upper_minutes: predicted.upperBoundMinutes,
    confidence: predicted.confidence,
    model_version: predicted.modelVersion,
    inputs: {
      cropCode: input.cropCode,
      quantityKg: input.quantityKg,
      qualityRisk: risk,
      qualityConfidence: aiConfidence,
      manualInspectionRequired: manual,
      lowConfidence,
      officialResult: input.officialResult,
    },
    created_by: input.actorId,
  });
}

/**
 * Staff adjust the estimate (§32). The original stays on record; the queue
 * uses the new figure from the next recalculation.
 */
export async function overrideEstimate(
  auth: AuthContext,
  bookingId: string,
  minutes: number,
  reason: string,
): Promise<{ assessment: QualityAssessmentView; queued: boolean; centreId: string }> {
  const { booking, operation } = await loadAtCentre(auth, bookingId);

  if (!operation || !['QUALITY_CHECK', 'WAITING'].includes(operation.state)) {
    throw conflict('The processing estimate can be changed during the quality check or while queued.');
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
    throw validationError('Enter an estimate between 1 and 600 minutes.');
  }
  if (reason.trim().length < 5) {
    throw validationError('Explain why the estimate is being changed.');
  }

  const current = (await quality.listEstimates(auth.db, bookingId))[0];

  const estimate = await quality.insertEstimate(supabaseAdminClient, {
    booking_id: bookingId,
    centre_id: booking.centre_id,
    source: 'STAFF_OVERRIDE',
    estimated_minutes: Math.round(minutes * 2) / 2,
    model_version: 'staff',
    original_estimate_minutes: current ? Number(current.estimated_minutes) : null,
    override_reason: reason.trim(),
    created_by: auth.userId,
  });

  // If already queued, the entry takes the new figure; the version bump this
  // causes makes the next recalculation see it.
  const { data } = await supabaseAdminClient
    .from('queue_entries')
    .update({ estimated_processing_minutes: Number(estimate.estimated_minutes), estimate_id: estimate.id })
    .eq('booking_id', bookingId)
    .eq('state', 'QUEUED')
    .select('id');

  return {
    assessment: await getAssessment(auth, bookingId),
    queued: Boolean(data && data.length > 0),
    centreId: booking.centre_id,
  };
}
