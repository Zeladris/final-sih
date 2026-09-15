/** Header used to correlate a request across the client, the API and the logs (§35). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Multipart field name the document upload endpoint reads the file from. */
export const DOCUMENT_UPLOAD_FIELD = 'file';

/** Rate limit windows (§36). Supabase Auth throttles OTP itself; these protect our endpoints. */
export const RATE_LIMITS = {
  auth: { windowMs: 5 * 60_000, max: 30 },
  documentUpload: { windowMs: 15 * 60_000, max: 20 },
  verificationSubmit: { windowMs: 60 * 60_000, max: 10 },
  // A busy centre pays dozens of farmers a day; this stops a stuck button or a
  // runaway client, not a working shift. Duplicates are stopped by
  // idempotency keys and the database, not by this limit.
  paymentAction: { windowMs: 15 * 60_000, max: 120 },
  general: { windowMs: 60_000, max: 300 },
  // Nominatim's usage policy asks for restraint (§34): this is deliberately
  // tighter than `general`, and search is never fired on keystroke — only on
  // an explicit submit — so a real user never approaches it.
  locationSearch: { windowMs: 60_000, max: 20 },
} as const;

/** Maximum JSON body we will parse. */
export const JSON_BODY_LIMIT = '256kb';
