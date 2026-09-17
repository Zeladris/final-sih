import type { MspSummary } from '@kisansetu/shared';
import { notFound } from '../../lib/errors.js';
import * as status from '../../repositories/statusRepository.js';
import { findProcurementQuantities } from '../../repositories/coldStorageRepository.js';
import { resolveMspRate } from './mspService.js';
import { today } from '../procurement/operationsService.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Demo/indicative MSP summary for a farmer's own booking (demo addition).
 *
 * Reuses resolveMspRate() exactly as confirmProcurement() does — same rate,
 * same "server refuses to guess a price" rule (no configured rate means no
 * summary, never a fabricated one). This is a preview only: the real payment
 * is still resolved and settled entirely independently at confirm time.
 */
export async function getMspSummary(auth: AuthContext, bookingId: string): Promise<MspSummary | null> {
  const booking = await status.findStatusBooking(auth.db, bookingId);
  if (!booking || booking.farmer_user_id !== auth.userId) {
    throw notFound('That booking is not available.');
  }

  if (!booking.crop_id) return null; // no catalogue crop, so no rate to show

  let rate;
  try {
    rate = await resolveMspRate(auth.db, {
      cropId: booking.crop_id,
      onDate: today(),
      centreId: booking.centre_id,
    });
  } catch {
    return null; // nothing configured for this crop — say nothing rather than guess
  }

  const procurement = await findProcurementQuantities(auth.db, bookingId);
  const bookedQuantityKg = Number(booking.expected_quantity_kg);
  const procuredQuantityKg = procurement ? Number(procurement.accepted_quantity_kg ?? 0) : null;
  const remainingQuantityKg =
    procuredQuantityKg !== null ? Math.max(0, bookedQuantityKg - procuredQuantityKg) : null;

  // Never the booked figure once a real, smaller procured figure exists.
  const basisQuantityKg = procuredQuantityKg ?? bookedQuantityKg;
  const estimatedValue = (basisQuantityKg * Number(rate.ratePerKg)).toFixed(2);

  return {
    cropName: booking.crop,
    ratePerKg: rate.ratePerKg,
    bookedQuantityKg,
    procuredQuantityKg,
    remainingQuantityKg,
    estimatedValue,
    isFinal: booking.status === 'COMPLETED',
  };
}
