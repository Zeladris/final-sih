import { Router } from 'express';
import { ROLES } from '@kisansetu/shared';
import { asyncHandler, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import { verificationLimiter } from '../middleware/rateLimit.js';
import { idParamSchema } from '../schemas/common.js';
import {
  grievanceListQuerySchema,
  changeGrievanceStatusSchema,
  grievanceResponseSchema,
  grievanceNoteSchema,
  grievanceAssignSchema,
  grievanceEscalateSchema,
  createHelplineSchema,
  updateHelplineSchema,
  createSchemeSchema,
  updateSchemeSchema,
  createFaqSchema,
  updateFaqSchema,
} from '../schemas/support.js';
import {
  getGovernmentGrievances,
  getGovernmentGrievanceDetail,
  patchGrievanceStatus,
  postGrievanceResponse,
  postGrievanceNote,
  postGrievanceAssign,
  postGrievanceEscalate,
  getGovernmentHelpline,
  postHelpline,
  patchHelpline,
  postHelplineVerify,
  getGovernmentSchemes,
  getGovernmentSchemeById,
  postScheme,
  patchScheme,
  postSchemePublish,
  postSchemeArchive,
  getGovernmentFaqs,
  postFaq,
  patchFaq,
} from '../controllers/governmentSupportController.js';

/**
 * The government-side Help & Support workspace (§10–§37). Grievance reads
 * and actions are open to Centre Staff too — they are where most complaints
 * first land — but assignment and escalation are re-checked inside
 * grievanceService.ts regardless of what this router lets through, because a
 * role check here is necessary and not sufficient (§25).
 */
export const governmentSupportRouter = Router();

governmentSupportRouter.use(
  requireAuth,
  requireRole(ROLES.CENTRE_STAFF, ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN),
);

// --- Grievances (§10–§14) -----------------------------------------------------

governmentSupportRouter.get(
  '/grievances',
  validateQuery(grievanceListQuerySchema),
  asyncHandler(getGovernmentGrievances),
);
governmentSupportRouter.get(
  '/grievances/:id',
  validateParams(idParamSchema),
  asyncHandler(getGovernmentGrievanceDetail),
);
governmentSupportRouter.patch(
  '/grievances/:id/status',
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(changeGrievanceStatusSchema),
  asyncHandler(patchGrievanceStatus),
);
governmentSupportRouter.post(
  '/grievances/:id/responses',
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(grievanceResponseSchema),
  asyncHandler(postGrievanceResponse),
);
governmentSupportRouter.post(
  '/grievances/:id/notes',
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(grievanceNoteSchema),
  asyncHandler(postGrievanceNote),
);
governmentSupportRouter.post(
  '/grievances/:id/assign',
  requireRole(ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN),
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(grievanceAssignSchema),
  asyncHandler(postGrievanceAssign),
);
governmentSupportRouter.post(
  '/grievances/:id/escalate',
  verificationLimiter,
  validateParams(idParamSchema),
  validateBody(grievanceEscalateSchema),
  asyncHandler(postGrievanceEscalate),
);

// --- Helpline (§16–§22) — District/State Admin only ---------------------------

const districtOrStateAdmin = requireRole(ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN);

governmentSupportRouter.get('/helpline', districtOrStateAdmin, asyncHandler(getGovernmentHelpline));
governmentSupportRouter.post(
  '/helpline',
  districtOrStateAdmin,
  verificationLimiter,
  validateBody(createHelplineSchema),
  asyncHandler(postHelpline),
);
governmentSupportRouter.patch(
  '/helpline/:id',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  validateBody(updateHelplineSchema),
  asyncHandler(patchHelpline),
);
governmentSupportRouter.post(
  '/helpline/:id/verify',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  asyncHandler(postHelplineVerify),
);

// --- Government schemes (§23–§32) — District/State Admin only -----------------

governmentSupportRouter.get('/schemes', districtOrStateAdmin, asyncHandler(getGovernmentSchemes));
governmentSupportRouter.get(
  '/schemes/:id',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  asyncHandler(getGovernmentSchemeById),
);
governmentSupportRouter.post(
  '/schemes',
  districtOrStateAdmin,
  verificationLimiter,
  validateBody(createSchemeSchema),
  asyncHandler(postScheme),
);
governmentSupportRouter.patch(
  '/schemes/:id',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  validateBody(updateSchemeSchema),
  asyncHandler(patchScheme),
);
governmentSupportRouter.post(
  '/schemes/:id/publish',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  asyncHandler(postSchemePublish),
);
governmentSupportRouter.post(
  '/schemes/:id/archive',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  asyncHandler(postSchemeArchive),
);

// --- FAQs (§33–§37) — District/State Admin only --------------------------------

governmentSupportRouter.get('/faqs', districtOrStateAdmin, asyncHandler(getGovernmentFaqs));
governmentSupportRouter.post(
  '/faqs',
  districtOrStateAdmin,
  validateBody(createFaqSchema),
  asyncHandler(postFaq),
);
governmentSupportRouter.patch(
  '/faqs/:id',
  districtOrStateAdmin,
  validateParams(idParamSchema),
  validateBody(updateFaqSchema),
  asyncHandler(patchFaq),
);
