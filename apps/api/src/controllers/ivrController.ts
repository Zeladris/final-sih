import type { Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { recordAudit } from '../services/audit/auditService.js';
import { continueCall, getSession, startCall } from '../services/ivr/ivrService.js';
import { isValidTwilioRequest } from '../services/ivr/twilioSignature.js';
import { sayAndHangup } from '../services/ivr/twiml.js';

/**
 * POST /api/ivr/voice — Twilio's "a call comes in" AND every `<Gather>`
 * `action` webhook (Phase 9 IVR; see routes/ivr.ts and ivrService.ts).
 *
 * Deliberately NOT wrapped in `asyncHandler`/the JSON error middleware: this
 * response is always TwiML (XML), even on failure — Twilio has no use for a
 * JSON error body, and an unhandled exception here would otherwise reach the
 * caller as dead air or a generic Twilio error tone instead of a spoken
 * apology. Every path below, success or failure, ends by writing valid
 * TwiML with a 200.
 */
export async function postVoice(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, string>;
  const callSid = body.CallSid;
  const fromPhone = body.From;

  res.type('text/xml');

  if (!callSid || !fromPhone) {
    logger.warn('ivr webhook missing CallSid/From', { hasCallSid: Boolean(callSid) });
    res.status(400).send(sayAndHangup('Something went wrong. Goodbye.'));
    return;
  }

  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const signature = req.get('X-Twilio-Signature');
  if (!isValidTwilioRequest(url, body, signature)) {
    // The computed `url` has to byte-for-byte match the URL Twilio itself
    // signed — a reverse proxy that rewrites Host or a path prefix
    // differently than the public URL Twilio saw will fail-closed here on
    // every real call. Logged so that specific mismatch is diagnosable
    // instead of just "signature invalid" with nothing to compare against.
    logger.warn('ivr webhook rejected: invalid Twilio signature', { callSid, computedUrl: url });
    res.status(403).send(sayAndHangup('Something went wrong. Goodbye.'));
    return;
  }

  try {
    const session = getSession(callSid);
    const result = session ? await continueCall(session, body.Digits) : await startCall(callSid, fromPhone);

    if (result.bookingCreated) {
      // Same BOOKING_CREATED entry postBooking writes for a web booking
      // (bookingController.ts) — this call has no req.auth (no Supabase
      // session on a phone call), so the actor is given explicitly.
      await recordAudit(req, {
        action: 'BOOKING_CREATED',
        entityType: 'bookings',
        entityId: result.bookingCreated.id,
        actorUserId: result.bookingCreated.userId,
        metadata: {
          bookingReference: result.bookingCreated.bookingReference,
          crop: result.bookingCreated.cropName,
          expectedQuantityKg: result.bookingCreated.expectedQuantityKg,
          slotDate: result.bookingCreated.slotDate,
          bookingMethod: 'ivr',
        },
      });
    }

    res.status(200).send(result.twiml);
  } catch (error) {
    logger.error('ivr webhook failed', { callSid, reason: (error as Error).message });
    res.status(200).send(sayAndHangup('Sorry, something went wrong on our end. Please try again later. Goodbye.'));
  }
}
