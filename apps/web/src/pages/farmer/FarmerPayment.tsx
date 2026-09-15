import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FarmerBookingPayment } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { Spinner } from '../../components/Spinner.js';
import { formatDateTime, formatInr, formatKg } from '../../features/payments/format.js';

/**
 * The farmer's payment for one booking (Phase 8 §19, §20, §41).
 *
 * What was accepted, what MSP rate was applied, how much, and where the money
 * is. Three states are kept strictly apart:
 *
 *   * the payment FAILED              → the procurement is safe; it will be retried
 *   * we could not CHECK the status   → says so; never presented as a failure
 *   * the device is offline           → last known state, marked as possibly outdated
 */
export function FarmerPayment(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const { bookingId = '' } = useParams();
  const [data, setData] = useState<FarmerBookingPayment | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const version = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.get<FarmerBookingPayment>(`/api/farmer/bookings/${bookingId}/payment`);
      setData(next);
      setCheckFailed(false);
      setCheckedAt(new Date().toISOString());
    } catch {
      setCheckFailed(true);
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: the farmer's own booking row (Phase 6 realtime), bumped by every
  // payment status change. On any newer version, ask the server again.
  useEffect(() => {
    let cancelled = false;
    const channel = supabase.channel(`booking-payment:${bookingId}`);
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session.session) await supabase.realtime.setAuth(session.session.access_token);
      channel
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${bookingId}` }, (payload) => {
          const v = Number((payload.new as { status_version?: number }).status_version);
          if (Number.isFinite(v) && v > version.current) {
            version.current = v;
            void load();
          }
        })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') void load();
        });
    })();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [bookingId, load]);

  useEffect(() => {
    const on = (): void => {
      setOffline(false);
      void load();
    };
    const off = (): void => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [load]);

  if (!data) {
    return (
      <Shell bookingId={bookingId}>
        {checkFailed ? (
          <section className="card">
            <p className="text-sm text-amber-900">{t('payment.checkFailed')}</p>
            <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </section>
        ) : (
          <Spinner label={t('payment.checking')} />
        )}
      </Shell>
    );
  }

  if (!data.payment) {
    return (
      <Shell bookingId={bookingId}>
        <section className="card">
          <h1 className="text-lg font-semibold text-stone-900">{t('payment.title')}</h1>
          <p className="mt-2 text-sm text-stone-700">{t('payment.farmer.NOT_ELIGIBLE')}</p>
        </section>
      </Shell>
    );
  }

  const p = data.payment;
  const tone =
    p.status === 'SUCCESS'
      ? 'border-harvest-300 bg-harvest-50'
      : p.status === 'FAILED' || p.status === 'RETRY_PENDING'
        ? 'border-amber-300 bg-amber-50'
        : 'border-sky-200 bg-sky-50';

  return (
    <Shell bookingId={bookingId}>
      {offline ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('payment.offline')}</p>
      ) : checkFailed ? (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('payment.checkFailed')}</p>
      ) : null}

      <section className={`rounded-2xl border-2 p-4 ${tone}`} aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">{t('payment.statusLabel')}</p>
        <h1 className="mt-1 text-xl font-semibold text-stone-900">{t(`payment.status.${p.status}`)}</h1>
        <p className="mt-1 text-sm text-stone-800">{t(`payment.farmer.${p.status}`)}</p>
        <p className="mt-3 text-3xl font-semibold text-stone-900">{formatInr(p.netAmount, language)}</p>
        {p.isDemo ? <p className="mt-2 text-sm font-medium text-sky-900">{t('payment.demoBanner')}</p> : null}
      </section>

      <section className="card">
        <dl className="space-y-2 text-sm">
          <Row label={t('payment.procurementId')} value={p.procurementReference} mono />
          <Row label={t('payment.reference')} value={p.paymentReference} mono />
          <Row label={t('dashboard.procurement.crop')} value={p.cropName} />
          {p.bookedQuantityKg ? <Row label={t('payment.booked')} value={`${formatKg(p.bookedQuantityKg, language)} ${t('ops.kg')}`} /> : null}
          {p.receivedQuantityKg ? <Row label={t('payment.received')} value={`${formatKg(p.receivedQuantityKg, language)} ${t('ops.kg')}`} /> : null}
          {p.rejectedQuantityKg && Number(p.rejectedQuantityKg) > 0 ? (
            <Row label={t('payment.rejected')} value={`${formatKg(p.rejectedQuantityKg, language)} ${t('ops.kg')}`} />
          ) : null}
          <Row label={t('payment.accepted')} value={`${formatKg(p.acceptedQuantityKg, language)} ${t('ops.kg')}`} strong />
          <Row
            label={t('payment.mspRate')}
            value={`${formatInr(p.ratePerQuintal, language)} / ${t('payment.quintal')} (${formatInr(p.ratePerKg, language)} / ${t('ops.kg')})`}
          />
          <Row label={t('payment.gross')} value={formatInr(p.grossAmount, language)} />
          {Number(p.deductionsAmount) > 0 ? <Row label={t('payment.deductions')} value={formatInr(p.deductionsAmount, language)} /> : null}
          <Row label={t('payment.net')} value={formatInr(p.netAmount, language)} strong />
          {p.completedAt ? <Row label={t('payment.paidAt')} value={formatDateTime(p.completedAt, language)} /> : null}
        </dl>
        <p className="mt-3 text-xs text-stone-500">{t('payment.acceptedExplainer')}</p>
      </section>

      {p.history.length > 0 ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('payment.historyTitle')}</h2>
          <ol className="mt-2 space-y-1 text-sm text-stone-700">
            {p.history.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-3">
                <span>{t(`payment.status.${entry.toStatus}`)}</span>
                <span className="text-xs text-stone-500">{formatDateTime(entry.createdAt, language)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {checkedAt ? (
        <p className="text-center text-xs text-stone-400">{t('payment.lastChecked', { when: formatDateTime(checkedAt, language) })}</p>
      ) : null}
    </Shell>
  );
}

function Row({ label, value, mono = false, strong = false }: { label: string; value: string; mono?: boolean; strong?: boolean }): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-2 last:border-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className={`${mono ? 'font-mono' : ''} ${strong ? 'font-semibold' : 'font-medium'} text-stone-900`}>{value}</dd>
    </div>
  );
}

function Shell({ bookingId, children }: { bookingId: string; children: React.ReactNode }): JSX.Element {
  const t = useT();
  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <Link to={`/farmer/bookings/${bookingId}/status`} className="text-sm text-stone-600 underline underline-offset-2">
          ← {t('liveStatus.view')}
        </Link>
        {children}
      </main>
    </div>
  );
}
