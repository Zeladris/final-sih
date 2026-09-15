import { Link } from 'react-router-dom';
import type { NotificationSummary } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';
import { formatInr } from '../../features/payments/format.js';

/**
 * Messages (§13).
 *
 * The notification engine is Phase 11. This is the display integration point:
 * it renders whatever a provider supplies and an honest empty state otherwise.
 * It never shows a fabricated unread count (§37).
 */
export function NotificationSummaryCard({
  summary,
}: {
  summary: NotificationSummary;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  // Amounts arrive as exact strings; shown in the reader's own number format.
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

  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-stone-900">{t('dashboard.notifications.title')}</h2>
        {summary.status === 'OK' && summary.unreadCount > 0 ? (
          <span className="rounded-full bg-harvest-100 px-2 py-0.5 text-xs font-semibold text-harvest-800">
            {t('dashboard.notifications.unread', { count: summary.unreadCount })}
          </span>
        ) : null}
      </div>

      {summary.recent.length === 0 ? (
        <div className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center">
          <p className="text-sm text-stone-700">{t('dashboard.notifications.none')}</p>
          {summary.status === 'NOT_AVAILABLE' ? (
            <p className="mt-1 text-xs text-stone-500">{t('dashboard.comingSoon')}</p>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {summary.recent.map((message) => (
            <li key={message.id} className="flex items-start gap-2.5 py-2.5">
              {/* Unread is marked by a dot AND bold text, not colour alone. */}
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  message.read ? 'bg-transparent' : 'bg-harvest-600'
                }`}
              />
              <div className="min-w-0">
                <p
                  className={`text-sm text-stone-900 ${message.read ? '' : 'font-semibold'}`}
                >
                  {message.title ?? t(message.titleKey, paramsFor(message.params))}
                </p>
                {message.bodyKey ? (
                  <p className="text-xs text-stone-600">{t(message.bodyKey, paramsFor(message.params))}</p>
                ) : message.body ? (
                  <p className="text-xs text-stone-600">{message.body}</p>
                ) : null}
                {message.params.demo === true ? (
                  <p className="text-xs font-medium text-sky-800">{t('payment.demoShort')}</p>
                ) : null}
                {message.bookingId ? (
                  <Link
                    to={`/farmer/bookings/${message.bookingId}/payment`}
                    className="text-xs text-harvest-800 underline underline-offset-2"
                  >
                    {t('payment.view')}
                  </Link>
                ) : null}
                <p className="mt-0.5 text-xs text-stone-400">{formatWhen(message.createdAt)}</p>
                <span className="sr-only">
                  {message.read
                    ? t('dashboard.notifications.readLabel')
                    : t('dashboard.notifications.unreadLabel')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {summary.status === 'OK' ? (
        <Link
          to="/farmer/notifications"
          className="mt-3 block text-center text-sm text-harvest-800 underline underline-offset-2"
        >
          {t('dashboard.notifications.viewAll')}
        </Link>
      ) : null}
    </section>
  );
}
