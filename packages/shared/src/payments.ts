import type { PaymentStatus } from './operations.js';

/**
 * Payment & MSP settlement (Phase 8).
 *
 * Payment has its own lifecycle, separate from — and feeding into — the
 * procurement lifecycle: only a SUCCESS moves a procurement to COMPLETED.
 */

// ---------------------------------------------------------------------------
// State machine (§3, §36) — mirrors app.assert_payment_transition()
// ---------------------------------------------------------------------------

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ['INITIATED'],
  INITIATED: ['PROCESSING', 'FAILED', 'SUCCESS'],
  PROCESSING: ['SUCCESS', 'FAILED'],
  FAILED: ['RETRY_PENDING'],
  RETRY_PENDING: ['INITIATED'],
  SUCCESS: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}

/** Money is on its way; the outcome is not known yet. */
export function isPaymentInFlight(status: PaymentStatus): boolean {
  return status === 'INITIATED' || status === 'PROCESSING';
}

/** Before a procurement exists there is nothing to pay — not a status, a fact. */
export type FarmerPaymentState = 'NOT_ELIGIBLE' | PaymentStatus;

export const PAYMENT_CURRENCY = 'INR';

export type DemoScenario = 'SUCCESS' | 'FAIL';

// ---------------------------------------------------------------------------
// Exact arithmetic (§7, §29)
//
// Quantities have 3 decimals (grams), rates 4 decimals, money 2 (paise).
// Everything is done in BigInt integers; a float never touches money. The
// database independently checks gross = round(quantity × rate, 2).
// ---------------------------------------------------------------------------

/** "487.25" → 487250n at scale 3. Refuses anything that is not a plain decimal. */
export function parseDecimal(value: string | number, scale: number): bigint {
  const text = typeof value === 'number' ? numberToPlain(value) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Not a decimal value: ${String(value)}`);

  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    throw new Error(`${text} has more than ${scale} decimal places`);
  }

  const digits = BigInt(whole! + fraction.slice(0, scale).padEnd(scale, '0'));
  return sign === '-' ? -digits : digits;
}

function numberToPlain(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Not a finite number');
  // toString can produce exponent notation for very small/large values.
  const text = String(value);
  return /e/i.test(text) ? value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** Integer division rounding half away from zero — what numeric round() does. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (2n * d);
  return negative ? -q : q;
}

export function formatScaled(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`;
}

export interface PaymentAmounts {
  grossPaise: bigint;
  deductionsPaise: bigint;
  netPaise: bigint;
  /** Rupees as exact decimal strings, e.g. "21620.00". */
  gross: string;
  deductions: string;
  net: string;
}

/**
 * Gross = accepted quantity × applicable rate, rounded to the paisa.
 * Net = gross − authorised deductions. No deductions are configured, so they
 * are zero unless a caller supplies an authorised amount (§7).
 */
export function computePaymentAmounts(input: {
  acceptedQuantityKg: string | number;
  ratePerKg: string | number;
  deductionsPaise?: bigint;
}): PaymentAmounts {
  const grams = parseDecimal(input.acceptedQuantityKg, 3);
  const rate = parseDecimal(input.ratePerKg, 4);
  if (grams <= 0n) throw new Error('Accepted quantity must be positive');
  if (rate <= 0n) throw new Error('Rate must be positive');

  // grams × (rupees × 10⁴) = rupees × 10⁷; paise = rupees × 10².
  const grossPaise = divRoundHalfUp(grams * rate, 100_000n);
  const deductionsPaise = input.deductionsPaise ?? 0n;
  if (deductionsPaise < 0n || deductionsPaise > grossPaise) {
    throw new Error('Deductions must be between zero and the gross amount');
  }
  const netPaise = grossPaise - deductionsPaise;

  return {
    grossPaise,
    deductionsPaise,
    netPaise,
    gross: formatScaled(grossPaise, 2),
    deductions: formatScaled(deductionsPaise, 2),
    net: formatScaled(netPaise, 2),
  };
}

/** Accepted = received − rejected, in exact grams. */
export function acceptedQuantity(received: string | number, rejected: string | number): string {
  const accepted = parseDecimal(received, 3) - parseDecimal(rejected, 3);
  if (accepted <= 0n) throw new Error('Nothing was accepted');
  return formatScaled(accepted, 3);
}

/** Per-quintal display of a per-kg rate (1 quintal = 100 kg), exact. */
export function ratePerQuintal(ratePerKg: string | number): string {
  return formatScaled(parseDecimal(ratePerKg, 4) * 100n, 4).replace(/\.?0+$/, '') || '0';
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface PaymentHistoryEntry {
  id: number;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  changedByRole: string;
  createdAt: string;
}

export interface PaymentAttemptView {
  attemptNumber: number;
  attemptReference: string;
  providerName: string;
  isDemo: boolean;
  demoScenario: DemoScenario | null;
  providerReference: string | null;
  status: string;
  failureCode: string | null;
  failureReason: string | null;
  requestedAt: string;
  completedAt: string | null;
}

/** What the farmer sees: what was accepted, at what rate, for how much, and where it is (§19). */
export interface FarmerPaymentView {
  id: string;
  paymentReference: string;
  procurementReference: string;
  bookingId: string;
  bookingReference: string;
  cropName: string;
  bookedQuantityKg: string | null;
  receivedQuantityKg: string | null;
  acceptedQuantityKg: string;
  rejectedQuantityKg: string | null;
  ratePerKg: string;
  ratePerQuintal: string;
  grossAmount: string;
  deductionsAmount: string;
  netAmount: string;
  currency: 'INR';
  status: PaymentStatus;
  /** True when no money moves (demo provider). Always shown. */
  isDemo: boolean;
  initiatedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  history: PaymentHistoryEntry[];
}

/** Staff additionally see provider references, failures and every attempt (§27). */
export interface StaffPaymentView extends FarmerPaymentView {
  procurementId: string;
  farmerName: string | null;
  providerName: string;
  providerReference: string | null;
  paymentMethod: string;
  failureCode: string | null;
  failureReason: string | null;
  retryCount: number;
  rateSource: string;
  mspSourceReference: string | null;
  attempts: PaymentAttemptView[];
  canInitiate: boolean;
  canRetry: boolean;
  canRefresh: boolean;
}

export interface FarmerBookingPayment {
  state: FarmerPaymentState;
  payment: FarmerPaymentView | null;
}

export interface StaffPaymentRow {
  paymentId: string;
  paymentReference: string;
  procurementId: string;
  procurementReference: string;
  bookingId: string;
  farmerName: string | null;
  cropName: string;
  acceptedQuantityKg: string;
  netAmount: string;
  status: PaymentStatus;
  isDemo: boolean;
  createdAt: string;
}

/** For the Government dashboard phase (§43, §44). Every figure is a count or sum of rows. */
export interface PaymentSummary {
  scope: 'DISTRICT' | 'STATE';
  centreCount: number;
  paymentCount: number;
  byStatus: Record<PaymentStatus, number>;
  totalProcurementValue: string;
  totalPaid: string;
  totalPending: string;
  successRate: number | null;
  averageProcessingSeconds: number | null;
  medianProcessingSeconds: number | null;
  totalRetries: number;
  failuresByReason: Array<{ code: string; count: number }>;
  centreExceptions: Array<{ centreId: string; centreName: string; failed: number; stuck: number }>;
  valueByCrop: Array<{ crop: string; value: string }>;
  demoPayments: number;
}
