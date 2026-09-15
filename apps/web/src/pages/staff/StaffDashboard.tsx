import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionStatus, StaffDashboardResponse } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { useStaffDashboard } from '../../hooks/useStaffDashboard.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { SessionStatusCard } from '../../components/staff/SessionStatusCard.js';
import { BookingCard } from '../../components/staff/BookingCard.js';
import { ErrorPanel } from '../../components/AppShell.js';

/**
 * The centre staff operations console (§8, §62; Phase 14).
 *
 * Answers one question: what needs to happen at my procurement centre right
 * now? Ordered by operational priority — session, who is being processed,
 * what needs action, what is coming. Farmer verification is NOT here — it is
 * the District Admin's responsibility entirely (Phase 14).
 */
export function StaffDashboard(): JSX.Element {
  const t = useT();
  const { state, reload } = useStaffDashboard();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  async function transition(status: SessionStatus): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await api.post('/api/staff/me/sessions/today/transition', { status });
      await reload();
    } catch (error) {
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'INITIALIZING') {
    return (
      <Shell>
        <div aria-busy="true" className="space-y-4">
          <span className="sr-only" role="status">
            {t('staff.loading')}
          </span>
          {[0, 1, 2].map((index) => (
            <div key={index} className="card animate-pulse">
              <div className="h-5 w-1/3 rounded bg-stone-200" />
              <div className="mt-3 h-3 w-2/3 rounded bg-stone-100" />
            </div>
          ))}
        </div>
      </Shell>
    );
  }

  if (state.status === 'ERROR') {
    return (
      <Shell>
        <ErrorPanel error={state.error} />
        <button type="button" className="btn-secondary mt-4" onClick={() => void reload()}>
          {t('common.retry')}
        </button>
      </Shell>
    );
  }

  const data: StaffDashboardResponse = state.data;
  const action = data.actionRequired;
  const actionTotal =
    action.awaitingArrival + action.qualityPending + action.weighingPending + action.paymentPending;

  return (
    <Shell centre={data.centre}>
      {state.status === 'PARTIAL_ERROR' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">{t('staff.refreshFailed')}</p>
          <button type="button" className="btn-secondary mt-2" onClick={() => void reload()}>
            {t('common.retry')}
          </button>
        </div>
      ) : null}

      {actionError ? <ErrorPanel error={actionError} /> : null}

      {/* 1. The session. Nothing can happen until it is open. */}
      <SessionStatusCard
        session={data.session}
        workload={data.workload}
        busy={busy}
        onTransition={(status) => void transition(status)}
      />

      {/* 2. Who is being processed right now. */}
      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('ops.nowProcessing.title')}</h2>

        {data.nowProcessing ? (
          <ul className="mt-3">
            <BookingCard booking={data.nowProcessing} />
          </ul>
        ) : (
          <p className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">
            {t('ops.nowProcessing.none')}
          </p>
        )}

        {data.queueAhead.length > 0 ? (
          <>
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('ops.queue.next')}
            </h3>
            <ul className="mt-2 space-y-2">
              {data.queueAhead.map((booking) => (
                <BookingCard key={booking.bookingId} booking={booking} />
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link to="/staff/queue" className="btn-primary inline-block">
            {t('queue.open')}
          </Link>
          <Link to="/staff/today" className="btn-secondary inline-block">
            {t('ops.queue.viewAll')}
          </Link>
        </div>
      </section>

      {/* 3. What needs a staff member's attention. */}
      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('ops.actionRequired.title')}</h2>

        {actionTotal === 0 ? (
          <p className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">
            {t('ops.actionRequired.none')}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            <ActionRow count={action.awaitingArrival} labelKey="ops.actionRequired.awaitingArrival" />
            <ActionRow count={action.qualityPending} labelKey="ops.actionRequired.qualityPending" />
            <ActionRow count={action.weighingPending} labelKey="ops.actionRequired.weighingPending" />
            <ActionRow count={action.paymentPending} labelKey="ops.actionRequired.paymentPending" />
          </ul>
        )}
      </section>

      {/* 4. What is coming. */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-stone-900">{t('ops.slots.title')}</h2>
          <Link to="/staff/slots" className="text-sm text-harvest-800 underline underline-offset-2">
            {t('ops.slots.manage')}
          </Link>
        </div>

        <SlotList label={t('ops.slots.today')} slots={data.slots.today} />
        <SlotList
          label={t('ops.slots.tomorrow', { date: data.slots.tomorrowDate })}
          slots={data.slots.tomorrow}
        />
      </section>

      {/* Provenance, stated plainly (§27, §30). */}
      <p className="pb-4 text-center text-xs text-stone-500">
        {t('ops.provenance', {
          rate: t(`ops.rateSource.${data.providers.rateSource}`),
          payment: data.providers.paymentIsReal
            ? t('ops.payment.real')
            : t('ops.payment.simulated'),
        })}
      </p>
    </Shell>
  );
}

function ActionRow({ count, labelKey }: { count: number; labelKey: string }): JSX.Element | null {
  const t = useT();
  if (count === 0) return null;

  return (
    <li className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2">
      <span className="text-sm text-amber-900">{t(labelKey)}</span>
      <span className="text-lg font-semibold text-amber-900">{count}</span>
    </li>
  );
}

function SlotList({
  label,
  slots,
}: {
  label: string;
  slots: StaffDashboardResponse['slots']['today'];
}): JSX.Element {
  const t = useT();

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</h3>

      {slots.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{t('ops.slots.none')}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {slots.map((slot) => (
            <li
              key={slot.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2"
            >
              <span className="font-mono text-sm text-stone-900">
                {slot.startTime}–{slot.endTime}
              </span>
              <span className="text-sm text-stone-600">
                {t('ops.slots.booked', { booked: slot.bookedCount, capacity: slot.capacity })}
                {slot.isFull ? ` · ${t('ops.slots.full')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Shell({
  centre,
  children,
}: {
  centre?: StaffDashboardResponse['centre'];
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader centre={centre} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
