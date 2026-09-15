import {
  acceptedQuantity,
  businessToday,
  canTransitionOperation,
  canTransitionSession,
  computePaymentAmounts,
  MIN_REMARKS_LENGTH,
  qualityRequiresRemarks,
  sessionIsActive,
} from '@kisansetu/shared';
import type {
  OperationState,
  OperationalBooking,
  ProcurementSession,
  QualityResult,
  SessionStatus,
  SessionWorkload,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import * as ops from '../../repositories/operationsRepository.js';
import { findProfileById } from '../../repositories/profilesRepository.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { activePaymentProvider } from '../payments/paymentProvider.js';
import { resolveMspRate } from '../msp/mspService.js';
import { enqueueBooking, recalculateQuietly } from '../queue/queueService.js';
import type { AuthContext } from '../../types/request.js';

/**
 * The procurement centre operational workflow (§16–§30).
 *
 * Two invariants hold throughout:
 *
 *   1. CENTRE SCOPE. Every operation resolves the centre from the staff
 *      profile on `auth.scope`, never from a request parameter (§42).
 *
 *   2. GUARDED TRANSITIONS. Every state change is conditional on the record
 *      still being in the state the caller saw. A losing race writes nothing
 *      and reports a conflict rather than overwriting another operator (§41).
 */

function centreOf(auth: AuthContext): string {
  const centreId = auth.scope.centreId;
  if (!centreId) throw forbidden('No procurement centre is assigned to this account.');
  return centreId;
}

/** Today, in the centre's business timezone —” not the server's (§46 of Phase 0). */
export function today(): string {
  return businessToday(env.APP_TIMEZONE);
}

// ---------------------------------------------------------------------------
// Sessions (§9, §10, §11)
// ---------------------------------------------------------------------------

export async function getOrCreateTodaySession(auth: AuthContext): Promise<ProcurementSession> {
  const centreId = centreOf(auth);
  const existing = await ops.findSession(auth.db, centreId, today());
  if (existing) return existing;

  // A SCHEDULED shell is not an open day; opening is a separate act.
  return ops.ensureSession(supabaseAdminClient, centreId, today());
}

export async function transitionTodaySession(
  auth: AuthContext,
  to: SessionStatus,
): Promise<ProcurementSession> {
  const session = await getOrCreateTodaySession(auth);

  if (!canTransitionSession(session.status, to)) {
    throw conflict(`A session cannot move from ${session.status} to ${to}.`);
  }

  const updated = await ops.transitionSession(
    supabaseAdminClient,
    session.id,
    session.status,
    to,
    auth.userId,
  );

  if (!updated) {
    throw conflict('This session has already been updated. Refresh and try again.');
  }

  return updated;
}

async function requireActiveSession(auth: AuthContext): Promise<ProcurementSession> {
  const session = await getOrCreateTodaySession(auth);

  if (!sessionIsActive(session.status)) {
    throw conflict("Open today's procurement session before processing farmers.");
  }

  return session;
}

// ---------------------------------------------------------------------------
// Operational view
// ---------------------------------------------------------------------------

/**
 * Bookings for a date range, joined to their operational state.
 *
 * Assembled in the service rather than one wide SQL join so each piece stays
 * individually RLS-checked and individually testable.
 */
export async function listOperationalBookings(
  auth: AuthContext,
  fromDate: string,
  toDate: string,
): Promise<OperationalBooking[]> {
  const centreId = centreOf(auth);

  const slots = await ops.listSlots(auth.db, centreId, fromDate, toDate);
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  const bookings = await ops.listBookingsForDates(
    auth.db,
    centreId,
    slots.map((slot) => slot.id),
  );
  if (bookings.length === 0) return [];

  const bookingIds = bookings.map((booking) => booking.id);
  const operations = await ops.listOperations(auth.db, bookingIds);
  const operationByBooking = new Map(operations.map((operation) => [operation.booking_id, operation]));

  const operationIds = operations.map((operation) => operation.id);
  const [quality, weighing, procurements] = await Promise.all([
    ops.latestQuality(auth.db, operationIds),
    ops.latestWeighing(auth.db, operationIds),
    ops.findProcurementByBooking(auth.db, bookingIds),
  ]);

  const payments = await ops.paymentsByProcurement(
    auth.db,
    [...procurements.values()].map((procurement) => procurement.id),
  );

  // Farmer names, resolved once.
  const farmerIds = [...new Set(bookings.map((booking) => booking.farmer_user_id))];
  const farmerInfo = new Map<string, { name: string | null; ref: string | null; village: string | null }>();

  await Promise.all(
    farmerIds.map(async (farmerId) => {
      const [profile, farmer] = await Promise.all([
        findProfileById(auth.db, farmerId),
        findFarmerProfile(auth.db, farmerId),
      ]);
      farmerInfo.set(farmerId, {
        name: profile?.fullName ?? null,
        ref: farmer?.farmerReferenceId ?? null,
        village: farmer?.village ?? null,
      });
    }),
  );

  const claimerIds = [
    ...new Set(operations.map((operation) => operation.claimed_by).filter((id): id is string => Boolean(id))),
  ];
  const claimerNames = new Map<string, string | null>();
  await Promise.all(
    claimerIds.map(async (id) => {
      const profile = await findProfileById(auth.db, id);
      claimerNames.set(id, profile?.fullName ?? null);
    }),
  );

  return bookings.map((booking): OperationalBooking => {
    const slot = slotById.get(booking.slot_id);
    const operation = operationByBooking.get(booking.id);
    const info = farmerInfo.get(booking.farmer_user_id);
    const procurement = procurements.get(booking.id);
    const payment = procurement ? payments.get(procurement.id) : undefined;
    const qualityEntry = operation ? quality.get(operation.id) : undefined;
    const weighed = operation ? weighing.get(operation.id) : undefined;

    return {
      bookingId: booking.id,
      bookingReference: booking.booking_reference,
      farmerUserId: booking.farmer_user_id,
      farmerName: info?.name ?? null,
      farmerReferenceId: info?.ref ?? null,
      village: info?.village ?? null,
      crop: booking.crop,
      expectedQuantityKg: Number(booking.expected_quantity_kg),
      slotDate: slot?.slotDate ?? '',
      slotStart: slot?.startTime ?? '',
      slotEnd: slot?.endTime ?? '',
      bookingStatus: booking.status,

      operationId: operation?.id ?? null,
      state: operation?.state ?? 'BOOKED',
      arrivedAt: operation?.arrived_at ?? null,
      checkedInAt: operation?.checked_in_at ?? null,
      claimedByName: operation?.claimed_by ? (claimerNames.get(operation.claimed_by) ?? null) : null,
      claimedByMe: operation?.claimed_by === auth.userId,
      cropVerified: operation?.crop_verified ?? null,
      cropIssue: operation?.crop_issue ?? null,
      queuePosition: operation?.queue_position ?? null,

      qualityResult: qualityEntry?.result ?? null,
      qualityRemarks: qualityEntry?.remarks ?? null,
      actualQuantityKg: weighed ? Number(weighed.receivedKg) : null,
      rejectedQuantityKg: weighed ? Number(weighed.rejectedKg) : null,
      acceptedQuantityKg: procurement?.accepted_quantity_kg != null
        ? Number(procurement.accepted_quantity_kg)
        : weighed
          ? Number(weighed.receivedKg) - Number(weighed.rejectedKg)
          : null,

      procurementId: procurement?.id ?? null,
      procurementReference: procurement?.procurement_reference ?? null,
      totalValue: procurement ? String(procurement.total_value) : null,
      paymentId: payment?.id ?? null,
      paymentReference: payment?.payment_reference ?? null,
      paymentStatus: (payment?.status as OperationalBooking['paymentStatus']) ?? null,
      paymentIsDemo: payment ? payment.is_demo : null,
    };
  });
}

/** Today's counts (§3 priority 2). Every figure is a count of real rows. */
export async function todayWorkload(auth: AuthContext): Promise<SessionWorkload> {
  const centreId = centreOf(auth);
  const date = today();

  const slots = await ops.listSlots(auth.db, centreId, date, date);
  const bookings = await listOperationalBookings(auth, date, date);

  const count = (predicate: (booking: OperationalBooking) => boolean): number =>
    bookings.filter(predicate).length;

  return {
    expected: bookings.filter((booking) => booking.bookingStatus === 'BOOKED').length,
    arrived: count((booking) =>
      ['ARRIVED', 'CHECKED_IN', 'WAITING', 'QUALITY_CHECK', 'WEIGHING', 'PROCUREMENT', 'PAYMENT_PENDING', 'COMPLETED'].includes(
        booking.state,
      ),
    ),
    waiting: count((booking) => booking.state === 'WAITING' || booking.state === 'CHECKED_IN'),
    processing: count((booking) =>
      ['QUALITY_CHECK', 'WEIGHING', 'PROCUREMENT'].includes(booking.state),
    ),
    completed: count((booking) => booking.state === 'COMPLETED'),
    paymentPending: count((booking) => booking.state === 'PAYMENT_PENDING'),
    slotCount: slots.length,
    capacityRemaining: slots.reduce((sum, slot) => sum + slot.remainingCapacity, 0),
  };
}

// ---------------------------------------------------------------------------
// The operational loop
// ---------------------------------------------------------------------------

/** Loads a booking and its operation, refusing anything outside this centre. */
async function loadForWork(
  auth: AuthContext,
  bookingId: string,
): Promise<{ booking: ops.BookingRow; operation: ops.OperationRow | null }> {
  const centreId = centreOf(auth);

  const booking = await ops.findBooking(auth.db, bookingId);
  // RLS already filters other centres out; this is the explicit second check.
  if (!booking || booking.centre_id !== centreId) {
    throw notFound('This booking is not available at your centre.');
  }

  return { booking, operation: await ops.findOperation(auth.db, bookingId) };
}

/** Validates a booking is fit to process at all (§18). */
function assertBookingProcessable(booking: ops.BookingRow): void {
  if (booking.status === 'CANCELLED') throw conflict('This booking was cancelled.');
  if (booking.status === 'COMPLETED') throw conflict('This booking has already been processed.');
  if (booking.status === 'NO_SHOW') throw conflict('This booking was marked as a no-show.');
}

export async function markArrived(
  auth: AuthContext,
  bookingId: string,
): Promise<OperationalBooking> {
  // Scope before state, always. "This booking is not at your centre" is a more
  // fundamental answer than "your session is not open", and checking the
  // session first would tell a staff member from another centre to open their
  // own session —” which would not have helped them.
  const { booking, operation } = await loadForWork(auth, bookingId);
  assertBookingProcessable(booking);

  const session = await requireActiveSession(auth);

  if (operation && operation.state !== 'BOOKED') {
    throw conflict('This farmer has already been marked as arrived.');
  }

  const record =
    operation ??
    (await ops.createOperation(supabaseAdminClient, {
      bookingId,
      sessionId: session.id,
      centreId: booking.centre_id,
    }));

  const moved = await ops.transitionOperation(supabaseAdminClient, record.id, 'BOOKED', 'ARRIVED', {
    actorId: auth.userId,
    patch: {
      arrived_at: new Date().toISOString(),
      arrived_by: auth.userId,
      session_id: session.id,
    },
  });

  if (!moved) throw conflict('This booking has already been updated. Refresh and try again.');

  return single(auth, bookingId);
}

/**
 * Check-in. Since Phase 7 this does NOT put the farmer in the queue: the
 * quality check comes first, and only a farmer who has passed it is queued —
 * the queue ranks known work, not unknown work.
 */
export async function checkIn(auth: AuthContext, bookingId: string): Promise<OperationalBooking> {
  const { operation } = await loadForWork(auth, bookingId);
  await requireActiveSession(auth);

  if (!operation) throw conflict('Mark this farmer as arrived first.');

  const checked = await ops.transitionOperation(
    supabaseAdminClient,
    operation.id,
    'ARRIVED',
    'CHECKED_IN',
    { actorId: auth.userId, patch: { checked_in_at: new Date().toISOString() } },
  );

  if (!checked) throw conflict('This booking has already been updated. Refresh and try again.');

  return single(auth, bookingId);
}

/**
 * Claims a farmer for processing (§41).
 *
 * Without this, two operators at two counters can both start on the same
 * farmer and the second silently overwrites the first.
 */
export async function claimBooking(
  auth: AuthContext,
  bookingId: string,
): Promise<OperationalBooking> {
  const { operation } = await loadForWork(auth, bookingId);
  await requireActiveSession(auth);

  if (!operation) throw conflict('This farmer has not arrived yet.');

  if (operation.claimed_by && operation.claimed_by !== auth.userId) {
    throw conflict('This booking is currently being handled by another staff member.');
  }

  const { error } = await supabaseAdminClient
    .from('booking_operations')
    .update({ claimed_by: auth.userId, claimed_at: new Date().toISOString() })
    .eq('id', operation.id)
    .is('claimed_by', null);

  if (error) throw conflict('Could not claim this booking. Refresh and try again.');

  return single(auth, bookingId);
}

async function assertClaimed(auth: AuthContext, operation: ops.OperationRow): Promise<void> {
  if (operation.claimed_by && operation.claimed_by !== auth.userId) {
    throw conflict('This booking is currently being handled by another staff member.');
  }
}

/** Crop verification against the booking (§19). */
export async function verifyCrop(
  auth: AuthContext,
  bookingId: string,
  input: { matches: boolean; issue?: string | null },
): Promise<OperationalBooking> {
  const { operation } = await loadForWork(auth, bookingId);
  await requireActiveSession(auth);

  if (!operation) throw conflict('This farmer has not arrived yet.');
  await assertClaimed(auth, operation);

  if (operation.state !== 'CHECKED_IN') {
    throw conflict('This booking is not ready for produce verification.');
  }

  if (!input.matches && (!input.issue || input.issue.trim().length < MIN_REMARKS_LENGTH)) {
    // A mismatch must not slide through silently (§19).
    throw validationError('Describe the problem with the produce before continuing.');
  }

  // Verification opens the quality check (Phase 6/7 order: ARRIVED → QUALITY_CHECK).
  const moved = await ops.transitionOperation(
    supabaseAdminClient,
    operation.id,
    'CHECKED_IN',
    'QUALITY_CHECK',
    {
      actorId: auth.userId,
      patch: {
        crop_verified: input.matches,
        crop_issue: input.matches ? null : (input.issue?.trim() ?? null),
      },
    },
  );

  if (!moved) throw conflict('This booking has already been updated. Refresh and try again.');

  return single(auth, bookingId);
}

/** Quality assessment (§20, §21). */
export async function recordQuality(
  auth: AuthContext,
  bookingId: string,
  input: { result: QualityResult; observedCrop?: string | null; remarks?: string | null },
): Promise<OperationalBooking> {
  const { booking, operation } = await loadForWork(auth, bookingId);
  await requireActiveSession(auth);

  if (!operation) throw conflict('This farmer has not arrived yet.');
  await assertClaimed(auth, operation);

  if (operation.state !== 'QUALITY_CHECK') {
    throw conflict('This booking is not at the quality check step.');
  }

  const remarks = input.remarks?.trim() ?? '';
  if (qualityRequiresRemarks(input.result) && remarks.length < MIN_REMARKS_LENGTH) {
    throw validationError('Record why the produce did not pass.');
  }

  const assessment = await ops.insertQualityAssessment(supabaseAdminClient, {
    operationId: operation.id,
    bookingId,
    result: input.result,
    observedCrop: input.observedCrop?.trim() || booking.crop,
    remarks: remarks || null,
    assessedBy: auth.userId,
  });

  // A failed check ends the process here; it does not quietly continue (§21).
  // A pass puts the farmer in the procurement queue (Phase 7 §48).
  const to: OperationState = input.result === 'FAILED' ? 'REJECTED' : 'WAITING';

  if (!canTransitionOperation('QUALITY_CHECK', to)) {
    throw conflict('Invalid workflow transition.');
  }

  const moved = await ops.transitionOperation(
    supabaseAdminClient,
    operation.id,
    'QUALITY_CHECK',
    to,
    {
      actorId: auth.userId,
      // A rejection carries its reason into history: the farmer is owed it.
      reason: to === 'REJECTED' ? remarks : null,
      // Leaving the check releases the claim: whoever the queue calls next
      // may be at a different station.
      patch: to === 'WAITING' ? { claimed_by: null, claimed_at: null } : {},
    },
  );

  if (!moved) throw conflict('This booking has already been updated. Refresh and try again.');

  if (to === 'REJECTED') {
    await supabaseAdminClient.from('bookings').update({ status: 'COMPLETED' }).eq('id', bookingId);
  } else {
    await enqueueBooking(booking.centre_id, bookingId, auth.userId);
    await recalculateQuietly(booking.centre_id, 'QUALITY_ASSESSMENT_COMPLETED');
  }

  void assessment;
  return single(auth, bookingId);
}

/**
 * Weighing (§24, §25; Phase 8 §2).
 *
 * Records what arrived at the scale and what was rejected there, with a
 * reason. What is ACCEPTED — received minus rejected — is what the farmer is
 * paid for. The booked quantity is never used as the purchased one.
 */
export async function recordWeight(
  auth: AuthContext,
  bookingId: string,
  input: { receivedQuantityKg: number; rejectedQuantityKg?: number; rejectionReason?: string | null },
): Promise<OperationalBooking> {
  const { operation } = await loadForWork(auth, bookingId);
  await requireActiveSession(auth);

  if (!operation) throw conflict('This farmer has not arrived yet.');
  await assertClaimed(auth, operation);

  if (operation.state !== 'WEIGHING') {
    throw conflict('This booking is not at the weighing step.');
  }

  const received = input.receivedQuantityKg;
  const rejected = input.rejectedQuantityKg ?? 0;
  const reason = input.rejectionReason?.trim() ?? '';

  if (!Number.isFinite(received) || received <= 0) {
    throw validationError('Enter the weight actually received.');
  }
  if (!Number.isFinite(rejected) || rejected < 0 || rejected >= received) {
    throw validationError('The rejected quantity must be less than the quantity received.');
  }
  if (rejected > 0 && reason.length < MIN_REMARKS_LENGTH) {
    throw validationError('Say why part of the produce was rejected.');
  }

  await ops.insertWeighing(supabaseAdminClient, {
    operationId: operation.id,
    bookingId,
    actualQuantityKg: received,
    rejectedQuantityKg: rejected,
    rejectionReason: rejected > 0 ? reason : null,
    weighedBy: auth.userId,
  });

  const moved = await ops.transitionOperation(
    supabaseAdminClient,
    operation.id,
    'WEIGHING',
    'PROCUREMENT',
    { actorId: auth.userId },
  );

  if (!moved) throw conflict('This booking has already been updated. Refresh and try again.');

  return single(auth, bookingId);
}

/**
 * Confirms the procurement (§26–§28; Phase 8 §10, §15).
 *
 * Everything that determines money is resolved HERE, from persisted records:
 * the accepted quantity from the weighment, the MSP rate by the server's own
 * rules, the amount in exact paise. The client sends none of it. The
 * procurement, its PENDING payment and the move to PAYMENT are written in one
 * database transaction.
 */
export async function confirmProcurement(
  auth: AuthContext,
  bookingId: string,
): Promise<OperationalBooking> {
  const { booking, operation } = await loadForWork(auth, bookingId);
  const session = await requireActiveSession(auth);

  if (!operation) throw conflict('This farmer has not arrived yet.');
  await assertClaimed(auth, operation);

  if (operation.state !== 'PROCUREMENT') {
    throw conflict('This booking is not ready to be procured.');
  }

  const weighing = (await ops.latestWeighing(auth.db, [operation.id])).get(operation.id);
  if (!weighing) throw conflict('Record the weight before confirming procurement.');

  const quality = (await ops.latestQuality(auth.db, [operation.id])).get(operation.id);
  if (!quality || quality.result === 'FAILED') {
    throw conflict('A passed quality assessment is required before procurement.');
  }

  if (!booking.crop_id) {
    throw conflict('This booking has no catalogue crop, so no MSP rate can be applied.');
  }

  const rate = await resolveMspRate(auth.db, {
    cropId: booking.crop_id,
    onDate: today(),
    centreId: booking.centre_id,
  });

  const accepted = acceptedQuantity(weighing.receivedKg, weighing.rejectedKg);
  const amounts = computePaymentAmounts({ acceptedQuantityKg: accepted, ratePerKg: rate.ratePerKg });
  const provider = activePaymentProvider();

  const { error } = await supabaseAdminClient.rpc('confirm_procurement', {
    p: {
      bookingId,
      operationId: operation.id,
      sessionId: session.id,
      centreId: booking.centre_id,
      farmerUserId: booking.farmer_user_id,
      crop: booking.crop,
      cropId: booking.crop_id,
      bookedQuantityKg: String(booking.expected_quantity_kg),
      receivedQuantityKg: weighing.receivedKg,
      rejectedQuantityKg: weighing.rejectedKg,
      acceptedQuantityKg: accepted,
      ratePerKg: rate.ratePerKg,
      grossAmount: amounts.gross,
      rateSource: rate.source,
      mspRateId: rate.mspRateId,
      qualityAssessmentId: quality.id,
      weighingRecordId: weighing.id,
      providerName: provider.name,
      isDemo: provider.isDemo,
      actorId: auth.userId,
    },
  });

  if (error) {
    if (error.code === '23505') throw conflict('This booking has already been procured.');
    if (error.code === '23514') throw conflict('This booking is no longer ready to be procured.');
    throw conflict('The procurement could not be confirmed. Refresh and try again.');
  }

  await supabaseAdminClient.from('bookings').update({ status: 'COMPLETED' }).eq('id', bookingId);

  // The station was freed by the database as the farmer left it; the queue
  // behind them can now move (Phase 7 §48).
  await recalculateQuietly(booking.centre_id, 'PROCUREMENT_COMPLETED');

  return single(auth, bookingId);
}

/** One booking's operational view, re-read after a change. */
export async function single(
  auth: AuthContext,
  bookingId: string,
): Promise<OperationalBooking> {
  const booking = await ops.findBooking(auth.db, bookingId);
  if (!booking) throw notFound('This booking is not available.');

  const slot = await ops.findSlot(auth.db, booking.slot_id);
  const all = await listOperationalBookings(
    auth,
    slot?.slot_date ?? today(),
    slot?.slot_date ?? today(),
  );

  const match = all.find((entry) => entry.bookingId === bookingId);
  if (!match) throw notFound('This booking is not available.');
  return match;
}

