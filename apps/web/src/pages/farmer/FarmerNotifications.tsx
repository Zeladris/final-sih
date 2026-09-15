import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationListItem, NotificationListResponse } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { useNotificationRealtime } from '../../features/notifications/hooks/useNotificationRealtime.js';
import { formatInr } from '../../features/payments/format.js';

/** Where tapping a notification goes, when it has somewhere to go (§18). A
 *  category or entity this build does not recognise simply gets no link —
 *  never a guess at a URL that might belong to someone else's data. */
function deepLinkFor(item: NotificationListItem): string | null {
  if (item.category === 'VERIFICATION') return '/farmer/status';
  if (!item.bookingId) return null;

  switch (item.category) {
    case 'BOOKING':
      return `/farmer/bookings/${item.bookingId}`;
    case 'QUEUE':
    case 'PROCUREMENT':
      return `/farmer/bookings/${item.bookingId}/status`;
    case 'PAYMENT':
      return `/farmer/bookings/${item.bookingId}/payment`;
    default:
      return null;
  }
}

type Filter = 'ALL' | 'UNREAD';

export function FarmerNotifications(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { profile } = useAuth();

  const [items, setItems] = useState<NotificationListItem[] | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  const load = useCallback((): void => {
    setError(null);
    api
      .get<NotificationListResponse>('/api/farmer/notifications')
      .then((data) => {
        setItems(data.items);
        setUnreadCount(data.unreadCount);
        setNextCursor(data.nextCursor);
      })
      .catch(setError);
  }, []);

  useEffect(load, [load]);
  useNotificationRealtime(profile?.id ?? null, load);

  async function loadMore(): Promise<void> {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const data = await api.get<NotificationListResponse>(
        `/api/farmer/notifications?before=${encodeURIComponent(nextCursor)}`,
      );
      setItems((current) => [...(current ?? []), ...data.items]);
      setNextCursor(data.nextCursor);
    } catch (cause) {
      setError(cause);
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(item: NotificationListItem): Promise<void> {
    if (item.read) return;
    setItems((current) =>
      current ? current.map((row) => (row.id === item.id ? { ...row, read: true } : row)) : current,
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    try {
      await api.post(`/api/farmer/notifications/${item.id}/read`, {});
    } catch {
      // A failed mark-read is not worth an error banner; a page refresh
      // simply shows it unread again, which is honest, not broken.
    }
  }

  async function markAllRead(): Promise<void> {
    setBusyAll(true);
    try {
      await api.post('/api/farmer/notifications/read-all', {});
      setItems((current) => (current ? current.map((row) => ({ ...row, read: true })) : current));
      setUnreadCount(0);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyAll(false);
    }
  }

  const paramsFor = (params: Record<string, string | number | boolean>): Record<string, string | number> => {
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(params)) {
      out[key] = key === 'amount' ? formatInr(String(value), language) : String(value);
    }
    return out;
  };

  const formatWhen = (iso: string): string =>
    new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso));

  const visible = (items ?? []).filter((item) => filter === 'ALL' || !item.read);

  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader unreadCount={unreadCount} />

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-stone-900">{t('dashboard.notifications.title')}</h1>
          {unreadCount > 0 ? (
            <button
              type="button"
              className="text-sm font-medium text-harvest-800 underline underline-offset-2 disabled:text-stone-400"
              onClick={() => void markAllRead()}
              disabled={busyAll}
            >
              {t('notifications.markAllRead')}
            </button>
          ) : null}
        </div>

        <div className="flex gap-2" role="tablist" aria-label={t('notifications.filter')}>
          {(['ALL', 'UNREAD'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={filter === option}
              onClick={() => setFilter(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                filter === option
                  ? 'bg-harvest-600 text-white'
                  : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-300'
              }`}
            >
              {t(option === 'ALL' ? 'notifications.filterAll' : 'notifications.filterUnread')}
            </button>
          ))}
        </div>

        {error ? <ErrorPanel error={error} /> : null}

        {items === null ? (
          <Spinner label={t('common.loading')} />
        ) : visible.length === 0 ? (
          <div className="card text-center">
            <p className="text-sm text-stone-700">{t('dashboard.notifications.none')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((item) => {
              const link = deepLinkFor(item);
              const title = item.title ?? t(item.titleKey, paramsFor(item.params));
              const body = item.body ?? (item.bodyKey ? t(item.bodyKey, paramsFor(item.params)) : null);

              const content = (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm text-stone-900 ${item.read ? '' : 'font-semibold'}`}>{title}</p>
                    {item.priority === 'URGENT' || item.priority === 'HIGH' ? (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.priority === 'URGENT'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {t(`notification.priority.${item.priority}`)}
                      </span>
                    ) : null}
                  </div>
                  {body ? <p className="mt-0.5 text-sm text-stone-600">{body}</p> : null}
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-stone-400">
                    <span>{t(`notification.category.${item.category}`)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatWhen(item.createdAt)}</span>
                  </div>
                  <span className="sr-only">
                    {item.read
                      ? t('dashboard.notifications.readLabel')
                      : t('dashboard.notifications.unreadLabel')}
                  </span>
                </>
              );

              return (
                <li key={item.id} className="relative">
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-4 h-2 w-2 -translate-x-4 rounded-full ${
                      item.read ? 'bg-transparent' : 'bg-harvest-600'
                    }`}
                  />
                  {link ? (
                    <Link
                      to={link}
                      onClick={() => void markRead(item)}
                      className={`card block transition hover:bg-stone-50 ${item.read ? '' : 'border-harvest-200 bg-harvest-50/40'}`}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void markRead(item)}
                      className={`card block w-full text-left transition hover:bg-stone-50 ${item.read ? '' : 'border-harvest-200 bg-harvest-50/40'}`}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {nextCursor && filter === 'ALL' ? (
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => void loadMore()}
            disabled={loadingMore}
          >
            {loadingMore ? t('common.loading') : t('notifications.loadMore')}
          </button>
        ) : null}
      </main>
    </div>
  );
}
