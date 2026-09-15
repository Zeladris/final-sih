/**
 * Procurement centre operations (Phase 5).
 *
 * Four distinct concepts, kept distinct (§9, §37):
 *   slot         a published appointment window
 *   booking      a farmer's reservation for one
 *   session      one day's operations at a centre
 *   procurement  the completed purchase
 */

// ---------------------------------------------------------------------------
// Session lifecycle (§10)
// ---------------------------------------------------------------------------

export const SESSION_STATUSES = {
  SCHEDULED: 'SCHEDULED',
  OPEN: 'OPEN',
  PROCESSING: 'PROCESSING',
  CLOSING: 'CLOSING',
  CLOSED: 'CLOSED',
} as const;

export type SessionStatus = (typeof SESSION_STATUSES)[keyof typeof SESSION_STATUSES];

export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  SCHEDULED: ['OPEN', 'CLOSED'],
  OPEN: ['PROCESSING', 'CLOSING'],
  PROCESSING: ['CLOSING'],
  // A day can be reopened from CLOSING if work turns up; CLOSED is final.
  CLOSING: ['CLOSED', 'PROCESSING'],
  CLOSED: [],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

/** A session that can accept operational work. */
export function sessionIsActive(status: SessionStatus): boolean {
  return status === 'OPEN' || status === 'PROCESSING';
}

// ---------------------------------------------------------------------------
// Slots (§14)
// ---------------------------------------------------------------------------

export const SLOT_STATUSES = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  FULL: 'FULL',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;

export type SlotStatus = (typeof SLOT_STATUSES)[keyof typeof SLOT_STATUSES];

export const ALL_SLOT_STATUSES: readonly SlotStatus[] = Object.values(SLOT_STATUSES);

export interface ProcurementSlot {
  id: string;
  centreId: string;
  /** Calendar date, "YYYY-MM-DD", in the business timezone. */
  slotDate: string;
  /** Local wall clock, "HH:MM". */
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  remainingCapacity: number;
  status: SlotStatus;
  /** True when capacity is reached — derived, never stored (§14). */
  isFull: boolean;
}

// ---------------------------------------------------------------------------
// Bookings and the operational lifecycle (§16, §23)
// ---------------------------------------------------------------------------

export const BOOKING_STATUSES = {
  BOOKED: 'BOOKED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
} as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[keyof typeof BOOKING_STATUSES];

/**
 * The single source of truth for where a booking is in the centre workflow.
 *
 * One field, not several: competing status columns are how a record ends up
 * simultaneously "weighed" and "awaiting arrival" (§23).
 */
export const OPERATION_STATES = {
  BOOKED: 'BOOKED',
  ARRIVED: 'ARRIVED',
  CHECKED_IN: 'CHECKED_IN',
  WAITING: 'WAITING',
  QUALITY_CHECK: 'QUALITY_CHECK',
  WEIGHING: 'WEIGHING',
  PROCUREMENT: 'PROCUREMENT',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

export type OperationState = (typeof OPERATION_STATES)[keyof typeof OPERATION_STATES];

/**
 * The happy path, in order. Used for progress display.
 *
 * Quality is checked BEFORE the queue (Phase 7): the queue ranks farmers
 * whose quality outcome and processing estimate are already known. WAITING is
 * the queue; leaving it for WEIGHING is "start procurement".
 */
export const OPERATION_SEQUENCE: readonly OperationState[] = [
  'BOOKED',
  'ARRIVED',
  'CHECKED_IN',
  'QUALITY_CHECK',
  'WAITING',
  'WEIGHING',
  'PROCUREMENT',
  'PAYMENT_PENDING',
  'COMPLETED',
];

/** Mirrors app.assert_operation_transition() in migration 0015. */
export const OPERATION_TRANSITIONS: Record<OperationState, readonly OperationState[]> = {
  BOOKED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['CHECKED_IN', 'ON_HOLD', 'CANCELLED'],
  CHECKED_IN: ['QUALITY_CHECK', 'ON_HOLD', 'REJECTED'],
  QUALITY_CHECK: ['WAITING', 'REJECTED', 'ON_HOLD'],
  WAITING: ['WEIGHING', 'ON_HOLD', 'REJECTED'],
  WEIGHING: ['PROCUREMENT', 'ON_HOLD', 'REJECTED'],
  // Phase 8: completion only through a successful payment.
  PROCUREMENT: ['PAYMENT_PENDING'],
  PAYMENT_PENDING: ['COMPLETED'],
  COMPLETED: [],
  // A held record returns to where it can continue; an operator decides.
  ON_HOLD: ['WAITING', 'CHECKED_IN', 'QUALITY_CHECK', 'REJECTED', 'CANCELLED'],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionOperation(from: OperationState, to: OperationState): boolean {
  return OPERATION_TRANSITIONS[from].includes(to);
}

/** States where the farmer is physically at the centre awaiting work. */
export function isInProgress(state: OperationState): boolean {
  return (
    state !== 'BOOKED' &&
    state !== 'COMPLETED' &&
    state !== 'CANCELLED' &&
    state !== 'REJECTED'
  );
}

export function operationStep(state: OperationState): number {
  const index = OPERATION_SEQUENCE.indexOf(state);
  return index === -1 ? 0 : index;
}

export const QUALITY_RESULTS = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  CONDITIONAL: 'CONDITIONAL',
} as const;

export type QualityResult = (typeof QUALITY_RESULTS)[keyof typeof QUALITY_RESULTS];

/** A failure or conditional pass must be explained (§21). */
export function qualityRequiresRemarks(result: QualityResult): boolean {
  return result !== QUALITY_RESULTS.PASSED;
}

export const MIN_REMARKS_LENGTH = 5;

// ---------------------------------------------------------------------------
// Payment (§29)
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = {
  PENDING: 'PENDING',
  INITIATED: 'INITIATED',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  RETRY_PENDING: 'RETRY_PENDING',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

export function paymentIsSettled(status: PaymentStatus): boolean {
  return status === 'SUCCESS';
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ProcurementSession {
  id: string;
  centreId: string;
  sessionDate: string;
  status: SessionStatus;
  openedAt: string | null;
  closedAt: string | null;
}

export interface OperationalBooking {
  bookingId: string;
  bookingReference: string;
  farmerUserId: string;
  farmerName: string | null;
  farmerReferenceId: string | null;
  village: string | null;
  crop: string;
  expectedQuantityKg: number;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
  bookingStatus: BookingStatus;

  /** Null until the booking enters a session. */
  operationId: string | null;
  state: OperationState;
  arrivedAt: string | null;
  checkedInAt: string | null;
  claimedByName: string | null;
  claimedByMe: boolean;
  cropVerified: boolean | null;
  cropIssue: string | null;
  queuePosition: number | null;

  qualityResult: QualityResult | null;
  qualityRemarks: string | null;
  /** Received at the scale. */
  actualQuantityKg: number | null;
  /** Rejected at weighing; accepted = received − rejected (Phase 8 §2). */
  rejectedQuantityKg: number | null;
  acceptedQuantityKg: number | null;

  procurementId: string | null;
  procurementReference: string | null;
  /** Exact decimal string. */
  totalValue: string | null;
  paymentId: string | null;
  paymentReference: string | null;
  paymentStatus: PaymentStatus | null;
  paymentIsDemo: boolean | null;
}

/** Today's counts, all from real rows (§3 priority 2). */
export interface SessionWorkload {
  expected: number;
  arrived: number;
  waiting: number;
  processing: number;
  completed: number;
  paymentPending: number;
  slotCount: number;
  capacityRemaining: number;
}

/** The MSP rate the server resolved for a procurement (Phase 8 §9). */
export interface ProcurementRate {
  mspRateId: string;
  cropId: string;
  /** Exact decimal string, per kg — the unit every calculation uses. */
  ratePerKg: string;
  ratePerQuintal: string;
  /** CONFIGURED means an operator entered it — not a government feed (§27). */
  source: string;
  sourceReference: string | null;
  effectiveFrom: string;
}

export interface ProcurementRecord {
  id: string;
  procurementReference: string;
  bookingReference: string;
  farmerName: string | null;
  crop: string;
  quantityKg: number;
  ratePerKg: number;
  totalValue: number;
  rateSource: string;
  confirmedAt: string;
  paymentStatus: PaymentStatus | null;
  paymentProvider: string | null;
}
