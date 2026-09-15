import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ALLOWED_DOCUMENT_MIME_TYPES, ROLES } from '@kisansetu/shared';
import { env } from '../config/env.js';
import { DOCUMENT_UPLOAD_FIELD } from '../config/constants.js';
import { asyncHandler, requireAuth, requireSession } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorization.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import {
  assessProduceSchema,
  cancelBookingSchema,
  createBookingSchema,
  cropQuerySchema,
  datesQuerySchema,
  slotsQuerySchema,
} from '../schemas/booking.js';
import {
  getBooking,
  getBookings,
  getCentres,
  getCrops,
  getDates,
  getEligibility,
  getSlots,
  getBookingProduceAssessment,
  postBooking,
  postCancelBooking,
  postProduceAssessment,
} from '../controllers/bookingController.js';
import { getBookingStatus, getBookingStatusHistory } from '../controllers/statusController.js';
import {
  getMyBookingPayment,
  getMyPayment,
  getMyPaymentHistory,
  getMyPayments,
  getMyProcurementPayment,
} from '../controllers/paymentController.js';
import {
  getMyNotifications,
  postReadAllNotifications,
  postReadNotification,
} from '../controllers/notificationController.js';
import { documentUploadLimiter, verificationLimiter } from '../middleware/rateLimit.js';
import { idParamSchema, uuidSchema } from '../schemas/common.js';
import {
  addressSchema,
  createLandHoldingSchema,
  personalDetailsSchema,
  saveStepSchema,
  setLanguageSchema,
  startRegistrationSchema,
  updateLandHoldingSchema,
} from '../schemas/registration.js';
import {
  beginRegistration,
  deleteDocument,
  deleteLand,
  getDistricts,
  getDashboard,
  getDocumentUrl,
  getDocuments,
  getLand,
  getRegistration,
  getRequirements,
  getStates,
  getStatus,
  postDocument,
  postLand,
  postSubmit,
  putAddress,
  putLand,
  putLanguage,
  putPersonalDetails,
  putStep,
} from '../controllers/farmerController.js';

/**
 * Files are held in memory, never written to disk: the API's own filesystem
 * should not become an unmanaged copy of farmers' documents.
 *
 * The limit and MIME filter here are a cheap first pass. The real check is
 * validateUpload() in the document service, which also inspects the file's
 * leading bytes — a declared Content-Type is not evidence (§23).
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  fileFilter: (_req, file, callback) => {
    callback(null, (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(file.mimetype));
  },
});

export const farmerRouter = Router();

/**
 * Two entry points accept a session WITHOUT a completed profile, because that
 * is exactly the new-farmer case (§10):
 *   GET  /registration  -> 404 tells the client "new farmer, start registration"
 *   POST /registration  -> creates it
 * Everything after them requires a FARMER profile.
 */
farmerRouter.get('/registration', requireSession, asyncHandler(getRegistration));

farmerRouter.post(
  '/registration',
  requireSession,
  validateBody(startRegistrationSchema),
  asyncHandler(beginRegistration),
);

// --- Everything below requires an onboarded farmer --------------------------

const authedFarmer = [requireAuth, requireRole(ROLES.FARMER)] as const;

farmerRouter.put(
  '/profile',
  ...authedFarmer,
  validateBody(personalDetailsSchema),
  asyncHandler(putPersonalDetails),
);

farmerRouter.put(
  '/address',
  ...authedFarmer,
  validateBody(addressSchema),
  asyncHandler(putAddress),
);

farmerRouter.get('/land', ...authedFarmer, asyncHandler(getLand));

farmerRouter.post(
  '/land',
  ...authedFarmer,
  validateBody(createLandHoldingSchema),
  asyncHandler(postLand),
);

farmerRouter.put(
  '/land/:id',
  ...authedFarmer,
  validateParams(idParamSchema),
  validateBody(updateLandHoldingSchema),
  asyncHandler(putLand),
);

farmerRouter.delete(
  '/land/:id',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(deleteLand),
);

farmerRouter.get('/documents', ...authedFarmer, asyncHandler(getDocuments));

farmerRouter.post(
  '/documents',
  ...authedFarmer,
  documentUploadLimiter,
  upload.single(DOCUMENT_UPLOAD_FIELD),
  asyncHandler(postDocument),
);

farmerRouter.get(
  '/documents/:id/url',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(getDocumentUrl),
);

farmerRouter.delete(
  '/documents/:id',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(deleteDocument),
);

farmerRouter.post(
  '/registration/submit',
  ...authedFarmer,
  verificationLimiter,
  asyncHandler(postSubmit),
);

farmerRouter.put(
  '/registration/step',
  ...authedFarmer,
  validateBody(saveStepSchema),
  asyncHandler(putStep),
);

farmerRouter.get('/verification-status', ...authedFarmer, asyncHandler(getStatus));

farmerRouter.get('/dashboard', ...authedFarmer, asyncHandler(getDashboard));

// --- Booking (Phase 4) -------------------------------------------------------

farmerRouter.get('/booking/eligibility', ...authedFarmer, asyncHandler(getEligibility));

farmerRouter.get('/booking/crops', ...authedFarmer, asyncHandler(getCrops));

farmerRouter.get(
  '/booking/centres',
  ...authedFarmer,
  validateQuery(cropQuerySchema),
  asyncHandler(getCentres),
);

farmerRouter.get(
  '/booking/dates',
  ...authedFarmer,
  validateQuery(datesQuerySchema),
  asyncHandler(getDates),
);

farmerRouter.get(
  '/booking/slots',
  ...authedFarmer,
  validateQuery(slotsQuerySchema),
  asyncHandler(getSlots),
);

farmerRouter.get('/bookings', ...authedFarmer, asyncHandler(getBookings));

farmerRouter.get(
  '/bookings/:bookingId',
  ...authedFarmer,
  validateParams(z.object({ bookingId: uuidSchema })),
  asyncHandler(getBooking),
);

/** The farmer's own pre-arrival indication, after booking (§15). */
farmerRouter.get(
  '/bookings/:bookingId/quality-assessment',
  ...authedFarmer,
  validateParams(z.object({ bookingId: uuidSchema })),
  asyncHandler(getBookingProduceAssessment),
);

/**
 * Rate limited: the final Confirm is the one request a farmer might retry in
 * frustration on a poor connection. The idempotency key makes a retry safe;
 * this stops a stuck button from hammering the server.
 */
/**
 * The produce photo, during booking (§3, §12). Images only, size-capped, in
 * memory — the bytes are checked properly in the service before anything is
 * stored, and the photo goes to a PRIVATE bucket under the farmer's own
 * prefix. Rate-limited like any other upload: a stuck button must not become
 * a stream of inference calls.
 */
const producePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 8 },
  fileFilter: (_req, file, callback) => {
    callback(null, file.mimetype === 'image/jpeg' || file.mimetype === 'image/png');
  },
});

farmerRouter.post(
  '/bookings/quality-assessment',
  ...authedFarmer,
  documentUploadLimiter,
  producePhotoUpload.single('photo'),
  validateBody(assessProduceSchema),
  asyncHandler(postProduceAssessment),
);

farmerRouter.post(
  '/bookings',
  ...authedFarmer,
  verificationLimiter,
  validateBody(createBookingSchema),
  asyncHandler(postBooking),
);

// --- Payments (Phase 8) — the farmer's own, read-only -------------------------

farmerRouter.get('/payments', ...authedFarmer, asyncHandler(getMyPayments));
farmerRouter.get(
  '/payments/:paymentId',
  ...authedFarmer,
  validateParams(z.object({ paymentId: uuidSchema })),
  asyncHandler(getMyPayment),
);
farmerRouter.get(
  '/payments/:paymentId/history',
  ...authedFarmer,
  validateParams(z.object({ paymentId: uuidSchema })),
  asyncHandler(getMyPaymentHistory),
);
farmerRouter.get(
  '/procurements/:procurementId/payment',
  ...authedFarmer,
  validateParams(z.object({ procurementId: uuidSchema })),
  asyncHandler(getMyProcurementPayment),
);
farmerRouter.get(
  '/bookings/:bookingId/payment',
  ...authedFarmer,
  validateParams(z.object({ bookingId: uuidSchema })),
  asyncHandler(getMyBookingPayment),
);

farmerRouter.get('/notifications', ...authedFarmer, asyncHandler(getMyNotifications));
farmerRouter.post(
  '/notifications/:id/read',
  ...authedFarmer,
  validateParams(idParamSchema),
  asyncHandler(postReadNotification),
);
farmerRouter.post('/notifications/read-all', ...authedFarmer, asyncHandler(postReadAllNotifications));

// --- Live status (Phase 6) ---------------------------------------------------

farmerRouter.get(
  '/bookings/:bookingId/status',
  ...authedFarmer,
  validateParams(z.object({ bookingId: uuidSchema })),
  asyncHandler(getBookingStatus),
);

farmerRouter.get(
  '/bookings/:bookingId/status-history',
  ...authedFarmer,
  validateParams(z.object({ bookingId: uuidSchema })),
  asyncHandler(getBookingStatusHistory),
);

farmerRouter.post(
  '/bookings/:bookingId/cancel',
  ...authedFarmer,
  verificationLimiter,
  validateParams(z.object({ bookingId: uuidSchema })),
  validateBody(cancelBookingSchema),
  asyncHandler(postCancelBooking),
);

farmerRouter.put(
  '/language',
  ...authedFarmer,
  validateBody(setLanguageSchema),
  asyncHandler(putLanguage),
);

// --- Reference data ---------------------------------------------------------

export const referenceRouter = Router();

referenceRouter.get('/states', requireSession, asyncHandler(getStates));

referenceRouter.get(
  '/states/:stateId/districts',
  requireSession,
  validateParams(z.object({ stateId: uuidSchema })),
  asyncHandler(getDistricts),
);

referenceRouter.get('/document-requirements', requireSession, asyncHandler(getRequirements));
