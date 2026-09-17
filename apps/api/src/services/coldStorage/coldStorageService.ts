import type {
  ColdStorageBooking,
  ColdStorageFacility,
  ColdStorageStatusResponse,
} from '@kisansetu/shared';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import * as status from '../../repositories/statusRepository.js';
import * as cold from '../../repositories/coldStorageRepository.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Cold storage (demo addition).
 *
 * A shortfall is read, never guessed: `procurements.booked_quantity_kg -
 * accepted_quantity_kg`, the same figures weighing/confirm already persist
 * (Phase 5/8) — nothing here recomputes or overrides what the centre
 * actually recorded. No procurement row yet (not weighed/confirmed) means
 * no offer, not a zero one (§ never claim a shortfall before it's real).
 */

/** Loads a booking the caller owns, or reports it as not found — same rule statusService.ts uses. */
async function ownBooking(auth: AuthContext, bookingId: string): Promise<status.StatusBookingRow> {
  const booking = await status.findStatusBooking(auth.db, bookingId);
  if (!booking || booking.farmer_user_id !== auth.userId) {
    throw notFound('That booking is not available.');
  }
  return booking;
}

async function computeShortfall(
  auth: AuthContext,
  bookingId: string,
): Promise<{ cropName: string; remainingQuantityKg: number } | null> {
  const procurement = await cold.findProcurementQuantities(auth.db, bookingId);
  if (!procurement) return null; // not weighed/confirmed yet — nothing to offer

  const booked = Number(procurement.booked_quantity_kg ?? 0);
  const accepted = Number(procurement.accepted_quantity_kg ?? 0);
  const remaining = Math.round((booked - accepted) * 1000) / 1000;

  if (remaining <= 0) return null; // fully procured — never offer storage for nothing
  return { cropName: procurement.crop, remainingQuantityKg: remaining };
}

export async function getColdStorageStatus(
  auth: AuthContext,
  bookingId: string,
): Promise<ColdStorageStatusResponse> {
  await ownBooking(auth, bookingId);

  const reservation = await cold.findReservationForBooking(auth.db, bookingId);
  if (reservation) return { offer: null, reservation };

  const shortfall = await computeShortfall(auth, bookingId);
  return { offer: shortfall, reservation: null };
}

export async function listColdStorageFacilities(auth: AuthContext): Promise<ColdStorageFacility[]> {
  return cold.listActiveFacilities(auth.db);
}

export async function reserveColdStorage(
  auth: AuthContext,
  bookingId: string,
  facilityId: string,
): Promise<ColdStorageBooking> {
  const booking = await ownBooking(auth, bookingId);

  const existing = await cold.findReservationForBooking(auth.db, bookingId);
  if (existing) throw conflict('This booking already has a cold-storage reservation.');

  // Recomputed here, server-side, from the booking's own procurement record —
  // never trusted from the client (§ the same reason MSP rates and payment
  // amounts are always server-resolved, never sent by the caller).
  const shortfall = await computeShortfall(auth, bookingId);
  if (!shortfall) {
    throw validationError('This booking has no remaining crop to store.');
  }

  const facility = await cold.findFacility(auth.db, facilityId);
  if (!facility) throw notFound('That cold storage facility is not available.');

  const reserved = await cold.decrementFacilityCapacity(
    supabaseAdminClient,
    facilityId,
    shortfall.remainingQuantityKg,
  );
  if (!reserved) {
    throw conflict('That facility no longer has enough available capacity for this quantity.');
  }

  return cold.insertReservation(supabaseAdminClient, {
    bookingId,
    farmerUserId: auth.userId,
    facilityId,
    crop: shortfall.cropName,
    cropId: booking.crop_id,
    quantityKg: shortfall.remainingQuantityKg,
  });
}
