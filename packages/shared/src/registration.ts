/**
 * The farmer registration state machine (§33) and its step sequence (§6).
 *
 * This module is the single definition of which transitions are legal. The
 * database enforces the same table in `app.assert_registration_transition()`;
 * the two must stay in step, and `registrationStateMachine.test.ts` is what
 * keeps them honest.
 */

export const REGISTRATION_STATUSES = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  RESUBMISSION_REQUIRED: 'RESUBMISSION_REQUIRED',
} as const;

export type RegistrationStatus =
  (typeof REGISTRATION_STATUSES)[keyof typeof REGISTRATION_STATUSES];

export const ALL_REGISTRATION_STATUSES: readonly RegistrationStatus[] =
  Object.values(REGISTRATION_STATUSES);

/** Legal transitions. Anything not listed here is refused, in both layers. */
export const ALLOWED_TRANSITIONS: Record<RegistrationStatus, readonly RegistrationStatus[]> = {
  DRAFT: ['SUBMITTED'],
  // SUBMITTED can fall back to DRAFT if a farmer withdraws before review starts.
  SUBMITTED: ['UNDER_REVIEW', 'DRAFT'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED'],
  RESUBMISSION_REQUIRED: ['DRAFT'],
  REJECTED: ['DRAFT'],
  // Terminal. Re-opening a verified registration is an administrative act
  // that will get its own explicit path if it is ever needed.
  VERIFIED: [],
};

export function canTransition(from: RegistrationStatus, to: RegistrationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** States in which the farmer may still edit their own information (§19). */
export const EDITABLE_STATUSES: readonly RegistrationStatus[] = [
  REGISTRATION_STATUSES.DRAFT,
  REGISTRATION_STATUSES.RESUBMISSION_REQUIRED,
  REGISTRATION_STATUSES.REJECTED,
];

export function isEditable(status: RegistrationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** States where the farmer is waiting on somebody else. */
export function isAwaitingReview(status: RegistrationStatus): boolean {
  return (
    status === REGISTRATION_STATUSES.SUBMITTED || status === REGISTRATION_STATUSES.UNDER_REVIEW
  );
}

/** States that need the farmer to do something (§20). */
export function needsFarmerAction(status: RegistrationStatus): boolean {
  return (
    status === REGISTRATION_STATUSES.REJECTED ||
    status === REGISTRATION_STATUSES.RESUBMISSION_REQUIRED
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const REGISTRATION_STEPS = {
  PERSONAL_DETAILS: 'PERSONAL_DETAILS',
  ADDRESS: 'ADDRESS',
  LAND_DETAILS: 'LAND_DETAILS',
  DOCUMENTS: 'DOCUMENTS',
  PHOTO: 'PHOTO',
  REVIEW: 'REVIEW',
} as const;

export type RegistrationStep = (typeof REGISTRATION_STEPS)[keyof typeof REGISTRATION_STEPS];

/** The order the farmer walks through them (§6). */
export const STEP_SEQUENCE: readonly RegistrationStep[] = [
  REGISTRATION_STEPS.PERSONAL_DETAILS,
  REGISTRATION_STEPS.ADDRESS,
  REGISTRATION_STEPS.LAND_DETAILS,
  REGISTRATION_STEPS.DOCUMENTS,
  REGISTRATION_STEPS.PHOTO,
  REGISTRATION_STEPS.REVIEW,
];

/** Route segment for each step, so links and resume share one definition. */
export const STEP_PATH: Record<RegistrationStep, string> = {
  PERSONAL_DETAILS: 'personal',
  ADDRESS: 'address',
  LAND_DETAILS: 'land',
  DOCUMENTS: 'documents',
  PHOTO: 'photo',
  REVIEW: 'review',
};

export const STEP_BY_PATH: Record<string, RegistrationStep> = Object.fromEntries(
  Object.entries(STEP_PATH).map(([step, path]) => [path, step as RegistrationStep]),
) as Record<string, RegistrationStep>;

export function stepIndex(step: RegistrationStep): number {
  return STEP_SEQUENCE.indexOf(step);
}

export function nextStep(step: RegistrationStep): RegistrationStep | null {
  const index = stepIndex(step);
  return index >= 0 && index < STEP_SEQUENCE.length - 1
    ? (STEP_SEQUENCE[index + 1] as RegistrationStep)
    : null;
}

export function previousStep(step: RegistrationStep): RegistrationStep | null {
  const index = stepIndex(step);
  return index > 0 ? (STEP_SEQUENCE[index - 1] as RegistrationStep) : null;
}

/** Progress presentation (§22) without leaking technical state names. */
export type StepState = 'complete' | 'current' | 'upcoming';

export function stepStateFor(
  step: RegistrationStep,
  currentStep: RegistrationStep,
  completedSteps: readonly RegistrationStep[],
): StepState {
  if (step === currentStep) return 'current';
  if (completedSteps.includes(step)) return 'complete';
  return 'upcoming';
}
