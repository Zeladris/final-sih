import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_DURATION_DAYS, extensionOf } from '@kisansetu/shared';
import type {
  PreArrivalQualityAssessment,
  StorageDurationBand,
  StorageType,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import * as quality from '../../repositories/qualityRepository.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { validateUpload } from '../documents/documentService.js';
import type { UploadedFile } from '../documents/documentService.js';
import {
  activeQualityProvider,
  QualityModelUnavailable,
  UnsupportedCrop,
} from './qualityProvider.js';
import { activeWeatherProvider } from './weatherProvider.js';

/**
 * Pre-arrival quality assessment, during booking (§3, §12, §13, §15).
 *
 * The farmer photographs their produce while booking a slot; the model
 * answers before they travel, so the centre knows something about the load
 * in advance and the queue has a quality signal the moment they are queued.
 *
 * THREE THINGS THIS IS NOT:
 *   1. A gate. Every failure path — model down, timeout, unreadable photo,
 *      unsupported crop — records what happened and lets the booking
 *      continue (§13). `assessment_source = MANUAL_FALLBACK` then says
 *      plainly that the centre will assess on arrival.
 *   2. A grade. It is an indication from a development model, labelled with
 *      its training data wherever it is shown (§8).
 *   3. A decision. The official quality result stays the staff member's, at
 *      the centre, recorded separately in quality_assessments (§16).
 *
 * The assessment is made BEFORE the booking exists, so it is stored against
 * the farmer and linked to the booking at confirm time (§4: bookingId is
 * optional). Nothing about it is rewritten by that link.
 */

export const PRODUCE_PHOTOS_BUCKET = 'produce-photos';

export interface AssessProduceInput {
  cropId: string;
  quantityKg: number;
  storageDurationBand?: StorageDurationBand | null;
  storageType?: StorageType | null;
  /** Where the produce is stored, if the farmer shared it. Used for weather context only. */
  storageLatitude?: number | null;
  storageLongitude?: number | null;
  file: UploadedFile;
}

/** POST /api/farmer/bookings/quality-assessment */
export async function assessProduce(
  db: SupabaseClient,
  farmerUserId: string,
  input: AssessProduceInput,
): Promise<PreArrivalQualityAssessment> {
  const farmer = await findFarmerProfile(db, farmerUserId);
  if (!farmer) throw notFound('Complete your registration before booking.');

  // Same rules as any photograph: declared type, extension and bytes agree.
  validateUpload(input.file, 'CROP_PHOTO');

  const crop = await findCrop(db, input.cropId);
  if (!crop) throw validationError('That crop is not currently being procured.');

  // Private bucket, under the farmer's own prefix — which is what their RLS
  // policy matches on. No public URL is ever produced (§12).
  const path = `${farmerUserId}/${randomUUID()}.${extensionOf(input.file.originalname) || 'jpg'}`;
  const stored = await supabaseAdminClient.storage
    .from(PRODUCE_PHOTOS_BUCKET)
    .upload(path, input.file.buffer, { contentType: input.file.mimetype, upsert: false });

  if (stored.error) {
    logger.error('produce photo upload failed', { farmerUserId, reason: stored.error.message });
    throw conflict('The photo could not be stored. Please try again.');
  }

  const storageDurationDays = input.storageDurationBand
    ? STORAGE_DURATION_DAYS[input.storageDurationBand]
    : null;

  // Weather is context, and entirely optional: no coordinates, no provider or
  // a provider that is down — the assessment simply runs without it (§5, §7).
  const weather =
    input.storageLatitude != null && input.storageLongitude != null
      ? await activeWeatherProvider().getRecentContext(input.storageLatitude, input.storageLongitude)
      : null;

  const base = {
    farmer_user_id: farmerUserId,
    crop_id: input.cropId,
    image_bucket: PRODUCE_PHOTOS_BUCKET,
    image_path: path,
    storage_duration_days: storageDurationDays,
    storage_type: input.storageType ?? null,
    requested_by: farmerUserId,
  };

  let row: quality.PredictionRow;

  try {
    const output = await activeQualityProvider().assess({
      cropCode: crop.code,
      quantityKg: input.quantityKg,
      image: input.file.buffer,
      mimeType: input.file.mimetype,
      filename: input.file.originalname,
      storageDurationDays,
      storageType: input.storageType ?? null,
      temperatureC: weather?.temperatureC ?? null,
      humidityPercent: weather?.humidityPercent ?? null,
      rainfallRecentMm: weather?.rainfallRecentMm ?? null,
    });

    row = await quality.insertPrediction(supabaseAdminClient, {
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
      weather_context: output.weatherContext,
      assessment_source: output.assessmentSource,
      inference_at: output.inferenceTimestamp,
    });
  } catch (cause) {
    const status =
      cause instanceof UnsupportedCrop ? 'UNSUPPORTED_CROP'
      : cause instanceof QualityModelUnavailable ? 'UNAVAILABLE'
      : 'FAILED';

    if (status === 'FAILED') {
      logger.error('pre-arrival quality prediction failed', {
        farmerUserId,
        reason: (cause as Error).message,
      });
    }

    // Recorded, not swallowed: the attempt is part of the booking's history,
    // and the farmer is told the centre will assess on arrival (§13).
    row = await quality.insertPrediction(supabaseAdminClient, {
      ...base,
      assessment_status: status,
      assessment_source: 'MANUAL_FALLBACK',
      failure_reason:
        cause instanceof QualityModelUnavailable ? cause.code : (cause as Error).message.slice(0, 200),
    });
  }

  return quality.toPreArrivalView(row, env.QUALITY_CONFIDENCE_THRESHOLD);
}

/**
 * Attaches a pre-booking assessment to the booking it was made for (§34).
 *
 * Checked, not trusted: the assessment must belong to this farmer, must be
 * for the crop being booked, and must not already belong to another booking.
 * A mismatch is refused rather than silently ignored — but the caller treats
 * the whole link as optional, because a booking made without an assessment
 * is perfectly valid.
 */
export async function linkAssessmentToBooking(
  farmerUserId: string,
  assessmentId: string,
  booking: { id: string; centreId: string; cropId: string | null },
): Promise<string | null> {
  const row = await quality.findPredictionById(supabaseAdminClient, assessmentId);

  if (!row || row.farmer_user_id !== farmerUserId) {
    throw validationError('That produce assessment is not available.');
  }
  if (row.booking_id !== null) {
    throw conflict('That produce assessment is already attached to another booking.');
  }

  const { error } = await supabaseAdminClient
    .from('quality_predictions')
    .update({ booking_id: booking.id, centre_id: booking.centreId })
    .eq('id', assessmentId)
    .is('booking_id', null);

  if (error) {
    // Never fatal: the booking is real either way, it simply carries no
    // pre-arrival assessment.
    logger.warn('could not link pre-arrival assessment to booking', {
      bookingId: booking.id,
      reason: error.message,
    });
    return null;
  }

  return assessmentId;
}

/**
 * GET /api/farmer/bookings/:bookingId/quality-assessment (§15).
 *
 * The farmer's own pre-arrival indication, after booking. Reads through the
 * caller's RLS-bound client, so a booking that is not theirs returns nothing
 * rather than somebody else's assessment.
 */
export async function getBookingAssessment(
  db: SupabaseClient,
  bookingId: string,
): Promise<PreArrivalQualityAssessment | null> {
  const rows = await quality.listPredictions(db, bookingId);
  // The pre-arrival one specifically: a staff counter assessment belongs to
  // the centre's screen, not the farmer's.
  const row = rows.find((entry) => entry.farmer_user_id !== null);
  return row ? quality.toPreArrivalView(row, env.QUALITY_CONFIDENCE_THRESHOLD) : null;
}

async function findCrop(
  db: SupabaseClient,
  cropId: string,
): Promise<{ id: string; code: string } | null> {
  const { data } = await db
    .from('crops')
    .select('id, code')
    .eq('id', cropId)
    .eq('is_procurable', true)
    .maybeSingle();
  return (data as { id: string; code: string } | null) ?? null;
}
