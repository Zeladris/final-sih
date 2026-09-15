import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentRequirement, VerificationCheck } from '@kisansetu/shared';
import { toDocumentRequirement, toVerificationCheck } from './rows.js';
import type { DocumentRequirementRow, VerificationCheckRow } from './rows.js';
import { unwrap } from './postgrestError.js';

/**
 * Which documents registration requires, and whether a photograph is among
 * them, is configuration rather than code (§14, §15). Changing a row in
 * document_requirements changes the product's demands with no deploy.
 */
export async function listDocumentRequirements(
  db: SupabaseClient,
): Promise<DocumentRequirement[]> {
  const rows = unwrap<DocumentRequirementRow[]>(
    await db
      .from('document_requirements')
      .select('document_kind, is_required, display_order, translation_key')
      .order('display_order', { ascending: true }),
    'document_requirements.list',
  );
  return rows.map(toDocumentRequirement);
}

export async function listVerificationChecks(
  db: SupabaseClient,
  farmerUserId: string,
): Promise<VerificationCheck[]> {
  const rows = unwrap<VerificationCheckRow[]>(
    await db
      .from('farmer_verification_checks')
      .select('check_type, status, notes, reviewed_at')
      .eq('farmer_user_id', farmerUserId),
    'farmer_verification_checks.list',
  );
  return rows.map(toVerificationCheck);
}

/**
 * Opens the component checks for a submitted registration (§18).
 *
 * Service-role only: farmer_verification_checks has a SELECT policy and
 * nothing else, so a client cannot create or move its own checks.
 */
export async function openVerificationChecks(
  adminDb: SupabaseClient,
  farmerUserId: string,
  checkTypes: readonly string[],
): Promise<void> {
  const { error } = await adminDb.from('farmer_verification_checks').upsert(
    checkTypes.map((checkType) => ({
      farmer_user_id: farmerUserId,
      check_type: checkType,
      status: 'UNDER_REVIEW',
      // A resubmission reopens the check, so any prior reviewer note is stale.
      notes: null,
      reviewed_by: null,
      reviewed_at: null,
    })),
    { onConflict: 'farmer_user_id,check_type' },
  );

  if (error) {
    throw new Error(`Could not open verification checks: ${error.message}`);
  }
}
