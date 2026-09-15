import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  formatScaled,
  isPaymentInFlight,
  parseDecimal,
  ratePerQuintal,
  zonedInstant,
} from '@kisansetu/shared';
import type {
  DemoScenario,
  FarmerBookingPayment,
  FarmerPaymentView,
  PaymentAttemptView,
  PaymentHistoryEntry,
  PaymentStatus,
  PaymentSummary,
  StaffPaymentRow,
  StaffPaymentView,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { insertAuditLog } from '../../repositories/auditRepository.js';
import { unwrap } from '../../repositories/postgrestError.js';
import * as repo from '../../repositories/paymentRepository.js';
import { activePaymentProvider } from './paymentProvider.js';
import type { ProviderOutcome } from './paymentProvider.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Payment settlement (Phase 8).
 *
 *   * The AMOUNT was fixed when the procurement was confirmed, from the
 *     accepted weighment and the server-resolved MSP rate. Nothing here
 *     computes, accepts or changes money.
 *   * The STATUS moves only through `transition_payment` — guarded, so two
 *     clicks, two staff members or a click and the background checker cannot
 *     both win — and every move is history.
 *   * A network failure talking to the provider is NOT a failed payment. The
 *     payment stays in flight until the provider says otherwise (§41).
 */

const money = (value: string | number): string => formatScaled(parseDecimal(String(value), 2), 2);
const qty = (value: string | number | null): string | null =>
  value === null ? null : formatScaled(parseDecimal(String(value), 3), 3);
const rate = (value: string | number): string => formatScaled(parseDecimal(String(value), 4), 4);

function centreOf(auth: AuthContext): string {
  const centreId = auth.scope.centreId;
  if (!centreId) throw forbidden('No procurement centre is assigned to this account.');
  return centreId;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function toHistory(rows: repo.HistoryRecord[]): PaymentHistoryEntry[] {
  return rows.map((row) => ({
    id: Number(row.id),
    fromStatus: row.from_status,
    toStatus: row.to_status,
    changedByRole: row.changed_by_role,
    createdAt: row.created_at,
  }));
}

async function bookingRefs(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap<Array<{ id: string; booking_reference: string }>>(
    await db.from('bookings').select('id, booking_reference').in('id', ids),
    'payments.bookingRefs',
  );
  return new Map(rows.map((row) => [row.id, row.booking_reference]));
}

function toFarmerView(
  payment: repo.PaymentRecord,
  procurement: repo.PaymentProcurement | undefined,
  bookingReference: string,
  history: PaymentHistoryEntry[],
): FarmerPaymentView {
  const perKg = rate(payment.rate_per_kg);
  return {
    id: payment.id,
    paymentReference: payment.payment_reference,
    procurementReference: procurement?.procurement_reference ?? '',
    bookingId: payment.booking_id,
    bookingReference,
    cropName: procurement?.crop ?? '',
    bookedQuantityKg: qty(procurement?.booked_quantity_kg ?? null),
    receivedQuantityKg: qty(procurement?.received_quantity_kg ?? null),
    acceptedQuantityKg: qty(payment.accepted_quantity_kg)!,
    rejectedQuantityKg: qty(procurement?.rejected_quantity_kg ?? null),
    ratePerKg: perKg,
    ratePerQuintal: ratePerQuintal(perKg),
    grossAmount: money(payment.gross_amount),
    deductionsAmount: money(payment.deductions_amount),
    netAmount: money(payment.net_amount),
    currency: 'INR',
    status: payment.status,
    isDemo: payment.is_demo,
    initiatedAt: payment.initiated_at,
    completedAt: payment.completed_at,
    updatedAt: payment.updated_at,
    history,
  };
}

function toAttemptView(row: repo.AttemptRecord): PaymentAttemptView {
  return {
    attemptNumber: row.attempt_number,
    attemptReference: row.attempt_reference,
    providerName: row.provider_name,
    isDemo: row.is_demo,
    demoScenario: row.demo_scenario,
    providerReference: row.provider_reference,
    status: row.status,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
  };
}

async function staffView(db: SupabaseClient, payment: repo.PaymentRecord): Promise<StaffPaymentView> {
  const [procurements, refs, history, attempts, farmer] = await Promise.all([
    repo.findProcurementsByIds(db, [payment.procurement_id]),
    bookingRefs(db, [payment.booking_id]),
    repo.listHistory(db, payment.id),
    repo.listAttempts(db, payment.id),
    db.from('profiles').select('full_name').eq('id', payment.farmer_user_id).maybeSingle(),
  ]);
  const procurement = procurements.get(payment.procurement_id);

  let mspSourceReference: string | null = null;
  if (procurement?.msp_rate_id) {
    const { data } = await db.from('msp_rates').select('source_reference').eq('id', procurement.msp_rate_id).maybeSingle();
    mspSourceReference = (data as { source_reference: string | null } | null)?.source_reference ?? null;
  }

  return {
    ...toFarmerView(payment, procurement, refs.get(payment.booking_id) ?? '', toHistory(history)),
    procurementId: payment.procurement_id,
    farmerName: (farmer.data as { full_name: string | null } | null)?.full_name ?? null,
    providerName: payment.provider,
    providerReference: payment.provider_reference,
    paymentMethod: payment.payment_method,
    failureCode: payment.failure_code,
    failureReason: payment.failure_reason,
    retryCount: payment.retry_count,
    rateSource: procurement?.rate_source ?? 'CONFIGURED',
    mspSourceReference,
    attempts: attempts.map(toAttemptView),
    canInitiate: payment.status === 'PENDING',
    canRetry: payment.status === 'FAILED',
    canRefresh: isPaymentInFlight(payment.status),
  };
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

async function loadForStaff(auth: AuthContext, by: { paymentId?: string; procurementId?: string }): Promise<repo.PaymentRecord> {
  const centreId = centreOf(auth);
  const payment = by.paymentId
    ? await repo.findPayment(auth.db, by.paymentId)
    : await repo.findPaymentBy(auth.db, 'procurement_id', by.procurementId!);

  // RLS already hides other centres' payments; this is the explicit second check.
  if (!payment || payment.centre_id !== centreId) {
    throw notFound('This payment is not available at your centre.');
  }
  return payment;
}

export type InitiationOutcome = 'STARTED' | 'REPLAYED' | 'ALREADY_PAID';

function assertKey(key: string | undefined): string {
  if (!key || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw validationError('Send an Idempotency-Key header (8–128 characters) with payment requests.');
  }
  return key;
}

/**
 * POST …/procurements/:procurementId/payment (§15, §16, §18).
 *
 * Idempotent by key: the same key returns what the first request did, however
 * many times it is retried. A procurement already paid returns its successful
 * payment and never starts another transfer.
 */
export async function initiatePayment(
  auth: AuthContext,
  procurementId: string,
  idempotencyKey: string | undefined,
  demoScenario: DemoScenario | undefined,
): Promise<{ payment: StaffPaymentView; outcome: InitiationOutcome }> {
  const key = assertKey(idempotencyKey);
  const payment = await loadForStaff(auth, { procurementId });

  const replay = await repo.findAttemptByKey(supabaseAdminClient, payment.id, key);
  if (replay) return { payment: await staffView(auth.db, payment), outcome: 'REPLAYED' };

  if (payment.status === 'SUCCESS') return { payment: await staffView(auth.db, payment), outcome: 'ALREADY_PAID' };
  if (payment.status === 'FAILED') throw conflict('This payment failed. Use Retry payment.');
  if (isPaymentInFlight(payment.status)) throw conflict('This payment is already being processed.');

  const outcome = await startAttempt(auth, payment, key, demoScenario);
  return { payment: await staffView(auth.db, (await repo.findPayment(auth.db, payment.id))!), outcome };
}

/** POST …/payments/:paymentId/retry (§17) — the same payment, a new attempt. */
export async function retryPayment(
  auth: AuthContext,
  paymentId: string,
  idempotencyKey: string | undefined,
  demoScenario: DemoScenario | undefined,
): Promise<{ payment: StaffPaymentView; outcome: InitiationOutcome }> {
  const key = assertKey(idempotencyKey);
  let payment = await loadForStaff(auth, { paymentId });

  const replay = await repo.findAttemptByKey(supabaseAdminClient, payment.id, key);
  if (replay) return { payment: await staffView(auth.db, payment), outcome: 'REPLAYED' };

  if (payment.status === 'SUCCESS') return { payment: await staffView(auth.db, payment), outcome: 'ALREADY_PAID' };

  if (payment.status === 'FAILED') {
    const moved = await repo.transitionPayment(supabaseAdminClient, payment.id, 'FAILED', 'RETRY_PENDING', {
      actorId: auth.userId,
      reason: 'Retry requested by centre staff',
    });
    if (!moved) throw conflict('Another staff member has already retried this payment.');
    payment = moved;
  } else if (payment.status !== 'RETRY_PENDING') {
    throw conflict('Only a failed payment can be retried.');
  }

  const outcome = await startAttempt(auth, payment, key, demoScenario);
  return { payment: await staffView(auth.db, (await repo.findPayment(auth.db, payment.id))!), outcome };
}

async function startAttempt(
  auth: AuthContext,
  payment: repo.PaymentRecord,
  key: string,
  demoScenario: DemoScenario | undefined,
): Promise<'STARTED' | 'REPLAYED'> {
  const provider = activePaymentProvider();
  const attemptNumber = (await repo.listAttempts(supabaseAdminClient, payment.id)).length + 1;
  const attemptReference = `${payment.payment_reference}-A${attemptNumber}`;
  const from = payment.status as 'PENDING' | 'RETRY_PENDING';

  // The guarded move comes FIRST: of two simultaneous clicks, exactly one
  // gets past here, and only that one ever talks to the provider (§16).
  const moved = await repo.transitionPayment(supabaseAdminClient, payment.id, from, 'INITIATED', {
    actorId: auth.userId,
    patch: { provider: provider.name, initiated_by: auth.userId },
    metadata: { attemptNumber, attemptReference },
  });

  if (!moved) {
    // The same request arriving twice at once: the first one is the answer.
    const again = await repo.findAttemptByKey(supabaseAdminClient, payment.id, key);
    if (again) return 'REPLAYED';
    throw conflict('This payment is already being processed.');
  }

  const attempt = await repo.insertAttempt(supabaseAdminClient, {
    payment_id: payment.id,
    centre_id: payment.centre_id,
    attempt_number: attemptNumber,
    attempt_reference: attemptReference,
    idempotency_key: key,
    provider_name: provider.name,
    is_demo: provider.isDemo,
    demo_scenario: provider.isDemo ? (demoScenario ?? 'SUCCESS') : null,
    requested_by: auth.userId,
  });
  if (attempt === 'DUPLICATE') return 'REPLAYED';

  await insertAuditLog({
    actorUserId: auth.userId,
    action: attemptNumber > 1 ? 'PAYMENT_RETRY' : 'PAYMENT_INITIATED',
    entityType: 'payments',
    entityId: payment.id,
    centreId: payment.centre_id,
    metadata: { paymentReference: payment.payment_reference, attemptReference, provider: provider.name, demo: provider.isDemo },
  });

  const input = {
    paymentReference: payment.payment_reference,
    attemptReference,
    procurementReference: payment.procurement_id,
    amountPaise: parseDecimal(String(payment.net_amount), 2),
    currency: 'INR' as const,
    farmerUserId: payment.farmer_user_id,
    method: payment.payment_method,
    ...(provider.isDemo ? { demoScenario: demoScenario ?? 'SUCCESS' } : {}),
  };

  let outcome: ProviderOutcome;
  try {
    outcome = attemptNumber > 1 ? await provider.retryPayment(input) : await provider.initiatePayment(input);
  } catch (cause) {
    // Unknown is not failed. The payment stays INITIATED and the status
    // checker asks the provider until it has an answer (§41).
    logger.warn('payment provider did not answer; outcome unknown', {
      paymentId: payment.id,
      attemptReference,
      reason: (cause as Error).message,
    });
    return 'STARTED';
  }

  await applyOutcome(payment.id, attempt, outcome, auth.userId);
  return 'STARTED';
}

/**
 * Records what the provider said. Idempotent: the same outcome twice changes
 * nothing, and an outcome for a payment that has moved on is kept on the
 * attempt without touching the payment.
 */
async function applyOutcome(
  paymentId: string,
  attempt: repo.AttemptRecord,
  outcome: ProviderOutcome,
  actorId: string | null,
): Promise<void> {
  const current = await repo.findPayment(supabaseAdminClient, paymentId);
  const finished = outcome.status === 'SUCCESS' || outcome.status === 'FAILED';

  // Only the attempt the payment is currently on may move it. An outcome for
  // an older attempt is history, not news.
  const attempts = await repo.listAttempts(supabaseAdminClient, paymentId);
  const isLatest = attempts[attempts.length - 1]?.id === attempt.id;

  if (current && isLatest && isPaymentInFlight(current.status) && current.status !== outcome.status) {
    const moved = await repo.transitionPayment(supabaseAdminClient, paymentId, current.status, outcome.status, {
      actorId,
      reason: outcome.status === 'FAILED' ? 'Provider reported a failure' : null,
      patch: {
        provider_reference: outcome.providerReference,
        provider_transaction_id: outcome.providerTransactionId,
        ...(outcome.status === 'FAILED'
          ? { failure_code: outcome.failureCode ?? 'PROVIDER_FAILURE', failure_reason: outcome.failureReason ?? 'Payment could not be completed' }
          : {}),
      },
      metadata: { attemptReference: attempt.attempt_reference, providerStatus: outcome.status },
    });

    if (!moved) {
      // Lost a race with another writer (a click, a webhook, the checker). The
      // attempt is left exactly as it was; the next check re-reads the truth
      // instead of this stale answer overwriting it.
      return;
    }

    {
      await insertAuditLog({
        actorUserId: actorId,
        action:
          outcome.status === 'SUCCESS' ? 'PAYMENT_SUCCEEDED'
            : outcome.status === 'FAILED' ? 'PAYMENT_FAILED'
              : 'PAYMENT_PROCESSING',
        entityType: 'payments',
        entityId: paymentId,
        centreId: current.centre_id,
        metadata: {
          paymentReference: current.payment_reference,
          attemptReference: attempt.attempt_reference,
          failureCode: outcome.failureCode,
        },
      });
    }
  }

  await repo.updateAttempt(supabaseAdminClient, attempt.id, {
    status: outcome.status,
    provider_reference: outcome.providerReference,
    provider_transaction_id: outcome.providerTransactionId,
    failure_code: outcome.failureCode,
    failure_reason: outcome.failureReason,
    completed_at: finished ? new Date().toISOString() : null,
  });
}

/** Asks the provider about an in-flight payment. Staff "Check status", the poller and webhooks use it. */
export async function refreshPayment(paymentId: string, actorId: string | null): Promise<void> {
  const attempts = await repo.listAttempts(supabaseAdminClient, paymentId);
  const open = [...attempts].reverse().find((attempt) => attempt.status === 'INITIATED' || attempt.status === 'PROCESSING');
  if (!open) return;

  const provider = activePaymentProvider();
  // A provider can only vouch for its own transfers.
  if (open.provider_name !== provider.name) return;

  let outcome: ProviderOutcome;
  try {
    outcome = await provider.getPaymentStatus(open.provider_reference ?? open.attempt_reference);
  } catch (cause) {
    logger.warn('payment status check failed; will try again', { paymentId, reason: (cause as Error).message });
    return;
  }

  await applyOutcome(paymentId, open, outcome, actorId);
}

export async function refreshForStaff(auth: AuthContext, paymentId: string): Promise<StaffPaymentView> {
  const payment = await loadForStaff(auth, { paymentId });
  if (isPaymentInFlight(payment.status)) await refreshPayment(payment.id, auth.userId);
  return staffView(auth.db, (await repo.findPayment(auth.db, payment.id))!);
}

// ---------------------------------------------------------------------------
// Staff reads
// ---------------------------------------------------------------------------

export async function getStaffPayment(
  auth: AuthContext,
  by: { paymentId?: string; procurementId?: string },
): Promise<StaffPaymentView> {
  return staffView(auth.db, await loadForStaff(auth, by));
}

export async function getStaffPaymentHistory(auth: AuthContext, paymentId: string): Promise<PaymentHistoryEntry[]> {
  const payment = await loadForStaff(auth, { paymentId });
  return toHistory(await repo.listHistory(auth.db, payment.id));
}

export async function listStaffPayments(auth: AuthContext, date: string): Promise<StaffPaymentRow[]> {
  const centreId = centreOf(auth);
  const from = zonedInstant(date, '00:00', env.APP_TIMEZONE).toISOString();
  const to = zonedInstant(addDays(date, 1), '00:00', env.APP_TIMEZONE).toISOString();

  // Today's payments, plus anything still unresolved from earlier days — an
  // unpaid farmer does not drop off the list at midnight.
  const [todays, open] = await Promise.all([
    repo.listPayments(auth.db, { centreId, fromIso: from, toIso: to }),
    repo.listPayments(auth.db, { centreId, statuses: ['PENDING', 'INITIATED', 'PROCESSING', 'FAILED', 'RETRY_PENDING'] }),
  ]);
  const all = [...new Map([...todays, ...open].map((p) => [p.id, p])).values()];

  const [procurements, names] = await Promise.all([
    repo.findProcurementsByIds(auth.db, all.map((p) => p.procurement_id)),
    all.length
      ? unwrap<Array<{ id: string; full_name: string | null }>>(
          await auth.db.from('profiles').select('id, full_name').in('id', [...new Set(all.map((p) => p.farmer_user_id))]),
          'payments.farmerNames',
        )
      : Promise.resolve([]),
  ]);
  const nameById = new Map(names.map((row) => [row.id, row.full_name]));

  return all
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => ({
      paymentId: p.id,
      paymentReference: p.payment_reference,
      procurementId: p.procurement_id,
      procurementReference: procurements.get(p.procurement_id)?.procurement_reference ?? '',
      bookingId: p.booking_id,
      farmerName: nameById.get(p.farmer_user_id) ?? null,
      cropName: procurements.get(p.procurement_id)?.crop ?? '',
      acceptedQuantityKg: qty(p.accepted_quantity_kg)!,
      netAmount: money(p.net_amount),
      status: p.status,
      isDemo: p.is_demo,
      createdAt: p.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Farmer reads — own payments only (§31)
// ---------------------------------------------------------------------------

async function farmerViews(auth: AuthContext, payments: repo.PaymentRecord[], withHistory: boolean): Promise<FarmerPaymentView[]> {
  const own = payments.filter((p) => p.farmer_user_id === auth.userId);
  const [procurements, refs] = await Promise.all([
    repo.findProcurementsByIds(auth.db, own.map((p) => p.procurement_id)),
    bookingRefs(auth.db, own.map((p) => p.booking_id)),
  ]);

  return Promise.all(
    own.map(async (p) =>
      toFarmerView(
        p,
        procurements.get(p.procurement_id),
        refs.get(p.booking_id) ?? '',
        withHistory ? toHistory(await repo.listHistory(auth.db, p.id)) : [],
      ),
    ),
  );
}

export async function listFarmerPayments(auth: AuthContext): Promise<FarmerPaymentView[]> {
  return farmerViews(auth, await repo.listPayments(auth.db, { farmerUserId: auth.userId }), false);
}

async function ownPayment(auth: AuthContext, payment: repo.PaymentRecord | null): Promise<FarmerPaymentView> {
  // RLS hides other farmers' payments; the owner check makes it explicit.
  if (!payment || payment.farmer_user_id !== auth.userId) throw notFound('That payment is not available.');
  const [view] = await farmerViews(auth, [payment], true);
  return view!;
}

export async function getFarmerPayment(auth: AuthContext, paymentId: string): Promise<FarmerPaymentView> {
  return ownPayment(auth, await repo.findPayment(auth.db, paymentId));
}

export async function getFarmerProcurementPayment(auth: AuthContext, procurementId: string): Promise<FarmerPaymentView> {
  return ownPayment(auth, await repo.findPaymentBy(auth.db, 'procurement_id', procurementId));
}

export async function getFarmerPaymentHistory(auth: AuthContext, paymentId: string): Promise<PaymentHistoryEntry[]> {
  return (await getFarmerPayment(auth, paymentId)).history;
}

/** The farmer's booking → its payment, or NOT_ELIGIBLE before procurement exists. */
export async function getFarmerBookingPayment(auth: AuthContext, bookingId: string): Promise<FarmerBookingPayment> {
  const { data: booking } = await auth.db.from('bookings').select('id, farmer_user_id').eq('id', bookingId).maybeSingle();
  if (!booking || (booking as { farmer_user_id: string }).farmer_user_id !== auth.userId) {
    throw notFound('That booking is not available.');
  }

  const payment = await repo.findPaymentBy(auth.db, 'booking_id', bookingId);
  if (!payment) return { state: 'NOT_ELIGIBLE', payment: null };
  const view = await ownPayment(auth, payment);
  return { state: view.status, payment: view };
}

// ---------------------------------------------------------------------------
// Administration summaries (§43, §44) — scope from the admin's own profile
// ---------------------------------------------------------------------------

export async function paymentSummary(auth: AuthContext, scope: 'DISTRICT' | 'STATE'): Promise<PaymentSummary> {
  const db = supabaseAdminClient;

  let centreQuery = db.from('procurement_centres').select('id, name, district_id');
  if (scope === 'DISTRICT') {
    if (!auth.scope.districtId) throw forbidden('No district is assigned to this account.');
    centreQuery = centreQuery.eq('district_id', auth.scope.districtId);
  } else {
    if (!auth.scope.stateId) throw forbidden('No state is assigned to this account.');
    const districts = unwrap<Array<{ id: string }>>(
      await db.from('districts').select('id').eq('state_id', auth.scope.stateId),
      'summary.districts',
    );
    centreQuery = centreQuery.in('district_id', districts.map((d) => d.id));
  }
  const centres = unwrap<Array<{ id: string; name: string }>>(await centreQuery, 'summary.centres');
  const centreIds = centres.map((c) => c.id);

  const payments = centreIds.length
    ? unwrap<repo.PaymentRecord[]>(
        await db.from('payments').select(repo.PAYMENT_RECORD_COLUMNS).in('centre_id', centreIds),
        'summary.payments',
      )
    : [];
  const failures = payments.length
    ? unwrap<Array<{ failure_code: string | null }>>(
        await db.from('payment_attempts').select('failure_code').in('payment_id', payments.map((p) => p.id)).eq('status', 'FAILED'),
        'summary.failures',
      )
    : [];
  const procurements = centreIds.length
    ? unwrap<Array<{ crop: string; total_value: string | number }>>(
        await db.from('procurements').select('crop, total_value').in('centre_id', centreIds),
        'summary.procurements',
      )
    : [];

  const statuses: PaymentStatus[] = ['PENDING', 'INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRY_PENDING'];
  const byStatus = Object.fromEntries(statuses.map((s) => [s, 0])) as Record<PaymentStatus, number>;
  let paid = 0n;
  let pending = 0n;
  for (const p of payments) {
    byStatus[p.status] += 1;
    const paise = parseDecimal(String(p.net_amount), 2);
    if (p.status === 'SUCCESS') paid += paise;
    else pending += paise;
  }

  const durations = payments
    .filter((p) => p.status === 'SUCCESS' && p.initiated_at && p.completed_at)
    .map((p) => (new Date(p.completed_at!).getTime() - new Date(p.initiated_at!).getTime()) / 1000)
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations.length % 2
      ? durations[(durations.length - 1) / 2]!
      : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2
    : null;

  const failureCounts = new Map<string, number>();
  for (const f of failures) failureCounts.set(f.failure_code ?? 'UNKNOWN', (failureCounts.get(f.failure_code ?? 'UNKNOWN') ?? 0) + 1);

  const stuckBefore = Date.now() - 30 * 60_000;
  const exceptions = centres
    .map((c) => ({
      centreId: c.id,
      centreName: c.name,
      failed: payments.filter((p) => p.centre_id === c.id && (p.status === 'FAILED' || p.status === 'RETRY_PENDING')).length,
      stuck: payments.filter(
        (p) => p.centre_id === c.id && isPaymentInFlight(p.status) && p.initiated_at && new Date(p.initiated_at).getTime() < stuckBefore,
      ).length,
    }))
    .filter((c) => c.failed > 0 || c.stuck > 0);

  const cropValue = new Map<string, bigint>();
  let totalValue = 0n;
  for (const pr of procurements) {
    const paise = parseDecimal(String(pr.total_value), 2);
    totalValue += paise;
    cropValue.set(pr.crop, (cropValue.get(pr.crop) ?? 0n) + paise);
  }

  const settled = byStatus.SUCCESS + byStatus.FAILED;

  return {
    scope,
    centreCount: centres.length,
    paymentCount: payments.length,
    byStatus,
    totalProcurementValue: formatScaled(totalValue, 2),
    totalPaid: formatScaled(paid, 2),
    totalPending: formatScaled(pending, 2),
    successRate: settled > 0 ? Math.round((byStatus.SUCCESS / settled) * 1000) / 1000 : null,
    averageProcessingSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    medianProcessingSeconds: median === null ? null : Math.round(median),
    totalRetries: payments.reduce((sum, p) => sum + p.retry_count, 0),
    failuresByReason: [...failureCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    centreExceptions: exceptions,
    valueByCrop: [...cropValue.entries()].map(([crop, value]) => ({ crop, value: formatScaled(value, 2) })),
    demoPayments: payments.filter((p) => p.is_demo).length,
  };
}

// ---------------------------------------------------------------------------
// Asynchronous confirmation (§37)
// ---------------------------------------------------------------------------

/**
 * A provider webhook. Refused unless the ACTIVE provider supports webhooks,
 * the name matches, and the provider verifies the signature. There is no
 * generic "mark this payment successful" door (§42).
 */
export async function handleWebhook(
  providerName: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
): Promise<'APPLIED' | 'IGNORED'> {
  const provider = activePaymentProvider();
  if (provider.name.toLowerCase() !== providerName.toLowerCase() || !provider.verifyWebhook) {
    throw notFound('This payment provider does not accept webhooks.');
  }

  const event = await provider.verifyWebhook(headers, rawBody);
  if (!event) throw forbidden('The webhook signature could not be verified.');

  const { data } = await supabaseAdminClient
    .from('payment_attempts')
    .select('id')
    .eq('provider_reference', event.providerReference)
    .maybeSingle();
  if (!data) return 'IGNORED';

  const attempts = unwrap<repo.AttemptRecord[]>(
    await supabaseAdminClient.from('payment_attempts').select('*').eq('id', (data as { id: string }).id),
    'webhook.attempt',
  );
  const attempt = attempts[0];
  if (!attempt) return 'IGNORED';

  await applyOutcome(attempt.payment_id, attempt, event.outcome, null);
  return 'APPLIED';
}

// ---------------------------------------------------------------------------
// Background status checks
// ---------------------------------------------------------------------------

/** How long an initiation call may take before the checker asks about it anyway. */
const INITIATION_GRACE_SECONDS = 30;

export function startPaymentPoller(): () => void {
  const seconds = env.PAYMENT_STATUS_POLL_SECONDS;
  if (seconds <= 0) return () => undefined;

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const open = await repo.openAttempts(supabaseAdminClient, 50, INITIATION_GRACE_SECONDS);
        for (const paymentId of new Set(open.map((attempt) => attempt.payment_id))) {
          await refreshPayment(paymentId, null);
        }
      } catch (cause) {
        logger.error('payment status poll failed', { reason: (cause as Error).message });
      } finally {
        running = false;
      }
    })();
  }, seconds * 1000);

  timer.unref();
  return () => clearInterval(timer);
}
