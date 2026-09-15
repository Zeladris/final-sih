import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentKind, FarmerDocument } from '@kisansetu/shared';
import { FARMER_DOCUMENT_PUBLIC_COLUMNS, toFarmerDocument } from './rows.js';
import type { FarmerDocumentRow } from './rows.js';
import { unwrap, unwrapMaybe } from './postgrestError.js';

export interface StoredDocumentLocation {
  bucket: string;
  path: string;
  status: string;
}

/** Live documents only — superseded rows are history, not the current set. */
export async function listDocumentsForFarmer(
  db: SupabaseClient,
  farmerUserId: string,
): Promise<FarmerDocument[]> {
  const rows = unwrap<FarmerDocumentRow[]>(
    await db
      .from('farmer_documents')
      .select(FARMER_DOCUMENT_PUBLIC_COLUMNS)
      .eq('farmer_user_id', farmerUserId)
      .is('superseded_at', null)
      .order('created_at', { ascending: false }),
    'farmer_documents.listForFarmer',
  );
  return rows.map(toFarmerDocument);
}

export async function findLiveDocumentOfKind(
  db: SupabaseClient,
  farmerUserId: string,
  kind: DocumentKind,
): Promise<FarmerDocument | null> {
  const row = unwrapMaybe<FarmerDocumentRow>(
    await db
      .from('farmer_documents')
      .select(FARMER_DOCUMENT_PUBLIC_COLUMNS)
      .eq('farmer_user_id', farmerUserId)
      .eq('document_type', kind)
      .is('superseded_at', null)
      .maybeSingle(),
    'farmer_documents.findLiveOfKind',
  );
  return row ? toFarmerDocument(row) : null;
}

export async function insertDocument(
  db: SupabaseClient,
  input: {
    id: string;
    farmerUserId: string;
    documentKind: DocumentKind;
    storageBucket: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    fileSizeBytes: number;
    replacesDocumentId?: string | null;
  },
): Promise<FarmerDocument> {
  const row = unwrap<FarmerDocumentRow>(
    await db
      .from('farmer_documents')
      .insert({
        id: input.id,
        farmer_user_id: input.farmerUserId,
        document_type: input.documentKind,
        storage_bucket: input.storageBucket,
        storage_path: input.storagePath,
        original_filename: input.originalFilename,
        mime_type: input.mimeType,
        file_size_bytes: input.fileSizeBytes,
        replaces_document_id: input.replacesDocumentId ?? null,
      })
      .select(FARMER_DOCUMENT_PUBLIC_COLUMNS)
      .single(),
    'farmer_documents.insert',
  );
  return toFarmerDocument(row);
}

/**
 * Retires the current document of a kind so a replacement can take its place.
 *
 * Service-role: `superseded_at` is pinned for farmer writers, and the
 * one-live-document-per-kind unique index means the replacement insert would
 * otherwise collide. The old row is kept, not deleted — the review history of
 * a resubmission has to survive (§20).
 */
export async function supersedeDocument(
  adminDb: SupabaseClient,
  documentId: string,
): Promise<void> {
  const { error } = await adminDb
    .from('farmer_documents')
    .update({ superseded_at: new Date().toISOString() })
    .eq('id', documentId);

  if (error) throw new Error(`Could not supersede document: ${error.message}`);
}

/**
 * Reads the storage location of a document the CALLER owns.
 *
 * Storage paths never leave the server — this is the only function that reads
 * them, and it does so through the caller's RLS-bound client, so it returns
 * null for a document belonging to anybody else.
 */
export async function findOwnDocumentLocation(
  db: SupabaseClient,
  documentId: string,
): Promise<StoredDocumentLocation | null> {
  const row = unwrapMaybe<{ storage_bucket: string; storage_path: string; status: string }>(
    await db
      .from('farmer_documents')
      .select('storage_bucket, storage_path, status')
      .eq('id', documentId)
      .maybeSingle(),
    'farmer_documents.findOwnLocation',
  );

  if (!row) return null;
  return { bucket: row.storage_bucket, path: row.storage_path, status: row.status };
}

export async function deleteDocument(db: SupabaseClient, documentId: string): Promise<boolean> {
  const rows = unwrap<{ id: string }[]>(
    await db.from('farmer_documents').delete().eq('id', documentId).select('id'),
    'farmer_documents.delete',
  );
  // Zero rows means RLS filtered it out — not ours, already reviewed, or the
  // registration is locked.
  return rows.length > 0;
}
