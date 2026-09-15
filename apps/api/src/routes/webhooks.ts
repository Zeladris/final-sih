import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/auth.js';
import { validateParams } from '../middleware/validation.js';
import { postProviderWebhook } from '../controllers/paymentController.js';

/**
 * Payment provider callbacks (Phase 8 §37).
 *
 * Unauthenticated by necessity — the caller is a provider, not a user — so the
 * provider adapter's signature verification IS the authorization. The active
 * demo provider sends no webhooks, and this route refuses it.
 */
export const webhookRouter = Router();

webhookRouter.post(
  '/:provider',
  validateParams(z.object({ provider: z.string().regex(/^[a-z0-9_-]{2,40}$/i) })),
  asyncHandler(postProviderWebhook),
);
