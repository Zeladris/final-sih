import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Role } from '@kisansetu/shared';
import { useAuth } from '../auth/AuthProvider.js';
import { useT } from '../i18n/index.js';
import { FullPageSpinner } from './Spinner.js';
import { AccessDenied } from './AccessDenied.js';
import { AccountLoadFailed, AccountNotConfigured } from './AccountProblem.js';

/**
 * Route guards (§18).
 *
 * A UX affordance, not a security control. They stop a signed-out user seeing
 * an empty dashboard flash and send the wrong role to a clear 403 — but
 * enforcement is the API middleware (`requireRole` on every route group) and
 * RLS. A user who edits these components in devtools gets a rendered shell
 * whose every request comes back 403.
 */

/** Sends an unauthenticated caller to the one sign-in page, explaining an expiry if that is why (§16). */
function loginRedirect(fromPath: string, sessionExpired: boolean): JSX.Element {
  return <Navigate to={sessionExpired ? '/?reason=expired' : '/'} state={{ from: fromPath }} replace />;
}

export function RequireAuth({ children }: { children: ReactNode }): JSX.Element {
  const { session, loading, sessionExpired } = useAuth();
  const t = useT();
  const location = useLocation();

  if (loading) return <FullPageSpinner label={t('common.loading')} />;
  if (!session) return loginRedirect(location.pathname, sessionExpired);

  return <>{children}</>;
}

export function RequireRole({
  role,
  children,
}: {
  /** One role, or several when a page serves more than one (e.g. both admin levels). */
  role: Role | readonly Role[];
  children: ReactNode;
}): JSX.Element {
  const { session, profile, loading, needsOnboarding, accountNotConfigured, profileLoadFailed, sessionExpired } =
    useAuth();
  const t = useT();
  const location = useLocation();
  const roles: readonly Role[] = Array.isArray(role) ? role : [role as Role];
  const primary = roles[0]!;

  if (loading) return <FullPageSpinner label={t('common.loading')} />;
  if (!session) return loginRedirect(location.pathname, sessionExpired);
  if (accountNotConfigured) return <AccountNotConfigured />;
  if (profileLoadFailed) return <AccountLoadFailed />;

  // Authenticated, but no application profile yet. Only farmers can create one
  // themselves; a government account in this state was never provisioned.
  if (needsOnboarding) {
    if (roles.includes('FARMER')) {
      return <Navigate to="/farmer/registration/start" replace />;
    }
    return <AccessDenied requiredRole={primary} messageKey="access.notProvisioned" />;
  }

  if (!profile) return <FullPageSpinner label={t('common.loading')} />;

  // The role came from the server, so this compares server truth to the area
  // the user opened — not one client value against another.
  if (!roles.includes(profile.role)) return <AccessDenied requiredRole={primary} />;

  return <>{children}</>;
}

// NOTE: a `RequireAccountState` guard lived here through Phase 2, gating the
// dashboard to VERIFIED. Phase 3 made the dashboard the landing page for every
// registered farmer — the verification card adapts instead — so nothing used
// it any more and it was removed rather than left as misleading dead code.
//
// `RedirectIfAuthenticated` wrapped the four per-role login pages. There is now
// one sign-in page at `/`, and the landing route itself sends a signed-in user
// onward, so it was removed with them.
