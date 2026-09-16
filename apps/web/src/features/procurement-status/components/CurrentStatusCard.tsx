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
 * The three sub-states of being farmer-facing IN_QUEUE, purely a presentation
 * split of the existing `queuePosition` figure — no new source of truth.
 * `queuePosition` is only ever non-null once the operation reaches WAITING
 * (see `apply_queue_snapshot`), which is exactly the IN_QUEUE farmer status,
 * so this only ever applies there.
 */
type QueuePhase = 'WAITING' | 'APPROACHING' | 'NEXT';

function queuePhaseFor(status: FarmerProcurementStatus, peopleAhead: number | null): QueuePhase | null {
  if (status !== 'IN_QUEUE' || peopleAhead === null) return null;
  if (peopleAhead === 0) return 'NEXT';
  if (peopleAhead === 1) return 'APPROACHING';
  return 'WAITING';
}

/**
 * What is happening now, in words (§5, §13).
 *
 * Queue figures appear only when the server supplies them. Until the queue
 * module exists they are null and nothing is shown — no placeholder numbers.
 */
export function CurrentStatusCard({ status }: { status: FarmerBookingStatus }): JSX.Element {
  const t = useT();
  const peopleAhead = status.queuePosition !== null ? Math.max(0, status.queuePosition - 1) : null;
  const queuePhase = queuePhaseFor(status.status, peopleAhead);

  return (
    <section className={`rounded-2xl border-2 p-4 ${TONE[status.status]}`} aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">
        {t('liveStatus.current')}
      </p>

      {queuePhase ? (
        <QueuePhaseBanner phase={queuePhase} peopleAhead={peopleAhead!} />
      ) : (
        <>
          <h1 className="mt-1 text-xl font-semibold text-stone-900">
            {t(`status.farmer.${status.status}.label`)}
          </h1>
          <p className="mt-1 text-sm text-stone-700">{t(`status.farmer.${status.status}.message`)}</p>
        </>
      )}

      {status.reason ? (
        <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-sm text-stone-800">
          <span className="font-medium">{t('liveStatus.reason')}:</span> {status.reason}
        </p>
      ) : null}

      {status.estimatedWaitMinutes !== null ? (
        <div className="mt-3 inline-block rounded-lg bg-white/70 px-3 py-2">
          <dt className="text-xs text-stone-600">{t('liveStatus.estimatedWait')}</dt>
          <dd className="text-lg font-semibold text-stone-900">
            {t('liveStatus.waitMinutes', { minutes: status.estimatedWaitMinutes })}
          </dd>
        </div>
      ) : null}

      {status.arrivalCode ? (
        <div className="mt-3 rounded-lg border border-harvest-300 bg-white px-3 py-2.5">
          <p className="text-xs font-medium text-stone-600">{t('liveStatus.arrivalCodeTitle')}</p>
          <p className="mt-1 font-mono text-3xl font-bold tracking-widest text-harvest-800">
            {status.arrivalCode}
          </p>
          <p className="mt-1 text-xs text-stone-500">{t('liveStatus.arrivalCodeHelp')}</p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The prominent, farmer-only "how many ahead" banner (§ never a list of
 * other farmers — this is a single count derived from the server's own
 * queue_position for THIS booking, never anyone else's identity).
 */
function QueuePhaseBanner({ phase, peopleAhead }: { phase: QueuePhase; peopleAhead: number }): JSX.Element {
  const t = useT();

  if (phase === 'NEXT') {
    return (
      <div className="mt-1" aria-live="assertive">
        <h1 className="text-2xl font-bold text-harvest-900">{t('liveStatus.queue.next.label')}</h1>
        <p className="mt-1 text-sm font-medium text-harvest-800">{t('liveStatus.queue.next.message')}</p>
      </div>
    );
  }

  const label = phase === 'APPROACHING' ? t('liveStatus.queue.approaching.label') : t('liveStatus.queue.waiting.label', { count: peopleAhead });
  const message = phase === 'APPROACHING' ? t('liveStatus.queue.approaching.message') : t('liveStatus.queue.waiting.message');

  return (
    <div className="mt-1">
      <h1 className="text-xl font-semibold text-stone-900">{label}</h1>
      <p className="mt-1 text-sm text-stone-700">{message}</p>
    </div>
  );
}
