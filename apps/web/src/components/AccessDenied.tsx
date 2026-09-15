import { Link } from 'react-router-dom';
import { DASHBOARD_PATH } from '@kisansetu/shared';
import type { Role } from '@kisansetu/shared';
import { useAuth } from '../auth/AuthProvider.js';
import { useT } from '../i18n/index.js';

/**
 * The 403 screen (§29).
 *
 * It says plainly that access was refused rather than silently bouncing the
 * user into whichever area matches their role. A quiet redirect hides a real
 * answer — that this account is not permitted here — and makes a
 * misconfigured account look like a broken app.
 */
export function AccessDenied({
  requiredRole,
  messageKey,
}: {
  requiredRole?: Role;
  messageKey?: string;
}): JSX.Element {
  const { role, signOut } = useAuth();
  const t = useT();

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="card w-full max-w-md text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl"
        >
          🔒
        </div>

        <h1 className="text-xl font-semibold text-stone-900">{t('access.deniedTitle')}</h1>

        <p className="mt-3 text-sm leading-relaxed text-stone-600">
          {messageKey
            ? t(messageKey)
            : requiredRole
              ? t('access.roleOnly', { role: t(`role.${requiredRole}`) })
              : t('access.deniedTitle')}{' '}
          {role ? t('access.signedInAs', { role: t(`role.${role}`) }) : ''}
        </p>

        <div className="mt-6 space-y-3">
          {role ? (
            <Link to={DASHBOARD_PATH[role]} className="btn-primary block text-center">
              {t('access.goToDashboard')}
            </Link>
          ) : (
            <Link to="/" className="btn-primary block text-center">
              {t('access.goHome')}
            </Link>
          )}

          <button type="button" onClick={() => void signOut()} className="btn-secondary w-full">
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
