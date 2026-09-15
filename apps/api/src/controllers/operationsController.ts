import type { Request, Response } from 'express';
import { addDays } from '@kisansetu/shared';
import type { QualityResult, SessionStatus, SlotStatus } from '@kisansetu/shared';
import { authOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  checkIn,
  claimBooking,
  confirmProcurement,
  getOrCreateTodaySession,
  listOperationalBookings,
  markArrived,
  recordQuality,
  recordWeight,
  single,
  today,
  todayWorkload,
  transitionTodaySession,
  verifyCrop,
} from '../services/procurement/operationsService.js';
import {
  createSlot,
  listForRange,
  listUpcoming,
  updateSlotDetails,
} from '../services/procurement/slotService.js';

/**
 * Procurement operations endpoints.
 *
 * Every handler takes the centre from `authOf(req)`, never from the request —
 * there is no `centreId` parameter anywhere in this file by design (§42).
 */

// --- Sessions ---------------------------------------------------------------

export async function getTodaySession(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({
    session: await getOrCreateTodaySession(auth),
    workload: await todayWorkload(auth),
  });
}

export async function postSessionTransition(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const { status } = req.body as { status: SessionStatus };

  const session = await transitionTodaySession(auth, status);

  await recordAudit(req, {
    action: status === 'OPEN' ? 'SESSION_OPENED' : 'SESSION_CLOSED',
    entityType: 'procurement_sessions',
    entityId: session.id,
    metadata: { status, sessionDate: session.sessionDate },
  });

  res.json({ session });
}

// --- Slots ------------------------------------------------------------------

export async function getSlots(req: Request, res: Response): Promise<void> {
  res.json(await listUpcoming(authOf(req)));
}

export async function getSlotsForRange(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const from = (req.query.from as string) ?? today();
  const to = (req.query.to as string) ?? addDays(from, 7);

  res.json({ slots: await listForRange(auth, from, to) });
}

export async function postSlot(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const body = req.body as {
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
  };

  const slot = await createSlot(auth, body);

  await recordAudit(req, {
    action: 'SLOT_CREATED',
    entityType: 'procurement_slots',
    entityId: slot.id,
    metadata: { slotDate: slot.slotDate, startTime: slot.startTime, capacity: slot.capacity },
  });

  res.status(201).json({ slot });
}

export async function patchSlot(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const slotId = req.params.slotId as string;
  const body = req.body as { capacity?: number; status?: SlotStatus };

  const slot = await updateSlotDetails(auth, slotId, body);

  await recordAudit(req, {
    action: 'SLOT_UPDATED',
    entityType: 'procurement_slots',
    entityId: slotId,
    metadata: { capacity: body.capacity, status: body.status },
  });

  res.json({ slot });
}

// --- Bookings and the operational loop ---------------------------------------

export async function getTodayBookings(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const date = today();
  res.json({ bookings: await listOperationalBookings(auth, date, date) });
}

export async function getUpcomingBookings(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const start = addDays(today(), 1);
  res.json({ bookings: await listOperationalBookings(auth, start, addDays(start, 6)) });
}

export async function getBooking(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ booking: await single(auth, req.params.bookingId as string) });
}

export async function postArrive(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;

  const booking = await markArrived(auth, bookingId);

  await recordAudit(req, {
    action: 'BOOKING_ARRIVED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { bookingReference: booking.bookingReference },
  });

  res.json({ booking });
}

export async function postCheckIn(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;

  const booking = await checkIn(auth, bookingId);

  await recordAudit(req, {
    action: 'BOOKING_CHECKED_IN',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { queuePosition: booking.queuePosition },
  });

  res.json({ booking });
}

export async function postClaimBooking(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  res.json({ booking: await claimBooking(auth, req.params.bookingId as string) });
}

export async function postVerifyCrop(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const body = req.body as { matches: boolean; issue?: string };

  const booking = await verifyCrop(auth, bookingId, body);

  await recordAudit(req, {
    action: 'CROP_VERIFIED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { matches: body.matches, issue: body.issue ?? null },
  });

  res.json({ booking });
}

export async function postQuality(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const body = req.body as { result: QualityResult; observedCrop?: string; remarks?: string };

  const booking = await recordQuality(auth, bookingId, body);

  await recordAudit(req, {
    action: 'QUALITY_ASSESSED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: { result: body.result, remarks: body.remarks ?? null },
  });

  res.json({ booking });
}

export async function postWeigh(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;
  const body = req.body as {
    receivedQuantityKg: number;
    rejectedQuantityKg?: number;
    rejectionReason?: string;
  };

  const booking = await recordWeight(auth, bookingId, body);

  await recordAudit(req, {
    action: 'WEIGHT_RECORDED',
    entityType: 'bookings',
    entityId: bookingId,
    metadata: {
      receivedQuantityKg: body.receivedQuantityKg,
      rejectedQuantityKg: body.rejectedQuantityKg ?? 0,
      rejectionReason: body.rejectionReason ?? null,
      expectedQuantityKg: booking.expectedQuantityKg,
    },
  });

  res.json({ booking });
}

export async function postProcure(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const bookingId = req.params.bookingId as string;

  const booking = await confirmProcurement(auth, bookingId);

  await recordAudit(req, {
    action: 'PROCUREMENT_CONFIRMED',
    entityType: 'procurements',
    entityId: bookingId,
    metadata: {
      procurementReference: booking.procurementReference,
      paymentReference: booking.paymentReference,
      receivedQuantityKg: booking.actualQuantityKg,
      acceptedQuantityKg: booking.acceptedQuantityKg,
      totalValue: booking.totalValue,
    },
  });

  res.json({ booking });
}
