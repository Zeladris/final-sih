import type { SupabaseClient } from '@supabase/supabase-js';
import { accountStateFor, remainingSteps } from '@kisansetu/shared';
import type { FarmerAccountSummary } from '@kisansetu/shared';
import { findProfileById } from '../../repositories/profilesRepository.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { listLandHoldings } from '../../repositories/landRepository.js';
import { listDocumentsForFarmer } from '../../repositories/documentsRepository.js';
import { listDocumentRequirements } from '../../repositories/registrationPolicyRepository.js';
import {
  evaluateCompleteness,
  photoRequired,
  resolveResumeStep,
} from '../farmers/registrationCompleteness.js';

/**
 * Summarises a farmer's account for the login flow (§11–§14, §21).
 *
 * Read-only by construction: login must never create a profile, overwrite a
 * field, or otherwise mutate registration data (§28). Every call here is a
 * SELECT through the caller's RLS-bound client.
 */
export async function loadFarmerAccountSummary(
  db: SupabaseClient,
  userId: string,
): Promise<FarmerAccountSummary> {
  const farmer = await findFarmerProfile(db, userId);

  if (!farmer) {
    // Authenticated, but registration has never been started.
    return {
      state: accountStateFor(null),
      registrationStatus: null,
      resumeStep: null,
      completedSteps: [],
      remainingSteps: [],
      photoRequired: false,
      submittedAt: null,
      verifiedAt: null,
    };
  }

  const profile = await findProfileById(db, userId);
  if (!profile) {
    // A farmer row without a profile row should be impossible (FK + cascade),
    // so treat it as "not started" rather than throwing mid-login.
    return {
      state: accountStateFor(null),
      registrationStatus: null,
      resumeStep: null,
      completedSteps: [],
      remainingSteps: [],
      photoRequired: false,
      submittedAt: null,
      verifiedAt: null,
    };
  }

  const [landHoldings, documents, requirements] = await Promise.all([
    listLandHoldings(db, userId),
    listDocumentsForFarmer(db, userId),
    listDocumentRequirements(db),
  ]);

  const input = { profile, farmer, landHoldings, documents, requirements };
  const { completedSteps } = evaluateCompleteness(input);
  const needsPhoto = photoRequired(requirements);
  const state = accountStateFor(farmer.registrationStatus);

  return {
    state,
    registrationStatus: farmer.registrationStatus,
    // Only meaningful while the registration is still being worked on.
    resumeStep:
      state === 'REGISTRATION_INCOMPLETE' || state === 'ACTION_REQUIRED'
        ? resolveResumeStep(input, completedSteps)
        : null,
    completedSteps,
    remainingSteps: remainingSteps(completedSteps, needsPhoto),
    photoRequired: needsPhoto,
    submittedAt: farmer.submittedAt,
    verifiedAt: farmer.verifiedAt,
  };
}
