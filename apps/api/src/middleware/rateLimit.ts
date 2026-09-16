import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { API_ERROR_CODES } from '@kisansetu/shared';
import type { ApiError } from '@kisansetu/shared';
import { RATE_LIMITS } from '../config/constants.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Collapses an IPv6 address to its /64 prefix.
 *
 * A single residential IPv6 allocation covers billions of addresses, so
 * limiting per exact address would let one client sidestep the budget just by
 * rotating within its own subnet.
 */
function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;

  const groups = ip.replace(/^::ffff:/i, '').split(':');
  return groups.length > 4 ? `${groups.slice(0, 4).join(':')}::/64` : ip;
}

/**
 * Abuse protection for the endpoints that cost something to call (§36).
 *
 * Supabase Auth throttles OTP issuance itself; this protects *our* endpoints,
 * which it knows nothing about. Limits are keyed by authenticated user where
 * one exists, so several farmers behind one village connection do not share a
 * budget, and by IP otherwise.
 */
function makeLimiter(config: { windowMs: number; max: number }, name: string): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests would otherwise fail intermittently as fixtures reuse accounts.
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: (req) => req.auth?.userId ?? req.session?.userId ?? ipKey(req.ip),
    handler: (req, res) => {
      logger.warn('rate limit exceeded', {
        limiter: name,
        requestId: req.requestId,
        path: req.originalUrl,
      });

      const body: ApiError = {
        error: {
          code: API_ERROR_CODES.RATE_LIMITED,
          message: 'Too many requests. Wait a moment and try again.',
          requestId: req.requestId,
        },
      };
      res.status(429).json(body);
    },
  });
}

export const generalLimiter = makeLimiter(RATE_LIMITS.general, 'general');
export const authLimiter = makeLimiter(RATE_LIMITS.auth, 'auth');
export const documentUploadLimiter = makeLimiter(RATE_LIMITS.documentUpload, 'documentUpload');
export const verificationLimiter = makeLimiter(RATE_LIMITS.verificationSubmit, 'verificationSubmit');
export const paymentLimiter = makeLimiter(RATE_LIMITS.paymentAction, 'paymentAction');
export const locationSearchLimiter = makeLimiter(RATE_LIMITS.locationSearch, 'locationSearch');
export const voiceLimiter = makeLimiter(RATE_LIMITS.voice, 'voice');
export const arrivalOtpLimiter = makeLimiter(RATE_LIMITS.arrivalOtp, 'arrivalOtp');
