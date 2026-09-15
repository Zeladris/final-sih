import { useState } from 'react';
import type { ProcurementSession, SessionWorkload } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';

/**
 * The daily session (§8, §11).
 *
 * The first thing a staff member sees, because nothing else can happen until
 * the day is open. Opening is an explicit server-side transition, not a
 * frontend toggle.
 */
export function SessionStatusCard({
  session,
  workload,
  busy,
  onTransition,
}: {
  session: ProcurementSession;
  workload: SessionWorkload;
  busy: boolean;
  onTransition: (status: 'OPEN' | 'PROCESSING' | 'CLOSING' | 'CLOSED') => void;
}): JSX.Element {
  const t = useT();
  const [confirmClose, setConfirmClose] = useState(false);

  const tone =
    session.status === 'OPEN' || session.status === 'PROCESSING'
      ? 'border-harvest-300 bg-harvest-50'
      : session.status === 'CLOSED'
        ? 'border-stone-300 bg-stone-100'
        : 'border-amber-300 bg-amber-50';

  return (
    <section className={`card border-2 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('ops.session.title')}
          </p>
          <h2 className="text-2xl font-semibold text-stone-900">
            {t(`ops.session.status.${session.status}`)}
          </h2>
          <p className="mt-1 text-sm text-stone-600">{session.sessionDate}</p>
        </div>

        <div className="flex flex-col gap-2">
          {session.status === 'SCHEDULED' ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onTransition('OPEN')}
            >
              {t('ops.session.open')}
            </button>
          ) : null}

          {session.status === 'OPEN' || session.status === 'PROCESSING' ? (
            confirmClose ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setConfirmClose(false)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                  disabled={busy}
                  onClick={() => onTransition('CLOSING')}
                >
                  {t('ops.session.confirmClose')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmClose(true)}
              >
                {t('ops.session.close')}
              </button>
            )
          ) : null}

          {session.status === 'CLOSING' ? (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => onTransition('CLOSED')}
            >
              {t('ops.session.finalise')}
            </button>
          ) : null}
        </div>
      </div>

      {/* Today's workload (§3 priority 2). Real counts, not placeholders. */}
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('ops.workload.expected')} value={workload.expected} />
        <Metric label={t('ops.workload.arrived')} value={workload.arrived} />
        <Metric label={t('ops.workload.waiting')} value={workload.waiting} />
        <Metric label={t('ops.workload.completed')} value={workload.completed} />
      </dl>

      <p className="mt-3 text-xs text-stone-600">
        {t('ops.workload.capacity', {
          slots: workload.slotCount,
          remaining: workload.capacityRemaining,
        })}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-lg bg-white/70 px-3 py-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="text-2xl font-semibold text-stone-900">{value}</dd>
    </div>
  );
}
