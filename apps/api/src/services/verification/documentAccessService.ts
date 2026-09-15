import type { SupabaseClient } from '@supabase/supabase-js';
import { DOCUMENT_SIGNED_URL_TTL_SECONDS } from '@kisansetu/shared';
import { internalError, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { findOwnDocumentLocation } from '../../repositories/documentsRepository.js';

/**
 * Document viewing for a verification reviewer (§13).
 *
 * Formerly centre staff's; now the District Admin's, since farmer
 * verification moved to that role entirely (Phase 14). The shape is
 * unchanged: look the row up through the CALLER's RLS-bound client, then sign
 * with that same client. Two independent checks have to pass — the row policy
 * and the storage policy — and both are scoped to what this reviewer may see
 * (their own district, via app.district_admin_can_review_farmer()).
 *
 * No permanent URL is ever produced, and the storage path never leaves the
 * server.
 */
export async function createReviewDocumentUrl(
  db: SupabaseClient,
  documentId: string,
): Promise<{ signedUrl: string; expiresAt: string }> {
  // Named "own" because it reads whatever the caller's policies allow; for a
  // district admin client that is the documents of farmers in their district.
  const location = await findOwnDocumentLocation(db, documentId);
  if (!location) throw notFound('This document is not available.');

  const signed = await db.storage
    .from(location.bucket)
    .createSignedUrl(location.path, DOCUMENT_SIGNED_URL_TTL_SECONDS);

  if (signed.error || !signed.data) {
    logger.error('failed to sign document url for reviewer', {
      documentId,
      reason: signed.error?.message,
    });
    throw internalError('Could not open the document. Try again.');
  }

  return {
    signedUrl: signed.data.signedUrl,
    expiresAt: new Date(Date.now() + DOCUMENT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}
