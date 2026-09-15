import { Router } from 'express';
import { z } from 'zod';
import { FARMER_STATUSES, ROLES } from '@kisansetu/shared';
import { postStaffStatus } from '../controllers/statusController.js';
import { asyncHandler, requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import multer from 'multer';
import { env } from '../config/env.js';
import { documentUploadLimiter, paymentLimiter } from '../middleware/rateLimit.js';
import {
  getQualityAssessment,
  getQueue,
  getQueueCandidate,
  getQueueCandidates,
  getQueueComparison,
  getQueueExplanation,
  getQueueMetrics,
  getQueueNext,
  getWorkstations,
  patchWorkstation,
  postQualityAssessment,
  postQualityOverride,
  postQueueRecalculate,
  postQueueRemove,
  postQueueRequeue,
  postQueueSelect,
} from '../controllers/queueController.js';
import {
  getCentrePaymentHistory,
  getCentrePayments,
  getPaymentById,
  getProcurementPayment,
  postInitiatePayment,
  postRefreshPayment,
  postRetryPayment,
} from '../controllers/paymentController.js';
import { uuidSchema } from '../schemas/common.js';
import {
  createSlotSchema,
  qualitySchema,
  sessionTransitionSchema,
  slotRangeSchema,
  updateSlotSchema,
  verifyCropSchema,
  weighSchema,
} from '../schemas/operations.js';
import {
  getBooking,
  getSlots,
  getSlotsForRange,
  getTodayBookings,
  getTodaySession,
  getUpcomingBookings,
  patchSlot,
  postArrive,
  postCheckIn,
  postClaimBooking,
  postProcure,
  postQuality,
  postSessionTransition,
  postSlot,
  postVerifyCrop,
  postWeigh,
} from '../controllers/operationsController.js';
import {
  getCentreById,
  getStaffCentre,
  getStaffDashboard,
  getStaffMe,
} from '../controllers/staffController.js';

export const staffRouter = Router();

/**
 * Every route below is `/me`-scoped: the centre and district come from the
 * authenticated staff profile, never from a client-supplied id (§6, §37).
 *
 * A farmer reaching any of these gets 403 from requireRole — not a redirect.
 */
staffRouter.use(requireAuth, requireRole(ROLES.CENTRE_STAFF));

const FARMER_STATUS_VALUES = Object.values(FARMER_STATUSES) as [string, ...string[]];

/** Produce sample photos: in memory, images only, size-capped. Bytes are checked in the service. */
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype === 'image/jpeg' || file.mimetype === 'image/png');
  },
});

staffRouter.get('/me', asyncHandler(getStaffMe));
staffRouter.get('/me/centre', asyncHandler(getStaffCentre));
staffRouter.get('/me/dashboard', asyncHandler(getStaffDashboard));

// --- Procurement operations (the primary staff workflow, §2) -----------------

const bookingParamSchema = z.object({ bookingId: uuidSchema });

// --- Fairness-aware queue (Phase 7) ------------------------------------------
//
// Static paths first: '/me/queue/metrics' must not be read as a booking id.

staffRouter.get('/me/queue', asyncHandler(getQueue));
staffRouter.get('/me/queue/candidates', asyncHandler(getQueueCandidates));
staffRouter.get('/me/queue/next', asyncHandler(getQueueNext));
staffRouter.get('/me/queue/metrics', asyncHandler(getQueueMetrics));
staffRouter.get('/me/queue/comparison', asyncHandler(getQueueComparison));
staffRouter.post('/me/queue/recalculate', asyncHandler(postQueueRecalculate));

staffRouter.get(
  '/me/queue/:bookingId',
  validateParams(bookingParamSchema),
  asyncHandler(getQueueCandidate),
);
staffRouter.get(
  '/me/queue/:bookingId/explanation',
  validateParams(bookingParamSchema),
  asyncHandler(getQueueExplanation),
);
staffRouter.post(
  '/me/queue/:bookingId/select',
  validateParams(bookingParamSchema),
  validateBody(
    z.object({ workstationId: uuidSchema, overrideReason: z.string().trim().max(500).optional() }).strict(),
  ),
  asyncHandler(postQueueSelect),
);
staffRouter.post(
  '/me/queue/:bookingId/remove',
  validateParams(bookingParamSchema),
  validateBody(z.object({ reason: z.string().trim().min(5).max(500) }).strict()),
  asyncHandler(postQueueRemove),
);
staffRouter.post(
  '/me/queue/:bookingId/requeue',
  validateParams(bookingParamSchema),
  asyncHandler(postQueueRequeue),
);

staffRouter.get('/me/workstations', asyncHandler(getWorkstations));
staffRouter.patch(
  '/me/workstations/:workstationId',
  validateParams(z.object({ workstationId: uuidSchema })),
  validateBody(z.object({ status: z.enum(['AVAILABLE', 'OFFLINE']) }).strict()),
  asyncHandler(patchWorkstation),
);

// --- AI-assisted pre-quality assessment (Phase 7) ----------------------------

staffRouter.get(
  '/me/bookings/:bookingId/quality-assessment',
  validateParams(bookingParamSchema),
  asyncHandler(getQualityAssessment),
);
staffRouter.post(
  '/me/bookings/:bookingId/quality-assessment',
  validateParams(bookingParamSchema),
  documentUploadLimiter,
  photoUpload.single('photo'),
  asyncHandler(postQualityAssessment),
);
staffRouter.post(
  '/me/bookings/:bookingId/quality-assessment/manual-override',
  validateParams(bookingParamSchema),
  validateBody(
    z.object({
      estimatedMinutes: z.number().positive().max(600),
      reason: z.string().trim().min(5).max(500),
    }).strict(),
  ),
  asyncHandler(postQualityOverride),
);

staffRouter.get('/me/sessions/today', asyncHandler(getTodaySession));

staffRouter.post(
  '/me/sessions/today/transition',
  validateBody(sessionTransitionSchema),
  asyncHandler(postSessionTransition),
);

staffRouter.get('/me/slots', asyncHandler(getSlots));

staffRouter.get(
  '/me/slots/range',
  validateQuery(slotRangeSchema),
  asyncHandler(getSlotsForRange),
);

staffRouter.post('/me/slots', validateBody(createSlotSchema), asyncHandler(postSlot));

staffRouter.patch(
  '/me/slots/:slotId',
  validateParams(z.object({ slotId: uuidSchema })),
  validateBody(updateSlotSchema),
  asyncHandler(patchSlot),
);

staffRouter.get('/me/bookings/today', asyncHandler(getTodayBookings));
staffRouter.get('/me/bookings/upcoming', asyncHandler(getUpcomingBookings));

staffRouter.get(
  '/me/bookings/:bookingId',
  validateParams(bookingParamSchema),
  asyncHandler(getBooking),
);

/**
 * The operational loop. Each step is its own endpoint because each is its own
 * authorization and state-transition decision — a single generic "advance"
 * endpoint would make them indistinguishable in the audit log.
 */
/**
 * Phase 6 status transition. Accepts a farmer-facing status, checks it against
 * the state machine, and performs it through the same Phase 5 operation as the
 * dedicated endpoint — so the audit log still records the concrete step. Moves
 * that need evidence (quality, weight, payment) are refused with a pointer to
 * the step that records it.
 */
staffRouter.post(
  '/me/bookings/:bookingId/status',
  validateParams(bookingParamSchema),
  validateBody(z.object({ status: z.enum(FARMER_STATUS_VALUES) }).strict()),
  asyncHandler(postStaffStatus),
);

staffRouter.post(
  '/me/bookings/:bookingId/arrive',
  validateParams(bookingParamSchema),
  asyncHandler(postArrive),
);

staffRouter.post(
  '/me/bookings/:bookingId/check-in',
  validateParams(bookingParamSchema),
  asyncHandler(postCheckIn),
);

staffRouter.post(
  '/me/bookings/:bookingId/claim',
  validateParams(bookingParamSchema),
  asyncHandler(postClaimBooking),
);

staffRouter.post(
  '/me/bookings/:bookingId/verify-crop',
  validateParams(bookingParamSchema),
  validateBody(verifyCropSchema),
  asyncHandler(postVerifyCrop),
);

staffRouter.post(
  '/me/bookings/:bookingId/quality',
  validateParams(bookingParamSchema),
  validateBody(qualitySchema),
  asyncHandler(postQuality),
);

staffRouter.post(
  '/me/bookings/:bookingId/weigh',
  validateParams(bookingParamSchema),
  validateBody(weighSchema),
  asyncHandler(postWeigh),
);

staffRouter.post(
  '/me/bookings/:bookingId/procure',
  validateParams(bookingParamSchema),
  asyncHandler(postProcure),
);

// --- Payment & MSP settlement (Phase 8) ---------------------------------------
//
// Money-moving requests carry an Idempotency-Key header and are rate limited:
// a stuck button must not become a stream of payment attempts.

const paymentParamSchema = z.object({ paymentId: uuidSchema });
const procurementParamSchema = z.object({ procurementId: uuidSchema });
const paymentActionSchema = z.object({ demoScenario: z.enum(['SUCCESS', 'FAIL']).optional() }).strict();

staffRouter.get('/me/payments', asyncHandler(getCentrePayments));
staffRouter.get(
  '/me/procurements/:procurementId/payment',
  validateParams(procurementParamSchema),
  asyncHandler(getProcurementPayment),
);
staffRouter.post(
  '/me/procurements/:procurementId/payment',
  validateParams(procurementParamSchema),
  paymentLimiter,
  validateBody(paymentActionSchema),
  asyncHandler(postInitiatePayment),
);
staffRouter.get('/me/payments/:paymentId', validateParams(paymentParamSchema), asyncHandler(getPaymentById));
staffRouter.post(
  '/me/payments/:paymentId/retry',
  validateParams(paymentParamSchema),
  paymentLimiter,
  validateBody(paymentActionSchema),
  asyncHandler(postRetryPayment),
);
staffRouter.post(
  '/me/payments/:paymentId/refresh',
  validateParams(paymentParamSchema),
  asyncHandler(postRefreshPayment),
);
staffRouter.get(
  '/me/payments/:paymentId/history',
  validateParams(paymentParamSchema),
  asyncHandler(getCentrePaymentHistory),
);

// --- Centre lookup ----------------------------------------------------------
//
// Farmer verification (profile/documents/land review) is NOT here. It moved
// to the District Admin entirely (Phase 14) — see
// apps/api/src/controllers/districtVerificationController.ts and
// apps/api/src/routes/admin.ts. Centre staff hold no RLS policy that can read
// a farmer's registration, so there is no "staff verification" API surface to
// restrict — it does not exist.

staffRouter.get(
  '/centres/:centreId',
  validateParams(z.object({ centreId: uuidSchema })),
  asyncHandler(getCentreById),
);
