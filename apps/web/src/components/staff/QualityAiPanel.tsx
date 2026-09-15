import { useCallback, useEffect, useState } from 'react';
import type { QualityAssessmentView, QualityPredictionView } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { ErrorPanel } from '../AppShell.js';
import { codeLabel } from '../../features/queue/labels.js';

/**
 * AI pre-assessment + processing estimate (Phase 7 §4–§8, §32).
 *
 * Presented as ADVICE, next to — never instead of — the official quality
 * result below it. Model version, confidence and training-data provenance are
 * always shown; a low-confidence answer says so in plain words.
 */
export function QualityAiPanel({
  bookingId,
  allowPhoto,
}: {
  bookingId: string;
  /** Photos are taken during the quality check; afterwards only the estimate can change. */
  allowPhoto: boolean;
}): JSX.Element {
  const t = useT();
  const [assessment, setAssessment] = useState<QualityAssessmentView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<{ assessment: QualityAssessmentView }>(
        `/api/staff/me/bookings/${bookingId}/quality-assessment`,
      );
      setAssessment(data.assessment);
    } catch (cause) {
      setError(cause);
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('photo', file);
      const data = await api.upload<{ assessment: QualityAssessmentView }>(
        `/api/staff/me/bookings/${bookingId}/quality-assessment`,
        form,
      );
      setAssessment(data.assessment);
      setFile(null);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 className="font-semibold text-stone-900">{t('quality.ai.title')}</h2>

      {allowPhoto ? (
        <>
          <p className="mt-1 text-sm text-stone-600">{t('quality.ai.hint')}</p>
          {assessment && !assessment.aiConfigured ? (
            <p className="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{t('quality.ai.notConfigured')}</p>
          ) : null}

          <label className="field-label mt-3 block" htmlFor={`photo-${bookingId}`}>
            {t('quality.ai.photo')}
          </label>
          <input
            id={`photo-${bookingId}`}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            className="mt-1 block w-full text-sm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn-secondary mt-3"
            disabled={!file || busy}
            onClick={() => void run()}
          >
            {busy ? t('quality.ai.running') : t('quality.ai.run')}
          </button>
        </>
      ) : null}

      {error ? <ErrorPanel error={error} /> : null}

      {assessment?.latestPrediction ? (
        <PredictionSummary prediction={assessment.latestPrediction} />
      ) : null}

      {assessment ? <EstimateSection assessment={assessment} bookingId={bookingId} onSaved={setAssessment} /> : null}
    </section>
  );
}

function PredictionSummary({ prediction }: { prediction: QualityPredictionView }): JSX.Element {
  const t = useT();

  if (prediction.status !== 'COMPLETED') {
    return (
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {codeLabel(t, 'quality.ai.status', prediction.status)}
      </p>
    );
  }

  const developmentData = prediction.trainingData === 'SYNTHETIC_DEVELOPMENT';

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-stone-200 p-3">
      {/* Where the assessment came from matters at the counter: a pre-arrival
          indication describes the photo the farmer sent before travelling,
          not the load now in front of the staff member (§16). */}
      {prediction.preArrival ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900">
          {t('quality.ai.preArrival')}
        </p>
      ) : null}

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-stone-500">{t('quality.ai.risk')}</dt>
          <dd className="font-semibold text-stone-900">
            {prediction.qualityRisk ? codeLabel(t, 'quality.ai.riskLevel', prediction.qualityRisk) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t('quality.ai.score')}</dt>
          <dd className="font-semibold text-stone-900">{prediction.qualityScore ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t('quality.ai.confidence')}</dt>
          <dd className="font-semibold text-stone-900">
            {prediction.confidence === null ? '—' : `${Math.round(prediction.confidence * 100)}%`}
          </dd>
        </div>
      </dl>

      {prediction.lowConfidence ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{t('quality.ai.lowConfidence')}</p>
      ) : null}
      {prediction.manualInspectionRequired ? (
        <p className="text-sm text-stone-800">• {t('quality.ai.manual')}</p>
      ) : null}

      {prediction.reasonCodes.length > 0 ? (
        <ul className="flex flex-wrap gap-1">
          {prediction.reasonCodes.map((code) => (
            <li key={code} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-800">
              {codeLabel(t, 'quality.ai.reason', code)}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-stone-500">
        {t('quality.ai.model')}: <span className="font-mono">{prediction.modelVersion}</span>
      </p>
      {developmentData ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{t('quality.ai.devModel')}</p>
      ) : null}
      <p className="text-xs text-stone-500">{t('quality.ai.advisory')}</p>
    </div>
  );
}

function EstimateSection({
  assessment,
  bookingId,
  onSaved,
}: {
  assessment: QualityAssessmentView;
  bookingId: string;
  onSaved: (assessment: QualityAssessmentView) => void;
}): JSX.Element {
  const t = useT();
  const estimate = assessment.currentEstimate;
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ assessment: QualityAssessmentView }>(
        `/api/staff/me/bookings/${bookingId}/quality-assessment/manual-override`,
        { estimatedMinutes: Number(minutes), reason: reason.trim() },
      );
      onSaved(data.assessment);
      setEditing(false);
      setMinutes('');
      setReason('');
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const parsed = Number(minutes);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= 600 && reason.trim().length >= 5;

  return (
    <div className="mt-4 border-t border-stone-100 pt-3">
      <h3 className="text-sm font-semibold text-stone-900">{t('quality.estimate.title')}</h3>
      {estimate ? (
        <p className="mt-1 text-sm text-stone-800">
          {t('queue.minutes', { minutes: estimate.estimatedMinutes })}
          {estimate.lowerMinutes !== null && estimate.upperMinutes !== null
            ? ` (${t('quality.estimate.range', { low: estimate.lowerMinutes, high: estimate.upperMinutes })})`
            : ''}
          {' · '}
          {codeLabel(t, 'quality.estimate.source', estimate.source)}
          {estimate.overrideReason ? ` — ${estimate.overrideReason}` : ''}
        </p>
      ) : (
        <p className="mt-1 text-sm text-stone-600">{t('quality.estimate.none')}</p>
      )}

      {!editing ? (
        <button type="button" className="mt-2 text-sm text-harvest-800 underline underline-offset-2" onClick={() => setEditing(true)}>
          {t('quality.estimate.override')}
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="field-label" htmlFor={`est-${bookingId}`}>
            {t('quality.estimate.minutesLabel')}
          </label>
          <input
            id={`est-${bookingId}`}
            type="text"
            inputMode="decimal"
            className="field-input"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value.replace(/[^\d.]/g, ''))}
          />
          <label className="field-label" htmlFor={`est-why-${bookingId}`}>
            {t('quality.estimate.reason')}
          </label>
          <textarea
            id={`est-why-${bookingId}`}
            rows={2}
            className="field-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? <ErrorPanel error={error} /> : null}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(false)} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary flex-1" disabled={!valid || busy} onClick={() => void save()}>
              {busy ? t('common.saving') : t('quality.estimate.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
