import {
  ALL_VERIFICATION_CHECK_TYPES,
  DECISION_OUTCOME,
  QUEUE_STATUSES,
  decisionRequiresReason,
  reviewClaimState,
  MIN_REASON_LENGTH,
  toAcres,
} from '@kisansetu/shared';
import type {
  ReviewDecision,
  ReviewSubmission,
  VerificationQueue,
  VerificationQueueItem,
} from '@kisansetu/shared';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { maskPhone } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import {
  findReviewable,
  listQueue,
  markDocumentsReviewed,
  namesByUserId,
  setVerificationChecks,
  transitionIfUnchanged,
} from '../../repositories/reviewRepository.js';
import { listLandHoldings } from '../../repositories/landRepository.js';
import { listDocumentsForFarmer } from '../../repositories/documentsRepository.js';
import { listVerificationChecks } from '../../repositories/registrationPolicyRepository.js';
import { findProfileById } from '../../repositories/profilesRepository.js';
import { findDistrictById, findStateById } from '../../repositories/centresRepository.js';
import type { AuthContext } from '../../types/request.js';

/**
 * Farmer verification review (§14, §19, §34; Phase 14).
 *
 * Administrative verification — profile, land, documents, photograph — is the
 * DISTRICT ADMIN's responsibility, one district per admin. It is not centre
 * staff's: nothing here is reachable from the staff router, and centre staff
 * hold no RLS policy that can see a farmer's registration at all (Phase 14
 * migration). Every decision here is a deliberate act by that district's
 * admin. Nothing in this file marks a farmer verified as a side effect of
 * submission, document upload, or a record simply being opened (§43).
 *
 * Two independent things stop a district admin reviewing outside their scope:
 * the reads run under their RLS-bound client (so a farmer in another district
 * is not returned at all — scope comes from district_admin_profiles via
 * app.admin_district_id(), never from a request), and the write is
 * conditional on the record still being in the status the caller saw.
 */

/** The queue for the calling district admin's own district. */
export async function getQueue(auth: AuthContext): Promise<VerificationQueue> {
  const rows = await listQueue(auth.db, QUEUE_STATUSES);

  // Service role: staff RLS cannot read another staff member's profile, which
  // is why every holder used to render as "another staff member". The ids come
  // from rows this caller was already allowed to see, so nothing new is exposed.
  const reviewerNames = await namesByUserId(
    supabaseAdminClient,
    rows.map((row) => row.reviewStartedBy).filter((id): id is string => Boolean(id)),
  );

  const items: VerificationQueueItem[] = await Promise.all(
    rows.map(async (row): Promise<VerificationQueueItem> => {
      const [profile, holdings, documents] = await Promise.all([
        findProfileById(auth.db, row.userId),
        listLandHoldings(auth.db, row.userId),
        listDocumentsForFarmer(auth.db, row.userId),
      ]);

      const totalAcres = holdings.reduce(
        (sum, holding) => sum + toAcres(holding.area, holding.areaUnit),
        0,
      );

      const largest = holdings.reduce<(typeof holdings)[number] | null>(
        (best, holding) =>
          best === null || toAcres(holding.area, holding.areaUnit) > toAcres(best.area, best.areaUnit)
            ? holding
            : best,
        null,
      );

      return {
        farmerUserId: row.userId,
        farmerReferenceId: row.farmerReferenceId,
        name: profile?.fullName ?? null,
        village: row.village,
        primaryCrop: largest?.primaryCrop ?? null,
        landAreaAcres: holdings.length > 0 ? Number(totalAcres.toFixed(2)) : null,
        submittedAt: row.submittedAt,
        registrationStatus: row.registrationStatus,
        documentCount: documents.length,
        reviewStartedAt: row.reviewStartedAt,
        reviewStartedByName: row.reviewStartedBy
          ? (reviewerNames.get(row.reviewStartedBy) ?? null)
          : null,
        ...reviewClaimState(
          row.registrationStatus,
          row.reviewStartedBy,
          row.reviewStartedAt,
          auth.userId,
        ),
      };
    }),
  );

  return {
    status: 'OK',
    items,
    awaitingReview: items.filter((item) => item.registrationStatus === 'SUBMITTED').length,
    inReview: items.filter((item) => item.registrationStatus === 'UNDER_REVIEW').length,
  };
}

/**
 * Loads one submission for review.
 *
 * A farmer outside the staff member's scope is simply not returned by RLS, so
 * this reports "not found" rather than confirming the record exists (§26).
 */
export async function getSubmission(
  auth: AuthContext,
  farmerUserId: string,
): Promise<ReviewSubmission> {
  const farmer = await findReviewable(auth.db, farmerUserId);
  if (!farmer) throw notFound('This verification record is not available.');

  const [profile, landHoldings, documents, checks] = await Promise.all([
    findProfileById(auth.db, farmerUserId),
    listLandHoldings(auth.db, farmerUserId),
    listDocumentsForFarmer(auth.db, farmerUserId),
    listVerificationChecks(auth.db, farmerUserId),
  ]);

  const [district, state] = await Promise.all([
    farmer.districtId ? findDistrictById(auth.db, farmer.districtId) : Promise.resolve(null),
    farmer.stateId ? findStateById(auth.db, farmer.stateId) : Promise.resolve(null),
  ]);

  const reviewerNames = farmer.reviewStartedBy
    ? await namesByUserId(supabaseAdminClient, [farmer.reviewStartedBy])
    : new Map<string, string | null>();

  const claim = reviewClaimState(
    farmer.registrationStatus,
    farmer.reviewStartedBy,
    farmer.reviewStartedAt,
    auth.userId,
  );

  return {
    farmer: {
      farmerUserId: farmer.userId,
      farmerReferenceId: farmer.farmerReferenceId,
      name: profile?.fullName ?? null,
      nameLocal: farmer.fullNameLocal,
      // Masked: staff need to recognise the farmer, not to dial them (§12).
      phoneMasked: maskPhone(profile?.phone ?? null),
      gender: farmer.gender,
      dateOfBirth: farmer.dateOfBirth,
      village: farmer.village,
      addressLine1: farmer.addressLine1,
      addressLine2: farmer.addressLine2,
      pincode: farmer.pincode,
      districtName: district?.name ?? null,
      stateName: state?.name ?? null,
      hasResidenceLocation: farmer.latitude !== null && farmer.longitude !== null,
    },
    landHoldings,
    documents,
    checks,
    registrationStatus: farmer.registrationStatus,
    submittedAt: farmer.submittedAt,
    reviewedAt: farmer.reviewedAt,
    reviewNotes: farmer.reviewNotes,
    reviewStartedAt: farmer.reviewStartedAt,
    reviewStartedByName: farmer.reviewStartedBy
      ? (reviewerNames.get(farmer.reviewStartedBy) ?? null)
      : null,
    ...claim,
    canDecide: farmer.registrationStatus === 'UNDER_REVIEW' && claim.claimedByMe,
  };
}

/**
 * Claims a submission for review (§19).
 *
 * SUBMITTED -> UNDER_REVIEW, conditional on it still being SUBMITTED. If
 * somebody else claimed it in the meantime the update matches nothing and the
 * caller is told, rather than quietly taking over their review.
 */
export async function claimSubmission(
  auth: AuthContext,
  farmerUserId: string,
): Promise<ReviewSubmission> {
  const farmer = await findReviewable(auth.db, farmerUserId);
  if (!farmer) throw notFound('This verification record is not available.');

  if (farmer.registrationStatus === 'UNDER_REVIEW') {
    const state = reviewClaimState(
      farmer.registrationStatus,
      farmer.reviewStartedBy,
      farmer.reviewStartedAt,
      auth.userId,
    );
    if (state.claimedByMe) return getSubmission(auth, farmerUserId);
    if (!state.canClaim) {
      throw conflict('This registration is already being reviewed.');
    }

    // Unheld or abandoned: take it over, but only if it is still exactly as we
    // saw it. If the holder came back and decided, or a colleague took it over
    // first, zero rows match and the caller is told instead of overwriting.
    let takeover = supabaseAdminClient
      .from('farmer_profiles')
      .update({ review_started_by: auth.userId, review_started_at: new Date().toISOString() })
      .eq('user_id', farmerUserId)
      .eq('registration_status', 'UNDER_REVIEW');
    takeover = farmer.reviewStartedBy
      ? takeover.eq('review_started_by', farmer.reviewStartedBy)
      : takeover.is('review_started_by', null);

    const { data, error } = await takeover.select('user_id');
    if (error || !data || data.length === 0) {
      throw conflict('This verification record has already been updated. Refresh and try again.');
    }

    await setVerificationChecks(
      supabaseAdminClient,
      farmerUserId,
      ALL_VERIFICATION_CHECK_TYPES,
      'UNDER_REVIEW',
      auth.userId,
      null,
    );

    return getSubmission(auth, farmerUserId);
  }

  if (farmer.registrationStatus !== 'SUBMITTED') {
    throw conflict('This registration is not waiting for review.');
  }

  const claimed = await transitionIfUnchanged(
    supabaseAdminClient,
    farmerUserId,
    'SUBMITTED',
    'UNDER_REVIEW',
    { reviewStartedBy: auth.userId },
  );

  if (!claimed) {
    throw conflict('This verification record has already been updated. Refresh and try again.');
  }

  // Opening a record is not a verification outcome — the checks move to
  // "being looked at", nothing more (§43).
  await setVerificationChecks(
    supabaseAdminClient,
    farmerUserId,
    ALL_VERIFICATION_CHECK_TYPES,
    'UNDER_REVIEW',
    auth.userId,
    null,
  );

  return getSubmission(auth, farmerUserId);
}

/** Releases a claim without deciding, so a reviewer can hand it back. */
export async function releaseSubmission(
  auth: AuthContext,
  farmerUserId: string,
): Promise<ReviewSubmission> {
  const farmer = await findReviewable(auth.db, farmerUserId);
  if (!farmer) throw notFound('This verification record is not available.');

  if (farmer.registrationStatus !== 'UNDER_REVIEW') {
    throw conflict('This registration is not currently being reviewed.');
  }

  if (farmer.reviewStartedBy !== auth.userId) {
    throw forbidden('Only the reviewer holding this registration can release it.');
  }

  // UNDER_REVIEW has no edge back to SUBMITTED in the state machine, so the
  // claim is dropped in place rather than the status being moved.
  const { error } = await supabaseAdminClient
    .from('farmer_profiles')
    .update({ review_started_by: null, review_started_at: null })
    .eq('user_id', farmerUserId)
    .eq('review_started_by', auth.userId);

  if (error) throw conflict('Could not release this review. Refresh and try again.');

  return getSubmission(auth, farmerUserId);
}

export interface DecisionInput {
  decision: ReviewDecision;
  reason?: string | null;
}

export interface DecisionResult {
  submission: ReviewSubmission;
  outcome: (typeof DECISION_OUTCOME)[ReviewDecision];
  /** For the audit trail: the status this decision moved the registration FROM. */
  previousStatus: 'UNDER_REVIEW';
}

/**
 * Records a verification decision (§14, §35).
 *
 * Order matters: the guarded status transition happens FIRST. If it fails
 * because somebody else already decided, nothing else has been written and the
 * caller gets a clean conflict rather than a half-applied decision.
 */
export async function decide(
  auth: AuthContext,
  farmerUserId: string,
  input: DecisionInput,
): Promise<DecisionResult> {
  const reason = input.reason?.trim() ?? '';

  if (decisionRequiresReason(input.decision) && reason.length < MIN_REASON_LENGTH) {
    throw validationError(
      `Explain what the farmer needs to do, in at least ${MIN_REASON_LENGTH} characters.`,
    );
  }

  const farmer = await findReviewable(auth.db, farmerUserId);
  if (!farmer) throw notFound('This verification record is not available.');

  if (farmer.registrationStatus !== 'UNDER_REVIEW') {
    throw conflict('This verification record has already been updated. Refresh and try again.');
  }

  if (farmer.reviewStartedBy !== auth.userId) {
    throw forbidden('Another reviewer is reviewing this registration.');
  }

  const outcome = DECISION_OUTCOME[input.decision];

  const updated = await transitionIfUnchanged(
    supabaseAdminClient,
    farmerUserId,
    'UNDER_REVIEW',
    outcome,
    {
      reviewedBy: auth.userId,
      reviewNotes: decisionRequiresReason(input.decision) ? reason : null,
    },
  );

  if (!updated) {
    throw conflict('This verification record has already been updated. Refresh and try again.');
  }

  // Component checks follow the decision, so the farmer's status screen shows
  // a coherent picture rather than checks that contradict the outcome.
  await setVerificationChecks(
    supabaseAdminClient,
    farmerUserId,
    ALL_VERIFICATION_CHECK_TYPES,
    outcome === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
    auth.userId,
    decisionRequiresReason(input.decision) ? reason : null,
  );

  if (outcome === 'VERIFIED') {
    await markDocumentsReviewed(supabaseAdminClient, farmerUserId, 'ACCEPTED', auth.userId);
  }

  return { submission: await getSubmission(auth, farmerUserId), outcome, previousStatus: 'UNDER_REVIEW' };
}
