/** Document upload rules (§16, §23). Shared so the UI rejects early and the API rejects authoritatively. */
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

export type AllowedDocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

/** A farmer photograph is an image; a PDF headshot is a mistake, not a choice (§15). */
export const ALLOWED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/** Extensions we accept, keyed by MIME type. The extension alone is never trusted. */
export const EXTENSIONS_BY_MIME_TYPE: Record<AllowedDocumentMimeType, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

/** Magic-number prefixes used to confirm the declared MIME type. */
export const MAGIC_BYTES_BY_MIME_TYPE: Record<AllowedDocumentMimeType, readonly number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]], // "%PDF"
};

export const DEFAULT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const FARMER_DOCUMENTS_BUCKET = 'farmer-documents';

/** Signed URL lifetime for document viewing, in seconds. */
export const DOCUMENT_SIGNED_URL_TTL_SECONDS = 120;

export function isAllowedDocumentMimeType(value: string): value is AllowedDocumentMimeType {
  return (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function isAllowedPhotoMimeType(value: string): boolean {
  return (ALLOWED_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index).toLowerCase();
}
