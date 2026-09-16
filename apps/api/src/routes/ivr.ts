import { Router } from 'express';
import express from 'express';
import { postVoice } from '../controllers/ivrController.js';

/**
 * Twilio webhooks (Phase 9 IVR). Unauthenticated by necessity — same shape as
 * `webhooks.ts` (payment provider callbacks): there is no Supabase session on
 * a phone call, so `X-Twilio-Signature` verification (isValidTwilioRequest in
 * the controller) is the auth layer instead of `requireSession`.
 *
 * Twilio POSTs `application/x-www-form-urlencoded`, not JSON, so this router
 * gets its own body parser rather than relying on the global `express.json()`
 * in app.ts — mounted before that global parser, same precedent as the
 * payments webhook route.
 */
export const ivrRouter = Router();

ivrRouter.use(express.urlencoded({ extended: false }));
ivrRouter.post('/voice', postVoice);
