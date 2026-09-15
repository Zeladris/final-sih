import { Link } from 'react-router-dom';
import type { BookingSummary, BookingSummaryItem } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';
import { formatInr, formatKg } from '../../features/payments/format.js';

/**
 * Procurement activity (§11).
 *
 * With no booking it renders a real empty state — it never invents a booking
 * reference, centre, date or queue position (§37). With one in progress it is
 * the compact "Active procurement" summary linking to the live status page.
 *
 * The `NOT_AVAILABLE` vs `EMPTY` distinction is deliberate: the first means
 * booking does not exist yet, the second that this farmer has none. They read
 * differently to a farmer and they mean different things to us.
 */
export function ProcurementSummaryCard({
  summary,
  eligible,
}: {
  summary: BookingSummary;
  eligible: boolean;
}): JSX.Element {
  const t = useT();

  const booking = summary.active ?? summary.upcoming ?? null;

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">
        {summary.active ? t('dashboard.procurement.active') : t('dashboard.procurement.title')}
      </h2>

      {booking ? (
        <BookingDetail booking={booking} />
      ) : (
        <div className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center">
          <p className="text-sm text-stone-700">{t('dashboard.procurement.none')}</p>

          {summary.status === 'NOT_AVAILABLE' ? (
            <p className="mt-1 text-xs text-stone-500">{t('dashboard.comingSoon')}</p>
          ) : eligible ? (
            <p className="mt-1 text-xs text-stone-500">{t('dashboard.procurement.whenReady')}</p>
          ) : (
            <p className="mt-1 text-xs text-stone-500">
              {t('dashboard.procurement.verifyFirst')}
            </p>
          )}

          {summary.status !== 'NOT_AVAILABLE' && eligible ? (
            <Link to="/farmer/book" className="btn-secondary mt-3 inline-block">
              {t('dashboard.action.bookSlot')}
            </Link>
          ) : null}
        </div>
      )}

      {/* Phase 8 §25 — the most recent completed procurement and its payment. */}
      {!summary.active && summary.mostRecentCompleted?.procurementReference ? (
        <RecentProcurement item={summary.mostRecentCompleted} />
      ) : null}
    </section>
  );
}

function RecentProcurement({ item }: { item: BookingSummaryItem }): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t('payment.recentProcurement')}</h3>
      <PaymentLine item={item} />
      <p className="mt-1 text-xs text-stone-600">
        {item.crop} · {formatKg(item.acceptedQuantityKg, language)} {t('ops.kg')} · {formatInr(item.netAmount, language)}
      </p>
    </div>
  );
}

/** "Payment: Processing / Completed / Action required" — from the persisted payment. */
function PaymentLine({ item }: { item: BookingSummaryItem }): JSX.Element | null {
  const t = useT();
  if (!item.procurementReference || !item.paymentStatus) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-stone-800">
        <span className="font-mono text-xs text-stone-500">{item.procurementReference}</span>
        {' · '}
        {t('payment.statusLabel')}: <strong>{t(`payment.dashboard.${item.paymentStatus}`)}</strong>
        {item.paymentIsDemo ? <span className="ml-1 text-xs text-sky-800">({t('payment.demoShort')})</span> : null}
      </p>
      <Link to={`/farmer/bookings/${item.bookingId}/payment`} className="text-sm font-medium text-harvest-800 underline underline-offset-2">
        {t('payment.view')}
      </Link>
    </div>
  );
}

/** Rendered only from real data — never a literal reference, centre or position. */
function BookingDetail({ booking }: { booking: BookingSummaryItem }): JSX.Element {
  const t = useT();
  const { language } = useI18n();

  const date = new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(`${booking.date}T00:00:00+05:30`));

  return (
    <>
      {/* Status first and compact; the full journey is on the status page (§18). */}
      <div className="mt-3 rounded-lg bg-harvest-50 px-3 py-2">
        <p className="text-sm font-semibold text-harvest-900">
          {t(`status.farmer.${booking.farmerStatus}.label`)}
        </p>
        {booking.queuePosition !== null || booking.estimatedWaitMinutes !== null ? (
          <p className="text-xs text-harvest-900">
            {[
              booking.queuePosition !== null
                ? `${t('liveStatus.queuePosition')}: ${booking.queuePosition}`
                : null,
              booking.estimatedWaitMinutes !== null
                ? t('liveStatus.waitMinutes', { minutes: booking.estimatedWaitMinutes })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </div>
      <PaymentLine item={booking} />
      <BookingRows booking={booking} date={date} />
      <Link
        to={`/farmer/bookings/${booking.bookingId}/status`}
        className="btn-secondary mt-3 inline-block"
      >
        {t('liveStatus.view')}
      </Link>
    </>
  );
}

function BookingRows({ booking, date }: { booking: BookingSummaryItem; date: string }): JSX.Element {
  const t = useT();
  return (
    <dl className="mt-3 space-y-2">
      <Row label={t('dashboard.procurement.reference')} value={booking.reference} />
      <Row label={t('dashboard.procurement.centre')} value={booking.centreName} />
      <Row label={t('dashboard.procurement.crop')} value={booking.crop} />
      <Row
        label={t('dashboard.procurement.quantity')}
        value={`${booking.quantityQtl} ${t('dashboard.procurement.quintal')}`}
      />
      <Row label={t('dashboard.procurement.date')} value={date} />
      {booking.slotStart ? (
        <Row
          label={t('dashboard.procurement.slot')}
          value={booking.slotEnd ? `${booking.slotStart}–${booking.slotEnd}` : booking.slotStart}
        />
      ) : null}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-1.5 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}
