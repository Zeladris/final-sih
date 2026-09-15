import { addDays } from '@kisansetu/shared';
import type { StaffDashboardResponse } from '@kisansetu/shared';
import { forbidden, notFound } from '../../lib/errors.js';
import { findStaffProfile } from '../../repositories/profilesRepository.js';
import {
  findCentreById,
  findDistrictById,
  findStateById,
} from '../../repositories/centresRepository.js';
import {
  getOrCreateTodaySession,
  listOperationalBookings,
  today,
  todayWorkload,
} from '../procurement/operationsService.js';
import { listUpcoming } from '../procurement/slotService.js';
import { activePaymentProvider } from '../payments/paymentProvider.js';
import type { AuthContext } from '../../types/request.js';

/**
 * The staff operations dashboard (§3, §8; Phase 14).
 *
 * Answers one question: what needs to happen at my procurement centre right
 * now? Ordered by operational priority — the current session, today's
 * workload, what is next, what needs action. Farmer verification is NOT
 * here — it is the District Admin's responsibility entirely (Phase 14); this
 * dashboard carries no verification figures to keep in step with it.
 *
 * Every figure is a count of real rows in this centre's scope. Nothing here is
 * a placeholder (§54).
 */
export async function buildStaffDashboard(auth: AuthContext): Promise<StaffDashboardResponse> {
  const staff = await findStaffProfile(auth.db, auth.userId);
  if (!staff) throw notFound('No staff record found for this account.');
  if (!staff.isActive) throw forbidden('This staff account is not active.');

  const centre = await findCentreById(auth.db, staff.centreId);
  if (!centre) throw notFound('The assigned procurement centre is not available.');

  const district = await findDistrictById(auth.db, centre.districtId);
  if (!district) throw notFound('The assigned district is not available.');

  const state = await findStateById(auth.db, district.stateId);
  if (!state) throw notFound('The assigned state is not available.');

  const date = today();

  const [session, workload, todayBookings, slots] = await Promise.all([
    getOrCreateTodaySession(auth),
    todayWorkload(auth),
    listOperationalBookings(auth, date, date),
    listUpcoming(auth),
  ]);

  // Who is actually being worked on right now, in queue order.
  const inProgress = todayBookings
    .filter((booking) =>
      ['CHECKED_IN', 'WAITING', 'QUALITY_CHECK', 'WEIGHING', 'PROCUREMENT', 'PAYMENT_PENDING'].includes(
        booking.state,
      ),
    )
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));

  const nowProcessing =
    inProgress.find((booking) =>
      ['QUALITY_CHECK', 'WEIGHING', 'PROCUREMENT'].includes(booking.state),
    ) ?? null;

  return {
    staff: {
      name: auth.fullName,
      employeeReferenceId: staff.employeeReferenceId,
      designation: staff.designation,
    },
    centre: {
      centreId: centre.id,
      centreCode: centre.code,
      centreName: centre.name,
      districtName: district.name,
      stateName: state.name,
      village: centre.village,
      openTime: centre.openTime,
      closeTime: centre.closeTime,
      dailyCapacityQtl: centre.dailyCapacityQtl,
    },
    session,
    workload,
    nowProcessing,
    // The queue proper (WAITING), in the optimizer's published order. A farmer
    // not yet ranked (e.g. ineligible) sorts after the ranked ones.
    queueAhead: todayBookings
      .filter((booking) => booking.state === 'WAITING')
      .sort((a, b) => (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 5),
    slots: {
      today: slots.today,
      tomorrow: slots.tomorrow,
      tomorrowDate: addDays(date, 1),
    },
    actionRequired: {
      awaitingArrival: todayBookings.filter((booking) => booking.state === 'BOOKED').length,
      qualityPending: todayBookings.filter((booking) => booking.state === 'QUALITY_CHECK').length,
      weighingPending: todayBookings.filter((booking) => booking.state === 'WEIGHING').length,
      paymentPending: todayBookings.filter((booking) => booking.state === 'PAYMENT_PENDING').length,
    },
    providers: {
      // Shown in the UI so nobody mistakes either for a real integration.
      // MSP rates are operator-configured (msp_rates.source_type); there is no
      // live government feed to claim.
      rateSource: 'CONFIGURED',
      paymentProvider: activePaymentProvider().name,
      paymentIsReal: !activePaymentProvider().isDemo,
    },
  };
}
