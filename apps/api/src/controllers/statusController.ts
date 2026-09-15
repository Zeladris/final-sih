import type { Request, Response } from 'express';
import type { FarmerProcurementStatus } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  getFarmerStatus,
  getFarmerStatusHistory,
  staffTransition,
} from '../services/status/statusService.js';

/**
 * Live status endpoints (Phase 6).
 *
 * No handler here accepts a farmer id or a centre id. The farmer is the
 * caller; the centre comes from the staff profile (§11, §23).
 */

/** GET /api/farmer/bookings/:bookingId/status */
export async function getBookingStatus(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  // Status must never be served from a cache: a stale "in queue" after the
  // farmer was called is exactly the failure this page exists to prevent.
  res.set('Cache-Control', 'no-store');
  res.json(await getFarmerStatus(auth, req.params.bookingId as string));
}

/** GET /api/farmer/bookings/:bookingId/status-history */
export async function getBookingStatusHistory(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.set('Cache-Control', 'no-store');
  res.json({ history: await getFarmerStatusHistory(auth, req.params.bookingId as string) });
}

/** POST /api/staff/me/bookings/:bookingId/status */
export async function postStaffStatus(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const { status } = req.body as { status: FarmerProcurementStatus };

  const booking = await staffTransition(auth, bookingId, status);

  await recordAudit(req, {
    action: status === 'ARRIVED' ? 'BOOKING_ARRIVED' : 'BOOKING_CHECKED_IN',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { bookingReference: booking.bookingReference, via: 'status', status },
  });

  res.json({ booking });
}
