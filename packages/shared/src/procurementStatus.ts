import type { BookingStatus, OperationState } from './operations.js';

/**
 * The farmer-facing procurement status (Phase 6).
 *
 * NOT a second source of truth. The authoritative state is the Phase 5
 * operational state (`booking_operations.state`) plus the booking's own status;
 * this is a projection of the two onto words a farmer understands. The same
 * mapping lives in SQL as `app.farmer_status()` — change both together.
 *
 * ORDER (§33). The centre verifies the produce first and then queues the
 * farmer, so the journey reads Arrived → Pre-procurement check → In queue →
 * Procurement. The AI's pre-arrival assessment is NOT a step here: it happens
 * during booking and is information the check uses, not a state (§28).
 */

export const FARMER_STATUSES = {
  SLOT_BOOKED: 'SLOT_BOOKED',
  ARRIVED: 'ARRIVED',
  IN_QUEUE: 'IN_QUEUE',
  PRE_PROCUREMENT_CHECK: 'PRE_PROCUREMENT_CHECK',
  PROCUREMENT: 'PROCUREMENT',
  PAYMENT: 'PAYMENT',
  COMPLETED: 'COMPLETED',
  /** Paused at the centre; staff decide the next step. */
  ON_HOLD: 'ON_HOLD',
  /** The produce did not pass the centre's check. */
  NOT_ACCEPTED: 'NOT_ACCEPTED',
  CANCELLED: 'CANCELLED',
  /** The farmer did not come for their slot. */
  MISSED: 'MISSED',
} as const;

export type FarmerProcurementStatus = (typeof FARMER_STATUSES)[keyof typeof FARMER_STATUSES];

/** The journey, in order. The timeline renders exactly these steps. */
export const FARMER_STATUS_SEQUENCE: readonly FarmerProcurementStatus[] = [
  'SLOT_BOOKED',
  'ARRIVED',
  'PRE_PROCUREMENT_CHECK',
  'IN_QUEUE',
  'PROCUREMENT',
  'PAYMENT',
  'COMPLETED',
];

/** Where the journey ends. Nothing moves out of these. */
export const TERMINAL_FARMER_STATUSES: readonly FarmerProcurementStatus[] = [
  'COMPLETED',
  'NOT_ACCEPTED',
  'CANCELLED',
  'MISSED',
];

export function isTerminalFarmerStatus(status: FarmerProcurementStatus): boolean {
  return TERMINAL_FARMER_STATUSES.includes(status);
}

/** The farmer is at the centre and something is happening to their produce. */
export function isActiveFarmerStatus(status: FarmerProcurementStatus): boolean {
  return status !== 'SLOT_BOOKED' && !isTerminalFarmerStatus(status);
}

/**
 * Allowed farmer-facing transitions (§4).
 *
 * Derived from the operational machine, not independent of it: every edge
 * here corresponds to at least one edge in OPERATION_TRANSITIONS.
 */
export const FARMER_STATUS_TRANSITIONS: Record<
  FarmerProcurementStatus,
  readonly FarmerProcurementStatus[]
> = {
  SLOT_BOOKED: ['ARRIVED', 'CANCELLED', 'MISSED'],
  ARRIVED: ['PRE_PROCUREMENT_CHECK', 'ON_HOLD', 'CANCELLED', 'NOT_ACCEPTED'],
  PRE_PROCUREMENT_CHECK: ['IN_QUEUE', 'ON_HOLD', 'NOT_ACCEPTED'],
  IN_QUEUE: ['PROCUREMENT', 'ON_HOLD', 'NOT_ACCEPTED'],
  // Phase 8: a procurement completes only through a successful payment.
  PROCUREMENT: ['PAYMENT', 'ON_HOLD', 'NOT_ACCEPTED'],
  PAYMENT: ['COMPLETED'],
  ON_HOLD: ['ARRIVED', 'PRE_PROCUREMENT_CHECK', 'IN_QUEUE', 'NOT_ACCEPTED', 'CANCELLED'],
  COMPLETED: [],
  NOT_ACCEPTED: [],
  CANCELLED: [],
  MISSED: [],
};

export function canTransitionFarmerStatus(
  from: FarmerProcurementStatus,
  to: FarmerProcurementStatus,
): boolean {
  return FARMER_STATUS_TRANSITIONS[from].includes(to);
}

/** The projection. Mirrors `app.farmer_status()` in migration 0014. */
export function farmerStatusOf(
  bookingStatus: BookingStatus,
  state: OperationState | null,
): FarmerProcurementStatus {
  if (bookingStatus === 'CANCELLED') return 'CANCELLED';
  if (bookingStatus === 'NO_SHOW') return 'MISSED';

  switch (state) {
    case null:
    case 'BOOKED':
      return 'SLOT_BOOKED';
    case 'ARRIVED':
    case 'CHECKED_IN':
      return 'ARRIVED';
    case 'WAITING':
      return 'IN_QUEUE';
    // The operational step is still QUALITY_CHECK; what the farmer is shown is
    // the pre-procurement check the staff member is performing (§28, §33).
    case 'QUALITY_CHECK':
      return 'PRE_PROCUREMENT_CHECK';
    case 'WEIGHING':
    case 'PROCUREMENT':
      return 'PROCUREMENT';
    case 'PAYMENT_PENDING':
      return 'PAYMENT';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'REJECTED':
      return 'NOT_ACCEPTED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export type TimelineStepState = 'DONE' | 'CURRENT' | 'UPCOMING';

export interface StatusTimelineStep {
  status: FarmerProcurementStatus;
  state: TimelineStepState;
  /** When the step was first reached, from recorded history. Never inferred. */
  reachedAt: string | null;
}

/** GET /api/farmer/bookings/:bookingId/status */
export interface FarmerBookingStatus {
  bookingId: string;
  bookingReference: string;
  /** Null until the centre confirms the purchase. Never the booking reference. */
  procurementReference: string | null;
  status: FarmerProcurementStatus;
  /**
   * Explanation shown to the farmer, only where they are owed one: why a
   * booking was cancelled or why produce was not accepted.
   */
  reason: string | null;

  /** Phase 7 contract (§20). Null until the queue module publishes real figures. */
  queuePosition: number | null;
  estimatedWaitMinutes: number | null;
  queueUpdatedAt: string | null;

  /**
   * The 4-digit code to read aloud to centre staff on arrival — this
   * farmer's own booking only, never anyone else's, and never sent to staff.
   * Null once arrival is already confirmed (nothing left to show) or the
   * booking can no longer be arrived at (cancelled/completed/no-show).
   */
  arrivalCode: string | null;

  centreName: string;
  centreVillage: string | null;
  cropName: string;
  cropNameTa: string | null;
  expectedQuantity: number;
  quantityUnit: string;
  slotDate: string;
  slotStart: string;
  slotEnd: string;

  /** The real time of the last farmer-visible change. */
  updatedAt: string;
  /** Monotonic; a client applies only a strictly newer version (§17). */
  version: number;
  timeline: StatusTimelineStep[];
}

export interface StatusHistoryEntry {
  id: number;
  fromStatus: FarmerProcurementStatus | null;
  status: FarmerProcurementStatus;
  /** Role only. Which staff member acted is not the farmer's concern. */
  changedByRole: string;
  reason: string | null;
  createdAt: string;
  /** Reconstructed from existing records when history began (migration 0014). */
  backfilled: boolean;
}

/** POST /api/staff/me/bookings/:bookingId/status */
export interface StaffStatusTransitionRequest {
  status: FarmerProcurementStatus;
}

/**
 * Builds the timeline from the current status and recorded history.
 *
 * A step is DONE if the journey has passed it, CURRENT if it is where the
 * farmer is now. For an exit status (cancelled, not accepted, on hold) the
 * steps actually reached stay DONE and nothing is marked current — the exit is
 * shown separately rather than pretending it is a step on the journey.
 */
export function buildTimeline(
  status: FarmerProcurementStatus,
  reached: ReadonlyMap<FarmerProcurementStatus, string>,
): StatusTimelineStep[] {
  const currentIndex = FARMER_STATUS_SEQUENCE.indexOf(status);

  const furthestReached = FARMER_STATUS_SEQUENCE.reduce(
    (furthest, step, index) => (reached.has(step) ? index : furthest),
    0,
  );

  return FARMER_STATUS_SEQUENCE.map((step, index): StatusTimelineStep => {
    let state: TimelineStepState;

    if (currentIndex !== -1) {
      state =
        index < currentIndex ? 'DONE' : index === currentIndex ? 'CURRENT' : 'UPCOMING';
      // The journey is over once completed; its last step is done, not "current".
      if (status === 'COMPLETED' && index === currentIndex) state = 'DONE';
    } else {
      state = index <= furthestReached ? 'DONE' : 'UPCOMING';
    }

    return { status: step, state, reachedAt: reached.get(step) ?? null };
  });
}
