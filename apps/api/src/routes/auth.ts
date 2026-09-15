import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, requireAuth, requireSession } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validation.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { getMe, getSessionState, recordSignIn } from '../controllers/authController.js';

export const authRouter = Router();

/**
 * Note what is NOT here: no send-OTP and no verify-OTP endpoint.
 *
 * The browser talks to Supabase Auth directly for those, so this API never
 * handles an OTP value and there is only one authentication system in the
 * stack (§22). These routes deal with the *session that results*.
 *
 * They also accept no input at all. A caller cannot say which role, portal or
 * scope they want — `?role=STATE_ADMIN` is rejected, not ignored — because
 * the answer comes only from the database.
 */
const noQuery = z.object({}).strict();
const noBody = z.object({}).strict();

authRouter.get('/me', requireAuth, validateQuery(noQuery), asyncHandler(getMe));

authRouter.get(
  '/session',
  authLimiter,
  requireSession,
  validateQuery(noQuery),
  asyncHandler(getSessionState),
);

authRouter.post(
  '/events/signed-in',
  authLimiter,
  requireSession,
  validateBody(noBody),
  asyncHandler(recordSignIn),
);
