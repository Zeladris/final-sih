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

          {/* Fixed set of boxes in a fixed order — never hidden or swapped
              for one another — so staff always tap the same spot for the
              same destination. The current page is marked, not removed. */}
          <NavPill to="/staff/dashboard" active={location.pathname === '/staff/dashboard'}>
            {t('dashboard.nav.dashboard')}
          </NavPill>
          <NavPill to="/staff/payments" active={location.pathname === '/staff/payments'}>
            {t('payment.nav')}
          </NavPill>
          <NavPill to="/staff/queue" active={location.pathname === '/staff/queue'}>
            {t('queue.nav')}
          </NavPill>
          <NavPill to="/support" active={location.pathname === '/support'}>
            {t('gov.tab.grievances')}
          </NavPill>
          <NavPill to="/staff/profile" active={onProfile}>
            {t('dashboard.nav.profile')}
          </NavPill>

          <button type="button" className="btn-secondary" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </div>
      </div>
    </header>
  );
}

function NavPill({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-harvest-500 bg-harvest-50 text-harvest-800'
          : 'border-stone-300 text-stone-700 hover:bg-stone-50'
      }`}
    >
      {children}
    </Link>
  );
}
