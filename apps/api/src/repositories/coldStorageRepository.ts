import type { SupabaseClient } from '@supabase/supabase-js';
import type { ColdStorageBooking, ColdStorageFacility } from '@kisansetu/shared';
import { unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Cold storage (demo addition). Follows the same row-type-then-mapper shape
 * as every other repository in this codebase — no new conventions.
 */

interface FacilityRow {
  id: string;
  name: string;
  location: string;
  capacity_kg: string | number;
  available_capacity_kg: string | number;
}

const FACILITY_COLUMNS = 'id, name, location, capacity_kg, available_capacity_kg';

const toFacility = (row: FacilityRow): ColdStorageFacility => ({
  id: row.id,
  name: row.name,
  location: row.location,
  capacityKg: Number(row.capacity_kg),
  availableCapacityKg: Number(row.available_capacity_kg),
});

export async function listActiveFacilities(db: SupabaseClient): Promise<ColdStorageFacility[]> {
  const rows = unwrap<FacilityRow[]>(
    await db
      .from('cold_storage_facilities')
      .select(FACILITY_COLUMNS)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    'coldStorage.facilities',
  );
  return rows.map(toFacility);
}

export async function findFacility(
  db: SupabaseClient,
  facilityId: string,
): Promise<ColdStorageFacility | null> {
  const row = unwrapMaybe<FacilityRow>(
    await db
      .from('cold_storage_facilities')
      .select(FACILITY_COLUMNS)
      .eq('id', facilityId)
      .eq('is_active', true)
      .maybeSingle(),
    'coldStorage.facility',
  );
  return row ? toFacility(row) : null;
}

/** What a booking actually procured today, for computing a shortfall. */
export interface ProcurementQuantityRow {
  crop: string;
  booked_quantity_kg: string | number | null;
  accepted_quantity_kg: string | number | null;
}

export async function findProcurementQuantities(
  db: SupabaseClient,
  bookingId: string,
): Promise<ProcurementQuantityRow | null> {
  return unwrapMaybe<ProcurementQuantityRow>(
    await db
      .from('procurements')
      .select('crop, booked_quantity_kg, accepted_quantity_kg')
      .eq('booking_id', bookingId)
      .maybeSingle(),
    'coldStorage.procurementQuantities',
  );
}

interface ReservationRow {
  id: string;
  booking_reference: string;
  crop: string;
  quantity_kg: string | number;
  status: 'RESERVED' | 'CANCELLED';
  created_at: string;
  cold_storage_facilities: { name: string; location: string } | null;
}

const RESERVATION_COLUMNS =
  'id, booking_reference, crop, quantity_kg, status, created_at, cold_storage_facilities(name, location)';

const toReservation = (row: ReservationRow): ColdStorageBooking => ({
  id: row.id,
  bookingReference: row.booking_reference,
  facilityName: row.cold_storage_facilities?.name ?? '',
  facilityLocation: row.cold_storage_facilities?.location ?? '',
  cropName: row.crop,
  quantityKg: Number(row.quantity_kg),
  status: row.status,
  createdAt: row.created_at,
});

export async function findReservationForBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<ColdStorageBooking | null> {
  const row = unwrapMaybe<ReservationRow>(
    await db
      .from('cold_storage_bookings')
      .select(RESERVATION_COLUMNS)
      .eq('booking_id', bookingId)
      .maybeSingle(),
    'coldStorage.reservation',
  );
  return row ? toReservation(row) : null;
}

/**
 * Reserves `quantityKg` at `facilityId`, decrementing available capacity
 * atomically via a DB function — `available_capacity_kg >= quantity` is
 * checked and applied in the same statement, so two concurrent reservations
 * for the same last bit of space can't both succeed (§ the DB is the source
 * of truth for anything concurrency can race on, never application code;
 * the exact pattern slot capacity already relies on elsewhere). Returns
 * false if there was not enough available capacity.
 */
export async function decrementFacilityCapacity(
  adminDb: SupabaseClient,
  facilityId: string,
  quantityKg: number,
): Promise<boolean> {
  const { data, error } = await adminDb.rpc('reserve_cold_storage_capacity', {
    p_facility_id: facilityId,
    p_quantity_kg: quantityKg,
  });
  if (error) throw new Error(`coldStorage.reserveCapacity: ${error.message}`);
  return Boolean(data);
}

export async function insertReservation(
  adminDb: SupabaseClient,
  input: {
    bookingId: string;
    farmerUserId: string;
    facilityId: string;
    crop: string;
    cropId: string | null;
    quantityKg: number;
  },
): Promise<ColdStorageBooking> {
  const row = unwrap<ReservationRow>(
    await adminDb
      .from('cold_storage_bookings')
      .insert({
        booking_id: input.bookingId,
        farmer_user_id: input.farmerUserId,
        facility_id: input.facilityId,
        crop: input.crop,
        crop_id: input.cropId,
        quantity_kg: input.quantityKg,
      })
      .select(RESERVATION_COLUMNS)
      .single(),
    'coldStorage.insertReservation',
  );
  return toReservation(row);
}
