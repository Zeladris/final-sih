import type { Request, Response } from 'express';
import type { CreateBookingRequest, StorageDurationBand, StorageType } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { notFound, validationError } from '../lib/errors.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  cancelBooking,
  checkEligibility,
  createBooking,
  findOwnBooking,
  listAvailableDates,
  listCentresForCrop,
  listCrops,
  listOwnBookings,
  listSlotsForDate,
  newIdempotencyKey,
} from '../services/booking/bookingService.js';
import { assessProduce, getBookingAssessment } from '../services/quality/preArrivalService.js';

/**
 * Farmer booking endpoints.
 *
 * Every handler derives the farmer from `authOf(req)`. There is no
 * `farmerId` parameter anywhere in this file — a farmer cannot name another
 * farmer, so they cannot book, read or cancel as one (§48).
 */

/** GET /api/farmer/booking/eligibility */
export async function getEligibility(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({
    eligibility: await checkEligibility(auth.db, auth.userId),
    // Issued here so a retried Confirm reuses one key rather than minting a
    // new one per attempt (§51).
    idempotencyKey: newIdempotencyKey(),
  });
}

/** GET /api/farmer/booking/crops */
export async function getCrops(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ crops: await listCrops(auth.db) });
}

/** GET /api/farmer/booking/centres?cropId=&lat=&lon= */
export async function getCentres(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const cropId = req.query.cropId as string;

  const lat = req.query.lat ? Number(req.query.lat) : null;
  const lon = req.query.lon ? Number(req.query.lon) : null;
  const from =
    lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon }
      : undefined;

  res.json({ centres: await listCentresForCrop(auth.db, cropId, from) });
}

/** GET /api/farmer/booking/dates?cropId=&centreId= */
export async function getDates(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({
    dates: await listAvailableDates(
      auth.db,
      req.query.centreId as string,
      req.query.cropId as string,
    ),
  });
}

/** GET /api/farmer/booking/slots?cropId=&centreId=&date= */
export async function getSlots(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({
    slots: await listSlotsForDate(
      auth.db,
      req.query.centreId as string,
      req.query.cropId as string,
      req.query.date as string,
    ),
  });
}

/** GET /api/farmer/bookings */
export async function getBookings(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ bookings: await listOwnBookings(auth.db, auth.userId) });
}

/** GET /api/farmer/bookings/:bookingId */
export async function getBooking(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const booking = await findOwnBooking(auth.db, req.params.bookingId as string);

  // RLS already filters another farmer's booking out, so this reads as "not
  // found" rather than confirming it exists elsewhere.
  if (!booking) throw notFound('That booking is not available.');

  res.json({ booking });
}

/** POST /api/farmer/bookings */
export async function postBooking(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as CreateBookingRequest;

  const booking = await createBooking(auth.db, auth.userId, body);

  await recordAudit(req, {
    action: 'BOOKING_CREATED',
    entityType: 'bookings',
    entityId: booking.id,
    metadata: {
      bookingReference: booking.bookingReference,
      crop: booking.cropName,
      expectedQuantityKg: booking.expectedQuantityKg,
      slotDate: booking.slotDate,
      // Phase 9 §46: the one voice metric that is genuinely persisted and
      // queryable, rather than console-only. See VoiceBookingPanel's summary
      // comment for why the rest of §46's events stop at the browser for now.
      bookingMethod: body.bookingMethod ?? 'standard',
    },
  });

  res.status(201).json({ booking });
}

/**
 * POST /api/farmer/bookings/quality-assessment (§3, §15).
 *
 * The produce photo, during booking. Answers with an advisory indication —
 * or, when the model cannot answer, with MANUAL_FALLBACK and a 200, because
 * a failed assessment is a normal outcome the farmer books through, not an
 * error that stops them (§13).
 */
export async function postProduceAssessment(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const file = req.file;
  if (!file) throw validationError('Attach a photo of your produce.');

  const body = req.body as {
    cropId: string;
    expectedQuantityKg: number;
    storageDurationBand?: StorageDurationBand;
    storageType?: StorageType;
    storageLatitude?: number;
    storageLongitude?: number;
  };

  const assessment = await assessProduce(auth.db, auth.userId, {
    cropId: body.cropId,
    quantityKg: body.expectedQuantityKg,
    storageDurationBand: body.storageDurationBand ?? null,
    storageType: body.storageType ?? null,
    storageLatitude: body.storageLatitude ?? null,
    storageLongitude: body.storageLongitude ?? null,
    file,
  });

  // The AI's request, not the staff member's official QUALITY_ASSESSED result.
  await recordAudit(req, {
    action: 'QUALITY_PREDICTION_REQUESTED',
    entityType: 'quality_predictions',
    entityId: assessment.assessmentId,
    metadata: {
      status: assessment.status,
      source: assessment.source,
      modelVersion: assessment.modelVersion,
      preArrival: true,
    },
  });

  res.status(201).json({ assessment });
}

/** GET /api/farmer/bookings/:bookingId/quality-assessment — the farmer's own (§15). */
export async function getBookingProduceAssessment(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;

  const booking = await findOwnBooking(auth.db, bookingId);
  if (!booking) throw notFound('That booking is not available.');

  res.json({ assessment: await getBookingAssessment(auth.db, bookingId) });
}

/** POST /api/farmer/bookings/:bookingId/cancel */
export async function postCancelBooking(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const { reason } = (req.body ?? {}) as { reason?: string };

  const booking = await cancelBooking(auth.db, auth.userId, bookingId, reason?.trim() ?? null);

  await recordAudit(req, {
    action: 'BOOKING_CANCELLED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { bookingReference: booking.bookingReference, reason: reason ?? null },
  });

  res.json({ booking });
}
