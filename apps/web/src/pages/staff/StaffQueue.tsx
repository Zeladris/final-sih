import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type {
  PolicySimulationResult,
  QueueCandidateView,
  QueueComparison,
  QueueMetrics,
  QueueView,
  WorkstationView,
} from '@kisansetu/shared';
import { api, ApiRequestError } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { StaffHeader } from '../../components/staff/StaffHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { useQueue } from '../../features/queue/useQueue.js';
import { codeLabel, minutesLabel } from '../../features/queue/labels.js';

/**
 * The procurement queue (Phase 7 §40).
 *
 * Answers one question first: who should be started next, and why. The
 * explanation is in reason codes a staff member can repeat to a farmer; the
 * raw scores are one tap away for anyone who needs to check the arithmetic.
 *
 * Nothing on this page ranks anyone. It shows the server's published order
 * and asks the server to START someone; the server revalidates everything.
 */
export function StaffQueue(): JSX.Element {
  const t = useT();
  const { queue, error, connection, refresh, setQueue } = useQueue();

  if (!queue && error) {
    return (
      <Shell>
        <ErrorPanel error={error} />
        <button type="button" className="btn-secondary mt-4" onClick={() => void refresh()}>
          {t('common.retry')}
        </button>
      </Shell>
    );
  }

  if (!queue) {
    return (
      <Shell>
        <Spinner label={t('common.loading')} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">{t('queue.title')}</h1>
          <p className="text-xs text-stone-500" role="status">
            {connection === 'LIVE' ? t('liveStatus.live') : connection === 'RECONNECTING' ? t('liveStatus.reconnecting') : t('liveStatus.connecting')}
            {' · '}
            {t('queue.count', { count: queue.candidates.length })}
          </p>
        </div>
        <RecalculateButton onDone={setQueue} />
      </div>

      {connection === 'RECONNECTING' ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('queue.reconnecting')}</p>
      ) : null}
      {error ? <ErrorPanel error={error} /> : null}

      <NextCard queue={queue} onChanged={refresh} />

      <section className="card">
        <h2 className="font-semibold text-stone-900">{t('queue.list')}</h2>
        {queue.candidates.length === 0 ? (
          <p className="mt-3 rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">{t('queue.none')}</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {queue.candidates.map((candidate) => (
              <CandidateRow key={candidate.bookingId} candidate={candidate} queue={queue} onChanged={refresh} />
            ))}
          </ol>
        )}
      </section>

      {queue.ineligible.length > 0 ? (
        <section className="card">
          <h2 className="font-semibold text-stone-900">{t('queue.ineligible')}</h2>
          <ul className="mt-3 space-y-2">
            {queue.ineligible.map((candidate) => (
              <li key={candidate.bookingId} className="rounded-lg border border-stone-200 p-3 text-sm">
                <Link to={`/staff/booking/${candidate.bookingId}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                  {candidate.farmerName ?? candidate.bookingReference}
                </Link>
                <span className="ml-2 font-mono text-xs text-stone-500">{candidate.bookingReference}</span>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {candidate.ineligibleReasons.map((code) => (
                    <li key={code} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                      {codeLabel(t, 'queue.ineligibleReason', code)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <WorkstationsCard workstations={queue.workstations} onChanged={refresh} />

      <InsightsCard />

      <p className="text-center text-xs text-stone-400">
        {t('queue.meta', { version: queue.algorithmVersion, hash: queue.configHash })}
        {queue.generatedAt ? ` · ${new Date(queue.generatedAt).toLocaleTimeString()}` : ''}
      </p>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

function NextCard({ queue, onChanged }: { queue: QueueView; onChanged: () => Promise<void> }): JSX.Element {
  const t = useT();
  const next = queue.next;

  return (
    <section className="card border-2 border-harvest-300" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-harvest-800">{t('queue.next')}</p>

      {!next ? (
        <p className="mt-2 text-sm text-stone-600">{t('queue.none')}</p>
      ) : (
        <>
          <h2 className="mt-1 text-lg font-semibold text-stone-900">{next.farmerName ?? next.bookingReference}</h2>
          <p className="font-mono text-xs text-stone-500">{next.bookingReference}</p>
          <p className="mt-1 text-sm text-stone-700">
            {next.cropName} · {Math.round(next.quantityKg)} {t('ops.kg')}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Stat label={t('queue.waiting')} value={minutesLabel(t, next.waitMinutes)} />
            <Stat label={t('queue.estProcessing')} value={minutesLabel(t, next.estimatedProcessingMinutes)} />
          </dl>

          {next.isProtected ? (
            <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900">{t('queue.protectedNote')}</p>
          ) : null}

          <h3 className="mt-4 text-sm font-semibold text-stone-900">{t('queue.whyNext')}</h3>
          <ReasonList codes={next.reasonCodes} />

          <StartControls candidate={next} queue={queue} isNext onChanged={onChanged} />
        </>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  queue,
  onChanged,
}: {
  candidate: QueueCandidateView;
  queue: QueueView;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-sm font-semibold text-stone-800">
          {candidate.rank}
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/staff/booking/${candidate.bookingId}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
            {candidate.farmerName ?? candidate.bookingReference}
          </Link>
          <p className="text-xs text-stone-600">
            <span className="font-mono">{candidate.bookingReference}</span> · {candidate.cropName} ·{' '}
            {Math.round(candidate.quantityKg)} {t('ops.kg')}
          </p>
          <p className="mt-1 text-xs text-stone-700">
            {t('queue.waiting')}: {minutesLabel(t, candidate.waitMinutes)} · {t('queue.estProcessing')}:{' '}
            {minutesLabel(t, candidate.estimatedProcessingMinutes)}
            {candidate.estimateSource ? ` (${codeLabel(t, 'quality.estimate.source', candidate.estimateSource)})` : ''}
            {' · '}
            {t('queue.estWait')}: {minutesLabel(t, candidate.estimatedWaitMinutes)}
          </p>
          {candidate.isProtected ? (
            <p className="mt-1 text-xs font-medium text-sky-800">{t('queue.protected')}</p>
          ) : null}
          <ReasonList codes={candidate.reasonCodes} compact />
        </div>
      </div>

      <button
        type="button"
        className="mt-2 text-xs text-stone-600 underline underline-offset-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? t('queue.hideDetails') : t('queue.details')}
      </button>

      {open ? (
        <div className="mt-2 space-y-3">
          {candidate.breakdown ? <Breakdown candidate={candidate} /> : null}
          {candidate.rank !== 1 ? <StartControls candidate={candidate} queue={queue} isNext={false} onChanged={onChanged} /> : null}
          <RemoveControl candidate={candidate} onChanged={onChanged} />
        </div>
      ) : null}
    </li>
  );
}

function ReasonList({ codes, compact = false }: { codes: string[]; compact?: boolean }): JSX.Element | null {
  const t = useT();
  if (codes.length === 0) return null;
  return (
    <ul className={compact ? 'mt-1 flex flex-wrap gap-1' : 'mt-1 space-y-1'}>
      {codes.map((code) =>
        compact ? (
          <li key={code} className="rounded-full bg-harvest-50 px-2 py-0.5 text-xs text-harvest-900">
            {codeLabel(t, 'queue.reason', code)}
          </li>
        ) : (
          <li key={code} className="text-sm text-stone-800">
            • {codeLabel(t, 'queue.reason', code)}
          </li>
        ),
      )}
    </ul>
  );
}

/** Starting a farmer: choose a free compatible station; out-of-order needs a reason. */
function StartControls({
  candidate,
  queue,
  isNext,
  onChanged,
}: {
  candidate: QueueCandidateView;
  queue: QueueView;
  isNext: boolean;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const t = useT();
  const navigate = useNavigate();
  const options = queue.workstations.filter((ws) => candidate.compatibleAvailableWorkstationIds.includes(ws.id));
  const [workstationId, setWorkstationId] = useState(options[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const chosen = options.find((ws) => ws.id === workstationId)?.id ?? options[0]?.id ?? '';

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/staff/me/queue/${candidate.bookingId}/select`, {
        workstationId: chosen,
        ...(isNext ? {} : { overrideReason: reason.trim() }),
      });
      navigate(`/staff/booking/${candidate.bookingId}`);
    } catch (cause) {
      setError(cause);
      // Someone else moved first — show the queue as it now is (§28).
      if (cause instanceof ApiRequestError && cause.status === 409) await onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (options.length === 0) {
    return <p className="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{t('queue.noWorkstation')}</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      <label className="field-label" htmlFor={`ws-${candidate.bookingId}`}>
        {t('queue.workstation')}
      </label>
      <select
        id={`ws-${candidate.bookingId}`}
        className="field-input"
        value={chosen}
        onChange={(event) => setWorkstationId(event.target.value)}
      >
        {options.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.code} — {ws.name}
          </option>
        ))}
      </select>

      {!isNext ? (
        <>
          <label className="field-label" htmlFor={`why-${candidate.bookingId}`}>
            {t('queue.overrideReason')}
          </label>
          <textarea
            id={`why-${candidate.bookingId}`}
            rows={2}
            className="field-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </>
      ) : null}

      {error ? <ErrorPanel error={error} /> : null}

      <button
        type="button"
        className={isNext ? 'btn-primary' : 'btn-secondary w-full'}
        disabled={busy || !chosen || (!isNext && reason.trim().length < 5)}
        onClick={() => void start()}
      >
        {busy ? t('common.saving') : isNext ? t('queue.start') : t('queue.startOverride')}
      </button>
    </div>
  );
}

function RemoveControl({ candidate, onChanged }: { candidate: QueueCandidateView; onChanged: () => Promise<void> }): JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!open) {
    return (
      <button type="button" className="text-sm text-red-700 underline underline-offset-2" onClick={() => setOpen(true)}>
        {t('queue.remove')}
      </button>
    );
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/staff/me/queue/${candidate.bookingId}/remove`, { reason: reason.trim() });
      await onChanged();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-2">
      <label className="field-label" htmlFor={`remove-${candidate.bookingId}`}>
        {t('queue.removeReason')}
      </label>
      <textarea
        id={`remove-${candidate.bookingId}`}
        rows={2}
        className="field-input"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {error ? <ErrorPanel error={error} /> : null}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-stone-300"
          disabled={busy || reason.trim().length < 5}
          onClick={() => void remove()}
        >
          {t('queue.confirmRemove')}
        </button>
      </div>
    </div>
  );
}

/** The technical view (§40): the numbers behind the position. */
function Breakdown({ candidate }: { candidate: QueueCandidateView }): JSX.Element {
  const t = useT();
  const b = candidate.breakdown!;
  const rows: Array<[string, number]> = [
    ['final', b.finalPriority],
    ['fairness', b.fairnessScore],
    ['efficiency', b.operationalEfficiencyScore],
    ['urgency', b.urgencyScore],
    ['penalty', b.fairnessPenalty],
    ['wait', b.waitScore],
    ['lateness', b.slotLatenessScore],
    ['aging', b.agingScore],
    ['processingFit', b.processingFitScore],
    ['workstationFit', b.workstationFitScore],
    ['qualityReadiness', b.qualityReadinessScore],
    ['qualityFactor', b.qualityFactorScore],
  ];

  return (
    <div className="rounded-lg bg-stone-50 p-2">
      <p className="text-xs font-semibold text-stone-700">{t('queue.technical')}</p>
      <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-stone-500">{t(`queue.score.${key}`)}</dt>
            <dd className="font-mono text-stone-900">{value.toFixed(3)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-stone-500">{t('queue.fairnessNote')}</p>
    </div>
  );
}

function WorkstationsCard({ workstations, onChanged }: { workstations: WorkstationView[]; onChanged: () => Promise<void> }): JSX.Element {
  const t = useT();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function setStatus(id: string, status: 'AVAILABLE' | 'OFFLINE'): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await api.patch(`/api/staff/me/workstations/${id}`, { status });
      await onChanged();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{t('queue.workstations')}</h2>
      {error ? <ErrorPanel error={error} /> : null}
      <ul className="mt-3 space-y-2">
        {workstations.map((ws) => (
          <li key={ws.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-stone-900">
                {ws.code} — {ws.name}
              </p>
              <p className="text-xs text-stone-600">
                {codeLabel(t, 'queue.ws', ws.status)}
                {ws.currentBookingReference ? ` · ${t('queue.ws.serving', { ref: ws.currentBookingReference })}` : ''}
                {' · '}
                {ws.cropNames.length === 0 ? t('queue.ws.allCrops') : ws.cropNames.join(', ')}
              </p>
            </div>
            {ws.status !== 'BUSY' ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={busyId === ws.id}
                onClick={() => void setStatus(ws.id, ws.status === 'OFFLINE' ? 'AVAILABLE' : 'OFFLINE')}
              >
                {ws.status === 'OFFLINE' ? t('queue.ws.setAvailable') : t('queue.ws.setOffline')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecalculateButton({ onDone }: { onDone: (queue: QueueView) => void }): JSX.Element {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void api
          .post<QueueView>('/api/staff/me/queue/recalculate')
          .then(onDone)
          .finally(() => setBusy(false));
      }}
    >
      {busy ? t('common.saving') : t('queue.recalculate')}
    </button>
  );
}

/** Metrics and the FCFS comparison (§43, §44) — loaded on demand. */
function InsightsCard(): JSX.Element {
  const t = useT();
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [comparison, setComparison] = useState<QueueComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function load(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const [m, c] = await Promise.all([
        api.get<QueueMetrics>('/api/staff/me/queue/metrics'),
        api.get<QueueComparison>('/api/staff/me/queue/comparison'),
      ]);
      setMetrics(m);
      setComparison(c);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const pct = (value: number | null): string => (value === null ? '—' : `${Math.round(value * 100)}%`);

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-900">{t('queue.metrics.title')}</h2>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? t('common.loading') : metrics ? t('queue.metrics.refresh') : t('queue.metrics.load')}
        </button>
      </div>
      {error ? <ErrorPanel error={error} /> : null}

      {metrics ? (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label={t('queue.metrics.avgWait')} value={minutesLabel(t, metrics.completedWaits.averageMinutes)} />
          <Stat label={t('queue.metrics.medianWait')} value={minutesLabel(t, metrics.completedWaits.medianMinutes)} />
          <Stat label={t('queue.metrics.maxWait')} value={minutesLabel(t, metrics.completedWaits.maxMinutes)} />
          <Stat label={t('queue.metrics.currentLength')} value={String(metrics.currentQueueLength)} />
          <Stat label={t('queue.metrics.longestCurrent')} value={minutesLabel(t, metrics.longestCurrentWaitMinutes)} />
          <Stat label={t('queue.metrics.slotDelay')} value={minutesLabel(t, metrics.averageSlotDelayMinutes)} />
          <Stat label={t('queue.metrics.processed')} value={String(metrics.processedCount)} />
          <Stat label={t('queue.metrics.perHour')} value={metrics.farmersPerHour === null ? '—' : String(metrics.farmersPerHour)} />
          <Stat label={t('queue.metrics.avgProcessing')} value={minutesLabel(t, metrics.averageProcessingMinutes)} />
          <Stat label={t('queue.metrics.utilisation')} value={pct(metrics.workstationUtilisation)} />
          <Stat label={t('queue.metrics.starvation')} value={String(metrics.starvationEvents)} />
          <Stat label={t('queue.metrics.fairnessOverrides')} value={String(metrics.fairnessOverrides)} />
          <Stat label={t('queue.metrics.reorders')} value={String(metrics.dynamicReorders)} />
          <Stat label={t('queue.metrics.selectionOverrides')} value={String(metrics.selectionOverrides)} />
          <Stat label={t('queue.metrics.manualRate')} value={pct(metrics.manualQualityReviewRate)} />
          <Stat label={t('queue.metrics.mlPredictions')} value={String(metrics.mlPredictions)} />
          <Stat label={t('queue.metrics.mlLowConfidence')} value={pct(metrics.mlLowConfidenceRate)} />
          <Stat label={t('queue.metrics.mlUnavailable')} value={String(metrics.mlUnavailableCount)} />
        </dl>
      ) : null}

      {comparison ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-stone-900">{t('queue.compare.title')}</h3>
          <p className="mt-1 text-xs text-stone-500">
            {t('queue.compare.basis', { count: comparison.workloadSize, stations: comparison.workstationCount })}
          </p>
          {comparison.fcfs && comparison.optimized ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500">
                    <th className="py-1 pr-2 font-medium" scope="col"> </th>
                    <th className="py-1 pr-2 font-medium" scope="col">{t('queue.compare.fcfs')}</th>
                    <th className="py-1 font-medium" scope="col">{t('queue.compare.optimized')}</th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow label={t('queue.metrics.avgWait')} pick={(r) => minutesLabel(t, r.waits.averageMinutes)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                  <CompareRow label={t('queue.metrics.medianWait')} pick={(r) => minutesLabel(t, r.waits.medianMinutes)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                  <CompareRow label={t('queue.metrics.maxWait')} pick={(r) => minutesLabel(t, r.waits.maxMinutes)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                  <CompareRow label={t('queue.metrics.slotDelay')} pick={(r) => minutesLabel(t, r.averageSlotDelayMinutes)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                  <CompareRow label={t('queue.metrics.starvation')} pick={(r) => String(r.starvationEvents)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                  <CompareRow label={t('queue.compare.makespan')} pick={(r) => minutesLabel(t, r.makespanMinutes)} fcfs={comparison.fcfs} opt={comparison.optimized} />
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-600">{t('queue.compare.empty')}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CompareRow({
  label,
  pick,
  fcfs,
  opt,
}: {
  label: string;
  pick: (result: PolicySimulationResult) => string;
  fcfs: PolicySimulationResult;
  opt: PolicySimulationResult;
}): JSX.Element {
  return (
    <tr className="border-t border-stone-100">
      <th className="py-1 pr-2 text-left font-normal text-stone-600" scope="row">{label}</th>
      <td className="py-1 pr-2 font-mono text-stone-900">{pick(fcfs)}</td>
      <td className="py-1 font-mono text-stone-900">{pick(opt)}</td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="text-sm font-semibold text-stone-900">{value}</dd>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  // useI18n keeps the page re-rendering on language change.
  useI18n();
  return (
    <div className="min-h-screen bg-stone-50">
      <StaffHeader />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
