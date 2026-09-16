import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BookingStatus,
  OperationState,
  ProcurementSession,
  ProcurementSlot,
  QualityResult,
  SessionStatus,
  SlotStatus,
} from '@kisansetu/shared';
import { conflict } from '../lib/errors.js';
import { translatePostgrestError, unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Data access for procurement operations.
 *
 * Reads use the CALLER's RLS-bound client, so another centre's rows are not
 * returned at all. Writes take an explicit admin client, because every state
 * transition is a server-authorized operation (§42).
 */

const num = (value: string | number | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const hhmm = (value: string | null): string => (value ? value.slice(0, 5) : '');

// --- Slots ------------------------------------------------------------------

interface SlotRow {
  id: string;
  centre_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: SlotStatus;
}

const SLOT_COLUMNS = 'id, centre_id, slot_date, start_time, end_time, capacity, status';

/**
 * Slots with their live booking counts.
 *
 * The count is computed from bookings rather than stored on the slot, so it
 * cannot drift out of step with reality (§14).
 */
export async function listSlots(
  db: SupabaseClient,
  centreId: string,
  fromDate: string,
  toDate: string,
): Promise<ProcurementSlot[]> {
  const rows = unwrap<SlotRow[]>(
    await db
      .from('procurement_slots')
      .select(SLOT_COLUMNS)
      .eq('centre_id', centreId)
      .gte('slot_date', fromDate)
      .lte('slot_date', toDate)
      .order('slot_date', { ascending: true })
      .order('start_time', { ascending: true }),
    'slots.list',
  );

  if (rows.length === 0) return [];

  const counts = await bookingCountsBySlot(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => {
    const bookedCount = counts.get(row.id) ?? 0;
    const remaining = Math.max(0, row.capacity - bookedCount);

    return {
      id: row.id,
      centreId: row.centre_id,
      slotDate: row.slot_date,
      startTime: hhmm(row.start_time),
      endTime: hhmm(row.end_time),
      capacity: row.capacity,
      bookedCount,
      remainingCapacity: remaining,
      status: row.status,
      isFull: remaining === 0,
    };
  });
}

async function bookingCountsBySlot(
  db: SupabaseClient,
  slotIds: string[],
): Promise<Map<string, number>> {
  const rows = unwrap<Array<{ slot_id: string }>>(
    await db.from('bookings').select('slot_id').in('slot_id', slotIds).eq('status', 'BOOKED'),
    'slots.bookingCounts',
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.slot_id, (counts.get(row.slot_id) ?? 0) + 1);
  }
  return counts;
}

export async function findSlot(db: SupabaseClient, slotId: string): Promise<SlotRow | null> {
  return unwrapMaybe<SlotRow>(
    await db.from('procurement_slots').select(SLOT_COLUMNS).eq('id', slotId).maybeSingle(),
    'slots.findById',
  );
}

export async function insertSlot(
  adminDb: SupabaseClient,
  input: {
    centreId: string;
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
    createdBy: string;
  },
): Promise<SlotRow> {
  return unwrap<SlotRow>(
    await adminDb
      .from('procurement_slots')
      .insert({
        centre_id: input.centreId,
        slot_date: input.slotDate,
        start_time: input.startTime,
        end_time: input.endTime,
        capacity: input.capacity,
        created_by: input.createdBy,
      })
      .select(SLOT_COLUMNS)
      .single(),
    'slots.insert',
  );
}

export async function updateSlot(
  adminDb: SupabaseClient,
  slotId: string,
  patch: { capacity?: number; status?: SlotStatus; startTime?: string; endTime?: string },
): Promise<SlotRow | null> {
  const payload: Record<string, unknown> = {};
  if (patch.capacity !== undefined) payload.capacity = patch.capacity;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.startTime !== undefined) payload.start_time = patch.startTime;
  if (patch.endTime !== undefined) payload.end_time = patch.endTime;

  return unwrapMaybe<SlotRow>(
    await adminDb
      .from('procurement_slots')
      .update(payload)
      .eq('id', slotId)
      .select(SLOT_COLUMNS)
      .maybeSingle(),
    'slots.update',
  );
}

// --- Sessions ---------------------------------------------------------------

interface SessionRow {
  id: string;
  centre_id: string;
  session_date: string;
  status: SessionStatus;
  opened_at: string | null;
  closed_at: string | null;
}

const SESSION_COLUMNS = 'id, centre_id, session_date, status, opened_at, closed_at';

const toSession = (row: SessionRow): ProcurementSession => ({
  id: row.id,
  centreId: row.centre_id,
  sessionDate: row.session_date,
  status: row.status,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
});

export async function findSession(
  db: SupabaseClient,
  centreId: string,
  sessionDate: string,
): Promise<ProcurementSession | null> {
  const row = unwrapMaybe<SessionRow>(
    await db
      .from('procurement_sessions')
      .select(SESSION_COLUMNS)
      .eq('centre_id', centreId)
      .eq('session_date', sessionDate)
      .maybeSingle(),
    'sessions.findByDate',
  );
  return row ? toSession(row) : null;
}

/**
 * Gets today's session, creating it as SCHEDULED if it does not exist.
 *
 * Creating a scheduled shell is not the same as opening the day — opening is
 * a deliberate staff action (§11).
 */
export async function ensureSession(
  adminDb: SupabaseClient,
  centreId: string,
  sessionDate: string,
): Promise<ProcurementSession> {
  const row = unwrap<SessionRow>(
    await adminDb
      .from('procurement_sessions')
      .upsert(
        { centre_id: centreId, session_date: sessionDate },
        { onConflict: 'centre_id,session_date', ignoreDuplicates: false },
      )
      .select(SESSION_COLUMNS)
      .single(),
    'sessions.ensure',
  );
  return toSession(row);
}

/**
 * Moves a session, but only from the status the caller last saw.
 *
 * The `.eq('status', expectedFrom)` is the concurrency control: if another
 * operator already opened or closed the day, this matches nothing.
 */
export async function transitionSession(
  adminDb: SupabaseClient,
  sessionId: string,
  expectedFrom: SessionStatus,
  to: SessionStatus,
  actorId: string,
): Promise<ProcurementSession | null> {
  const payload: Record<string, unknown> = { status: to };
  if (to === 'OPEN') payload.opened_by = actorId;
  if (to === 'CLOSED') payload.closed_by = actorId;

  const rows = unwrap<SessionRow[]>(
    await adminDb
      .from('procurement_sessions')
      .update(payload)
      .eq('id', sessionId)
      .eq('status', expectedFrom)
      .select(SESSION_COLUMNS),
    'sessions.transition',
  );

  return rows.length > 0 ? toSession(rows[0] as SessionRow) : null;
}

// --- Bookings and operations ------------------------------------------------

export interface BookingRow {
  id: string;
  booking_reference: string;
  farmer_user_id: string;
  slot_id: string;
  centre_id: string;
  crop: string;
  crop_id: string | null;
  expected_quantity_kg: string | number;
  status: BookingStatus;
  created_at: string;
  arrival_otp_code: string;
  arrival_otp_verified_at: string | null;
}

export interface OperationRow {
  id: string;
  booking_id: string;
  session_id: string;
  centre_id: string;
  state: OperationState;
  arrived_at: string | null;
  checked_in_at: string | null;
  claimed_by: string | null;
  crop_verified: boolean | null;
  crop_issue: string | null;
  hold_reason: string | null;
  queue_position: number | null;
  estimated_wait_minutes: number | null;
  queue_updated_at: string | null;
}

const BOOKING_COLUMNS =
  'id, booking_reference, farmer_user_id, slot_id, centre_id, crop, crop_id, expected_quantity_kg, ' +
  'status, created_at, arrival_otp_code, arrival_otp_verified_at';

const OPERATION_COLUMNS =
  'id, booking_id, session_id, centre_id, state, arrived_at, checked_in_at, claimed_by, ' +
  'crop_verified, crop_issue, hold_reason, queue_position, estimated_wait_minutes, queue_updated_at';

export async function listBookingsForDates(
  db: SupabaseClient,
  centreId: string,
  slotIds: string[],
): Promise<BookingRow[]> {
  if (slotIds.length === 0) return [];

  return unwrap<BookingRow[]>(
    await db
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .eq('centre_id', centreId)
      .in('slot_id', slotIds),
    'bookings.listForSlots',
  );
}

export async function findBooking(
  db: SupabaseClient,
  bookingId: string,
): Promise<BookingRow | null> {
  return unwrapMaybe<BookingRow>(
    await db.from('bookings').select(BOOKING_COLUMNS).eq('id', bookingId).maybeSingle(),
    'bookings.findById',
  );
}

export async function listOperations(
  db: SupabaseClient,
  bookingIds: string[],
): Promise<OperationRow[]> {
  if (bookingIds.length === 0) return [];

  return unwrap<OperationRow[]>(
    await db.from('booking_operations').select(OPERATION_COLUMNS).in('booking_id', bookingIds),
    'operations.listForBookings',
  );
}

export async function findOperation(
  db: SupabaseClient,
  bookingId: string,
): Promise<OperationRow | null> {
  return unwrapMaybe<OperationRow>(
    await db
      .from('booking_operations')
      .select(OPERATION_COLUMNS)
      .eq('booking_id', bookingId)
      .maybeSingle(),
    'operations.findByBooking',
  );
}

export async function createOperation(
  adminDb: SupabaseClient,
  input: { bookingId: string; sessionId: string; centreId: string },
): Promise<OperationRow> {
  return unwrap<OperationRow>(
    await adminDb
      .from('booking_operations')
      .insert({
        booking_id: input.bookingId,
        session_id: input.sessionId,
        centre_id: input.centreId,
      })
      .select(OPERATION_COLUMNS)
      .single(),
    'operations.create',
  );
}

/** Columns `transition_booking_operation` accepts alongside a state change. */
export type OperationPatch = Partial<{
  session_id: string;
  arrived_at: string;
  arrived_by: string;
  checked_in_at: string;
  queue_position: number;
  crop_verified: boolean;
  crop_issue: string | null;
  hold_reason: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}>;

/**
 * Guarded operational transition (Phase 6 §11, §12).
 *
 * One database call, one transaction: the state machine is checked by
 * trigger, the row moves only if it is still in `expectedFrom`, and the
 * history row — attributed to `actorId` — is written by trigger alongside it.
 * Returns null when the expected state no longer holds (a lost race).
 */
export async function transitionOperation(
  adminDb: SupabaseClient,
  operationId: string,
  expectedFrom: OperationState,
  to: OperationState,
  change: { actorId: string; reason?: string | null; patch?: OperationPatch },
): Promise<OperationRow | null> {
  const { data, error } = await adminDb.rpc('transition_booking_operation', {
    p_operation_id: operationId,
    p_expected_from: expectedFrom,
    p_to: to,
    p_actor: change.actorId,
    p_reason: change.reason ?? null,
    p_patch: change.patch ?? {},
  });

  if (error) {
    // The database refused the move itself — an illegal edge. That is a
    // conflict with the record's state, not bad input.
    if (error.code === '23514') {
      throw conflict('This step is not allowed from the booking’s current status.');
    }
    throw translatePostgrestError(error, { operation: 'operations.transition' });
  }

  const rows = (data ?? []) as OperationRow[];
  return rows.length > 0 ? (rows[0] as OperationRow) : null;
}

// --- Quality, weighing, procurement, payment --------------------------------

export async function insertQualityAssessment(
  adminDb: SupabaseClient,
  input: {
    operationId: string;
    bookingId: string;
    result: QualityResult;
    observedCrop: string | null;
    remarks: string | null;
    assessedBy: string;
  },
): Promise<{ id: string }> {
  return unwrap<{ id: string }>(
    await adminDb
      .from('quality_assessments')
      .insert({
        operation_id: input.operationId,
        booking_id: input.bookingId,
        result: input.result,
        observed_crop: input.observedCrop,
        remarks: input.remarks,
        assessed_by: input.assessedBy,
      })
      .select('id')
      .single(),
    'quality.insert',
  );
}

export async function latestQuality(
  db: SupabaseClient,
  operationIds: string[],
): Promise<Map<string, { id: string; result: QualityResult; remarks: string | null }>> {
  if (operationIds.length === 0) return new Map();

  const rows = unwrap<Array<{ id: string; operation_id: string; result: QualityResult; remarks: string | null }>>(
    await db
      .from('quality_assessments')
      .select('id, operation_id, result, remarks, assessed_at')
      .in('operation_id', operationIds)
      .order('assessed_at', { ascending: false }),
    'quality.latest',
  );

  const map = new Map<string, { id: string; result: QualityResult; remarks: string | null }>();
  for (const row of rows) {
    if (!map.has(row.operation_id)) {
      map.set(row.operation_id, { id: row.id, result: row.result, remarks: row.remarks });
    }
  }
  return map;
}

export async function insertWeighing(
  adminDb: SupabaseClient,
  input: {
    operationId: string;
    bookingId: string;
    actualQuantityKg: number;
    rejectedQuantityKg: number;
    rejectionReason: string | null;
    weighedBy: string;
  },
): Promise<{ id: string }> {
  return unwrap<{ id: string }>(
    await adminDb
      .from('weighing_records')
      .insert({
        operation_id: input.operationId,
        booking_id: input.bookingId,
        actual_quantity_kg: input.actualQuantityKg,
        rejected_quantity_kg: input.rejectedQuantityKg,
        rejection_reason: input.rejectionReason,
        weighed_by: input.weighedBy,
      })
      .select('id')
      .single(),
    'weighing.insert',
  );
}

/** Received and rejected kept as exact decimal strings — they become money. */
export interface WeighingSummary {
  id: string;
  receivedKg: string;
  rejectedKg: string;
}

export async function latestWeighing(
  db: SupabaseClient,
  operationIds: string[],
): Promise<Map<string, WeighingSummary>> {
  if (operationIds.length === 0) return new Map();

  const rows = unwrap<Array<{ id: string; operation_id: string; actual_quantity_kg: string | number; rejected_quantity_kg: string | number }>>(
    await db
      .from('weighing_records')
      .select('id, operation_id, actual_quantity_kg, rejected_quantity_kg, weighed_at')
      .in('operation_id', operationIds)
      .order('weighed_at', { ascending: false }),
    'weighing.latest',
  );

  const map = new Map<string, WeighingSummary>();
  for (const row of rows) {
    if (!map.has(row.operation_id)) {
      map.set(row.operation_id, {
        id: row.id,
        receivedKg: String(row.actual_quantity_kg),
        rejectedKg: String(row.rejected_quantity_kg ?? 0),
      });
    }
  }
  return map;
}

export interface ProcurementRow {
  id: string;
  procurement_reference: string;
  booking_id: string;
  crop: string;
  quantity_kg: string | number;
  accepted_quantity_kg: string | number | null;
  rate_per_kg: string | number;
  total_value: string | number;
  rate_source: string;
  confirmed_at: string;
}

const PROCUREMENT_COLUMNS =
  'id, procurement_reference, booking_id, crop, quantity_kg, accepted_quantity_kg, rate_per_kg, ' +
  'total_value, rate_source, confirmed_at';

/**
 * Procurements and their payments are created together by the
 * `confirm_procurement` database function, never row by row from here.
 */
export async function findProcurementByBooking(
  db: SupabaseClient,
  bookingIds: string[],
): Promise<Map<string, ProcurementRow>> {
  if (bookingIds.length === 0) return new Map();

  const rows = unwrap<ProcurementRow[]>(
    await db.from('procurements').select(PROCUREMENT_COLUMNS).in('booking_id', bookingIds),
    'procurement.byBooking',
  );

  return new Map(rows.map((row) => [row.booking_id, row]));
}

export interface PaymentRow {
  id: string;
  payment_reference: string;
  procurement_id: string;
  amount: string | number;
  status: string;
  provider: string;
  is_demo: boolean;
}

const PAYMENT_COLUMNS = 'id, payment_reference, procurement_id, amount, status, provider, is_demo';

export async function paymentsByProcurement(
  db: SupabaseClient,
  procurementIds: string[],
): Promise<Map<string, PaymentRow>> {
  if (procurementIds.length === 0) return new Map();

  const rows = unwrap<PaymentRow[]>(
    await db.from('payments').select(PAYMENT_COLUMNS).in('procurement_id', procurementIds),
    'payment.byProcurement',
  );

  return new Map(rows.map((row) => [row.procurement_id, row]));
}
