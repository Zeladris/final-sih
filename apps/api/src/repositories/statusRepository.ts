import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookingStatus, FarmerProcurementStatus, OperationState } from '@kisansetu/shared';
import { unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Reads for the live status system (Phase 6).
 *
 * All of these run under the CALLER's RLS-bound client. There are no writes
 * here: status moves only through `transition_booking_operation` (see
 * operationsRepository) and history is written by database trigger.
 */

export interface StatusBookingRow {
  id: string;
  booking_reference: string;
  farmer_user_id: string;
  centre_id: string;
  slot_id: string;
  crop_id: string | null;
  crop: string;
  expected_quantity_kg: string | number;
  quantity_unit: string;
  status: BookingStatus;
  procurement_status: FarmerProcurementStatus;
  status_version: string | number;
  status_updated_at: string;
  cancellation_reason: string | null;
  arrival_otp_code: string;
  arrival_otp_verified_at: string | null;
}

const STATUS_BOOKING_COLUMNS =
  'id, booking_reference, farmer_user_id, centre_id, slot_id, crop_id, crop, expected_quantity_kg, ' +
  'quantity_unit, status, procurement_status, status_version, status_updated_at, cancellation_reason, ' +
  'arrival_otp_code, arrival_otp_verified_at';

export async function findStatusBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<StatusBookingRow | null> {
  return unwrapMaybe<StatusBookingRow>(
    await db.from('bookings').select(STATUS_BOOKING_COLUMNS).eq('id', bookingId).maybeSingle(),
    'status.findBooking',
  );
}

export interface HistoryRow {
  id: number;
  from_status: FarmerProcurementStatus | null;
  to_status: FarmerProcurementStatus;
  from_state: OperationState | null;
  to_state: OperationState | null;
  changed_by_role: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function listHistory(db: SupabaseClient, bookingId: string): Promise<HistoryRow[]> {
  return unwrap<HistoryRow[]>(
    await db
      .from('procurement_status_history')
      .select(
        'id, from_status, to_status, from_state, to_state, changed_by_role, reason, metadata, created_at',
      )
      // Identity order, not timestamp: two transitions in one second must
      // still come back in the order they happened.
      .eq('booking_id', bookingId)
      .order('id', { ascending: true }),
    'status.history',
  );
}

export async function findCropNames(
  db: SupabaseClient,
  cropId: string,
): Promise<{ name_en: string; name_ta: string } | null> {
  return unwrapMaybe<{ name_en: string; name_ta: string }>(
    await db.from('crops').select('name_en, name_ta').eq('id', cropId).maybeSingle(),
    'status.crop',
  );
}

export async function findCentreName(
  db: SupabaseClient,
  centreId: string,
): Promise<{ name: string; village: string | null } | null> {
  return unwrapMaybe<{ name: string; village: string | null }>(
    await db.from('procurement_centres').select('name, village').eq('id', centreId).maybeSingle(),
    'status.centre',
  );
}
