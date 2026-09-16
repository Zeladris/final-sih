import {
  buildTimeline,
  canTransitionFarmerStatus,
  farmerStatusOf,
} from '@kisansetu/shared';
import type {
  FarmerBookingStatus,
  FarmerProcurementStatus,
  OperationalBooking,
  StatusHistoryEntry,
} from '@kisansetu/shared';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import * as ops from '../../repositories/operationsRepository.js';
import * as status from '../../repositories/statusRepository.js';
import { single } from '../procurement/operationsService.js';
import type { AuthContext } from '../../types/request.js';

/**
 * The live status system (Phase 6).
 *
 * The farmer-facing status is READ here, never decided here: it is derived by
 * the database from the authoritative operational state, in the same
 * transaction as every change. This service assembles it for display and
 * routes staff requests to the Phase 5 operation that performs the change.
 */

// ---------------------------------------------------------------------------
// Farmer reads (§11)
// ---------------------------------------------------------------------------

/** Loads a booking the caller owns, or reports it as not found (§23). */
async function ownBooking(auth: AuthContext, bookingId: string): Promise<status.StatusBookingRow> {
  const booking = await status.findStatusBooking(auth.db, bookingId);

  // RLS already hides other farmers' bookings; the explicit owner check keeps
  // this correct even if a broader read policy is added later. Either way the
  // answer is "not found", never "exists but not yours".
  if (!booking || booking.farmer_user_id !== auth.userId) {
    throw notFound('That booking is not available.');
  }

  return booking;
}

export async function getFarmerStatus(
  auth: AuthContext,
  bookingId: string,
): Promise<FarmerBookingStatus> {
  const booking = await ownBooking(auth, bookingId);

  const [operation, procurements, history, slot, centre, crop] = await Promise.all([
    ops.findOperation(auth.db, bookingId),
    ops.findProcurementByBooking(auth.db, [bookingId]),
    status.listHistory(auth.db, bookingId),
    ops.findSlot(auth.db, booking.slot_id),
    status.findCentreName(auth.db, booking.centre_id),
    booking.crop_id ? status.findCropNames(auth.db, booking.crop_id) : Promise.resolve(null),
  ]);

  const current = booking.procurement_status;

  // When each step was first reached — from recorded history only.
  const reached = new Map<FarmerProcurementStatus, string>();
  for (const entry of history) {
    if (!reached.has(entry.to_status)) reached.set(entry.to_status, entry.created_at);
  }

  // Queue figures are shown only once the queue optimizer has published them
  // (Phase 7 stamps queue_updated_at when it does). Anything else in that
  // column is not a live position and is never shown as one (§13, §20).
  const queuePublished = Boolean(operation?.queue_updated_at) && current === 'IN_QUEUE';

  return {
    bookingId: booking.id,
    bookingReference: booking.booking_reference,
    procurementReference: procurements.get(bookingId)?.procurement_reference ?? null,
    status: current,
    reason: reasonFor(current, booking, history),

    queuePosition: queuePublished ? (operation?.queue_position ?? null) : null,
    estimatedWaitMinutes: queuePublished ? (operation?.estimated_wait_minutes ?? null) : null,
    queueUpdatedAt: queuePublished ? (operation?.queue_updated_at ?? null) : null,

    // Nothing left to show once arrival is confirmed, or once the booking
    // is past the point arrival is even meaningful (cancelled/completed/
    // no-show never reach ARRIVED at all).
    arrivalCode:
      booking.status === 'BOOKED' && !booking.arrival_otp_verified_at ? booking.arrival_otp_code : null,

    centreName: centre?.name ?? '',
    centreVillage: centre?.village ?? null,
    cropName: crop?.name_en ?? booking.crop,
    cropNameTa: crop?.name_ta ?? null,
    expectedQuantity: Number(booking.expected_quantity_kg),
    quantityUnit: booking.quantity_unit,
    slotDate: slot?.slot_date ?? '',
    slotStart: slot ? slot.start_time.slice(0, 5) : '',
    slotEnd: slot ? slot.end_time.slice(0, 5) : '',

    updatedAt: booking.status_updated_at,
    version: Number(booking.status_version),
    timeline: buildTimeline(current, reached),
  };
}

/**
 * The explanation a farmer is owed — and only that.
 *
 * A cancellation or a rejection says why. Internal operational notes (crop
 * mismatch remarks, hold reasons) stay with the centre.
 */
function reasonFor(
  current: FarmerProcurementStatus,
  booking: status.StatusBookingRow,
  history: status.HistoryRow[],
): string | null {
  if (current === 'CANCELLED') return booking.cancellation_reason;

  if (current === 'NOT_ACCEPTED') {
    const rejection = [...history].reverse().find((entry) => entry.to_status === 'NOT_ACCEPTED');
    return rejection?.reason ?? null;
  }

  return null;
}

export async function getFarmerStatusHistory(
  auth: AuthContext,
  bookingId: string,
): Promise<StatusHistoryEntry[]> {
  await ownBooking(auth, bookingId);
  const history = await status.listHistory(auth.db, bookingId);

  // Operational sub-steps (arrived -> checked in) are one farmer-facing step,
  // so only changes the farmer would recognise are listed.
  return history
    .filter((entry) => entry.from_status !== entry.to_status)
    .map((entry) => ({
      id: Number(entry.id),
      fromStatus: entry.from_status,
      status: entry.to_status,
      changedByRole: entry.changed_by_role,
      reason:
        entry.to_status === 'CANCELLED' || entry.to_status === 'NOT_ACCEPTED' ? entry.reason : null,
      createdAt: entry.created_at,
      backfilled: entry.metadata?.backfilled === true,
    }));
}

// ---------------------------------------------------------------------------
// Staff transitions (§11, §19)
// ---------------------------------------------------------------------------

/**
 * Which dedicated step performs a transition that needs evidence.
 *
 * A quality check, a weight or a payment cannot be asserted by naming a
 * status — the evidence IS the transition. Those go through the Phase 5 step
 * that records it.
 */
const STEP_FOR: Partial<Record<FarmerProcurementStatus, string>> = {
  // Arrival now needs evidence too: the farmer's own arrival code (§ arrival
  // OTP). It used to be a direct one-click transition (see the removed
  // special case below); now it belongs in this table like every other
  // evidence-requiring move.
  ARRIVED: 'arrive',
  // Check in, then verify the produce: that opens the pre-procurement check.
  PRE_PROCUREMENT_CHECK: 'verify-crop',
  // The official quality result is what puts a farmer in the queue.
  IN_QUEUE: 'quality',
  // Leaving the queue is the queue's own decision, on a chosen workstation.
  PROCUREMENT: 'queue/:bookingId/select',
  PAYMENT: 'procure',
  COMPLETED: 'payment',
};

/**
 * POST /api/staff/me/bookings/:bookingId/status
 *
 * 1–3. Authenticated CENTRE_STAFF (route middleware) acting on a booking at
 *      their own centre (`single` resolves the centre from their profile).
 * 4.   The requested move is checked against the farmer-facing machine.
 * 5–7. The move itself runs through the Phase 5 operation, whose database call
 *      updates state and writes history in one transaction.
 */
export async function staffTransition(
  auth: AuthContext,
  bookingId: string,
  to: FarmerProcurementStatus,
): Promise<OperationalBooking> {
  const booking = await single(auth, bookingId);
  const from = farmerStatusOf(booking.bookingStatus, booking.state);

  if (!canTransitionFarmerStatus(from, to)) {
    throw conflict(`A booking cannot move from ${from} to ${to}.`, { from, to });
  }

  const step = STEP_FOR[to];
  const path = step?.startsWith('queue/')
    ? `/api/staff/me/${step.replace(':bookingId', bookingId)}`
    : `/api/staff/me/bookings/${bookingId}/${step}`;

  throw validationError(
    step
      ? `Moving to ${to} records evidence. Use the "${step}" step for this booking.`
      : `Moving to ${to} is not available as a direct status change.`,
    step ? [{ path: 'status', message: `Use POST ${path}` }] : undefined,
  );
}
