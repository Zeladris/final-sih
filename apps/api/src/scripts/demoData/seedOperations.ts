import { addDays, businessToday } from '@kisansetu/shared';
import type { AccessScope, Role } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import type { AuthContext } from '../../types/request.js';
import * as slotService from '../../services/procurement/slotService.js';
import * as ops from '../../services/procurement/operationsService.js';
import * as queueService from '../../services/queue/queueService.js';
import * as paymentService from '../../services/payments/paymentService.js';
import { createBooking, newIdempotencyKey } from '../../services/booking/bookingService.js';
import {
  DEMO_SLOT_DAYS_AHEAD,
  DEMO_SLOT_WINDOWS,
  DEMO_STATES,
} from './config.js';
import type { SeededIds } from './seedAccounts.js';

/**
 * Slots, sample bookings and a real operational history — built by calling
 * the SAME service functions the API exposes (`operationsService`,
 * `queueService`, `paymentService`), with a service-role-backed
 * `AuthContext` standing in for an interactive session. This is not a
 * shortcut around authorization: it is how the seed gets an authentic,
 * trigger-verified history (status history, the projected booking status,
 * queue snapshots, the payment state machine) instead of hand-writing rows
 * that merely look right.
 */

function authFor(userId: string, role: Role, scope: AccessScope): AuthContext {
  return {
    userId,
    phone: null,
    role,
    status: 'ACTIVE',
    fullName: null,
    preferredLanguage: 'en',
    scope,
    db: supabaseAdminClient,
  };
}

async function seedSlotsForCentre(centreId: string, staffAuth: AuthContext): Promise<void> {
  const start = businessToday(env.APP_TIMEZONE);

  for (let dayOffset = 0; dayOffset < DEMO_SLOT_DAYS_AHEAD; dayOffset += 1) {
    const slotDate = addDays(start, dayOffset);

    for (const window of DEMO_SLOT_WINDOWS) {
      try {
        await slotService.createSlot(staffAuth, {
          slotDate,
          startTime: window.start,
          endTime: window.end,
          capacity: window.capacity,
        });
      } catch (cause) {
        // Idempotent re-run: a slot for this (centre, date, start) already
        // exists. Anything else is a real problem.
        const message = (cause as Error).message ?? '';
        if (!/already/i.test(message)) {
          logger.warn('demo slot could not be created', { centreId, slotDate, reason: message });
        }
      }
    }
  }

  void centreId;
}

/** Books a slot for `farmerUserId` on `dayOffset` days from today at `centreId`, for the demo PADDY-or-configured crop. */
async function bookDemoSlot(
  farmerUserId: string,
  centreId: string,
  cropId: string,
  dayOffset: number,
  farmerLabel: string,
): Promise<string | null> {
  const targetDate = addDays(businessToday(env.APP_TIMEZONE), dayOffset);

  const { data: slots, error } = await supabaseAdminClient
    .from('procurement_slots')
    .select('id')
    .eq('centre_id', centreId)
    .eq('slot_date', targetDate)
    .eq('status', 'OPEN')
    .order('start_time', { ascending: true })
    .limit(1);
  if (error || !slots || slots.length === 0) {
    logger.warn('no open demo slot to book', { centreId, targetDate, farmerLabel });
    return null;
  }
  const slotId = (slots[0] as { id: string }).id;

  // Idempotent: a booking for this farmer on this slot already exists.
  const { data: existing } = await supabaseAdminClient
    .from('bookings')
    .select('id')
    .eq('farmer_user_id', farmerUserId)
    .eq('slot_id', slotId)
    .neq('status', 'CANCELLED')
    .maybeSingle();
  if (existing) return (existing as { id: string }).id;

  const booking = await createBooking(supabaseAdminClient, farmerUserId, {
    cropId,
    slotId,
    expectedQuantityKg: 1200,
    storageLocationText: 'On-farm storage shed',
    idempotencyKey: newIdempotencyKey(),
  });
  return booking.id;
}

/** The farmer-only arrival code (§ arrival OTP) — the seed reads it directly
 *  with admin access, the same way it stands in for an interactive session
 *  everywhere else in this file; a real staff login never sees this value,
 *  only the farmer's own app does. */
async function arrivalOtpFor(bookingId: string): Promise<string> {
  const { data, error } = await supabaseAdminClient
    .from('bookings')
    .select('arrival_otp_code')
    .eq('id', bookingId)
    .single();
  if (error || !data) throw new Error(`Could not read arrival_otp_code for ${bookingId}: ${error?.message}`);
  return (data as { arrival_otp_code: string }).arrival_otp_code;
}

/** Drives a booking BOOKED -> COMPLETED with a successful demo payment. History/analytics demo. */
async function runToCompletion(bookingId: string, staffAuth: AuthContext): Promise<void> {
  await ops.markArrived(staffAuth, bookingId, await arrivalOtpFor(bookingId));
  await ops.checkIn(staffAuth, bookingId);
  await ops.verifyCrop(staffAuth, bookingId, { matches: true });
  await ops.recordQuality(staffAuth, bookingId, { result: 'PASSED' });

  const stations = await queueService.listWorkstationViews(staffAuth);
  const available = stations.find((s) => s.status === 'AVAILABLE');
  if (!available) {
    logger.warn('no available workstation for demo procurement', { bookingId });
    return;
  }
  await queueService.selectCandidate(staffAuth, bookingId, { workstationId: available.id });

  await ops.recordWeight(staffAuth, bookingId, { receivedQuantityKg: 1200, rejectedQuantityKg: 0 });
  await ops.confirmProcurement(staffAuth, bookingId);

  const single = await ops.single(staffAuth, bookingId);
  if (!single.procurementId) return;

  const { outcome } = await paymentService.initiatePayment(staffAuth, single.procurementId, newIdempotencyKey(), 'SUCCESS');
  if (outcome === 'ALREADY_PAID') return;

  // The DEMO provider settles after PAYMENT_DEMO_SETTLE_SECONDS. Wait it out
  // so this seed leaves a SUCCESS payment rather than one stuck PROCESSING.
  await new Promise((resolve) => setTimeout(resolve, (env.PAYMENT_DEMO_SETTLE_SECONDS + 1) * 1000));

  const paymentId = (await ops.single(staffAuth, bookingId)).paymentId;
  if (paymentId) await paymentService.refreshPayment(paymentId, staffAuth.userId);
}

/** Drives a booking to WAITING — genuinely live in the queue, ready for a demo staff login to process. */
async function runToQueued(bookingId: string, staffAuth: AuthContext): Promise<void> {
  const current = await ops.single(staffAuth, bookingId);
  if (current.state !== 'BOOKED') return; // already progressed by an earlier run

  await ops.markArrived(staffAuth, bookingId, await arrivalOtpFor(bookingId));
  await ops.checkIn(staffAuth, bookingId);
  await ops.verifyCrop(staffAuth, bookingId, { matches: true });
  await ops.recordQuality(staffAuth, bookingId, { result: 'PASSED' });
}

export async function seedOperationalData(seeded: SeededIds): Promise<void> {
  // A demo procurement needs an MSP rate to resolve, and only PADDY has one
  // (migrated nationally from Phase 5's configured rate) — so every demo
  // booking uses PADDY, regardless of a district's descriptive primary crop.
  // Land holdings still show the district's own crop (Maize, Groundnut, …);
  // only the operational chain is standardised on the crop with a real rate.
  const { data: paddyCrop, error: cropError } = await supabaseAdminClient
    .from('crops')
    .select('id')
    .eq('code', 'PADDY')
    .maybeSingle();
  if (cropError || !paddyCrop) {
    logger.error('demo seed: PADDY crop not found; skipping operational data', { reason: cropError?.message });
    return;
  }
  const cropId = (paddyCrop as { id: string }).id;

  // Slots for every centre — real business data every district's staff can
  // see, whether or not this run also drives a sample booking there.
  for (const state of DEMO_STATES) {
    for (const district of state.districts) {
      for (const centre of district.centres) {
        const centreId = seeded.centreIdByCode.get(centre.code);
        const staffIds = seeded.staffUserIdsByCentre.get(centre.code);
        if (!centreId || !staffIds || staffIds.length === 0) continue;

        const staffAuth = authFor(staffIds[0]!, 'CENTRE_STAFF', { centreId, districtId: null, stateId: null });
        await seedSlotsForCentre(centreId, staffAuth);
      }
    }
  }
  logger.info('demo slots seeded for every centre');

  // The two demonstrable bookings per district: one full completed history,
  // one live in the queue right now — see config.ts's DemoFarmerStory doc.
  for (const state of DEMO_STATES) {
    for (const district of state.districts) {
      const primaryCentre = district.centres[0]!;
      const secondCentre = district.centres[1]!;
      const primaryCentreId = seeded.centreIdByCode.get(primaryCentre.code);
      const secondCentreId = seeded.centreIdByCode.get(secondCentre.code);
      const primaryStaffIds = seeded.staffUserIdsByCentre.get(primaryCentre.code);
      const secondStaffIds = seeded.staffUserIdsByCentre.get(secondCentre.code);
      if (!primaryCentreId || !secondCentreId || !primaryStaffIds || !secondStaffIds) continue;

      const historyFarmer = district.farmers[0]!; // VERIFIED_HISTORY
      const liveFarmer = district.farmers[1]!; // VERIFIED_LIVE
      const historyFarmerUserId = seeded.farmerUserIdByRef.get(historyFarmer.employeeReferenceId);
      const liveFarmerUserId = seeded.farmerUserIdByRef.get(liveFarmer.employeeReferenceId);
      if (!historyFarmerUserId || !liveFarmerUserId) continue;

      const primaryStaffAuth = authFor(primaryStaffIds[0]!, 'CENTRE_STAFF', {
        centreId: primaryCentreId,
        districtId: null,
        stateId: null,
      });
      const secondStaffAuth = authFor(secondStaffIds[0]!, 'CENTRE_STAFF', {
        centreId: secondCentreId,
        districtId: null,
        stateId: null,
      });

      try {
        await ops.getOrCreateTodaySession(primaryStaffAuth);
        await ops.transitionTodaySession(primaryStaffAuth, 'OPEN').catch(() => undefined);
        const historyBookingId = await bookDemoSlot(historyFarmerUserId, primaryCentreId, cropId, 0, historyFarmer.fullName);
        if (historyBookingId) await runToCompletion(historyBookingId, primaryStaffAuth);
      } catch (cause) {
        logger.warn('demo history booking chain failed (non-fatal)', {
          district: district.code,
          reason: (cause as Error).message,
        });
      }

      try {
        await ops.getOrCreateTodaySession(secondStaffAuth);
        await ops.transitionTodaySession(secondStaffAuth, 'OPEN').catch(() => undefined);
        const liveBookingId = await bookDemoSlot(liveFarmerUserId, secondCentreId, cropId, 0, liveFarmer.fullName);
        if (liveBookingId) await runToQueued(liveBookingId, secondStaffAuth);
      } catch (cause) {
        logger.warn('demo live-queue booking chain failed (non-fatal)', {
          district: district.code,
          reason: (cause as Error).message,
        });
      }
    }
  }

  logger.info('demo operational data seeded (bookings, procurements, payments, queue)');
}
