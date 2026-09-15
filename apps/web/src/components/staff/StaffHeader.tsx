import { Link, useLocation } from 'react-router-dom';
import type { StaffCentreSummary } from '@kisansetu/shared';
import { useAuth } from '../../auth/AuthProvider.js';
import { useT } from '../../i18n/index.js';
import { LanguageSwitcher } from '../LanguageSwitcher.js';

/**
 * Staff header (§29).
 *
 * Makes two things unmissable: that this is the Centre Staff portal, and which
 * centre. A staff member who cannot tell at a glance which centre they are
 * operating at is one tap from a mistake that matters.
 */
export function StaffHeader({ centre }: { centre?: StaffCentreSummary }): JSX.Element {
  const { signOut } = useAuth();
  const t = useT();
  const location = useLocation();

  const onProfile = location.pathname === '/staff/profile';

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to="/staff/dashboard" className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-harvest-700">
            {t('app.name')} · {t('role.CENTRE_STAFF')}
          </span>
          {centre ? (
            <p className="truncate text-base font-semibold text-stone-900">{centre.centreName}</p>
          ) : null}
          {centre ? (
            <p className="truncate text-xs text-stone-500">
              {centre.districtName} · {centre.stateName}
            </p>
          ) : null}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitcher compact />

          {location.pathname !== '/staff/payments' ? (
            <Link
              to="/staff/payments"
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              {t('payment.nav')}
            </Link>
          ) : null}

          {location.pathname !== '/staff/queue' ? (
            <Link
              to="/staff/queue"
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              {t('queue.nav')}
            </Link>
          ) : null}

          {location.pathname !== '/support' ? (
            <Link
              to="/support"
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              {t('gov.tab.grievances')}
            </Link>
          ) : null}

          <Link
            to={onProfile ? '/staff/dashboard' : '/staff/profile'}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
          >
            {onProfile ? t('dashboard.nav.dashboard') : t('dashboard.nav.profile')}
          </Link>

          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </header>
  );
}
