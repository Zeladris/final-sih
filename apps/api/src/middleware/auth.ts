import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { forbidden, unauthenticated } from '../lib/errors.js';
import { logger, maskPhone } from '../lib/logger.js';
import { createUserClient, supabaseAnonClient } from '../lib/supabase.js';
import { loadAuthContext } from '../services/auth/authContextService.js';
import type { AuthContext, PendingAuthContext } from '../types/request.js';

const BEARER = /^Bearer\s+(.+)$/i;

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Establishes a Supabase session for the request (§25).
 *
 * The token is verified by Supabase (`auth.getUser`), never decoded and
 * trusted locally, so a forged or expired JWT cannot produce a session.
 * The resulting client carries that token, which is what makes every
 * downstream query run under the user's RLS policies.
 */
async function resolveSession(req: Request): Promise<PendingAuthContext> {
  const token = extractBearerToken(req);
  if (!token) {
    throw unauthenticated('Sign in to continue.');
  }

  const { data, error } = await supabaseAnonClient.auth.getUser(token);

  if (error || !data.user) {
    // Covers expired, revoked and malformed tokens alike. The client should
    // refresh its session and retry.
    throw unauthenticated('Your session has expired. Sign in again.', {
      reason: error?.message,
    });
  }

  return {
    userId: data.user.id,
    phone: data.user.phone ? `+${data.user.phone.replace(/^\+/, '')}` : null,
    db: createUserClient(token),
  };
}

/**
 * Accepts any valid Supabase session, including one with no application
 * profile yet. Only the onboarding endpoints should use this.
 */
export const requireSession: RequestHandler = (req, _res, next) => {
  resolveSession(req)
    .then((session) => {
      req.session = session;
      // A profile may already exist; attaching it when it does lets the same
      // handler answer "already registered" without a second lookup.
      return loadAuthContext(session).then((auth) => {
        if (auth) req.auth = auth;
      });
    })
    .then(() => next())
    .catch(next);
};

/**
 * The standard gate: a valid session AND a completed application profile.
 *
 * Everything on `req.auth` afterwards — id, role, scope — is server-derived.
 * Nothing in the request body or query string influences it (§60.5).
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  resolveSession(req)
    .then(async (session) => {
      req.session = session;
      const auth = await loadAuthContext(session);

      if (!auth) {
        logger.debug('authenticated user has no application profile', {
          userId: session.userId,
          phone: maskPhone(session.phone),
        });
        throw forbidden('Finish setting up your account before continuing.', {
          reason: 'NO_PROFILE',
        });
      }

      req.auth = auth;
    })
    .then(() => next())
    .catch(next);
};

/** Narrowing helper so handlers do not repeat non-null assertions. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) {
    throw unauthenticated('Sign in to continue.');
  }
  return req.auth;
}

export function sessionOf(req: Request): PendingAuthContext {
  if (!req.session) {
    throw unauthenticated('Sign in to continue.');
  }
  return req.session;
}

/** Wraps an async handler so a rejected promise reaches the error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
