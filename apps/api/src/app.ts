import express from 'express';
import type { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { JSON_BODY_LIMIT, REQUEST_ID_HEADER } from './config/constants.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { farmerRouter, referenceRouter } from './routes/farmer.js';
import { staffRouter } from './routes/staff.js';
import { adminRouter, districtAdminRouter, stateAdminRouter } from './routes/admin.js';
import { locationRouter } from './routes/location.js';
import { voiceRouter } from './routes/voice.js';
import { farmerMessagesRouter } from './routes/farmerMessages.js';
import { supportRouter } from './routes/support.js';
import { governmentSupportRouter } from './routes/governmentSupport.js';
import {
  setBookingSummaryProvider,
  setNotificationSummaryProvider,
} from './services/dashboard/summaryProviders.js';
import { SupabaseNotificationProvider } from './services/notifications/notificationService.js';
import { webhookRouter } from './routes/webhooks.js';
import { ivrRouter } from './routes/ivr.js';
import { SupabaseBookingProvider } from './services/dashboard/farmerBookingProvider.js';

// Load the global Express type augmentation for req.auth / req.requestId.
import './types/request.js';

/**
 * Wires the real providers over the placeholders their phases shipped with.
 *
 * Done here rather than at module scope so the registration is visible in one
 * place and a test can swap a provider before creating an app.
 */
function registerProviders(): void {
  setBookingSummaryProvider(new SupabaseBookingProvider());
  setNotificationSummaryProvider(new SupabaseNotificationProvider());
}

export function createApp(): Express {
  registerProviders();

  const app = express();

  // Behind a single reverse proxy in deployment; needed for correct req.ip,
  // which rate limiting and audit logs both depend on.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  // Helmet does not set Permissions-Policy by default. This is a pure JSON
  // API with no browser-facing pages of its own, so every powerful browser
  // feature is denied outright — there is nothing here that should ever need
  // camera/mic/geolocation/etc. access granted through this origin.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
    );
    next();
  });

  app.use(
    cors({
      // DEMO: also trusts localhost:5173 alongside the configured
      // FRONTEND_URL, so the presenter's own laptop can use either address
      // while other devices on the LAN must use FRONTEND_URL (localhost
      // never resolves to another machine, whatever the network). Revert to
      // `origin: env.FRONTEND_URL` after the demo.
      origin: [env.FRONTEND_URL, 'http://localhost:5173'],
      credentials: false, // Bearer tokens, not cookies — nothing to send along.
      // Idempotency-Key: payment requests carry one so a retry is recognised (Phase 8 §16).
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', REQUEST_ID_HEADER],
      exposedHeaders: [REQUEST_ID_HEADER],
    }),
  );

  app.use(requestId);

  // Provider webhooks need the exact bytes to verify a signature, so they are
  // mounted before JSON parsing (Phase 8 §37).
  app.use('/api/payments/webhooks', generalLimiter, express.raw({ type: '*/*', limit: '256kb' }), webhookRouter);

  // Twilio POSTs application/x-www-form-urlencoded, not JSON (Phase 9 IVR) —
  // mounted before the global JSON parser for the same reason as above.
  app.use('/api/ivr', generalLimiter, ivrRouter);

  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(generalLimiter);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/reference', referenceRouter);
  app.use('/api/location', locationRouter);
  app.use('/api/voice', voiceRouter);
  app.use('/api/farmer', farmerRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/district-admin', districtAdminRouter);
  app.use('/api/state-admin', stateAdminRouter);
  app.use('/api/farmer-messages', farmerMessagesRouter);
  app.use('/api', supportRouter);
  app.use('/api/government', governmentSupportRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
