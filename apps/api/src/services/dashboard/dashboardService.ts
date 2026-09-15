import type { SupabaseClient } from '@supabase/supabase-js';
import { accountStateFor, documentNeedsAction, remainingSteps, toAcres } from '@kisansetu/shared';
import type {
  DashboardFarmer,
  DashboardResponse,
  DashboardVerification,
} from '@kisansetu/shared';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { findProfileById } from '../../repositories/profilesRepository.js';
import { findFarmerProfile } from '../../repositories/farmersRepository.js';
import { listLandHoldings } from '../../repositories/landRepository.js';
import { listDocumentsForFarmer } from '../../repositories/documentsRepository.js';
import {
  listDocumentRequirements,
  listVerificationChecks,
} from '../../repositories/registrationPolicyRepository.js';
import { findDistrictById, findStateById } from '../../repositories/centresRepository.js';
import {
  evaluateCompleteness,
  photoRequired,
  resolveResumeStep,
} from '../farmers/registrationCompleteness.js';
import { activeBookingProvider, activeNotificationProvider } from './summaryProviders.js';

/**
 * Assembles the farmer dashboard (§30).
 *
 * Everything is read through the caller's RLS-bound client, so the farmer
 * identity comes from the session and a farmer can only ever assemble their
 * own dashboard (§17).
 *
 * Nothing here invents data. Sections whose subsystems do not exist yet report
 * NOT_AVAILABLE via their provider rather than returning plausible-looking
 * blanks (§37).
 */
export async function buildDashboard(
  db: SupabaseClient,
  userId: string,
): Promise<DashboardResponse> {
  const [profile, farmer] = await Promise.all([
    findProfileById(db, userId),
    findFarmerProfile(db, userId),
  ]);

  if (!profile) throw notFound('No profile found for this account.');
  if (!farmer) throw notFound('Registration has not been started for this account.');

  const [landHoldings, documents, requirements, checks] = await Promise.all([
    listLandHoldings(db, userId),
    listDocumentsForFarmer(db, userId),
    listDocumentRequirements(db),
    listVerificationChecks(db, userId),
  ]);

  // Place names, not ids — the dashboard shows "Thanjavur", not a UUID.
  const [district, state] = await Promise.all([
    farmer.districtId ? findDistrictById(db, farmer.districtId) : Promise.resolve(null),
    farmer.stateId ? findStateById(db, farmer.stateId) : Promise.resolve(null),
  ]);

  const input = { profile, farmer, landHoldings, documents, requirements };
  const { completedSteps } = evaluateCompleteness(input);
  const accountState = accountStateFor(farmer.registrationStatus);

  const totalAcres = landHoldings.reduce(
    (sum, holding) => sum + toAcres(holding.area, holding.areaUnit),
    0,
  );

  // The crop from the largest holding is the most representative single
  // answer; showing a list on a summary card would be noise.
  const largestHolding = landHoldings.reduce<(typeof landHoldings)[number] | null>(
    (largest, holding) =>
      largest === null || toAcres(holding.area, holding.areaUnit) > toAcres(largest.area, largest.areaUnit)
        ? holding
        : largest,
    null,
  );

  const dashboardFarmer: DashboardFarmer = {
    farmerReferenceId: farmer.farmerReferenceId,
    name: profile.fullName,
    nameLocal: farmer.fullNameLocal,
    phone: profile.phone,
    gender: farmer.gender,
    village: farmer.village,
    districtName: district?.name ?? null,
    stateName: state?.name ?? null,
    primaryCrop: largestHolding?.primaryCrop ?? null,
    landAreaAcres: landHoldings.length > 0 ? Number(totalAcres.toFixed(2)) : null,
    landHoldingCount: landHoldings.length,
    // Whether a location exists, never the coordinates (§14).
    hasFarmLocation: landHoldings.some(
      (holding) => holding.latitude !== null && holding.longitude !== null,
    ),
  };

  const itemsNeedingAction =
    documents.filter((document) => documentNeedsAction(document.status)).length +
    landHoldings.filter((holding) => holding.verificationStatus === 'REJECTED').length;

  const verification: DashboardVerification = {
    state: accountState,
    registrationStatus: farmer.registrationStatus,
    submittedAt: farmer.submittedAt,
    verifiedAt: farmer.verifiedAt,
    reviewNotes: farmer.reviewNotes,
    checks,
    resumeStep:
      accountState === 'REGISTRATION_INCOMPLETE' || accountState === 'ACTION_REQUIRED'
        ? resolveResumeStep(input, completedSteps)
        : null,
    completedSteps,
    remainingSteps: remainingSteps(completedSteps, photoRequired(requirements)),
    itemsNeedingAction,
  };

  // A failing future subsystem must not take the whole dashboard down (§19),
  // so each summary degrades to its own empty state independently.
  const [bookingSummary, notificationSummary] = await Promise.all([
    activeBookingProvider()
      .forFarmer(userId)
      .catch((error: unknown) => {
        logger.warn('booking summary provider failed', {
          provider: activeBookingProvider().name,
          reason: error instanceof Error ? error.message : String(error),
        });
        return {
          status: 'NOT_AVAILABLE' as const,
          upcoming: null,
          active: null,
          mostRecentCompleted: null,
        };
      }),
    activeNotificationProvider()
      .forFarmer(userId, profile.preferredLanguage)
      .catch((error: unknown) => {
        logger.warn('notification summary provider failed', {
          provider: activeNotificationProvider().name,
          reason: error instanceof Error ? error.message : String(error),
        });
        return { status: 'NOT_AVAILABLE' as const, unreadCount: 0, recent: [] };
      }),
  ]);

  return { farmer: dashboardFarmer, verification, bookingSummary, notificationSummary };
}
