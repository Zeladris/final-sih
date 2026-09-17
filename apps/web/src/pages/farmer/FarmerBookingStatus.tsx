import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { useProcurementStatus } from '../../features/procurement-status/hooks/useProcurementStatus.js';
import { CurrentStatusCard } from '../../features/procurement-status/components/CurrentStatusCard.js';
import { MspSummaryCard } from '../../features/procurement-status/components/MspSummaryCard.js';
import { ColdStorageCard } from '../../features/procurement-status/components/ColdStorageCard.js';
import { LiveIndicator } from '../../features/procurement-status/components/LiveIndicator.js';
import { StatusTimeline } from '../../features/procurement-status/components/StatusTimeline.js';

/**
 * Live procurement status for one booking (Phase 6 §13).
 *
 * Mobile-first, one column. What is happening now comes first, then the
 * booking facts a farmer quotes at the counter, then the whole journey.
 */
export function FarmerBookingStatus(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { bookingId = '' } = useParams();
  const { data, error, connection, lastChange, refresh } = useProcurementStatus(bookingId);

  if (!data && error) {
    return (
      <Shell>
        <ErrorPanel error={error} />
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => void refresh()}>
            {t('common.retry')}
          </button>
          <Link to="/farmer/bookings" className="btn-secondary">
            {t('booking.list.title')}
          </Link>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  const date = data.slotDate
    ? new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
        dateStyle: 'long',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(`${data.slotDate}T00:00:00+05:30`))
    : null;

  const cropName = language === 'ta' && data.cropNameTa ? data.cropNameTa : data.cropName;

  return (
    <Shell>
      <LiveIndicator connection={connection} updatedAt={data.updatedAt} />

      {connection === 'RECONNECTING' ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('liveStatus.unavailable')}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('liveStatus.refreshFailed')}
        </p>
      ) : null}

      <ChangeNotice change={lastChange} />

      <CurrentStatusCard status={data} />

      {/* Demo/indicative MSP (demo addition) — updates itself from booked to
          procured quantity once weighing happens, same fetch-and-render-
          nothing-if-absent pattern as the cold storage card below. */}
      <MspSummaryCard bookingId={data.bookingId} />

      {/* Cold storage (demo addition) — a sibling fact about this booking,
          shown only when the centre could not procure the full crop today.
          It has its own fetch and renders nothing when there's no offer and
          no reservation, so the normal journey below is unaffected. */}
      <ColdStorageCard bookingId={data.bookingId} />

      <section className="card">
        <dl className="space-y-2">
          <Row label={t('liveStatus.bookingId')} value={data.bookingReference} mono />
          <Row
            label={t('liveStatus.procurementId')}
            value={data.procurementReference ?? t('liveStatus.procurementIdPending')}
            mono={Boolean(data.procurementReference)}
            muted={!data.procurementReference}
          />
          <Row
            label={t('dashboard.procurement.centre')}
            value={[data.centreName, data.centreVillage].filter(Boolean).join(' · ')}
          />
          <Row label={t('dashboard.procurement.crop')} value={cropName} />
          <Row
            label={t('dashboard.procurement.quantity')}
            value={`${data.expectedQuantity} ${data.quantityUnit}`}
          />
          {date ? (
            <Row
              label={t('liveStatus.scheduled')}
              value={data.slotStart ? `${date} · ${data.slotStart}–${data.slotEnd}` : date}
            />
          ) : null}
        </dl>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-stone-900">{t('liveStatus.journey')}</h2>
        <StatusTimeline steps={data.timeline} />
      </section>

      <div className="flex flex-wrap gap-2">
        {data.procurementReference ? (
          <Link to={`/farmer/bookings/${data.bookingId}/payment`} className="btn-primary">
            {t('payment.view')}
          </Link>
        ) : null}
        <Link to={`/farmer/bookings/${data.bookingId}`} className="btn-secondary">
          {t('liveStatus.bookingDetails')}
        </Link>
        <Link to="/farmer/dashboard" className="btn-secondary">
          {t('dashboard.nav.dashboard')}
        </Link>
      </div>
    </Shell>
  );
}

/** A subtle, dismissable note when the status changes while the page is open (§15.8). */
function ChangeNotice({
  change,
}: {
  change: { to: string; at: number } | null;
}): JSX.Element | null {
  const t = useT();
  const [visibleAt, setVisibleAt] = useState<number | null>(null);

  useEffect(() => {
    if (!change) return undefined;
    setVisibleAt(change.at);
    const timer = window.setTimeout(() => setVisibleAt(null), 8000);
    return () => window.clearTimeout(timer);
  }, [change]);

  if (!change || visibleAt !== change.at) return null;

  return (
    <p
      role="status"
      className="rounded-lg border border-harvest-200 bg-white px-3 py-2 text-sm text-harvest-900"
    >
      {t('liveStatus.changed', { status: t(`status.farmer.${change.to}.label`) })}
    </p>
  );
}

function Row({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-2 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd
        className={`text-sm ${mono ? 'font-mono' : ''} ${
          muted ? 'text-stone-500' : 'font-medium text-stone-900'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
