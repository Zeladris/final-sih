import { Router } from 'express';
import { z } from 'zod';
import { ADMIN_EXPORT_REPORTS, ROLES } from '@kisansetu/shared';
import { asyncHandler, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import { idParamSchema, uuidSchema } from '../schemas/common.js';
import { reviewDecisionSchema } from '../schemas/review.js';
import {
  getCentresForDistrict,
  getDistrictCentres,
  getDistrictMe,
  getStateCentres,
  getStateDistricts,
  getStateMe,
} from '../controllers/adminController.js';
import { getDistrictPaymentSummary, getStatePaymentSummary } from '../controllers/paymentController.js';
import {
  getAdminAlerts,
  getCentre,
  getDashboard,
  getDistricts,
  getExport,
  getMe,
  getPerformance,
  getScopedCentres,
  getSection,
} from '../controllers/adminAnalyticsController.js';
import { verificationLimiter } from '../middleware/rateLimit.js';
import {
  getDistrictVerificationDocumentUrl,
  getDistrictVerificationQueue,
  getDistrictVerificationSubmission,
  postDistrictVerificationClaim,
  postDistrictVerificationDecision,
  postDistrictVerificationRelease,
} from '../controllers/districtVerificationController.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);

const eitherAdmin = requireRole(ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN);

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-14.');

/** Filters narrow the admin's own scope; they are never how scope is granted (§4, §30). */
const periodQuery = z
  .object({
    from: date.optional(),
    to: date.optional(),
    districtId: uuidSchema.optional(),
    cropId: uuidSchema.optional(),
  })
  .strict();

const performanceQuery = periodQuery
  .extend({
    search: z.string().trim().max(80).optional(),
    status: z.enum(['OPERATIONAL', 'HIGH_LOAD', 'DELAYED', 'LOW_ACTIVITY', 'CLOSED', 'INACTIVE']).optional(),
    sort: z.string().max(40).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().positive().max(10_000).optional(),
    pageSize: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

// --- Shared by both admin roles (Phase 12) ------------------------------------

adminRouter.get('/me', eitherAdmin, asyncHandler(getMe));
adminRouter.get('/dashboard', eitherAdmin, validateQuery(periodQuery), asyncHandler(getDashboard));
adminRouter.get('/centres', eitherAdmin, validateQuery(periodQuery), asyncHandler(getScopedCentres));
adminRouter.get('/centres/performance', eitherAdmin, validateQuery(performanceQuery), asyncHandler(getPerformance));
adminRouter.get(
  '/centres/:centreId',
  eitherAdmin,
  validateParams(z.object({ centreId: uuidSchema })),
  validateQuery(periodQuery),
  asyncHandler(getCentre),
);
adminRouter.get('/alerts', eitherAdmin, validateQuery(periodQuery), asyncHandler(getAdminAlerts));
adminRouter.get(
  '/analytics/:section',
  eitherAdmin,
  validateParams(z.object({ section: z.enum(['procurement', 'operations', 'queue', 'quality', 'payments']) })),
  validateQuery(periodQuery),
  asyncHandler(getSection),
);
adminRouter.get(
  '/export/:report',
  eitherAdmin,
  validateParams(z.object({ report: z.enum(ADMIN_EXPORT_REPORTS) })),
  validateQuery(periodQuery),
  asyncHandler(getExport),
);

// --- District admin --------------------------------------------------------

const districtRouter = Router();
districtRouter.use(requireRole(ROLES.DISTRICT_ADMIN));
districtRouter.get('/me', asyncHandler(getDistrictMe));
districtRouter.get('/centres', asyncHandler(getDistrictCentres));
districtRouter.get('/dashboard', validateQuery(periodQuery), asyncHandler(getDashboard));
districtRouter.get('/payments/summary', asyncHandler(getDistrictPaymentSummary));

// --- Farmer verification (Phase 14) -----------------------------------------
//
// Administrative verification is the district admin's alone. Every handler
// resolves its district from the authenticated admin's own profile — never
// from a request parameter (§ security note in districtVerificationController.ts).

const farmerParamSchema = z.object({ farmerUserId: uuidSchema });

districtRouter.get('/verification-queue', asyncHandler(getDistrictVerificationQueue));

districtRouter.get(
  '/verification/:farmerUserId',
  validateParams(farmerParamSchema),
  asyncHandler(getDistrictVerificationSubmission),
);

districtRouter.post(
  '/verification/:farmerUserId/claim',
  validateParams(farmerParamSchema),
  asyncHandler(postDistrictVerificationClaim),
);

districtRouter.post(
  '/verification/:farmerUserId/release',
  validateParams(farmerParamSchema),
  asyncHandler(postDistrictVerificationRelease),
);

/** The only way a registration status changes. No generic `{ status }` update. */
districtRouter.post(
  '/verification/:farmerUserId/decision',
  verificationLimiter,
  validateParams(farmerParamSchema),
  validateBody(reviewDecisionSchema),
  asyncHandler(postDistrictVerificationDecision),
);

districtRouter.get(
  '/documents/:id/url',
  validateParams(idParamSchema),
  asyncHandler(getDistrictVerificationDocumentUrl),
);

adminRouter.use('/district', districtRouter);

// --- State admin -----------------------------------------------------------

const stateRouter = Router();
stateRouter.use(requireRole(ROLES.STATE_ADMIN));
stateRouter.get('/me', asyncHandler(getStateMe));
stateRouter.get('/districts', asyncHandler(getStateDistricts));
stateRouter.get('/districts/summary', validateQuery(periodQuery), asyncHandler(getDistricts));
stateRouter.get('/centres', asyncHandler(getStateCentres));
stateRouter.get('/dashboard', validateQuery(periodQuery), asyncHandler(getDashboard));
stateRouter.get('/payments/summary', asyncHandler(getStatePaymentSummary));

adminRouter.use('/state', stateRouter);

// --- Cross-district lookup -------------------------------------------------

/**
 * Open to both admin roles on purpose: the scope check inside decides. A
 * district admin naming a neighbouring district gets 403; a state admin
 * naming a district in their own state gets the centres.
 */
adminRouter.get(
  '/districts/:districtId/centres',
  eitherAdmin,
  validateParams(z.object({ districtId: uuidSchema })),
  asyncHandler(getCentresForDistrict),
);

// --- The spec's role-named paths (§29), as aliases of the same handlers ------

export const districtAdminRouter = Router();
districtAdminRouter.use(requireAuth, requireRole(ROLES.DISTRICT_ADMIN));
districtAdminRouter.get('/dashboard', validateQuery(periodQuery), asyncHandler(getDashboard));

export const stateAdminRouter = Router();
stateAdminRouter.use(requireAuth, requireRole(ROLES.STATE_ADMIN));
stateAdminRouter.get('/dashboard', validateQuery(periodQuery), asyncHandler(getDashboard));
stateAdminRouter.get('/districts/summary', validateQuery(periodQuery), asyncHandler(getDistricts));
