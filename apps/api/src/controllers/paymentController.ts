import type { Request, Response } from 'express';
import { businessToday } from '@kisansetu/shared';
import type { DemoScenario } from '@kisansetu/shared';
import { env } from '../config/env.js';
import { authOf } from '../middleware/auth.js';
import { validationError } from '../lib/errors.js';
import { recordAudit } from '../services/audit/auditService.js';
import {
  getFarmerBookingPayment,
  getFarmerPayment,
  getFarmerPaymentHistory,
  getFarmerProcurementPayment,
  getStaffPayment,
  getStaffPaymentHistory,
  handleWebhook,
  initiatePayment,
  listFarmerPayments,
  listStaffPayments,
  paymentSummary,
  refreshForStaff,
  retryPayment,
} from '../services/payments/paymentService.js';

/**
 * Payment endpoints (Phase 8 §34).
 *
 * No handler accepts an amount, a rate, a quantity, a status or a farmer id.
 * Staff can ask to START or RETRY a payment; what it is for and how much it
 * is were settled when the procurement was confirmed.
 */

const param = (req: Request, name: string): string => req.params[name] as string;
const keyOf = (req: Request): string | undefined => req.get('Idempotency-Key') ?? undefined;
const scenarioOf = (req: Request): DemoScenario | undefined =>
  (req.body as { demoScenario?: DemoScenario } | undefined)?.demoScenario;

// --- Farmer -------------------------------------------------------------------

export async function getMyPayments(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json({ payments: await listFarmerPayments(authOf(req)) });
}

export async function getMyBookingPayment(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json(await getFarmerBookingPayment(authOf(req), param(req, 'bookingId')));
}

export async function getMyProcurementPayment(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json({ payment: await getFarmerProcurementPayment(authOf(req), param(req, 'procurementId')) });
}

export async function getMyPayment(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json({ payment: await getFarmerPayment(authOf(req), param(req, 'paymentId')) });
}

export async function getMyPaymentHistory(req: Request, res: Response): Promise<void> {
  res.json({ history: await getFarmerPaymentHistory(authOf(req), param(req, 'paymentId')) });
}

// --- Staff ----------------------------------------------------------------------

export async function getCentrePayments(req: Request, res: Response): Promise<void> {
  const date = (req.query.date as string | undefined) ?? businessToday(env.APP_TIMEZONE);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError('Use a date like 2026-09-14.');
  res.set('Cache-Control', 'no-store');
  res.json({ payments: await listStaffPayments(authOf(req), date) });
}

export async function getProcurementPayment(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const payment = await getStaffPayment(auth, { procurementId: param(req, 'procurementId') });

  await recordAudit(req, {
    action: 'PAYMENT_VIEWED',
    entityType: 'payments',
    entityId: payment.id,
    metadata: { paymentReference: payment.paymentReference },
  });

  res.set('Cache-Control', 'no-store');
  res.json({ payment });
}

export async function getPaymentById(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  res.json({ payment: await getStaffPayment(authOf(req), { paymentId: param(req, 'paymentId') }) });
}

export async function postInitiatePayment(req: Request, res: Response): Promise<void> {
  const result = await initiatePayment(authOf(req), param(req, 'procurementId'), keyOf(req), scenarioOf(req));
  // 201 for a new attempt; 200 for a replay or an already-paid procurement.
  res.status(result.outcome === 'STARTED' ? 201 : 200).json(result);
}

export async function postRetryPayment(req: Request, res: Response): Promise<void> {
  const result = await retryPayment(authOf(req), param(req, 'paymentId'), keyOf(req), scenarioOf(req));
  res.status(result.outcome === 'STARTED' ? 201 : 200).json(result);
}

export async function postRefreshPayment(req: Request, res: Response): Promise<void> {
  res.json({ payment: await refreshForStaff(authOf(req), param(req, 'paymentId')) });
}

export async function getCentrePaymentHistory(req: Request, res: Response): Promise<void> {
  res.json({ history: await getStaffPaymentHistory(authOf(req), param(req, 'paymentId')) });
}

// --- Administration ------------------------------------------------------------

export async function getDistrictPaymentSummary(req: Request, res: Response): Promise<void> {
  res.json(await paymentSummary(authOf(req), 'DISTRICT'));
}

export async function getStatePaymentSummary(req: Request, res: Response): Promise<void> {
  res.json(await paymentSummary(authOf(req), 'STATE'));
}

// --- Provider webhooks ----------------------------------------------------------

export async function postProviderWebhook(req: Request, res: Response): Promise<void> {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await handleWebhook(param(req, 'provider'), req.headers, raw);
  res.json({ result });
}
