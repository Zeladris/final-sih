import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QueueCandidateView } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { ErrorPanel } from '../AppShell.js';
import { codeLabel, minutesLabel } from '../../features/queue/labels.js';

/**
 * A farmer in the queue, seen from their booking (Phase 7).
 *
 * Starting them happens on the queue page, where the choice is made against
 * everyone else waiting — not from one farmer's screen in isolation.
 */
export function QueuedPanel({ bookingId }: { bookingId: string }): JSX.Element {
  const t = useT();
  const [candidate, setCandidate] = useState<QueueCandidateView | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ candidate: QueueCandidateView }>(`/api/staff/me/queue/${bookingId}`)
      .then((data) => setCandidate(data.candidate))
      .catch(setError);
  }, [bookingId]);

  return (
    <section className="card border-2 border-harvest-200">
      <h2 className="text-lg font-semibold text-stone-900">{t('queue.inQueue.title')}</h2>
      {error ? <ErrorPanel error={error} /> : null}

      {candidate ? (
        <div className="mt-2 space-y-2 text-sm">
          {candidate.rank !== null ? (
            <p className="text-stone-900">
              <span className="text-2xl font-semibold">{t('queue.inQueue.position', { rank: candidate.rank })}</span>
              {' · '}
              {t('queue.estWait')}: {minutesLabel(t, candidate.estimatedWaitMinutes)}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {candidate.ineligibleReasons.map((code) => (
                <li key={code} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                  {codeLabel(t, 'queue.ineligibleReason', code)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-stone-700">
            {t('queue.waiting')}: {minutesLabel(t, candidate.waitMinutes)} · {t('queue.estProcessing')}:{' '}
            {minutesLabel(t, candidate.estimatedProcessingMinutes)}
          </p>
          {candidate.reasonCodes.length > 0 ? (
            <ul className="flex flex-wrap gap-1">
              {candidate.reasonCodes.map((code) => (
                <li key={code} className="rounded-full bg-harvest-50 px-2 py-0.5 text-xs text-harvest-900">
                  {codeLabel(t, 'queue.reason', code)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Link to="/staff/queue" className="btn-primary mt-4 inline-block">
        {t('queue.open')}
      </Link>
    </section>
  );
}

/** A farmer taken out of the queue can be put back; time already waited still counts. */
export function OnHoldPanel({
  bookingId,
  onChanged,
}: {
  bookingId: string;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function requeue(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/staff/me/queue/${bookingId}/requeue`);
      await onChanged();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card border-2 border-amber-200">
      <h2 className="text-lg font-semibold text-stone-900">{t('queue.onHold.title')}</h2>
      <p className="mt-1 text-sm text-stone-600">{t('queue.onHold.hint')}</p>
      {error ? <ErrorPanel error={error} /> : null}
      <button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void requeue()}>
        {busy ? t('common.saving') : t('queue.requeue')}
      </button>
    </section>
  );
}
