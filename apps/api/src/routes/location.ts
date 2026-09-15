import { Router } from 'express';
import { asyncHandler, requireSession } from '../middleware/auth.js';
import { locationSearchLimiter } from '../middleware/rateLimit.js';
import { validateQuery } from '../middleware/validation.js';
import { locationReverseQuerySchema, locationSearchQuerySchema } from '../schemas/location.js';
import { getLocationReverse, getLocationSearch } from '../controllers/locationController.js';

/**
 * Location search and reverse geocoding (Phase 10 §14).
 *
 * `requireSession` rather than a specific role: registration (no profile
 * yet), farmer booking, and any future admin/staff use all need this, and
 * none of it is farmer-scoped data — it is a thin, rate-limited, cached
 * proxy onto a public geocoder, never anyone's PII.
 */
export const locationRouter = Router();

locationRouter.get(
  '/search',
  requireSession,
  locationSearchLimiter,
  validateQuery(locationSearchQuerySchema),
  asyncHandler(getLocationSearch),
);

locationRouter.get(
  '/reverse',
  requireSession,
  locationSearchLimiter,
  validateQuery(locationReverseQuerySchema),
  asyncHandler(getLocationReverse),
);
