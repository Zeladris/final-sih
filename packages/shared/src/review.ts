import type { RegistrationStatus } from './registration.js';
import type { FarmerDocument, LandHolding, VerificationCheck } from './models.js';
import type { Gender } from './status.js';
import type { SectionStatus } from './dashboard.js';
import type {
  OperationalBooking,
  ProcurementSession,
  ProcurementSlot,
  SessionWorkload,
} from './operations.js';

/**
 * Farmer verification review (Phase 5; moved to the District Admin in
 * Phase 14 — see apps/api/src/controllers/districtVerificationController.ts).
 *
 * The decision vocabulary a reviewer uses is deliberately NOT a new status
 * enum — each maps onto the Phase 1 registration state machine (§18), so
 * there is one source of truth for what a registration is.
 */

export const REVIEW_DECISIONS = {
  /** Information and documents satisfy the requirements. */
  APPROVE: 'APPROVE',
  /** Something must be fixed or replaced; the farmer can resubmit. */
  REQUEST_CORRECTION: 'REQUEST_CORRECTION',
  /** The submission is not acceptable for registration. */
  REJECT: 'REJECT',
} as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[keyof typeof REVIEW_DECISIONS];

/** Where each decision lands in the Phase 1 state machine. */
export const DECISION_OUTCOME: Record<ReviewDecision, RegistrationStatus> = {
  APPROVE: 'VERIFIED',
  REQUEST_CORRECTION: 'RESUBMISSION_REQUIRED',
  REJECT: 'REJECTED',
};

/** A reason is mandatory for anything other than approval (§15). */
export function decisionRequiresReason(decision: ReviewDecision): boolean {
  return decision !== REVIEW_DECISIONS.APPROVE;
}

export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 1000;

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export interface VerificationQueueItem {
  farmerUserId: string;
  farmerReferenceId: string;
  name: string | null;
  village: string | null;
  primaryCrop: string | null;
  landAreaAcres: number | null;
  submittedAt: string | null;
  registrationStatus: RegistrationStatus;
  documentCount: number;
  /** Set while another reviewer holds the review (§19). */
  reviewStartedAt: string | null;
  reviewStartedByName: string | null;
  /** True when the current caller is the one holding it. */
  claimedByMe: boolean;
  /** Somebody else holds a live claim. Decided on the server, never inferred. */
  heldByAnother: boolean;
  /** Unclaimed, or the claim is abandoned — the caller may start reviewing. */
  canClaim: boolean;
}

/**
 * How long a claim lasts without a decision before another reviewer may take
 * it over (§19). Without this, a reviewer who closes the tab — or whose
 * account is deactivated — leaves a farmer stuck in review indefinitely.
 */
export const REVIEW_CLAIM_STALE_MINUTES = 30;

export interface ReviewClaimState {
  claimedByMe: boolean;
  heldByAnother: boolean;
  canClaim: boolean;
}

/**
 * The one definition of who may act on a review.
 *
 * UNDER_REVIEW with nobody holding it is NOT "held by another": it is what a
 * release, a deleted staff account, or a pre-claim registration leaves behind,
 * and treating it as held would lock the record forever.
 */
export function reviewClaimState(
  status: RegistrationStatus,
  holderId: string | null,
  claimedAt: string | null,
  callerId: string,
  now: Date = new Date(),
): ReviewClaimState {
  const claimedByMe = holderId !== null && holderId === callerId;

  if (status === 'SUBMITTED') {
    return { claimedByMe: false, heldByAnother: false, canClaim: true };
  }
  if (status !== 'UNDER_REVIEW' || claimedByMe) {
    return { claimedByMe, heldByAnother: false, canClaim: false };
  }
  if (holderId === null) {
    return { claimedByMe: false, heldByAnother: false, canClaim: true };
  }

  const ageMs = claimedAt ? now.getTime() - new Date(claimedAt).getTime() : Infinity;
  const stale = ageMs >= REVIEW_CLAIM_STALE_MINUTES * 60_000;
  return { claimedByMe: false, heldByAnother: !stale, canClaim: stale };
}

export interface VerificationQueue {
  status: SectionStatus;
  items: VerificationQueueItem[];
  awaitingReview: number;
  inReview: number;
}

// ---------------------------------------------------------------------------
// Review detail
// ---------------------------------------------------------------------------

export interface ReviewFarmerDetail {
  farmerUserId: string;
  farmerReferenceId: string;
  name: string | null;
  nameLocal: string | null;
  /** Masked for display; staff rarely need the full number (§12). */
  phoneMasked: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  village: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  pincode: string | null;
  districtName: string | null;
  stateName: string | null;
  hasResidenceLocation: boolean;
}

export interface ReviewSubmission {
  farmer: ReviewFarmerDetail;
  landHoldings: LandHolding[];
  documents: FarmerDocument[];
  checks: VerificationCheck[];
  registrationStatus: RegistrationStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  /** Review ownership, so the UI can warn before a second reviewer starts. */
  reviewStartedAt: string | null;
  reviewStartedByName: string | null;
  claimedByMe: boolean;
  heldByAnother: boolean;
  canClaim: boolean;
  /** False when somebody else holds it, or it is no longer reviewable. */
  canDecide: boolean;
}

// ---------------------------------------------------------------------------
// Staff dashboard
// ---------------------------------------------------------------------------

export interface StaffCentreSummary {
  centreId: string;
  centreCode: string;
  centreName: string;
  districtName: string;
  stateName: string;
  village: string | null;
  openTime: string | null;
  closeTime: string | null;
  dailyCapacityQtl: number | null;
}

/**
 * The staff dashboard (Phase 14: verification removed entirely — see the
 * module comment in apps/api/src/services/staff/staffDashboardService.ts).
 *
 * Ordered by operational priority (§3): session, workload, who is being
 * processed, what is next, what needs action.
 */
export interface StaffDashboardResponse {
  staff: {
    name: string | null;
    employeeReferenceId: string;
    designation: string | null;
  };
  centre: StaffCentreSummary;

  session: ProcurementSession;
  workload: SessionWorkload;

  /** The farmer currently being processed, if any. */
  nowProcessing: OperationalBooking | null;
  /** Next few farmers in queue order. */
  queueAhead: OperationalBooking[];

  slots: {
    today: ProcurementSlot[];
    tomorrow: ProcurementSlot[];
    tomorrowDate: string;
  };

  actionRequired: {
    awaitingArrival: number;
    qualityPending: number;
    weighingPending: number;
    paymentPending: number;
  };

  /** Provenance, so the UI can be honest about what is and is not real. */
  providers: {
    rateSource: string;
    paymentProvider: string;
    paymentIsReal: boolean;
  };
}

/**
 * Statuses that belong in the active queue (§11).
 *
 * Verified and rejected registrations drop out — they need no staff action.
 */
export const QUEUE_STATUSES: readonly RegistrationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

export function isQueueStatus(status: RegistrationStatus): boolean {
  return QUEUE_STATUSES.includes(status);
}
