import { Router } from 'express';
import { ROLES } from '@kisansetu/shared';
import { asyncHandler, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import { verificationLimiter } from '../middleware/rateLimit.js';
import { idParamSchema } from '../schemas/common.js';
import {
  submitFeedbackSchema,
  submitGrievanceSchema,
  grievanceResponseSchema,
  schemeListQuerySchema,
} from '../schemas/support.js';
import {
  postFeedback,
  getMyFeedback,
  postGrievance,
  getMyGrievances,
  getMyGrievanceDetail,
  postMyGrievanceResponse,
  getHelpline,
  getSchemes,
  getSchemeById,
  postSaveScheme,
  deleteSaveScheme,
  getSavedSchemes,
  getFaqs,
} from '../controllers/supportController.js';

/**
 * Help & Support — the farmer's own view, plus the read surfaces (helpline,
 * schemes, FAQs) that any authenticated user shares (§4, §17, §26, §35).
 * Admin/staff workspace actions live in governmentSupport.ts, on a separate
 * router, so an audience mistake shows up as a missing import, not a
 * misconfigured requireRole call buried in one giant file.
 */
export const supportRouter = Router();

const authedFarmer = [requireAuth, requireRole(ROLES.FARMER)] as const;

// --- Feedback (§4, §5) --------------------------------------------------------

supportRouter.post('/feedback', ...authedFarmer, validateBody(submitFeedbackSchema), asyncHandler(postFeedback));
supportRouter.get('/feedback/me', ...authedFarmer, asyncHandler(getMyFeedback));

// --- Grievances (§6–§14) -------------------------------------------------------

supportRouter.post(
  '/grievances',
  ...authedFarmer,
  verificationLimiter,
  validateBody(submitGrievanceSchema),
  asyncHandler(postGrievance),
);
supportRouter.get('/grievances/me', ...authedFarmer, asyncHandler(getMyGrievances));
supportRouter.get(
  '/grievances/:id',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(getMyGrievanceDetail),
);
supportRouter.post(
  '/grievances/:id/responses',
  ...authedFarmer,
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(grievanceResponseSchema),
  asyncHandler(postMyGrievanceResponse),
);

// --- Helpline (§16–§22) — any authenticated user -------------------------------

supportRouter.get('/helpline', requireAuth, asyncHandler(getHelpline));

// --- Government schemes (§23–§32) ----------------------------------------------

supportRouter.get('/schemes', requireAuth, validateQuery(schemeListQuerySchema), asyncHandler(getSchemes));
supportRouter.get('/schemes/saved', ...authedFarmer, asyncHandler(getSavedSchemes));
supportRouter.get('/schemes/:id', requireAuth, validateParams(idParamSchema), asyncHandler(getSchemeById));
supportRouter.post(
  '/schemes/:id/save',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(postSaveScheme),
);
supportRouter.delete(
  '/schemes/:id/save',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(deleteSaveScheme),
);

// --- FAQs (§33–§37) --------------------------------------------------------------

supportRouter.get('/faqs', requireAuth, asyncHandler(getFaqs));
