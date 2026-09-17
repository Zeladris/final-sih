import { useEffect, useState } from 'react';
import type { MspSummary } from '@kisansetu/shared';
import { api } from '../../../lib/api.js';
import { useI18n, useT } from '../../../i18n/index.js';
import { formatInr, formatKg } from '../../payments/format.js';

/**
 * Demo/indicative MSP for a farmer's own booking (demo addition).
 *
 * Renders nothing when there's no summary to show (no catalogue crop, or no
 * MSP configured) — matches ColdStorageCard's pattern of a card that simply
 * doesn't appear rather than showing a placeholder.
 */
export function MspSummaryCard({ bookingId }: { bookingId: string }): JSX.Element | null {
  const t = useT();
  const { language } = useI18n();
  const [summary, setSummary] = useState<MspSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ summary: MspSummary | null }>(`/api/farmer/bookings/${bookingId}/msp-summary`)
      .then((data) => {
        if (!cancelled) setSummary(data.summary);
      })
      .catch(() => {
        // No summary is not an error worth showing — the rest of the
        // booking page already explains everything else.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!loaded || !summary) return null;

  const hasProcured = summary.procuredQuantityKg !== null;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-stone-900">{t('msp.summary.title')}</h2>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900">
          {t('msp.summary.demoBadge')}
        </span>
      </div>

      <dl className="mt-3 space-y-2">
        <Row label={t('dashboard.procurement.crop')} value={summary.cropName} />
        <Row label={t('msp.summary.booked')} value={`${formatKg(summary.bookedQuantityKg, language)} ${t('ops.kg')}`} />
        {hasProcured ? (
          <>
            <Row
              label={t('msp.summary.procured')}
              value={`${formatKg(summary.procuredQuantityKg, language)} ${t('ops.kg')}`}
            />
            {summary.remainingQuantityKg !== null && summary.remainingQuantityKg > 0 ? (
              <Row
                label={t('msp.summary.remaining')}
                value={`${formatKg(summary.remainingQuantityKg, language)} ${t('ops.kg')}`}
              />
            ) : null}
          </>
        ) : null}
        <Row label={t('msp.summary.rate')} value={`${formatInr(summary.ratePerKg, language)} / ${t('ops.kg')}`} />
      </dl>

      <div className="mt-3 rounded-lg bg-harvest-50 px-3 py-2">
        <p className="text-xs text-harvest-900">
          {hasProcured ? t('msp.summary.estimatedProcuredLabel') : t('msp.summary.estimatedBookedLabel')}
        </p>
        <p className="text-xl font-semibold text-harvest-900">
          {formatInr(summary.estimatedValue, language)}
        </p>
      </div>

      <p className="mt-2 text-xs text-stone-500">{t('msp.summary.note')}</p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 border-b border-stone-100 pb-1.5 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-sm font-medium text-stone-900">{value}</dd>
    </div>
  );
}
