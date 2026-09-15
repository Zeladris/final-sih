import type { FarmerBookingStatus, FarmerProcurementStatus } from '@kisansetu/shared';
import { useT } from '../../../i18n/index.js';

/** Tone per status. Colour reinforces the text; it never replaces it. */
const TONE: Record<FarmerProcurementStatus, string> = {
  SLOT_BOOKED: 'border-sky-200 bg-sky-50',
  ARRIVED: 'border-harvest-200 bg-harvest-50',
  IN_QUEUE: 'border-harvest-200 bg-harvest-50',
  PRE_PROCUREMENT_CHECK: 'border-harvest-200 bg-harvest-50',
  PROCUREMENT: 'border-harvest-200 bg-harvest-50',
  PAYMENT: 'border-harvest-200 bg-harvest-50',
  COMPLETED: 'border-harvest-300 bg-harvest-100',
  ON_HOLD: 'border-amber-200 bg-amber-50',
  NOT_ACCEPTED: 'border-red-200 bg-red-50',
  CANCELLED: 'border-stone-200 bg-stone-100',
  MISSED: 'border-stone-200 bg-stone-100',
};

/**
 * What is happening now, in words (§5, §13).
 *
 * Queue figures appear only when the server supplies them. Until the queue
 * module exists they are null and nothing is shown — no placeholder numbers.
 */
export function CurrentStatusCard({ status }: { status: FarmerBookingStatus }): JSX.Element {
  const t = useT();
  const hasQueue = status.queuePosition !== null || status.estimatedWaitMinutes !== null;

  return (
    <section className={`rounded-2xl border-2 p-4 ${TONE[status.status]}`} aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">
        {t('liveStatus.current')}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-stone-900">
        {t(`status.farmer.${status.status}.label`)}
      </h1>
      <p className="mt-1 text-sm text-stone-700">{t(`status.farmer.${status.status}.message`)}</p>

      {status.reason ? (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-stone-800">
          <span className="font-medium">{t('liveStatus.reason')}:</span> {status.reason}
        </p>
      ) : null}

      {hasQueue ? (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {status.queuePosition !== null ? (
            <div className="rounded-lg bg-white/70 px-3 py-2">
              <dt className="text-xs text-stone-600">{t('liveStatus.queuePosition')}</dt>
              <dd className="text-2xl font-semibold text-stone-900">{status.queuePosition}</dd>
            </div>
          ) : null}
          {status.estimatedWaitMinutes !== null ? (
            <div className="rounded-lg bg-white/70 px-3 py-2">
              <dt className="text-xs text-stone-600">{t('liveStatus.estimatedWait')}</dt>
              <dd className="text-2xl font-semibold text-stone-900">
                {t('liveStatus.waitMinutes', { minutes: status.estimatedWaitMinutes })}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
