import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { isCancellable } from '@kisansetu/shared';
import type { FarmerBooking, PreArrivalQualityAssessment } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { MspSummaryCard } from '../../features/procurement-status/components/MspSummaryCard.js';

/**
 * One booking, in detail (§32, §33).
 *
 * Doubles as the success screen: arriving with `?created=1` shows the
 * confirmation banner, so a fresh booking and a revisited one render the same
 * facts and there is only one page to keep correct.
 */
export function FarmerBookingDetails(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const justCreated = searchParams.get('created') === '1';

  const [booking, setBooking] = useState<FarmerBooking | null>(null);
  const [assessment, setAssessment] = useState<PreArrivalQualityAssessment | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ booking: FarmerBooking }>(
        `/api/farmer/bookings/${bookingId}`,
      );
      setBooking(data.booking);
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [bookingId]);

  // The pre-arrival indication, if one was made (§15). Its absence is normal
  // and silent — the booking page does not need to explain a missing extra.
  useEffect(() => {
    api
      .get<{ assessment: PreArrivalQualityAssessment | null }>(
        `/api/farmer/bookings/${bookingId}/quality-assessment`,
      )
      .then((data) => setAssessment(data.assessment))
      .catch(() => setAssessment(null));
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ booking: FarmerBooking }>(
        `/api/farmer/bookings/${bookingId}/cancel`,
        {},
      );
      setBooking(data.booking);
      setConfirmCancel(false);
    } catch (cause) {
      setError(cause);
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  if (error && !booking) {
    return (
      <Shell>
        <ErrorPanel error={error} />
        <Link to="/farmer/bookings" className="btn-secondary mt-4 inline-block">
          {t('booking.list.title')}
        </Link>
      </Shell>
    );
  }

  if (!booking) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(language === 'ta' ? 'ta-IN' : 'en-IN', {
      dateStyle: 'long',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(`${iso}T00:00:00+05:30`));

  return (
    <Shell>
      {justCreated && booking.status === 'BOOKED' ? (
        <section className="card border-2 border-harvest-300 bg-harvest-50 text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-harvest-600 text-2xl text-white"
          >
            ✓
          </div>
          <h1 className="text-xl font-semibold text-stone-900">{t('booking.success.title')}</h1>
          <p className="mt-1 text-sm text-stone-700">{t('booking.success.body')}</p>
        </section>
      ) : null}

      <section className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('booking.detail.reference')}
        </p>
        {/* The booking ID is what a farmer quotes at the centre — make it big. */}
        <p className="font-mono text-lg font-semibold text-stone-900">
          {booking.bookingReference}
        </p>

        <StatusLine booking={booking} />

        <dl className="mt-4 space-y-2">
          <Row label={t('ops.field.crop')} value={booking.cropName} />
          <Row
            label={t('booking.details.quantity')}
            value={`${booking.expectedQuantityKg} ${booking.quantityUnit}`}
          />
          <Row
            label={t('dashboard.procurement.centre')}
            value={[booking.centreName, booking.centreVillage].filter(Boolean).join(' · ')}
          />
          <Row label={t('ops.field.date')} value={formatDate(booking.slotDate)} />
          <Row label={t('ops.field.slot')} value={`${booking.slotStart}–${booking.slotEnd}`} />
          <Row
            label={t('booking.location.where')}
            value={booking.storageLocationText ?? t('common.notProvided')}
          />
          {booking.harvestDate ? (
            <Row
              label={t('booking.details.harvestDate')}
              value={formatDate(booking.harvestDate)}
            />
          ) : null}
        </dl>
      </section>

      {/* Demo/indicative MSP (demo addition) — shown right after the crop and
          quantity the farmer just booked. */}
      <MspSummaryCard bookingId={booking.id} />

      {/* The pre-arrival indication, stated as exactly that (§15). */}
      {assessment?.status === 'COMPLETED' ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('quality.preArrival.title')}</h2>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            {assessment.qualityScore !== null ? (
              <p className="text-xl font-semibold text-stone-900">
                {t('booking.photo.result.score', { score: Math.round(assessment.qualityScore) })}
              </p>
            ) : null}
            {assessment.qualityRisk ? (
              <p className="text-sm text-stone-700">
                {t('quality.risk')}: {t(`quality.risk.${assessment.qualityRisk}`)}
              </p>
            ) : null}
            {assessment.confidence !== null ? (
              <p className="text-sm text-stone-700">
                {t('quality.confidence')}:{' '}
                {assessment.lowConfidence
                  ? t('quality.confidence.low')
                  : `${Math.round(assessment.confidence * 100)}%`}
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-sm text-stone-600">{t('booking.photo.result.advisory')}</p>

          {assessment.trainingData ? (
            <p className="mt-2 text-xs text-stone-500">
              {t('quality.provenance', {
                model: assessment.modelVersion ?? '',
                data: assessment.trainingData,
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {booking.status === 'BOOKED' ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('booking.detail.whatNext')}</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-700">
            <li>{t('booking.detail.bringId')}</li>
            <li>{t('booking.detail.arriveOnTime')}</li>
            <li>{t('booking.detail.quantityNote')}</li>
          </ul>
        </section>
      ) : null}

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex flex-wrap gap-2">
        <Link to="/farmer/dashboard" className="btn-secondary">
          {t('dashboard.nav.dashboard')}
        </Link>
        <Link to="/farmer/bookings" className="btn-secondary">
          {t('booking.list.title')}
        </Link>
      </div>

      {/* Cancellation is refused server-side once the centre has started, so
          this hides an action that would only fail (§35). */}
      {isCancellable(booking) ? (
        <section className="card border-stone-200">
          {confirmCancel ? (
            <>
              <p className="text-sm font-medium text-stone-900">
                {t('booking.cancel.confirmTitle')}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {formatDate(booking.slotDate)} · {booking.slotStart}–{booking.slotEnd}
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn-secondary flex-1"
                  onClick={() => setConfirmCancel(false)}
                  disabled={busy}
                >
                  {t('booking.cancel.keep')}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-lg bg-red-700 px-4 py-3 text-base font-semibold text-white disabled:bg-stone-300"
                  onClick={() => void cancel()}
                  disabled={busy}
                >
                  {busy ? t('common.saving') : t('booking.cancel.confirm')}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="text-sm text-red-700 underline underline-offset-2"
              onClick={() => setConfirmCancel(true)}
            >
              {t('booking.cancel.action')}
            </button>
          )}
        </section>
      ) : null}
    </Shell>
  );
}

/**
 * Where the booking stands, in the farmer's words (Phase 6).
 *
 * The full journey and live updates live on the status page; this is the
 * one-line summary plus the way there.
 */
function StatusLine({ booking }: { booking: FarmerBooking }): JSX.Element {
  const t = useT();
  const ended = booking.farmerStatus === 'CANCELLED' || booking.farmerStatus === 'MISSED';

  return (
    <div
      className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ${
        ended ? 'bg-stone-100' : 'bg-harvest-50'
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${ended ? 'text-stone-700' : 'text-harvest-900'}`}>
          {t(`status.farmer.${booking.farmerStatus}.label`)}
        </p>
        <p className="text-xs text-stone-600">{t(`status.farmer.${booking.farmerStatus}.message`)}</p>
      </div>
      {!ended ? (
        <Link
          to={`/farmer/bookings/${booking.id}/status`}
          className="text-sm font-medium text-harvest-800 underline underline-offset-2"
        >
          {t('liveStatus.view')}
        </Link>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-2 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-sm font-medium text-stone-900">{value}</dd>
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
