import type { RegistrationStatus, RegistrationStep } from './registration.js';
import { REGISTRATION_STATUSES, STEP_SEQUENCE } from './registration.js';

/**
 * What a farmer's account needs from them right now (§11–§14).
 *
 * The server derives this; the client only maps it to a route. That ordering
 * matters: the frontend must never decide a user is a verified farmer from a
 * value it holds locally.
 */
export const FARMER_ACCOUNT_STATES = {
  /** Authenticated, but no farmer profile exists yet — send to registration. */
  NO_PROFILE: 'NO_PROFILE',
  /** Started registration and left before submitting — resume it. */
  REGISTRATION_INCOMPLETE: 'REGISTRATION_INCOMPLETE',
  /** Submitted or being reviewed — show status, nothing to do. */
  AWAITING_REVIEW: 'AWAITING_REVIEW',
  /** Rejected or sent back — show what to fix. */
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  /** Verified — the farmer experience proper. */
  VERIFIED: 'VERIFIED',
} as const;

export type FarmerAccountState =
  (typeof FARMER_ACCOUNT_STATES)[keyof typeof FARMER_ACCOUNT_STATES];

/**
 * Maps a persisted registration status onto the account state.
 *
 * `DRAFT` is deliberately "incomplete" rather than "not started": a farmer who
 * saved two sections and closed the app has a DRAFT, and telling them to start
 * over would be wrong (§12).
 */
export function accountStateFor(
  registrationStatus: RegistrationStatus | null,
): FarmerAccountState {
  if (registrationStatus === null) return FARMER_ACCOUNT_STATES.NO_PROFILE;

  switch (registrationStatus) {
    case REGISTRATION_STATUSES.DRAFT:
      return FARMER_ACCOUNT_STATES.REGISTRATION_INCOMPLETE;
    case REGISTRATION_STATUSES.SUBMITTED:
    case REGISTRATION_STATUSES.UNDER_REVIEW:
      return FARMER_ACCOUNT_STATES.AWAITING_REVIEW;
    case REGISTRATION_STATUSES.REJECTED:
    case REGISTRATION_STATUSES.RESUBMISSION_REQUIRED:
      return FARMER_ACCOUNT_STATES.ACTION_REQUIRED;
    case REGISTRATION_STATUSES.VERIFIED:
      return FARMER_ACCOUNT_STATES.VERIFIED;
    default:
      return FARMER_ACCOUNT_STATES.NO_PROFILE;
  }
}

/**
 * Where each state sends the farmer after login (§14).
 *
 * Kept next to the state definition so adding a state forces a decision about
 * where it goes, rather than falling through to a dashboard by accident.
 */
/**
 * Where each state sends the farmer after login (§5).
 *
 * Every state that HAS a registration lands on the dashboard, which carries a
 * verification status card and the right next action. Only an unfinished
 * registration routes elsewhere, because a half-filled form is the one case
 * where the dashboard has nothing useful to say.
 *
 * (This supersedes the Phase 2 routing, which sent submitted and
 * action-required farmers straight to the status page. Phase 3 §5 and §9 make
 * the dashboard the landing page for all of them; the status page remains for
 * the detail view.)
 */
export const FARMER_ACCOUNT_DESTINATION: Record<FarmerAccountState, string> = {
  NO_PROFILE: '/farmer/registration/start',
  REGISTRATION_INCOMPLETE: '/farmer/welcome',
  AWAITING_REVIEW: '/farmer/dashboard',
  ACTION_REQUIRED: '/farmer/dashboard',
  VERIFIED: '/farmer/dashboard',
};

/** Steps still outstanding, honouring a policy that switches the photo off. */
export function remainingSteps(
  completedSteps: readonly RegistrationStep[],
  photoRequired: boolean,
): RegistrationStep[] {
  return STEP_SEQUENCE.filter(
    (step) =>
      (photoRequired || step !== 'PHOTO') &&
      step !== 'REVIEW' &&
      !completedSteps.includes(step),
  );
}

/**
 * The farmer account summary returned by GET /api/auth/me (§21).
 *
 * Present only for FARMER accounts; other roles have no registration.
 */
export interface FarmerAccountSummary {
  state: FarmerAccountState;
  registrationStatus: RegistrationStatus | null;
  /** Where a resumed registration should continue. Null once submitted. */
  resumeStep: RegistrationStep | null;
  completedSteps: RegistrationStep[];
  remainingSteps: RegistrationStep[];
  photoRequired: boolean;
  submittedAt: string | null;
  verifiedAt: string | null;
}
