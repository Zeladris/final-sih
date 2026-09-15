import { formatScaled, isActiveFarmerStatus, parseDecimal, SECTION_STATUSES } from '@kisansetu/shared';
import { findPaymentBy, findProcurementsByIds } from '../../repositories/paymentRepository.js';
import type { BookingSummary, BookingSummaryItem, FarmerBooking } from '@kisansetu/shared';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { findOperation } from '../../repositories/operationsRepository.js';
import { listOwnBookings } from '../booking/bookingService.js';
import { today } from '../procurement/operationsService.js';
import type { BookingSummaryProvider } from './summaryProviders.js';

/**
 * The real booking summary, replacing the Phase 3 placeholder (§53).
 *
 * Phase 3 shipped `UnimplementedBookingProvider`, which reported
 * NOT_AVAILABLE because booking genuinely did not exist. It does now, so the
 * dashboard reports EMPTY when a farmer has no bookings — a different and
 * newly-true claim.
 *
 * Grouping uses the Phase 6 farmer-facing status. The booking row's own
 * status is not enough: it reads COMPLETED as soon as procurement is
 * confirmed, while the farmer is still waiting to be paid.
 */
export class SupabaseBookingProvider implements BookingSummaryProvider {
  readonly name = 'SupabaseBookingProvider';

  async forFarmer(farmerUserId: string): Promise<BookingSummary> {
    // The service role is used deliberately: this runs inside dashboard
    // assembly where there is no per-request user client to hand down, and the
    // query is pinned to this one farmer's id.
    const bookings = await listOwnBookings(supabaseAdminClient, farmerUserId);
    const date = today();

    // "Active" means the farmer is at the centre and it is in progress. A
    // farmer standing at the counter should see this first (§18).
    const inProgress = bookings
      .filter((booking) => isActiveFarmerStatus(booking.farmerStatus))
      .sort((a, b) => b.slotDate.localeCompare(a.slotDate))[0];

    const upcoming = bookings
      .filter((booking) => booking.farmerStatus === 'SLOT_BOOKED' && booking.slotDate >= date)
      .sort((a, b) => a.slotDate.localeCompare(b.slotDate))[0];

    const completed = bookings
      .filter((booking) => booking.farmerStatus === 'COMPLETED')
      .sort((a, b) => b.slotDate.localeCompare(a.slotDate))[0];

    const anything = inProgress ?? upcoming ?? completed;

    return {
      status: anything ? SECTION_STATUSES.OK : SECTION_STATUSES.EMPTY,
      upcoming: upcoming ? toItem(upcoming) : null,
      active: inProgress ? await withPayment(await withQueue(toItem(inProgress))) : null,
      mostRecentCompleted: completed ? await withPayment(toItem(completed)) : null,
    };
  }
}

function toItem(booking: FarmerBooking): BookingSummaryItem {
  return {
    bookingId: booking.id,
    reference: booking.bookingReference,
    crop: booking.cropName,
    // The dashboard contract is in quintals; bookings are recorded in kg.
    quantityQtl: Math.round((booking.expectedQuantityKg / 100) * 100) / 100,
    centreName: booking.centreName,
    date: booking.slotDate,
    slotStart: booking.slotStart || null,
    slotEnd: booking.slotEnd || null,
    status: booking.operationState ?? booking.status,
    farmerStatus: booking.farmerStatus,
    queuePosition: null,
    estimatedWaitMinutes: null,
    procurementReference: null,
    acceptedQuantityKg: null,
    netAmount: null,
    paymentStatus: null,
    paymentIsDemo: null,
  };
}

/**
 * Phase 8: what was accepted, for how much, and whether it has been paid —
 * from the persisted payment, never a placeholder card (§25).
 */
async function withPayment(item: BookingSummaryItem): Promise<BookingSummaryItem> {
  const payment = await findPaymentBy(supabaseAdminClient, 'booking_id', item.bookingId);
  if (!payment) return item;

  const procurements = await findProcurementsByIds(supabaseAdminClient, [payment.procurement_id]);
  return {
    ...item,
    procurementReference: procurements.get(payment.procurement_id)?.procurement_reference ?? null,
    acceptedQuantityKg: formatScaled(parseDecimal(String(payment.accepted_quantity_kg), 3), 3),
    netAmount: formatScaled(parseDecimal(String(payment.net_amount), 2), 2),
    paymentStatus: payment.status,
    paymentIsDemo: payment.is_demo,
  };
}

/** Queue figures only once the queue module has published them (Phase 6 §20). */
async function withQueue(item: BookingSummaryItem): Promise<BookingSummaryItem> {
  if (item.farmerStatus !== 'IN_QUEUE') return item;

  const operation = await findOperation(supabaseAdminClient, item.bookingId);
  if (!operation?.queue_updated_at) return item;

  return {
    ...item,
    queuePosition: operation.queue_position,
    estimatedWaitMinutes: operation.estimated_wait_minutes,
  };
}
