import type { Request, Response } from 'express';
import { authOf } from '../middleware/auth.js';
import { getMspSummary } from '../services/msp/mspSummaryService.js';

/** GET /api/farmer/bookings/:bookingId/msp-summary (demo addition) */
export async function getBookingMspSummary(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.set('Cache-Control', 'no-store');
  res.json({ summary: await getMspSummary(auth, req.params.bookingId as string) });
}
