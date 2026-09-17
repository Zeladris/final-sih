import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  getColdStorageStatus,
  listColdStorageFacilities,
  reserveColdStorage,
} from '../services/coldStorage/coldStorageService.js';

/** Cold storage (demo addition) — farmer-only, one booking at a time. */

/** GET /api/farmer/bookings/:bookingId/cold-storage */
export async function getBookingColdStorage(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.set('Cache-Control', 'no-store');
  res.json(await getColdStorageStatus(auth, req.params.bookingId as string));
}

/** GET /api/farmer/cold-storage/facilities */
export async function getColdStorageFacilities(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ facilities: await listColdStorageFacilities(auth) });
}

/** POST /api/farmer/bookings/:bookingId/cold-storage */
export async function postBookingColdStorage(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const { facilityId } = req.body as { facilityId: string };

  const reservation = await reserveColdStorage(auth, bookingId, facilityId);

  await recordAudit(req, {
    action: 'COLD_STORAGE_RESERVED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: {
      reservationReference: reservation.bookingReference,
      facilityName: reservation.facilityName,
      quantityKg: reservation.quantityKg,
    },
  });

  res.status(201).json({ reservation });
}
