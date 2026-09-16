import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider.js';
import { useT } from '../../i18n/index.js';
import { LanguageSwitcher } from '../LanguageSwitcher.js';
import { api } from '../../lib/api.js';

/**
 * The farmer header (§7, §17).
 *
 * Branding, language, notifications, account and sign out. Present on every
 * authenticated farmer page so the exits are always in the same place.
 *
 * `unreadCount` is optional: the dashboard already has it from its one
 * combined fetch and passes it down to avoid a second request, but every
 * other farmer page renders this header with no props at all — so when it is
 * not supplied, the header fetches its own count. Either way the bell is a
 * real link with a real count, not the permanently-inert placeholder Phase 3
 * left here.
 */
export function FarmerHeader({
  unreadCount,
}: {
  unreadCount?: number;
}): JSX.Element {
  const { signOut } = useAuth();
  const t = useT();
  const location = useLocation();

  const onProfile = location.pathname === '/farmer/profile';
  const onNotifications = location.pathname === '/farmer/notifications';
  const onSupport = location.pathname === '/farmer/support';

  const [ownUnread, setOwnUnread] = useState<number | null>(null);

  useEffect(() => {
    if (unreadCount !== undefined) return;
    let cancelled = false;
    api
      .get<{ unreadCount: number }>('/api/farmer/notifications?limit=1')
      .then((data) => {
        if (!cancelled) setOwnUnread(data.unreadCount);
      })
      .catch(() => {
        // A failed count is not worth showing an error for — the bell just
        // shows no badge, and the full list still loads normally on open.
      });
    return () => {
      cancelled = true;
    };
  }, [unreadCount, location.pathname]);

  const effectiveUnread = unreadCount ?? ownUnread ?? 0;

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link to="/farmer/dashboard" className="flex items-center gap-2.5">
          <span className="brand-mark">KS</span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-wide text-stone-900">{t('app.name')}</span>
            <span className="text-xs text-stone-500">{t('app.farmerPortal')}</span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <LanguageSwitcher compact />

          {onNotifications ? (
            <span
              aria-hidden="true"
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-harvest-500 bg-harvest-50 text-sm text-harvest-800"
            >
              🔔
            </span>
          ) : (
            <Link
              to="/farmer/notifications"
              aria-label={
                effectiveUnread > 0
                  ? t('dashboard.notifications.unread', { count: effectiveUnread })
                  : t('dashboard.notifications.title')
              }
              className="relative flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-sm text-stone-700 transition hover:bg-stone-50"
            >
              <span aria-hidden="true">🔔</span>
              {effectiveUnread > 0 ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white"
                >
                  {effectiveUnread > 9 ? '9+' : effectiveUnread}
                </span>
              ) : null}
            </Link>
          )}

          {/* Dashboard, Support and Profile are always the same three boxes
              in the same order — never hidden or swapped for one another —
              so where to tap next never shifts once a farmer has learned it.
              The current page is simply marked, not removed. */}
          <NavPill to="/farmer/dashboard" active={location.pathname === '/farmer/dashboard'}>
            {t('dashboard.nav.dashboard')}
          </NavPill>
          <NavPill to="/farmer/support" active={onSupport}>
            {t('dashboard.nav.support')}
          </NavPill>
          <NavPill to="/farmer/profile" active={onProfile}>
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
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? 'border-harvest-500 bg-harvest-50 text-harvest-800'
          : 'border-stone-300 text-stone-700 hover:bg-stone-50'
      }`}
    >
      {children}
    </Link>
  );
}
