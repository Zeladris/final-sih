import {
  DOCUMENT_STATUSES,
  REGISTRATION_STEPS,
  documentNeedsAction,
} from '@kisansetu/shared';
import type {
  DocumentRequirement,
  FarmerDocument,
  FarmerProfile,
  LandHolding,
  Profile,
  RegistrationStep,
} from '@kisansetu/shared';

/**
 * Which registration steps are satisfied, and whether the whole thing may be
 * submitted (§19, §22).
 *
 * This is pure and shares no state with the database, so the same rules can be
 * unit-tested exhaustively and reused by the review screen, the progress
 * indicator and the submit guard without drifting apart.
 *
 * Blocking reasons are returned as i18n KEYS, never as English sentences —
 * the farmer may be reading the app in Tamil (§4).
 */

export interface CompletenessInput {
  profile: Profile;
  farmer: FarmerProfile;
  landHoldings: LandHolding[];
  documents: FarmerDocument[];
  requirements: DocumentRequirement[];
}

export interface CompletenessResult {
  completedSteps: RegistrationStep[];
  canSubmit: boolean;
  blockingReasons: string[];
}

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim().length === 0;

function personalDetailsComplete(input: CompletenessInput): boolean {
  return !isBlank(input.profile.fullName) && !isBlank(input.farmer.dateOfBirth);
}

function addressComplete(input: CompletenessInput): boolean {
  const { farmer } = input;
  return (
    !isBlank(farmer.village) &&
    !isBlank(farmer.pincode) &&
    farmer.districtId !== null &&
    farmer.stateId !== null
  );
}

function landComplete(input: CompletenessInput): boolean {
  return input.landHoldings.length > 0;
}

/** A live document of this kind that has not been rejected or sent back. */
function hasUsableDocument(documents: FarmerDocument[], kind: string): boolean {
  return documents.some(
    (document) => document.documentKind === kind && !documentNeedsAction(document.status),
  );
}

function requiredKinds(requirements: DocumentRequirement[], includePhoto: boolean): string[] {
  return requirements
    .filter((requirement) => requirement.isRequired)
    .filter((requirement) =>
      includePhoto
        ? requirement.documentKind === 'FARMER_PHOTO'
        : requirement.documentKind !== 'FARMER_PHOTO',
    )
    .map((requirement) => requirement.documentKind);
}

function documentsComplete(input: CompletenessInput): boolean {
  return requiredKinds(input.requirements, false).every((kind) =>
    hasUsableDocument(input.documents, kind),
  );
}

/** The photo step is skipped entirely when policy does not require one (§15). */
export function photoRequired(requirements: DocumentRequirement[]): boolean {
  return requirements.some(
    (requirement) => requirement.documentKind === 'FARMER_PHOTO' && requirement.isRequired,
  );
}

function photoComplete(input: CompletenessInput): boolean {
  if (!photoRequired(input.requirements)) return true;
  return hasUsableDocument(input.documents, 'FARMER_PHOTO');
}

export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const completedSteps: RegistrationStep[] = [];
  const blockingReasons: string[] = [];

  if (personalDetailsComplete(input)) {
    completedSteps.push(REGISTRATION_STEPS.PERSONAL_DETAILS);
  } else {
    blockingReasons.push('registration.blocking.personalDetails');
  }

  if (addressComplete(input)) {
    completedSteps.push(REGISTRATION_STEPS.ADDRESS);
  } else {
    blockingReasons.push('registration.blocking.address');
  }

  if (landComplete(input)) {
    completedSteps.push(REGISTRATION_STEPS.LAND_DETAILS);
  } else {
    blockingReasons.push('registration.blocking.land');
  }

  if (documentsComplete(input)) {
    completedSteps.push(REGISTRATION_STEPS.DOCUMENTS);
  } else {
    blockingReasons.push('registration.blocking.documents');
  }

  if (photoComplete(input)) {
    completedSteps.push(REGISTRATION_STEPS.PHOTO);
  } else {
    blockingReasons.push('registration.blocking.photo');
  }

  // A document a reviewer sent back blocks resubmission even when every other
  // requirement is satisfied — otherwise a farmer could resubmit unchanged.
  const needsAttention = input.documents.filter((document) => documentNeedsAction(document.status));
  if (needsAttention.length > 0) {
    blockingReasons.push('registration.blocking.documentsNeedReplacement');
  }

  const rejectedLand = input.landHoldings.filter(
    (holding) => holding.verificationStatus === 'REJECTED',
  );
  if (rejectedLand.length > 0) {
    blockingReasons.push('registration.blocking.landNeedsCorrection');
  }

  return {
    completedSteps,
    canSubmit: blockingReasons.length === 0,
    blockingReasons,
  };
}

/**
 * Where a resumed session should land (§21).
 *
 * The first incomplete step, or REVIEW when everything is satisfied. Preferring
 * the stored `current_step` when it is still incomplete keeps a farmer where
 * they left off rather than jumping them backwards.
 */
export function resolveResumeStep(
  input: CompletenessInput,
  completedSteps: RegistrationStep[],
): RegistrationStep {
  const photoNeeded = photoRequired(input.requirements);

  const sequence: RegistrationStep[] = [
    REGISTRATION_STEPS.PERSONAL_DETAILS,
    REGISTRATION_STEPS.ADDRESS,
    REGISTRATION_STEPS.LAND_DETAILS,
    REGISTRATION_STEPS.DOCUMENTS,
    ...(photoNeeded ? [REGISTRATION_STEPS.PHOTO] : []),
  ];

  const stored = input.farmer.currentStep;
  if (sequence.includes(stored) && !completedSteps.includes(stored)) {
    return stored;
  }

  const firstIncomplete = sequence.find((step) => !completedSteps.includes(step));
  return firstIncomplete ?? REGISTRATION_STEPS.REVIEW;
}

/** Documents the farmer must act on, for the status screen (§20). */
export function actionableDocuments(documents: FarmerDocument[]): FarmerDocument[] {
  return documents.filter((document) => documentNeedsAction(document.status));
}

export const DOCUMENT_STATUS_VALUES = DOCUMENT_STATUSES;
