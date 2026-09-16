import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Verifies `X-Twilio-Signature` (Phase 9 IVR §5): HMAC-SHA1 of the exact
 * request URL followed by every POST param, sorted by key and concatenated
 * as `key+value` with no delimiter — Twilio's documented algorithm.
 *
 * Without `TWILIO_AUTH_TOKEN` configured this allows every request through
 * (so `curl`-based local testing works before a real Twilio account exists)
 * but logs a warning every time — never silent, since this is the only thing
 * standing between the booking flow and an unauthenticated webhook once a
 * real number is attached.
 */
export function isValidTwilioRequest(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
): boolean {
  if (!env.TWILIO_AUTH_TOKEN) {
    logger.warn('twilio signature check skipped: TWILIO_AUTH_TOKEN is not set');
    return true;
  }
  if (!signatureHeader) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(data, 'utf8').digest('base64');

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
