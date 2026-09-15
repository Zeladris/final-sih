import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistrationStatus } from '@kisansetu/shared';
import { FARMER_COLUMNS, toFarmerProfile } from './rows.js';
import type { FarmerProfileRow } from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';
import type { FarmerProfile } from '@kisansetu/shared';

/**
 * Review-side reads and the guarded status write.
 *
 * Reads run through the DISTRICT ADMIN's RLS-bound client, so a farmer
 * outside their district is filtered out by the database as well as by the
 * service. The status write is the one exception: it needs the service role,
 * because the column guard pins registration status for everybody else.
 */

const REVIEW_COLUMNS = `${FARMER_COLUMNS}, review_started_at, review_started_by`;

export interface ReviewRow extends FarmerProfileRow {
  review_started_at: string | null;
  review_started_by: string | null;
}

export interface FarmerWithReview extends FarmerProfile {
  reviewStartedAt: string | null;
  reviewStartedBy: string | null;
}

const toFarmerWithReview = (row: ReviewRow): FarmerWithReview => ({
  ...toFarmerProfile(row),
  reviewStartedAt: row.review_started_at,
  reviewStartedBy: row.review_started_by,
});

/** Registrations in this district admin's district awaiting or under review. */
export async function listQueue(
  db: SupabaseClient,
  statuses: readonly RegistrationStatus[],
): Promise<FarmerWithReview[]> {
  const rows = unwrap<ReviewRow[]>(
    await db
      .from('farmer_profiles')
      .select(REVIEW_COLUMNS)
      .in('registration_status', statuses as string[])
      // Oldest submission first: a queue that reorders itself is unfair.
      .order('submitted_at', { ascending: true }),
    'review.listQueue',
  );
  return rows.map(toFarmerWithReview);
}

export async function findReviewable(
  db: SupabaseClient,
  farmerUserId: string,
): Promise<FarmerWithReview | null> {
  const row = unwrapMaybe<ReviewRow>(
    await db.from('farmer_profiles').select(REVIEW_COLUMNS).eq('user_id', farmerUserId).maybeSingle(),
    'review.findReviewable',
  );
  return row ? toFarmerWithReview(row) : null;
}

/**
 * Applies a review transition, but ONLY if the record is still in the status
 * the caller last saw.
 *
 * The `.eq('registration_status', expectedFrom)` is the concurrency control
 * (§34): if another staff member already decided, zero rows match and this
 * returns null rather than silently overwriting their decision.
 */
export async function transitionIfUnchanged(
  adminDb: SupabaseClient,
  farmerUserId: string,
  expectedFrom: RegistrationStatus,
  to: RegistrationStatus,
  patch: {
    reviewedBy?: string | null;
    reviewNotes?: string | null;
    reviewStartedBy?: string | null;
  } = {},
): Promise<FarmerWithReview | null> {
  const payload: Record<string, unknown> = { registration_status: to };

  if (patch.reviewedBy !== undefined) payload.reviewed_by = patch.reviewedBy;
  if (patch.reviewNotes !== undefined) payload.review_notes = patch.reviewNotes;
  if (patch.reviewStartedBy !== undefined) payload.review_started_by = patch.reviewStartedBy;

  const rows = unwrap<ReviewRow[]>(
    await adminDb
      .from('farmer_profiles')
      .update(payload)
      .eq('user_id', farmerUserId)
      .eq('registration_status', expectedFrom)
      .select(REVIEW_COLUMNS),
    'review.transitionIfUnchanged',
  );

  return rows.length > 0 ? toFarmerWithReview(rows[0] as ReviewRow) : null;
}

/** Display names for the district admins holding reviews, for the queue. */
export async function namesByUserId(
  db: SupabaseClient,
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = unwrap<Array<{ id: string; full_name: string | null }>>(
    await db.from('profiles').select('id, full_name').in('id', unique),
    'review.namesByUserId',
  );

  return new Map(rows.map((row) => [row.id, row.full_name]));
}

/** Marks the documents of a decided registration, so the farmer sees what to fix. */
export async function markDocumentsReviewed(
  adminDb: SupabaseClient,
  farmerUserId: string,
  status: 'ACCEPTED' | 'UNDER_REVIEW',
  reviewerId: string,
): Promise<void> {
  const { error } = await adminDb
    .from('farmer_documents')
    .update({
      status,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('farmer_user_id', farmerUserId)
    .is('superseded_at', null)
    // Never touch a document a reviewer already sent back.
    .not('status', 'in', '("REJECTED","REPLACEMENT_REQUIRED")');

  if (error) throw new Error(`Could not update document review state: ${error.message}`);
}

/** Records the outcome of each component check (§18). */
export async function setVerificationChecks(
  adminDb: SupabaseClient,
  farmerUserId: string,
  checkTypes: readonly string[],
  status: 'VERIFIED' | 'REJECTED' | 'UNDER_REVIEW',
  reviewerId: string,
  notes: string | null,
): Promise<void> {
  const { error } = await adminDb.from('farmer_verification_checks').upsert(
    checkTypes.map((checkType) => ({
      farmer_user_id: farmerUserId,
      check_type: checkType,
      status,
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
      notes,
    })),
    { onConflict: 'farmer_user_id,check_type' },
  );

  if (error) throw new Error(`Could not record verification checks: ${error.message}`);
}
