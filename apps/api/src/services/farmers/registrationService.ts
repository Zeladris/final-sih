import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ALL_VERIFICATION_CHECK_TYPES,
  REGISTRATION_STATUSES,
  ROLES,
  canTransition,
  isEditable,
} from '@kisansetu/shared';
import type {
  Gender,
  Language,
  RegistrationStatus,
  RegistrationStep,
  RegistrationView,
  VerificationStatusView,
} from '@kisansetu/shared';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import {
  findProfileById,
  insertProfile,
  updateProfile,
} from '../../repositories/profilesRepository.js';
import {
  findFarmerProfile,
  insertFarmerProfile,
  updateFarmerProfile,
  updateRegistrationStatus,
} from '../../repositories/farmersRepository.js';
import { findDistrictById } from '../../repositories/centresRepository.js';
import { listLandHoldings } from '../../repositories/landRepository.js';
import { listDocumentsForFarmer } from '../../repositories/documentsRepository.js';
import {
  listDocumentRequirements,
  listVerificationChecks,
  openVerificationChecks,
} from '../../repositories/registrationPolicyRepository.js';
import {
  actionableDocuments,
  evaluateCompleteness,
  photoRequired,
  resolveResumeStep,
} from './registrationCompleteness.js';
import type { CompletenessInput } from './registrationCompleteness.js';

/**
 * Farmer registration (§6, §21, §33).
 *
 * Everything a farmer writes goes through their own RLS-bound client, so the
 * database re-checks ownership and the "locked while under review" rule.
 * Status transitions are the exception: they use the service-role client,
 * because a farmer must never be able to move their own registration (§33).
 */

async function loadInput(db: SupabaseClient, userId: string): Promise<CompletenessInput> {
  const [profile, farmer] = await Promise.all([
    findProfileById(db, userId),
    findFarmerProfile(db, userId),
  ]);

  if (!profile) throw notFound('No profile found for this account.');
  if (!farmer) throw notFound('Registration has not been started for this account.');

  const [landHoldings, documents, requirements] = await Promise.all([
    listLandHoldings(db, userId),
    listDocumentsForFarmer(db, userId),
    listDocumentRequirements(db),
  ]);

  return { profile, farmer, landHoldings, documents, requirements };
}

/** Whether this authenticated identity already has a farmer registration (§10). */
export async function findExistingRegistration(
  db: SupabaseClient,
  userId: string,
): Promise<RegistrationView | null> {
  const profile = await findProfileById(db, userId);
  if (!profile) return null;

  if (profile.role !== ROLES.FARMER) {
    throw forbidden('This account is not a farmer account.');
  }

  const farmer = await findFarmerProfile(db, userId);
  if (!farmer) return null;

  return buildView(db, userId);
}

export async function buildView(db: SupabaseClient, userId: string): Promise<RegistrationView> {
  const input = await loadInput(db, userId);
  const checks = await listVerificationChecks(db, userId);

  const { completedSteps, canSubmit, blockingReasons } = evaluateCompleteness(input);
  const editable = isEditable(input.farmer.registrationStatus);

  return {
    profile: input.profile,
    farmer: input.farmer,
    landHoldings: input.landHoldings,
    documents: input.documents,
    requirements: input.requirements,
    checks,
    completedSteps,
    // Submit is only offered while the registration is actually editable —
    // otherwise a stale tab could re-submit something already under review.
    canSubmit: canSubmit && editable,
    blockingReasons,
    editable,
  };
}

export interface StartRegistrationInput {
  fullName: string;
  preferredLanguage: Language;
}

/**
 * Creates the profile and the farmer registration in DRAFT (§10).
 *
 * The profiles INSERT policy accepts only role = 'FARMER', so this is the one
 * self-service account creation path in the system; government roles are
 * provisioned out of band.
 */
export async function startRegistration(
  db: SupabaseClient,
  userId: string,
  input: StartRegistrationInput,
): Promise<RegistrationView> {
  const existing = await findProfileById(db, userId);
  if (existing) {
    throw conflict('This account is already registered.');
  }

  await insertProfile(db, {
    id: userId,
    role: ROLES.FARMER,
    fullName: input.fullName,
    preferredLanguage: input.preferredLanguage,
  });

  await insertFarmerProfile(db, userId, {});

  return buildView(db, userId);
}

/** Guard shared by every section save: refuse writes once the registration locks. */
async function assertEditable(db: SupabaseClient, userId: string): Promise<void> {
  const farmer = await findFarmerProfile(db, userId);
  if (!farmer) throw notFound('Registration has not been started for this account.');

  if (!isEditable(farmer.registrationStatus)) {
    throw conflict('Your registration is being reviewed and cannot be changed right now.');
  }
}

export interface PersonalDetailsInput {
  fullName: string;
  fullNameLocal?: string | null;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  preferredLanguage?: Language;
}

export async function savePersonalDetails(
  db: SupabaseClient,
  userId: string,
  input: PersonalDetailsInput,
): Promise<RegistrationView> {
  await assertEditable(db, userId);

  await updateProfile(db, userId, {
    fullName: input.fullName,
    ...(input.preferredLanguage !== undefined
      ? { preferredLanguage: input.preferredLanguage }
      : {}),
  });

  await updateFarmerProfile(db, userId, {
    fullNameLocal: input.fullNameLocal ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
  });

  return buildView(db, userId);
}

export interface AddressInput {
  village: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  pincode: string;
  stateId: string;
  districtId: string;
  latitude?: number | null;
  longitude?: number | null;
}

export async function saveAddress(
  db: SupabaseClient,
  userId: string,
  input: AddressInput,
): Promise<RegistrationView> {
  await assertEditable(db, userId);

  // The FK on farmer_profiles.district_id only proves the district exists —
  // not that it belongs to the state the farmer picked. A frontend that sends
  // a real district from the wrong state would otherwise silently route the
  // farmer's verification to the wrong state's admin, so it is checked here
  // against the server's own reference data rather than trusted (§ district
  // assignment: "do not trust a frontend districtId as authorization").
  const district = await findDistrictById(db, input.districtId);
  if (!district || district.stateId !== input.stateId) {
    throw validationError('Choose a district that belongs to the selected state.');
  }

  await updateFarmerProfile(db, userId, {
    village: input.village,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    pincode: input.pincode,
    stateId: input.stateId,
    districtId: input.districtId,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  });

  return buildView(db, userId);
}

/** Save/resume position. Navigation state, so the farmer owns it (§21). */
export async function saveCurrentStep(
  db: SupabaseClient,
  userId: string,
  step: RegistrationStep,
): Promise<void> {
  await updateFarmerProfile(db, userId, { currentStep: step });
}

/** Language preference can change at any time, including after submission (§4). */
export async function savePreferredLanguage(
  db: SupabaseClient,
  userId: string,
  language: Language,
): Promise<void> {
  await updateProfile(db, userId, { preferredLanguage: language });
}

export interface SubmitResult {
  view: RegistrationView;
  wasResubmission: boolean;
}

/**
 * Submits a registration for verification (§19, §33).
 *
 * Completeness is re-evaluated here from the database rather than trusted from
 * the client — a review screen that thinks it is complete is not evidence.
 */
export async function submitRegistration(
  db: SupabaseClient,
  userId: string,
): Promise<SubmitResult> {
  const input = await loadInput(db, userId);
  const current = input.farmer.registrationStatus;

  if (!isEditable(current)) {
    throw conflict('This registration has already been submitted.');
  }

  const { canSubmit, blockingReasons } = evaluateCompleteness(input);
  if (!canSubmit) {
    throw conflict('Some required information is still missing.', {
      blockingReasons,
    });
  }

  const wasResubmission =
    current === REGISTRATION_STATUSES.RESUBMISSION_REQUIRED ||
    current === REGISTRATION_STATUSES.REJECTED;

  // RESUBMISSION_REQUIRED and REJECTED must pass through DRAFT first — the
  // state machine allows no direct edge to SUBMITTED.
  if (current !== REGISTRATION_STATUSES.DRAFT) {
    await transition(userId, current, REGISTRATION_STATUSES.DRAFT);
  }

  await transition(userId, REGISTRATION_STATUSES.DRAFT, REGISTRATION_STATUSES.SUBMITTED);

  // Open the component checks a reviewer will work through (§18). The photo
  // check only exists when policy actually asks for a photograph.
  const checkTypes = ALL_VERIFICATION_CHECK_TYPES.filter(
    (checkType) => checkType !== 'PHOTO' || photoRequired(input.requirements),
  );
  await openVerificationChecks(supabaseAdminClient, userId, checkTypes);

  // Stops at SUBMITTED. Phase 1 used to advance straight to UNDER_REVIEW,
  // which was fine while nobody reviewed anything — but UNDER_REVIEW now means
  // "a named staff member has claimed this" (§11, §19), and only staff can
  // truthfully put it there.
  return { view: await buildView(db, userId), wasResubmission };
}

/**
 * Applies one state-machine edge.
 *
 * Checked in TypeScript first for a clear error, then again by the database
 * trigger. The duplication is deliberate: the trigger is what holds if some
 * future code path forgets to come through here.
 */
async function transition(
  userId: string,
  from: RegistrationStatus,
  to: RegistrationStatus,
): Promise<void> {
  if (!canTransition(from, to)) {
    throw conflict(`A registration cannot move from ${from} to ${to}.`);
  }
  await updateRegistrationStatus(supabaseAdminClient, userId, to);
}

/** The farmer-facing status view (§42). */
export async function getVerificationStatus(
  db: SupabaseClient,
  userId: string,
): Promise<VerificationStatusView> {
  const input = await loadInput(db, userId);
  const checks = await listVerificationChecks(db, userId);

  return {
    status: input.farmer.registrationStatus,
    submittedAt: input.farmer.submittedAt,
    reviewedAt: input.farmer.reviewedAt,
    verifiedAt: input.farmer.verifiedAt,
    reviewNotes: input.farmer.reviewNotes,
    checks,
    actionableDocuments: actionableDocuments(input.documents),
    actionableLandHoldings: input.landHoldings.filter(
      (holding) => holding.verificationStatus === 'REJECTED',
    ),
  };
}

/** Where a resumed session should land (§21). */
export async function getResumeStep(
  db: SupabaseClient,
  userId: string,
): Promise<RegistrationStep> {
  const input = await loadInput(db, userId);
  const { completedSteps } = evaluateCompleteness(input);
  return resolveResumeStep(input, completedSteps);
}
