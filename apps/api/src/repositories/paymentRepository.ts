import type { SupabaseClient } from '@supabase/supabase-js';
import type { DemoScenario, PaymentStatus } from '@kisansetu/shared';
import { conflict } from '../lib/errors.js';
import { translatePostgrestError, unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Payment data access (Phase 8).
 *
 * Reads run under the caller's RLS-bound client wherever there is a caller.
 * Status changes go ONLY through `transition_payment`, which enforces the
 * state machine and writes history in the same transaction. Amounts are never
 * written from here at all — the database refuses to change them.
 */

export interface PaymentRecord {
  id: string;
  payment_reference: string;
  procurement_id: string;
  booking_id: string;
  farmer_user_id: string;
  centre_id: string;
  accepted_quantity_kg: string | number;
  rate_per_kg: string | number;
  gross_amount: string | number;
  deductions_amount: string | number;
  net_amount: string | number;
  currency: 'INR';
  payment_method: string;
  status: PaymentStatus;
  provider: string;
  provider_reference: string | null;
  provider_transaction_id: string | null;
  is_demo: boolean;
  initiated_at: string | null;
  processed_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  retry_count: number;
  last_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export const PAYMENT_RECORD_COLUMNS =
  'id, payment_reference, procurement_id, booking_id, farmer_user_id, centre_id, ' +
  'accepted_quantity_kg, rate_per_kg, gross_amount, deductions_amount, net_amount, currency, ' +
  'payment_method, status, provider, provider_reference, provider_transaction_id, is_demo, ' +
  'initiated_at, processed_at, completed_at, failed_at, failure_code, failure_reason, ' +
  'retry_count, last_retry_at, created_at, updated_at';

export async function findPayment(db: SupabaseClient, paymentId: string): Promise<PaymentRecord | null> {
  return unwrapMaybe<PaymentRecord>(
    await db.from('payments').select(PAYMENT_RECORD_COLUMNS).eq('id', paymentId).maybeSingle(),
    'payments.find',
  );
}

export async function findPaymentBy(
  db: SupabaseClient,
  column: 'procurement_id' | 'booking_id',
  value: string,
): Promise<PaymentRecord | null> {
  return unwrapMaybe<PaymentRecord>(
    await db.from('payments').select(PAYMENT_RECORD_COLUMNS).eq(column, value).maybeSingle(),
    'payments.findBy',
  );
}

export async function listPayments(
  db: SupabaseClient,
  filter: { farmerUserId?: string; centreId?: string; fromIso?: string; toIso?: string; statuses?: PaymentStatus[] },
): Promise<PaymentRecord[]> {
  let query = db.from('payments').select(PAYMENT_RECORD_COLUMNS).order('created_at', { ascending: false });
  if (filter.farmerUserId) query = query.eq('farmer_user_id', filter.farmerUserId);
  if (filter.centreId) query = query.eq('centre_id', filter.centreId);
  if (filter.fromIso) query = query.gte('created_at', filter.fromIso);
  if (filter.toIso) query = query.lt('created_at', filter.toIso);
  if (filter.statuses) query = query.in('status', filter.statuses);
  return unwrap<PaymentRecord[]>(await query, 'payments.list');
}

/**
 * The guarded transition. Returns null when the payment is no longer in
 * `expectedFrom` — someone else moved it first — so the caller re-reads
 * rather than overwriting (§17).
 */
export async function transitionPayment(
  adminDb: SupabaseClient,
  paymentId: string,
  expectedFrom: PaymentStatus,
  to: PaymentStatus,
  change: {
    actorId: string | null;
    reason?: string | null;
    patch?: Record<string, string | null>;
    metadata?: Record<string, unknown>;
  },
): Promise<PaymentRecord | null> {
  const { data, error } = await adminDb.rpc('transition_payment', {
    p_payment_id: paymentId,
    p_expected_from: expectedFrom,
    p_to: to,
    p_actor: change.actorId,
    p_reason: change.reason ?? null,
    p_patch: change.patch ?? {},
    p_metadata: change.metadata ?? null,
  });

  if (error) {
    if (error.code === '23514') throw conflict('That payment step is not allowed from its current status.');
    throw translatePostgrestError(error, { operation: 'payments.transition' });
  }

  const rows = (data ?? []) as PaymentRecord[];
  return rows[0] ?? null;
}

// --- Attempts ---------------------------------------------------------------

export interface AttemptRecord {
  id: string;
  payment_id: string;
  centre_id: string;
  attempt_number: number;
  attempt_reference: string;
  idempotency_key: string;
  provider_name: string;
  is_demo: boolean;
  demo_scenario: DemoScenario | null;
  provider_reference: string | null;
  provider_transaction_id: string | null;
  status: string;
  failure_code: string | null;
  failure_reason: string | null;
  requested_at: string;
  completed_at: string | null;
}

const ATTEMPT_COLUMNS =
  'id, payment_id, centre_id, attempt_number, attempt_reference, idempotency_key, provider_name, ' +
  'is_demo, demo_scenario, provider_reference, provider_transaction_id, status, failure_code, ' +
  'failure_reason, requested_at, completed_at';

export async function listAttempts(db: SupabaseClient, paymentId: string): Promise<AttemptRecord[]> {
  return unwrap<AttemptRecord[]>(
    await db
      .from('payment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('payment_id', paymentId)
      .order('attempt_number', { ascending: true }),
    'payments.attempts',
  );
}

export async function findAttemptByKey(
  adminDb: SupabaseClient,
  paymentId: string,
  idempotencyKey: string,
): Promise<AttemptRecord | null> {
  return unwrapMaybe<AttemptRecord>(
    await adminDb
      .from('payment_attempts')
      .select(ATTEMPT_COLUMNS)
      .eq('payment_id', paymentId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle(),
    'payments.attemptByKey',
  );
}

export async function insertAttempt(
  adminDb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<AttemptRecord | 'DUPLICATE'> {
  const { data, error } = await adminDb.from('payment_attempts').insert(row).select(ATTEMPT_COLUMNS).single();
  if (error) {
    if (error.code === '23505') return 'DUPLICATE';
    throw translatePostgrestError(error, { operation: 'payments.insertAttempt' });
  }
  return data as unknown as AttemptRecord;
}

export async function updateAttempt(
  adminDb: SupabaseClient,
  attemptId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminDb
    .from('payment_attempts')
    .update(patch)
    .eq('id', attemptId)
    .in('status', ['INITIATED', 'PROCESSING']);
  if (error) throw translatePostgrestError(error, { operation: 'payments.updateAttempt' });
}

/**
 * Attempts the background checker may ask the provider about.
 *
 * An attempt with no provider reference yet may still be mid-way through its
 * initiation call. Asking the provider about it then would race that call, so
 * such attempts are only picked up once they are old enough that the call
 * must have ended without an answer.
 */
export async function openAttempts(
  adminDb: SupabaseClient,
  limit: number,
  initiationGraceSeconds: number,
): Promise<AttemptRecord[]> {
  const cutoff = new Date(Date.now() - initiationGraceSeconds * 1000).toISOString();
  return unwrap<AttemptRecord[]>(
    await adminDb
      .from('payment_attempts')
      .select(ATTEMPT_COLUMNS)
      .in('status', ['INITIATED', 'PROCESSING'])
      .or(`provider_reference.not.is.null,requested_at.lt.${cutoff}`)
      .order('requested_at', { ascending: true })
      .limit(limit),
    'payments.openAttempts',
  );
}

// --- History ----------------------------------------------------------------

export interface HistoryRecord {
  id: number;
  from_status: PaymentStatus | null;
  to_status: PaymentStatus;
  changed_by_role: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function listHistory(db: SupabaseClient, paymentId: string): Promise<HistoryRecord[]> {
  return unwrap<HistoryRecord[]>(
    await db
      .from('payment_status_history')
      .select('id, from_status, to_status, changed_by_role, reason, metadata, created_at')
      .eq('payment_id', paymentId)
      .order('id', { ascending: true }),
    'payments.history',
  );
}

// --- The procurement a payment belongs to -------------------------------------

export interface PaymentProcurement {
  id: string;
  procurement_reference: string;
  booking_id: string;
  centre_id: string;
  crop: string;
  booked_quantity_kg: string | number | null;
  received_quantity_kg: string | number | null;
  accepted_quantity_kg: string | number | null;
  rejected_quantity_kg: string | number | null;
  rate_source: string;
  msp_rate_id: string | null;
}

export async function findProcurementsByIds(
  db: SupabaseClient,
  ids: string[],
): Promise<Map<string, PaymentProcurement>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap<PaymentProcurement[]>(
    await db
      .from('procurements')
      .select('id, procurement_reference, booking_id, centre_id, crop, booked_quantity_kg, received_quantity_kg, accepted_quantity_kg, rejected_quantity_kg, rate_source, msp_rate_id')
      .in('id', ids),
    'payments.procurements',
  );
  return new Map(rows.map((row) => [row.id, row]));
}
