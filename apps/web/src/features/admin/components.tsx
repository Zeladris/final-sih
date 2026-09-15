import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Compared, TrendPoint } from '@kisansetu/shared';
import { useI18n, useT } from '../../i18n/index.js';
import { formatInr } from '../payments/format.js';
import { PRESETS, presetRange } from './period.js';
import type { PeriodSelection } from './period.js';

/**
 * Admin dashboard building blocks.
 *
 * Every value is rendered from the server's response. A null is shown as
 * "Not available" — never silently as 0 (§39). Charts are single-series (one
 * hue, the title names the series) with a per-bar hover and a table view, so
 * nothing depends on colour alone. Visual polish is deferred (§38).
 */

// --- Formatting ----------------------------------------------------------------

export function useAdminFormat(): {
  num: (v: number | null, digits?: number) => string;
  pct: (v: number | null) => string;
  mins: (v: number | null) => string;
  inr: (v: string | null) => string;
  tonnes: (kg: string | null) => string;
  date: (d: string) => string;
  na: string;
} {
  const t = useT();
  const { language } = useI18n();
  const locale = language === 'ta' ? 'ta-IN' : 'en-IN';
  const na = t('admin.notAvailable');
  return {
    na,
    num: (v, digits = 0) => (v === null ? na : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)),
    pct: (v) => (v === null ? na : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(v)),
    mins: (v) => (v === null ? na : t('admin.minutes', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v) })),
    inr: (v) => (v === null ? na : formatInr(v, language)),
    tonnes: (kg) => (kg === null ? na : t('admin.tonnes', { value: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(kg) / 1000) })),
    date: (d) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)),
  };
}

// --- Layout --------------------------------------------------------------------

export function Section({ title, subtitle, live = false, children, actions }: { title: string; subtitle?: string; live?: boolean; children: ReactNode; actions?: ReactNode }): JSX.Element {
  const t = useT();
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-stone-900">
            {title}
            {live ? (
              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 align-middle text-xs font-medium text-sky-900">{t('admin.liveBadge')}</span>
            ) : null}
          </h2>
          {subtitle ? <p className="text-xs text-stone-500">{subtitle}</p> : null}
        </div>
        {actions}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function KpiGrid({ children }: { children: ReactNode }): JSX.Element {
  return <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</dl>;
}

export function Kpi({ label, value, hint, change, lowerIsBetter = false }: { label: string; value: string; hint?: string; change?: Compared; lowerIsBetter?: boolean }): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  let changeText: string | null = null;
  let tone = 'text-stone-500';
  if (change && change.changeRatio !== null) {
    const pct = new Intl.NumberFormat(language === 'ta' ? 'ta-IN' : 'en-IN', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(change.changeRatio);
    const better = lowerIsBetter ? change.changeRatio < 0 : change.changeRatio > 0;
    tone = change.changeRatio === 0 ? 'text-stone-500' : better ? 'text-harvest-800' : 'text-amber-800';
    changeText = t('admin.vsPrevious', { change: pct });
  }
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-stone-900">{value}</dd>
      {changeText ? <p className={`text-xs ${tone}`}>{changeText}</p> : null}
      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

// --- Period picker (§9) ---------------------------------------------------------

export function PeriodPicker({ value, onChange }: { value: PeriodSelection; onChange: (next: PeriodSelection) => void }): JSX.Element {
  const t = useT();
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('admin.period.label')}>
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`rounded-full border px-3 py-1 text-sm ${value.preset === preset ? 'border-harvest-600 bg-harvest-50 font-medium text-harvest-900' : 'border-stone-300 text-stone-700'}`}
            aria-pressed={value.preset === preset}
            onClick={() => onChange(presetRange(preset))}
          >
            {t(`admin.period.${preset}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-1">
        <label className="text-xs text-stone-600">
          {t('admin.period.from')}
          <input type="date" className="field-input mt-0.5 py-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-stone-600">
          {t('admin.period.to')}
          <input type="date" className="field-input mt-0.5 py-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary py-1"
          disabled={!from || !to || from > to}
          onClick={() => onChange({ preset: 'CUSTOM', from, to })}
        >
          {t('admin.period.apply')}
        </button>
      </div>
    </div>
  );
}

// --- Charts -----------------------------------------------------------------------

/**
 * A single-series daily bar chart. Bars start at the zero baseline with a
 * rounded data end; hovering (or focusing) a bar shows its exact value; a
 * table view carries the same numbers for anyone who cannot use the chart.
 */
export function DailyBars({ title, points, pick, format }: { title: string; points: TrendPoint[]; pick: (p: TrendPoint) => number; format: (p: TrendPoint) => string }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const id = useId();
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const values = points.map(pick);
  const max = Math.max(0, ...values);
  const width = 600;
  const height = 160;
  const pad = { top: 12, bottom: 22, left: 4, right: 4 };
  const plotH = height - pad.top - pad.bottom;
  const slot = (width - pad.left - pad.right) / Math.max(points.length, 1);
  const barW = Math.max(2, Math.min(28, slot - 2));

  return (
    <figure className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm font-medium text-stone-800" id={`${id}-title`}>{title}</figcaption>
        <button type="button" className="text-xs text-stone-600 underline underline-offset-2" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('admin.showChart') : t('admin.showTable')}
        </button>
      </div>

      {max === 0 ? (
        <p className="mt-2 rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">{t('admin.emptyPeriod')}</p>
      ) : asTable ? (
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {points.map((p) => (
                <tr key={p.date} className="border-t border-stone-100">
                  <th scope="row" className="py-1 pr-2 text-left font-normal text-stone-600">{fmt.date(p.date)}</th>
                  <td className="py-1 text-right font-mono text-stone-900">{format(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-2">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-labelledby={`${id}-title`}>
            <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} className="stroke-stone-300" strokeWidth={1} />
            {points.map((p, i) => {
              const v = values[i]!;
              const h = max > 0 ? (v / max) * plotH : 0;
              const x = pad.left + i * slot + (slot - barW) / 2;
              const y = height - pad.bottom - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <g
                  key={p.date}
                  tabIndex={0}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${fmt.date(p.date)}: ${format(p)}`}
                >
                  {/* Hit target taller than the bar, so small values are hoverable. */}
                  <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="transparent" />
                  {h > 0 ? (
                    <path
                      d={`M${x},${height - pad.bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${height - pad.bottom} Z`}
                      className={hover === i ? 'fill-harvest-800' : 'fill-harvest-600'}
                    />
                  ) : null}
                </g>
              );
            })}
            <text x={pad.left} y={height - 6} className="fill-stone-500 text-[11px]">{fmt.date(points[0]!.date)}</text>
            <text x={width - pad.right} y={height - 6} textAnchor="end" className="fill-stone-500 text-[11px]">{fmt.date(points[points.length - 1]!.date)}</text>
          </svg>
          {hover !== null ? (
            <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs shadow-sm">
              <span className="text-stone-500">{fmt.date(points[hover]!.date)}</span>{' '}
              <span className="font-mono font-semibold text-stone-900">{format(points[hover]!)}</span>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}

/** Horizontal labelled bars for a distribution or a funnel. Labels carry identity, not colour. */
export function LabelledBars({ rows, total }: { rows: Array<{ label: string; value: number; display?: string }>; total?: number }): JSX.Element {
  const t = useT();
  const max = total ?? Math.max(0, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) {
    return <p className="rounded-lg bg-stone-50 px-3 py-3 text-center text-sm text-stone-600">{t('admin.emptyPeriod')}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate text-stone-700">{r.label}</span>
          <span className="h-3 rounded-sm bg-stone-100">
            <span className="block h-3 rounded-sm bg-harvest-600" style={{ width: `${max > 0 ? Math.max(1, (r.value / max) * 100) : 0}%` }} />
          </span>
          <span className="font-mono text-xs text-stone-900">{r.display ?? r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function Money({ value }: { value: string | null }): JSX.Element {
  const fmt = useAdminFormat();
  return <>{fmt.inr(value)}</>;
}
