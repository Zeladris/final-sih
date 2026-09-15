import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  accountStateFor,
  addDays,
  BOOKING_HORIZON_DAYS,
  calculateDistanceKm,
  eligibilityFor,
  isEligibleToBook,
  MAX_QUANTITY_KG,
  MIN_QUANTITY_KG,
} from '@kisansetu/shared';
import type {
  AvailableDate,
  BookableCentre,
  BookingEligibility,
  CreateBookingRequest,
  Crop,
  FarmerBooking,
  ProcurementSlot,
  StorageDurationBand,
  StorageType,
} from '@kisansetu/shared';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap, unwrapMaybe } from '../../repositories/postgrestError.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { today } from '../procurement/operationsService.js';
import { linkAssessmentToBooking } from '../quality/preArrivalService.js';
import * as ops from '../../repositories/operationsRepository.js';

/**
 * Farmer crop & slot booking (Phase 4).
 *
 * Three rules the server owns outright, because the client cannot be trusted
 * with any of them (§29, §48, §49, §50):
 *
 *   1. ELIGIBILITY  — only a verified farmer may book.
 *   2. COMPATIBILITY — the centre must actually accept the crop.
 *   3. CAPACITY     — enforced by a database trigger, so two farmers
 *                     confirming the last place simultaneously cannot both win.
 */

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

interface CropRow {
  id: string;
  code: string;
  name_en: string;
  name_ta: string;
  unit: string;
  is_procurable: boolean;
}

const toCrop = (row: CropRow): Crop => ({
  id: row.id,
  code: row.code,
  nameEn: row.name_en,
  nameTa: row.name_ta,
  unit: row.unit,
  isProcurable: row.is_procurable,
});

export async function listCrops(db: SupabaseClient): Promise<Crop[]> {
  const rows = unwrap<CropRow[]>(
    await db
      .from('crops')
      .select('id, code, name_en, name_ta, unit, is_procurable')
      .eq('is_procurable', true)
      .order('display_order', { ascending: true }),
    'crops.list',
  );
  return rows.map(toCrop);
}

async function findCrop(db: SupabaseClient, cropId: string): Promise<Crop | null> {
  const row = unwrapMaybe<CropRow>(
    await db
      .from('crops')
      .select('id, code, name_en, name_ta, unit, is_procurable')
      .eq('id', cropId)
      .maybeSingle(),
    'crops.findById',
  );
  return row ? toCrop(row) : null;
}

// ---------------------------------------------------------------------------
// Eligibility (§4)
// ---------------------------------------------------------------------------

export async function checkEligibility(
  db: SupabaseClient,
  userId: string,
): Promise<BookingEligibility> {
  const farmer = await findFarmerProfile(db, userId);
  return eligibilityFor(accountStateFor(farmer?.registrationStatus ?? null));
}

async function requireEligible(db: SupabaseClient, userId: string): Promise<void> {
  const eligibility = await checkEligibility(db, userId);

  if (!isEligibleToBook(eligibility)) {
    // Re-checked here even though the UI hides the entry point: a hidden
    // button is not an authorization control (§4).
    throw forbidden('Your farmer registration must be verified before you can book a slot.', {
      eligibility,
    });
  }
}

// ---------------------------------------------------------------------------
// Centres and availability (§18, §21, §22)
// ---------------------------------------------------------------------------

/** Straight-line distance. Approximate by design — it only orders a list.
 *  Moved to packages/shared/src/location.ts (Phase 10 §18) so the frontend
 *  location feature and any future consumer share the one implementation. */
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return calculateDistanceKm(a.lat, a.lon, b.lat, b.lon);
}

export async function listCentresForCrop(
  db: SupabaseClient,
  cropId: string,
  from?: { lat: number; lon: number },
): Promise<BookableCentre[]> {
  const crop = await findCrop(db, cropId);
  if (!crop || !crop.isProcurable) {
    throw validationError('That crop is not currently being procured.');
  }

  // Only centres that accept this crop (§19).
  const links = unwrap<Array<{ centre_id: string }>>(
    await db.from('centre_crops').select('centre_id').eq('crop_id', cropId).eq('is_active', true),
    'centreCrops.forCrop',
  );

  if (links.length === 0) return [];

  const centreIds = links.map((link) => link.centre_id);

  const centres = unwrap<
    Array<{
      id: string;
      code: string;
      name: string;
      village: string | null;
      latitude: string | number | null;
      longitude: string | number | null;
      open_time: string | null;
      close_time: string | null;
      district_id: string;
      is_active: boolean;
    }>
  >(
    await db
      .from('procurement_centres')
      .select('id, code, name, village, latitude, longitude, open_time, close_time, district_id, is_active')
      .in('id', centreIds)
      .eq('is_active', true),
    'centres.bookable',
  );

  const start = today();
  const horizon = addDays(start, BOOKING_HORIZON_DAYS);

  // District names, once.
  const districtIds = [...new Set(centres.map((centre) => centre.district_id))];
  const districts = unwrap<Array<{ id: string; name: string }>>(
    await db.from('districts').select('id, name').in('id', districtIds),
    'districts.forCentres',
  );
  const districtName = new Map(districts.map((district) => [district.id, district.name]));

  const result = await Promise.all(
    centres.map(async (centre): Promise<BookableCentre> => {
      const slots = await ops.listSlots(db, centre.id, start, horizon);
      const bookable = slots.filter(
        (slot) => slot.status === 'OPEN' && slot.remainingCapacity > 0,
      );

      const lat = centre.latitude === null ? null : Number(centre.latitude);
      const lon = centre.longitude === null ? null : Number(centre.longitude);

      return {
        id: centre.id,
        code: centre.code,
        name: centre.name,
        village: centre.village,
        districtName: districtName.get(centre.district_id) ?? null,
        openTime: centre.open_time ? centre.open_time.slice(0, 5) : null,
        closeTime: centre.close_time ? centre.close_time.slice(0, 5) : null,
        availableSlotCount: bookable.length,
        // Null rather than a guess when we have no location to measure from.
        distanceKm:
          from && lat !== null && lon !== null ? distanceKm(from, { lat, lon }) : null,
      };
    }),
  );

  return result.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    return b.availableSlotCount - a.availableSlotCount;
  });
}

/** Dates with at least one bookable slot (§21). */
export async function listAvailableDates(
  db: SupabaseClient,
  centreId: string,
  cropId: string,
): Promise<AvailableDate[]> {
  await assertCentreAcceptsCrop(db, centreId, cropId);

  const start = today();
  const slots = await ops.listSlots(db, centreId, start, addDays(start, BOOKING_HORIZON_DAYS));

  const byDate = new Map<string, { slotCount: number; remainingCapacity: number }>();

  for (const slot of slots) {
    if (slot.status !== 'OPEN' || slot.remainingCapacity === 0) continue;

    const entry = byDate.get(slot.slotDate) ?? { slotCount: 0, remainingCapacity: 0 };
    entry.slotCount += 1;
    entry.remainingCapacity += slot.remainingCapacity;
    byDate.set(slot.slotDate, entry);
  }

  return [...byDate.entries()]
    .map(([date, entry]) => ({ date, ...entry }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Slots on one date.
 *
 * Full slots are returned too, marked full, so the farmer can see the day is
 * busy rather than wondering why a time is missing (§22).
 */
export async function listSlotsForDate(
  db: SupabaseClient,
  centreId: string,
  cropId: string,
  date: string,
): Promise<ProcurementSlot[]> {
  await assertCentreAcceptsCrop(db, centreId, cropId);

  if (date < today()) {
    throw validationError('That date has already passed.');
  }

  const slots = await ops.listSlots(db, centreId, date, date);
  return slots.filter((slot) => slot.status === 'OPEN' || slot.status === 'FULL');
}

async function assertCentreAcceptsCrop(
  db: SupabaseClient,
  centreId: string,
  cropId: string,
): Promise<void> {
  const link = unwrapMaybe<{ centre_id: string }>(
    await db
      .from('centre_crops')
      .select('centre_id')
      .eq('centre_id', centreId)
      .eq('crop_id', cropId)
      .eq('is_active', true)
      .maybeSingle(),
    'centreCrops.check',
  );

  if (!link) {
    throw validationError('This procurement centre does not accept that crop.');
  }
}

// ---------------------------------------------------------------------------
// Creating a booking (§29)
// ---------------------------------------------------------------------------

interface BookingJoinRow {
  id: string;
  booking_reference: string;
  crop_id: string | null;
  crop: string;
  expected_quantity_kg: string | number;
  quantity_unit: string;
  harvest_date: string | null;
  storage_location_text: string | null;
  storage_place_name: string | null;
  storage_latitude: string | number | null;
  produce_photo_path: string | null;
  storage_duration_band: StorageDurationBand | null;
  storage_type: StorageType | null;
  quality_prediction_id: string | null;
  centre_id: string;
  slot_id: string;
  status: FarmerBooking['status'];
  procurement_status: FarmerBooking['farmerStatus'];
  created_at: string;
  cancelled_at: string | null;
}

const BOOKING_SELECT =
  'id, booking_reference, crop_id, crop, expected_quantity_kg, quantity_unit, harvest_date, ' +
  'storage_location_text, storage_place_name, storage_latitude, produce_photo_path, ' +
  'storage_duration_band, storage_type, quality_prediction_id, ' +
  'centre_id, slot_id, status, procurement_status, created_at, cancelled_at';

async function hydrate(db: SupabaseClient, rows: BookingJoinRow[]): Promise<FarmerBooking[]> {
  if (rows.length === 0) return [];

  const slotIds = [...new Set(rows.map((row) => row.slot_id))];
  const centreIds = [...new Set(rows.map((row) => row.centre_id))];

  const [slots, centres, operations] = await Promise.all([
    Promise.all(slotIds.map((id) => ops.findSlot(db, id))),
    unwrap<Array<{ id: string; name: string; village: string | null }>>(
      await db.from('procurement_centres').select('id, name, village').in('id', centreIds),
      'centres.forBookings',
    ),
    ops.listOperations(db, rows.map((row) => row.id)),
  ]);

  const slotById = new Map(slots.filter(Boolean).map((slot) => [slot!.id, slot!]));
  const centreById = new Map(centres.map((centre) => [centre.id, centre]));
  const operationByBooking = new Map(operations.map((op) => [op.booking_id, op]));

  return rows.map((row): FarmerBooking => {
    const slot = slotById.get(row.slot_id);
    const centre = centreById.get(row.centre_id);

    return {
      id: row.id,
      bookingReference: row.booking_reference,
      cropId: row.crop_id,
      cropName: row.crop,
      expectedQuantityKg: Number(row.expected_quantity_kg),
      quantityUnit: row.quantity_unit,
      harvestDate: row.harvest_date,
      storageLocationText: row.storage_location_text,
      storagePlaceName: row.storage_place_name,
      hasStorageCoordinates: row.storage_latitude !== null,
      storageDurationBand: row.storage_duration_band,
      storageType: row.storage_type,
      centreId: row.centre_id,
      centreName: centre?.name ?? '',
      centreVillage: centre?.village ?? null,
      slotDate: slot?.slot_date ?? '',
      slotStart: slot ? slot.start_time.slice(0, 5) : '',
      slotEnd: slot ? slot.end_time.slice(0, 5) : '',
      status: row.status,
      hasProducePhoto: row.produce_photo_path !== null,
      operationState: operationByBooking.get(row.id)?.state ?? null,
      farmerStatus: row.procurement_status,
      createdAt: row.created_at,
      cancelledAt: row.cancelled_at,
    };
  });
}

export async function listOwnBookings(
  db: SupabaseClient,
  userId: string,
): Promise<FarmerBooking[]> {
  const rows = unwrap<BookingJoinRow[]>(
    await db
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('farmer_user_id', userId)
      .order('created_at', { ascending: false }),
    'bookings.listOwn',
  );

  return hydrate(db, rows);
}

export async function findOwnBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<FarmerBooking | null> {
  const row = unwrapMaybe<BookingJoinRow>(
    await db.from('bookings').select(BOOKING_SELECT).eq('id', bookingId).maybeSingle(),
    'bookings.findOwn',
  );

  if (!row) return null;
  const [booking] = await hydrate(db, [row]);
  return booking ?? null;
}

export async function createBooking(
  db: SupabaseClient,
  userId: string,
  request: CreateBookingRequest,
): Promise<FarmerBooking> {
  await requireEligible(db, userId);

  /**
   * The retry check comes FIRST, before validation and before the duplicate
   * check below.
   *
   * A farmer whose Confirm timed out and who tapped again is not making a
   * second booking — they are asking whether the first one landed. Checking
   * "do you already have a booking for this slot?" first would answer that
   * with a 409 the UI shows as a failure, for a booking that actually
   * succeeded (§40, §51).
   */
  const replay = unwrapMaybe<BookingJoinRow>(
    await db
      .from('bookings')
      .select(BOOKING_SELECT)
      .eq('farmer_user_id', userId)
      .eq('idempotency_key', request.idempotencyKey)
      .maybeSingle(),
    'bookings.idempotencyCheck',
  );

  if (replay) {
    const [booking] = await hydrate(db, [replay]);
    if (booking) return booking;
  }

  if (
    !Number.isFinite(request.expectedQuantityKg) ||
    request.expectedQuantityKg < MIN_QUANTITY_KG ||
    request.expectedQuantityKg > MAX_QUANTITY_KG
  ) {
    throw validationError('Enter how much produce you plan to bring.');
  }

  if (!request.storageLocationText?.trim()) {
    throw validationError('Tell us where the produce is currently stored.');
  }

  const crop = await findCrop(db, request.cropId);
  if (!crop || !crop.isProcurable) {
    throw validationError('That crop is not currently being procured.');
  }

  const slot = await ops.findSlot(db, request.slotId);
  if (!slot) throw notFound('That slot is no longer available.');

  if (slot.status !== 'OPEN') {
    throw conflict('This slot is no longer available. Please choose another time.');
  }

  if (slot.slot_date < today()) {
    throw conflict('That slot has already passed. Please choose another date.');
  }

  await assertCentreAcceptsCrop(db, slot.centre_id, request.cropId);

  // An overlapping active booking is almost always a double-tap, not intent (§26).
  const existing = unwrapMaybe<{ id: string; booking_reference: string }>(
    await db
      .from('bookings')
      .select('id, booking_reference')
      .eq('farmer_user_id', userId)
      .eq('slot_id', request.slotId)
      .eq('status', 'BOOKED')
      .maybeSingle(),
    'bookings.duplicateCheck',
  );

  if (existing) {
    throw conflict('You already have a booking for this slot.', {
      bookingReference: existing.booking_reference,
    });
  }

  /**
   * Created with the service role AFTER every check above.
   *
   * Capacity is not checked here on purpose — the database trigger enforces
   * it, which is the only way two farmers confirming the last place at the
   * same moment cannot both succeed (§50).
   */
  const { data, error } = await supabaseAdminClient
    .from('bookings')
    .insert({
      farmer_user_id: userId,
      slot_id: request.slotId,
      centre_id: slot.centre_id,
      crop_id: request.cropId,
      expected_quantity_kg: request.expectedQuantityKg,
      harvest_date: request.harvestDate ?? null,
      storage_location_text: request.storageLocationText.trim(),
      storage_place_name: request.storagePlaceName?.trim() || null,
      storage_latitude: request.storageLatitude ?? null,
      storage_longitude: request.storageLongitude ?? null,
      storage_duration_band: request.storageDurationBand ?? null,
      storage_type: request.storageType ?? null,
      idempotency_key: request.idempotencyKey,
    })
    .select(BOOKING_SELECT)
    .single();

  if (error) {
    // A repeated Confirm hits the idempotency index. Return what was already
    // created rather than an error — the farmer's intent was satisfied (§51).
    if (error.code === '23505' && /idempotency/i.test(error.message)) {
      const prior = unwrapMaybe<BookingJoinRow>(
        await db
          .from('bookings')
          .select(BOOKING_SELECT)
          .eq('farmer_user_id', userId)
          .eq('idempotency_key', request.idempotencyKey)
          .maybeSingle(),
        'bookings.idempotentReplay',
      );

      if (prior) {
        const [booking] = await hydrate(db, [prior]);
        if (booking) return booking;
      }
    }

    if (/capacity/i.test(error.message)) {
      throw conflict('This slot is no longer available. Please choose another time.');
    }

    logger.error('booking creation failed', { userId, reason: error.message, code: error.code });
    throw conflict('We could not confirm your booking. Please try again.');
  }

  // The client is untyped, so PostgREST infers an opaque row here; the shape
  // is declared by BookingJoinRow and asserted once, at this boundary.
  const row = data as unknown as BookingJoinRow;

  /**
   * Attach the pre-arrival assessment, if the farmer made one (§34).
   *
   * Deliberately after the booking exists and deliberately non-fatal: the
   * booking is the thing the farmer asked for, and an assessment that cannot
   * be linked must not undo it. The centre then simply assesses on arrival,
   * which is what happens for every booking made without one (§13).
   */
  if (request.qualityAssessmentId) {
    try {
      const linked = await linkAssessmentToBooking(userId, request.qualityAssessmentId, {
        id: row.id,
        centreId: slot.centre_id,
        cropId: request.cropId,
      });
      if (linked) {
        await supabaseAdminClient
          .from('bookings')
          .update({ quality_prediction_id: linked })
          .eq('id', row.id);
        row.quality_prediction_id = linked;
      }
    } catch (cause) {
      logger.warn('pre-arrival assessment could not be attached to the booking', {
        bookingId: row.id,
        reason: (cause as Error).message,
      });
    }
  }

  const [booking] = await hydrate(db, [row]);
  if (!booking) throw conflict('We could not confirm your booking. Please try again.');
  return booking;
}

/** Cancellation keeps the row and sets a status, so history survives (§35). */
export async function cancelBooking(
  db: SupabaseClient,
  userId: string,
  bookingId: string,
  reason: string | null,
): Promise<FarmerBooking> {
  const booking = await findOwnBooking(db, bookingId);
  if (!booking) throw notFound('That booking is not available.');

  if (booking.status !== 'BOOKED') {
    throw conflict('This booking can no longer be cancelled.');
  }

  // Once the centre has started work, cancelling is no longer the farmer's
  // call — staff are mid-process on the produce in front of them.
  if (booking.operationState !== null && booking.operationState !== 'BOOKED') {
    throw conflict('This booking is already being processed at the centre.');
  }

  const { error } = await supabaseAdminClient
    .from('bookings')
    .update({
      status: 'CANCELLED',
      cancelled_at: new Date().toISOString(),
      cancelled_by: userId,
      cancellation_reason: reason,
    })
    .eq('id', bookingId)
    .eq('farmer_user_id', userId)
    .eq('status', 'BOOKED');

  if (error) throw conflict('We could not cancel this booking. Please try again.');

  const updated = await findOwnBooking(db, bookingId);
  if (!updated) throw notFound('That booking is not available.');
  return updated;
}

/** A fresh idempotency key for the review screen. */
export function newIdempotencyKey(): string {
  return randomUUID();
}
