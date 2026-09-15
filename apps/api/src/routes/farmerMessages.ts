import { Router } from 'express';
import { ROLES } from '@kisansetu/shared';
import { asyncHandler, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateQuery } from '../middleware/validation.js';
import { verificationLimiter } from '../middleware/rateLimit.js';
import { createFarmerMessageSchema, messageHistoryQuerySchema } from '../schemas/farmerMessage.js';
import { getSentMessages, postFarmerMessage } from '../controllers/farmerMessageController.js';

/**
 * Government messages (§21, §31). District/State Admin only — a Centre Staff
 * or Farmer caller is rejected by `requireRole` before the handler runs, and
 * `publishFarmerMessage` re-checks the specific target regardless of role.
 */
export const farmerMessagesRouter = Router();

farmerMessagesRouter.use(requireAuth, requireRole(ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN));

farmerMessagesRouter.post(
  '/',
  // Reuses the verification-submit budget: a meaningful admin action, not a
  // per-keystroke call.
  verificationLimiter,
  validateBody(createFarmerMessageSchema),
  asyncHandler(postFarmerMessage),
);

farmerMessagesRouter.get('/', validateQuery(messageHistoryQuerySchema), asyncHandler(getSentMessages));
