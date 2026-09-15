import type { Request, Response } from 'express';
import { ROLES } from '@kisansetu/shared';
import type { FarmerAccountSummary, MeResponse } from '@kisansetu/shared';
import { authOf, sessionOf } from '../middleware/auth.js';
import { recordAudit } from '../services/audit/auditService.js';
import { loadFarmerAccountSummary } from '../services/auth/farmerAccountService.js';
import type { AuthContext } from '../types/request.js';

/**
 * There is one sign-in screen for every role. Nothing in these handlers reads a
 * role, portal or scope from the request — the caller authenticates, and the
 * server tells them who they are from the profile and assignment rows. The
 * client routes on that answer; every protected API route re-checks it with
 * `requireRole`, and RLS checks it again.
 */

async function accountSummaryFor(auth: AuthContext): Promise<FarmerAccountSummary | null> {
  if (auth.role !== ROLES.FARMER) return null;
  return loadFarmerAccountSummary(auth.db, auth.userId);
}

/**
 * GET /api/auth/me — the canonical application identity endpoint (§10, §21).
 *
 * The client asks the server who it is; it never decides for itself. Role,
 * scope and farmer account state here are the same values every authorization
 * check uses, which is why editing role in frontend state changes nothing.
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);

  const body: MeResponse = {
    user: {
      id: auth.userId,
      role: auth.role,
      name: auth.fullName,
      phone: auth.phone,
      status: auth.status,
      preferredLanguage: auth.preferredLanguage,
    },
    scope: auth.scope,
    account: await accountSummaryFor(auth),
  };

  res.json(body);
}

/**
 * GET /api/auth/session — the post-login routing answer.
 *
 * Accepts a caller who has authenticated but has no profile yet, so a new
 * farmer is told to register (`onboarded: false`) instead of being refused. A
 * profile that exists but is unusable never reaches here: `requireSession`
 * rejects it with ACCOUNT_NOT_CONFIGURED, which the client shows as such.
 */
export async function getSessionState(req: Request, res: Response): Promise<void> {
  const session = sessionOf(req);
  const auth = req.auth;

  res.json({
    authenticated: true,
    onboarded: Boolean(auth),
    user: auth
      ? {
          id: auth.userId,
          role: auth.role,
          name: auth.fullName,
          phone: auth.phone,
          status: auth.status,
          preferredLanguage: auth.preferredLanguage,
        }
      : { id: session.userId, phone: session.phone },
    scope: auth?.scope ?? null,
    account: auth ? await accountSummaryFor(auth) : null,
  });
}

/**
 * POST /api/auth/events/signed-in — the client reports a completed OTP login
 * so the server can audit it (§30 LOGIN / OTP_VERIFIED).
 *
 * Recorded only for a caller holding a token the server already verified, so
 * it cannot forge login records for other accounts. The role recorded is the
 * server-derived one. The OTP value itself is never sent here.
 */
export async function recordSignIn(req: Request, res: Response): Promise<void> {
  const session = sessionOf(req);

  await recordAudit(req, {
    action: 'OTP_VERIFIED',
    entityType: 'auth.users',
    entityId: session.userId,
    actorUserId: session.userId,
    metadata: { onboarded: Boolean(req.auth) },
  });

  if (req.auth) {
    await recordAudit(req, {
      action: 'LOGIN',
      entityType: 'profiles',
      entityId: req.auth.userId,
      metadata: { role: req.auth.role },
    });
  }

  res.status(204).end();
}
