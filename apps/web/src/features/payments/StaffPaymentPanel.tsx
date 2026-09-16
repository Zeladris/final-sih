import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffPaymentView } from '@kisansetu/shared';
import { isPaymentInFlight } from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { supabase } from '../../lib/supabase.js';
import { randomUuid } from '../../lib/uuid.js';
import { useI18n, useT } from '../../i18n/index.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { formatDateTime, formatInr, formatKg } from './format.js';
import { codeLabel } from '../queue/labels.js';

/**
 * Staff payment panel (Phase 8 §26, §27).
 *
 * Shows exactly what is being paid and why — accepted quantity, applied MSP,
 * amount — and offers only the actions the server says are possible. Amounts
 * cannot be edited here or anywhere.
 *
 * Each click is one INTENT with one idempotency key. If the request times out
 * and staff press again, the same key goes with it, so the server recognises
 * the retry instead of starting a second transfer (§16).
 */
export function StaffPaymentPanel({
  procurementId,
  onStatusChange,
}: {
  procurementId: string;
  /** Called when the payment's status changes, e.g. so the booking screen can show COMPLETED. */
  onStatusChange?: (status: string) => void;
}): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [payment, setPayment] = useState<StaffPaymentView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const intentKey = useRef<{ action: string; key: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ payment: StaffPaymentView }>(`/api/staff/me/procurements/${procurementId}/payment`);
      setPayment(data.payment);
      setLoadError(null);
    } catch (cause) {
      // Could not CHECK the status. That is not the same as the payment failing (§41).
      setLoadError(cause);
    }
  }, [procurementId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: this payment's row, which staff RLS scopes to their centre.
  const paymentId = payment?.id ?? null;
  useEffect(() => {
    if (!paymentId) return undefined;
    let cancelled = false;
    const channel = supabase.channel(`payment:${paymentId}`);
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      channel
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payments', filter: `id=eq.${paymentId}` }, () => void load())
        .subscribe();
    })();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [paymentId, load]);

  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!payment) return;
    if (lastStatus.current !== null && lastStatus.current !== payment.status) onStatusChange?.(payment.status);
    lastStatus.current = payment.status;
  }, [payment, onStatusChange]);

  // While money is in flight, also ask periodically: realtime is an optimisation (§35).
  const inFlight = payment ? isPaymentInFlight(payment.status) : false;
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [inFlight, load]);

  function keyFor(action: string): string {
    if (intentKey.current?.action !== action) {
      intentKey.current = { action, key: randomUuid() };
    }
    return intentKey.current.key;
  }

  async function act(action: 'start' | 'retry' | 'refresh'): Promise<void> {
    if (!payment) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = payment.isDemo ? { demoScenario: simulateFailure ? 'FAIL' : 'SUCCESS' } : {};
      const data =
        action === 'start'
          ? await api.postIdempotent<{ payment: StaffPaymentView }>(`/api/staff/me/procurements/${procurementId}/payment`, keyFor('start'), body)
          : action === 'retry'
            ? await api.postIdempotent<{ payment: StaffPaymentView }>(`/api/staff/me/payments/${payment.id}/retry`, keyFor(`retry-${payment.retryCount}`), body)
            : await api.post<{ payment: StaffPaymentView }>(`/api/staff/me/payments/${payment.id}/refresh`);
      setPayment(data.payment);
      intentKey.current = null;
      setSimulateFailure(false);
    } catch (cause) {
      setActionError(cause);
      // A network failure keeps the key: pressing again is the same request.
      if (cause instanceof ApiRequestError && cause.status !== 0) {
        intentKey.current = null;
        if (cause.status === 409) await load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!payment) {
    return (
      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('payment.title')}</h2>
        {loadError ? (
          <>
            <p className="mt-2 text-sm text-amber-900">{t('payment.checkFailed')}</p>
            <button type="button" className="btn-secondary mt-2" onClick={() => void load()}>
              {t('common.retry')}
            </button>
          </>
        ) : (
          <p className="mt-2 text-sm text-stone-600">{t('payment.checking')}</p>
        )}
      </section>
    );
  }

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-900">{t('payment.title')}</h2>
        <StatusBadge status={payment.status} />
      </div>

      {payment.isDemo ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">
          {t('payment.demoBanner')}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Field label={t('payment.farmer')} value={payment.farmerName ?? '—'} />
        <Field label={t('payment.procurementId')} value={payment.procurementReference} mono />
        <Field label={t('payment.reference')} value={payment.paymentReference} mono />
        <Field label={t('dashboard.procurement.crop')} value={payment.cropName} />
        <Field label={t('payment.received')} value={`${formatKg(payment.receivedQuantityKg, language)} ${t('ops.kg')}`} />
        <Field label={t('payment.rejected')} value={`${formatKg(payment.rejectedQuantityKg, language)} ${t('ops.kg')}`} />
        <Field label={t('payment.accepted')} value={`${formatKg(payment.acceptedQuantityKg, language)} ${t('ops.kg')}`} strong />
        <Field
          label={t('payment.mspRate')}
          value={`${formatInr(payment.ratePerKg, language)} / ${t('ops.kg')} · ${formatInr(payment.ratePerQuintal, language)} / ${t('payment.quintal')}`}
        />
        <Field label={t('payment.rateSource')} value={`${t(`payment.rateSourceType.${payment.rateSource}`)}`} />
      </dl>

      <div className="rounded-lg bg-stone-50 p-3">
        <dl className="space-y-1 text-sm">
          <Line label={t('payment.gross')} value={formatInr(payment.grossAmount, language)} />
          <Line label={t('payment.deductions')} value={formatInr(payment.deductionsAmount, language)} />
          <Line label={t('payment.net')} value={formatInr(payment.netAmount, language)} strong />
        </dl>
        <p className="mt-2 text-xs text-stone-500">{t('payment.amountLocked')}</p>
      </div>

      {payment.failureCode ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          {t('payment.failedStaff')} <span className="font-mono text-xs">{payment.failureCode}</span>
          {payment.failureReason ? ` — ${payment.failureReason}` : ''}
        </p>
      ) : null}

      {loadError ? <p className="text-sm text-amber-900">{t('payment.checkFailed')}</p> : null}
      {actionError ? <ErrorPanel error={actionError} /> : null}

      {payment.canInitiate || payment.canRetry ? (
        <div className="space-y-2">
          {payment.isDemo ? (
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(event) => setSimulateFailure(event.target.checked)}
                className="h-4 w-4"
              />
              {t('payment.demoSimulateFailure')}
            </label>
          ) : null}
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void act(payment.canRetry ? 'retry' : 'start')}
          >
            {busy ? t('common.saving') : payment.canRetry ? t('payment.retry') : t('payment.start')}
          </button>
        </div>
      ) : null}

      {payment.canRefresh ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-stone-700">{t('payment.inFlightStaff')}</p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act('refresh')}>
            {t('payment.checkStatus')}
          </button>
        </div>
      ) : null}

      <details>
        <summary className="cursor-pointer text-sm font-medium text-stone-800">
          {t('payment.historyTitle')} ({payment.history.length})
        </summary>
        <ol className="mt-2 space-y-1 text-xs text-stone-700">
          {payment.history.map((entry) => (
            <li key={entry.id}>
              {formatDateTime(entry.createdAt, language)} ·{' '}
              {entry.fromStatus ? `${t(`payment.status.${entry.fromStatus}`)} → ` : ''}
              <strong>{t(`payment.status.${entry.toStatus}`)}</strong> · {codeLabel(t, 'role', entry.changedByRole)}
            </li>
          ))}
        </ol>
      </details>

      {payment.attempts.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-stone-800">
            {t('payment.attemptsTitle')} ({payment.attempts.length})
          </summary>
          <ol className="mt-2 space-y-1 text-xs text-stone-700">
            {payment.attempts.map((attempt) => (
              <li key={attempt.attemptReference}>
                #{attempt.attemptNumber} <span className="font-mono">{attempt.attemptReference}</span> ·{' '}
                {attempt.providerName}
                {attempt.isDemo ? ` (${t('payment.demoShort')})` : ''} · {attempt.status}
                {attempt.failureCode ? ` · ${attempt.failureCode}` : ''}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

export function StatusBadge({ status }: { status: string }): JSX.Element {
  const t = useT();
  const tone =
    status === 'SUCCESS'
      ? 'bg-harvest-100 text-harvest-900'
      : status === 'FAILED' || status === 'RETRY_PENDING'
        ? 'bg-red-100 text-red-900'
        : 'bg-amber-100 text-amber-900';
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>{t(`payment.status.${status}`)}</span>;
}

function Field({ label, value, mono = false, strong = false }: { label: string; value: string; mono?: boolean; strong?: boolean }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className={`${mono ? 'font-mono text-xs' : ''} ${strong ? 'font-semibold' : ''} text-stone-900`}>{value}</dd>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'border-t border-stone-200 pt-1 font-semibold' : ''}`}>
      <dt className="text-stone-600">{label}</dt>
      <dd className="font-mono text-stone-900">{value}</dd>
    </div>
  );
}
