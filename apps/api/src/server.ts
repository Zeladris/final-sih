import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { startQueueScheduler } from './services/queue/queueService.js';
import { startPaymentPoller } from './services/payments/paymentService.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info('api listening', {
    port: env.PORT,
    environment: env.NODE_ENV,
    frontendUrl: env.FRONTEND_URL,
    timezone: env.APP_TIMEZONE,
    // Host only — the key material is never logged.
    supabaseHost: new URL(env.SUPABASE_URL).host,
    qualityModel: env.ML_SERVICE_URL ? new URL(env.ML_SERVICE_URL).host : 'not configured (manual quality only)',
    paymentProvider: env.PAYMENT_PROVIDER === 'demo' ? 'DEMO — no money moves' : env.PAYMENT_PROVIDER,
  });
});

// Started here, not in createApp(), so tests that build the app never get a
// background timer writing to the database.
const stopQueueScheduler = startQueueScheduler();
// Asks the payment provider about in-flight payments until each has an answer.
const stopPaymentPoller = startPaymentPoller();

function shutdown(signal: string): void {
  logger.info('shutting down', { signal });
  stopQueueScheduler();
  stopPaymentPoller();
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
