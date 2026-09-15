import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AdminAlert,
  AdminExportReport,
  AdminMe,
  AdminOverview,
  CentrePerformancePage,
  CentreStatus,
} from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { DailyBars, Kpi, KpiGrid, LabelledBars, PeriodPicker, Section, useAdminFormat } from '../../features/admin/components.js';
import { presetRange, queryString } from '../../features/admin/period.js';
import type { PeriodSelection } from '../../features/admin/period.js';
import { useAdminRealtime } from '../../features/admin/useAdminRealtime.js';
import { downloadReport } from '../../features/admin/exportCsv.js';

/**
 * District & State admin dashboard (Phase 12).
 *
 * Exactly two views (§5): the holistic OVERVIEW — with the district comparison
 * inside it for a state admin — and CENTRE ANALYSIS. Monitoring only: nothing
 * here starts a payment, reorders a queue or changes a quality decision.
 */
export function AdminDashboard(): JSX.Element {
  const t = useT();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [meError, setMeError] = useState<unknown>(null);
  const [tab, setTab] = useState<'OVERVIEW' | 'CENTRES'>('OVERVIEW');
  const [period, setPeriod] = useState<PeriodSelection>(() => presetRange('LAST_7'));
  const [districtId, setDistrictId] = useState<string>('');
  const [cropId, setCropId] = useState<string>('');

  useEffect(() => {
    api.get<AdminMe>('/api/admin/me').then(setMe).catch(setMeError);
  }, []);

  if (meError) {
    return (
      <AppShell title={t('admin.title')}>
        <ErrorPanel error={meError} />
      </AppShell>
    );
  }
  if (!me) {
    return (
      <AppShell title={t('admin.title')}>
        <Spinner label={t('admin.loading')} />
      </AppShell>
    );
  }

  const area = me.scope === 'STATE' ? me.state?.name : me.district?.name;
  const filters = { from: period.from, to: period.to, districtId: districtId || null, cropId: cropId || null };

  return (
    <AppShell
      title={area ?? t('admin.title')}
      subtitle={me.scope === 'STATE' ? t('admin.subtitleState', { count: me.districtCount, centres: me.centreCount }) : t('admin.subtitleDistrict', { centres: me.centreCount })}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1" role="tablist">
              {(['OVERVIEW', 'CENTRES'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === key ? 'bg-harvest-600 text-white' : 'text-stone-700'}`}
                  onClick={() => setTab(key)}
                >
                  {t(`admin.tab.${key}`)}
                </button>
              ))}
            </div>

            {/* Individual farmer verification is an operational workflow of
                its own, not a dashboard tab — and it belongs to the district
                admin alone, never the state admin (Phase 14). */}
            {me.scope === 'DISTRICT' ? (
              <Link
                to="/district/verification"
                className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                {t('admin.nav.verification')}
              </Link>
            ) : null}
            <Link
              to="/admin/messages"
              className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              {t('admin.nav.messages')}
            </Link>
            <Link
              to="/support"
              className="rounded-lg border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              {t('admin.nav.support')}
            </Link>
          </div>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        {tab === 'OVERVIEW' ? (
          <Overview
            me={me}
            filters={filters}
            cropId={cropId}
            onCrop={setCropId}
            onDistrict={(id) => {
              setDistrictId(id);
              setTab('CENTRES');
            }}
          />
        ) : (
          <CentreAnalysis me={me} filters={filters} districtId={districtId} onDistrict={setDistrictId} />
        )}
      </div>
    </AppShell>
  );
}

type Filters = { from: string; to: string; districtId: string | null; cropId: string | null };

// ---------------------------------------------------------------------------
// View 1 — Holistic overview
// ---------------------------------------------------------------------------

function Overview({
  me,
  filters,
  cropId,
  onCrop,
  onDistrict,
}: {
  me: AdminMe;
  filters: Filters;
  cropId: string;
  onCrop: (id: string) => void;
  onDistrict: (id: string) => void;
}): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const cropOptions = useRef<Array<{ id: string; name: string }>>([]);
  const qs = queryString(filters);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await api.get<AdminOverview>(`/api/admin/dashboard${qs}`);
      setData(next);
      setError(null);
      if (!filters.cropId) {
        cropOptions.current = next.crops.filter((c) => c.cropId).map((c) => ({ id: c.cropId!, name: c.crop }));
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setLoading(false);
    }
  }, [qs, filters.cropId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Material events inside this admin's scope refresh the aggregates (§33).
  useAdminRealtime(() => void load());

  if (loading && !data) return <Spinner label={t('admin.loading')} />;
  if (error && !data) return <ErrorPanel error={error} />;
  if (!data) return <p className="text-sm text-stone-600">{t('admin.loadFailed')}</p>;

  const d = data;

  return (
    <div className="space-y-4">
      {error ? <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('admin.refreshFailed')}</p> : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="text-stone-600">
          {t('admin.filter.crop')}{' '}
          <select className="field-input inline-block w-auto py-1" value={cropId} onChange={(e) => onCrop(e.target.value)}>
            <option value="">{t('admin.filter.allCrops')}</option>
            {cropOptions.current.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <span className="text-xs text-stone-500">{t('admin.periodNote', { from: fmt.date(d.period.from), to: fmt.date(d.period.to), days: d.period.days })}</span>
      </div>

      <AlertList alerts={d.alerts} />

      <Section title={t('admin.live.title')} subtitle={t('admin.live.asOf', { time: new Date(d.live.asOf).toLocaleTimeString() })} live>
        <KpiGrid>
          <Kpi label={t('admin.kpi.centresOperating')} value={`${fmt.num(d.centres.operating)} / ${fmt.num(d.centres.total)}`} />
          <Kpi label={t('admin.kpi.highLoad')} value={fmt.num(d.centres.highLoad)} />
          <Kpi label={t('admin.kpi.closedInactive')} value={fmt.num(d.centres.closedOrInactive)} />
          <Kpi label={t('admin.kpi.arrivalsToday')} value={fmt.num(d.live.arrivalsToday)} />
          <Kpi label={t('admin.kpi.inQueue')} value={fmt.num(d.live.inQueue)} />
          <Kpi label={t('admin.kpi.processing')} value={fmt.num(d.live.processing)} />
        </KpiGrid>
      </Section>

      <Section title={t('admin.procurement.title')} subtitle={t('admin.historical')}>
        <KpiGrid>
          <Kpi label={t('admin.kpi.completedProcurements')} value={fmt.num(d.procurement.completedProcurements)} />
          <Kpi label={t('admin.kpi.acceptedQuantity')} value={fmt.tonnes(d.procurement.acceptedKg)} />
          <Kpi label={t('admin.kpi.procurementValue')} value={fmt.inr(d.procurement.value)} change={d.changes.value} />
          <Kpi label={t('admin.kpi.averageValue')} value={fmt.inr(d.procurement.averageValue)} />
          <Kpi label={t('admin.kpi.farmersServed')} value={fmt.num(d.procurement.farmersServed)} change={d.changes.farmersServed} />
        </KpiGrid>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <DailyBars title={t('admin.chart.quantity')} points={d.trends} pick={(p) => Number(p.acceptedKg)} format={(p) => fmt.tonnes(p.acceptedKg)} />
          <DailyBars title={t('admin.chart.value')} points={d.trends} pick={(p) => Number(p.value)} format={(p) => fmt.inr(p.value)} />
          <DailyBars title={t('admin.chart.farmers')} points={d.trends} pick={(p) => p.farmersServed} format={(p) => fmt.num(p.farmersServed)} />
        </div>
      </Section>

      <Section title={t('admin.bookings.title')} subtitle={t('admin.bookings.cohort')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-stone-800">{t('admin.bookings.funnel')}</h3>
            <LabelledBars
              total={d.bookings.funnel[0]?.count}
              rows={d.bookings.funnel.map((f) => ({ label: t(`admin.funnel.${f.step}`), value: f.count }))}
            />
          </div>
          <KpiGrid>
            <Kpi label={t('admin.kpi.activeBookings')} value={fmt.num(d.bookings.active)} />
            <Kpi label={t('admin.kpi.completedBookings')} value={fmt.num(d.bookings.completed)} />
            <Kpi label={t('admin.kpi.cancelled')} value={fmt.num(d.bookings.cancelled)} />
            <Kpi label={t('admin.kpi.noShows')} value={fmt.num(d.bookings.noShow)} />
          </KpiGrid>
        </div>
      </Section>

      <Section title={t('admin.efficiency.title')} subtitle={t('admin.efficiency.subtitle')}>
        <KpiGrid>
          <Kpi label={t('admin.kpi.avgWait')} value={fmt.mins(d.operations.queueWait.averageMinutes)} change={d.changes.averageWaitMinutes} lowerIsBetter />
          <Kpi label={t('admin.kpi.medianWait')} value={fmt.mins(d.operations.queueWait.medianMinutes)} />
          <Kpi label={t('admin.kpi.maxWait')} value={fmt.mins(d.operations.queueWait.maxMinutes)} />
          <Kpi label={t('admin.kpi.avgProcessing')} value={fmt.mins(d.operations.averageProcessingMinutes)} change={d.changes.averageProcessingMinutes} lowerIsBetter />
          <Kpi label={t('admin.kpi.farmersPerHour')} value={fmt.num(d.operations.farmersPerHour, 1)} />
          <Kpi label={t('admin.kpi.avgQueueLength')} value={fmt.num(d.operations.averageQueueLength, 1)} />
          <Kpi label={t('admin.kpi.slotUtilisation')} value={fmt.pct(d.operations.slotUtilisation)} />
          <Kpi label={t('admin.kpi.workstationUtilisation')} value={fmt.pct(d.operations.workstationUtilisation)} />
          <Kpi label={t('admin.kpi.slotDelay')} value={fmt.mins(d.operations.averageSlotDelayMinutes)} />
        </KpiGrid>
      </Section>

      <Section title={t('admin.fairness.title')} subtitle={t('admin.fairness.subtitle')}>
        <KpiGrid>
          <Kpi label={t('admin.kpi.longWaits')} value={fmt.num(d.queue.longWaitCases)} />
          <Kpi label={t('admin.kpi.starvation')} value={fmt.num(d.queue.starvationEvents)} />
          <Kpi label={t('admin.kpi.protections')} value={fmt.num(d.queue.maxWaitProtections)} />
          <Kpi label={t('admin.kpi.reorders')} value={fmt.num(d.queue.reorders)} />
          <Kpi label={t('admin.kpi.overrides')} value={fmt.num(d.queue.selectionOverrides)} />
        </KpiGrid>
        <Comparison queue={d.queue} />
      </Section>

      <QualitySection quality={d.quality} />
      <PaymentsSection payments={d.payments} />

      <Section title={t('admin.farmers.title')} subtitle={t('admin.farmers.subtitle')} live>
        <KpiGrid>
          <Kpi label={t('admin.kpi.registered')} value={fmt.num(d.farmers.registered)} />
          <Kpi label={t('admin.kpi.verified')} value={fmt.num(d.farmers.verified)} />
          <Kpi label={t('admin.kpi.pendingReview')} value={fmt.num(d.farmers.pendingReview)} />
          <Kpi label={t('admin.kpi.underReview')} value={fmt.num(d.farmers.underReview)} />
          <Kpi label={t('admin.kpi.actionRequired')} value={fmt.num(d.farmers.actionRequired)} />
          <Kpi label={t('admin.kpi.rejected')} value={fmt.num(d.farmers.rejected)} />
        </KpiGrid>
      </Section>

      <CropsSection crops={d.crops} />

      <Section title={t('admin.rankings.title')} subtitle={t('admin.rankings.subtitle', { min: d.rankings[0]?.minimumSample ?? 0 })}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.rankings.map((r) => (
            <div key={r.metric} className="rounded-lg border border-stone-200 p-3">
              <h3 className="text-sm font-medium text-stone-800">{t(`admin.ranking.${r.metric}`)}</h3>
              {r.entries.length === 0 ? (
                <p className="mt-1 text-xs text-stone-500">{t('admin.notEnoughData')}</p>
              ) : (
                <ol className="mt-1 space-y-0.5 text-sm">
                  {r.entries.map((e, i) => (
                    <li key={e.centreId} className="flex justify-between gap-2">
                      <Link to={`/admin/centres/${e.centreId}${queryString({ from: filters.from, to: filters.to })}`} className="truncate text-stone-900 underline-offset-2 hover:underline">
                        {i + 1}. {e.centreName}
                      </Link>
                      <span className="font-mono text-xs text-stone-700">{rankingValue(r.metric, e.value, fmt)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </Section>

      {me.scope === 'STATE' && d.districts ? (
        <Section title={t('admin.districts.title')} subtitle={t('admin.districts.subtitle')}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  {['district', 'centres', 'farmersServed', 'quantity', 'value', 'avgWait', 'avgProcessing', 'throughput', 'paymentCompletion'].map((h) => (
                    <th key={h} scope="col" className="py-1 pr-2 font-medium">{t(`admin.col.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.districts.map((row) => (
                  <tr key={row.districtId} className="border-t border-stone-100">
                    <td className="py-1.5 pr-2">
                      <button type="button" className="font-medium text-stone-900 underline underline-offset-2" onClick={() => onDistrict(row.districtId)}>
                        {row.districtName}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2">{fmt.num(row.centres)}</td>
                    <td className="py-1.5 pr-2">{fmt.num(row.farmersServed)}</td>
                    <td className="py-1.5 pr-2">{fmt.tonnes(row.acceptedKg)}</td>
                    <td className="py-1.5 pr-2 font-mono">{fmt.inr(row.value)}</td>
                    <td className="py-1.5 pr-2">{fmt.mins(row.averageWaitMinutes)}</td>
                    <td className="py-1.5 pr-2">{fmt.mins(row.averageProcessingMinutes)}</td>
                    <td className="py-1.5 pr-2">{fmt.num(row.farmersPerHour, 1)}</td>
                    <td className="py-1.5">{fmt.pct(row.paymentCompletionRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function rankingValue(metric: string, value: number, fmt: ReturnType<typeof useAdminFormat>): string {
  switch (metric) {
    case 'LOWEST_AVERAGE_WAIT': return fmt.mins(value);
    case 'HIGHEST_THROUGHPUT': return fmt.num(value, 1);
    case 'HIGHEST_VOLUME': return fmt.tonnes(String(value));
    default: return fmt.pct(value);
  }
}

// ---------------------------------------------------------------------------
// Shared sections (also used by the centre drill-down)
// ---------------------------------------------------------------------------

export function AlertList({ alerts }: { alerts: AdminAlert[] }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const show = (a: AdminAlert, v: number): string => (a.unit === 'MINUTES' ? fmt.mins(v) : a.unit === 'RATIO' ? fmt.pct(v) : fmt.num(v));
  return (
    <Section title={t('admin.alerts.title')} subtitle={t('admin.alerts.subtitle')}>
      {alerts.length === 0 ? (
        <p className="rounded-lg bg-stone-50 px-3 py-3 text-sm text-stone-600">{t('admin.alerts.none')}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={`${a.code}-${a.centreId}`} className={`rounded-lg border p-3 ${a.severity === 'SERIOUS' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className="text-sm font-semibold text-stone-900">
                <span aria-hidden="true">{a.severity === 'SERIOUS' ? '⚠ ' : '• '}</span>
                {t(`admin.alert.${a.code}.title`)} —{' '}
                <Link to={`/admin/centres/${a.centreId}`} className="underline underline-offset-2">{a.centreName}</Link>
                {a.districtName ? <span className="font-normal text-stone-600"> · {a.districtName}</span> : null}
              </p>
              <p className="mt-0.5 text-sm text-stone-800">
                {t('admin.alert.measured', { value: show(a, a.value), threshold: show(a, a.threshold) })}
                {' · '}
                {a.live ? t('admin.alert.now') : t('admin.alert.inPeriod')}
              </p>
              <p className="mt-0.5 text-xs text-stone-600">{t(`admin.alert.${a.code}.why`)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function Comparison({ queue }: { queue: AdminOverview['queue'] }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const c = queue.comparison;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-medium text-stone-800">{t('admin.comparison.title')}</h3>
      {!c ? (
        <p className="mt-1 text-sm text-stone-600">{t('admin.comparison.none')}</p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500">
                  <th scope="col" className="py-1 pr-2 font-medium"> </th>
                  <th scope="col" className="py-1 pr-2 font-medium">{t('queue.compare.fcfs')}</th>
                  <th scope="col" className="py-1 font-medium">{t('queue.compare.optimized')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-stone-100"><th scope="row" className="py-1 pr-2 text-left font-normal text-stone-600">{t('admin.kpi.avgWait')}</th><td className="py-1 pr-2 font-mono">{fmt.mins(c.fcfs.averageMinutes)}</td><td className="py-1 font-mono">{fmt.mins(c.optimized.averageMinutes)}</td></tr>
                <tr className="border-t border-stone-100"><th scope="row" className="py-1 pr-2 text-left font-normal text-stone-600">{t('admin.kpi.maxWait')}</th><td className="py-1 pr-2 font-mono">{fmt.mins(c.fcfs.maxMinutes)}</td><td className="py-1 font-mono">{fmt.mins(c.optimized.maxMinutes)}</td></tr>
                <tr className="border-t border-stone-100"><th scope="row" className="py-1 pr-2 text-left font-normal text-stone-600">{t('admin.kpi.starvation')}</th><td className="py-1 pr-2 font-mono">{fmt.num(c.fcfs.starvationEvents)}</td><td className="py-1 font-mono">{fmt.num(c.optimized.starvationEvents)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-stone-500">{t('admin.comparison.basis', { count: c.workloadSize })}</p>
        </>
      )}
    </div>
  );
}

export function QualitySection({ quality }: { quality: AdminOverview['quality'] }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const aiTotal = quality.aiRiskDistribution.LOW + quality.aiRiskDistribution.MEDIUM + quality.aiRiskDistribution.HIGH;
  return (
    <Section title={t('admin.quality.title')} subtitle={t('admin.quality.subtitle')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-stone-800">{t('admin.quality.official')}</h3>
          <LabelledBars
            rows={(['PASSED', 'CONDITIONAL', 'FAILED'] as const).map((r) => ({ label: t(`ops.quality.${r}`), value: quality.officialResults[r] }))}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium text-stone-800">{t('admin.quality.ai')}</h3>
          <LabelledBars
            total={aiTotal}
            rows={(['LOW', 'MEDIUM', 'HIGH'] as const).map((r) => ({
              label: t(`quality.ai.riskLevel.${r}`),
              value: quality.aiRiskDistribution[r],
              display: aiTotal ? `${quality.aiRiskDistribution[r]} (${fmt.pct(quality.aiRiskDistribution[r] / aiTotal)})` : '0',
            }))}
          />
        </div>
      </div>
      <div className="mt-4">
        <KpiGrid>
          <Kpi label={t('admin.kpi.aiAssessments')} value={fmt.num(quality.aiAssessments)} hint={quality.aiUnavailable ? t('admin.quality.unavailable', { count: quality.aiUnavailable }) : undefined} />
          <Kpi label={t('admin.kpi.lowConfidence')} value={fmt.pct(quality.aiLowConfidenceRate)} />
          <Kpi label={t('admin.kpi.manualRate')} value={fmt.pct(quality.manualInspectionRate)} />
          <Kpi label={t('admin.kpi.avgScore')} value={fmt.num(quality.averagePredictedScore, 1)} />
        </KpiGrid>
      </div>
      <p className="mt-3 text-xs text-stone-600">
        {t('admin.quality.models')}: {quality.modelVersions.length ? quality.modelVersions.join(', ') : fmt.na}
      </p>
      <p className="mt-1 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{t('admin.quality.noAccuracy')}</p>
    </Section>
  );
}

export function PaymentsSection({ payments }: { payments: AdminOverview['payments'] }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  return (
    <Section title={t('admin.payments.title')} subtitle={t('admin.historical')}>
      <div className="grid gap-4 lg:grid-cols-2">
        <LabelledBars
          rows={(['SUCCESS', 'PROCESSING', 'INITIATED', 'PENDING', 'FAILED', 'RETRY_PENDING'] as const).map((s) => ({ label: t(`payment.status.${s}`), value: payments.byStatus[s] }))}
        />
        <KpiGrid>
          <Kpi label={t('admin.kpi.totalPaid')} value={fmt.inr(payments.totalPaid)} />
          <Kpi label={t('admin.kpi.totalPayable')} value={fmt.inr(payments.totalPayable)} />
          <Kpi label={t('admin.kpi.paymentCompletion')} value={fmt.pct(payments.completionRate)} />
          <Kpi label={t('admin.kpi.settlementTime')} value={payments.averageSettlementSeconds === null ? fmt.na : t('admin.seconds', { value: fmt.num(payments.averageSettlementSeconds) })} />
        </KpiGrid>
      </div>
      {payments.demoPayments > 0 ? <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{t('admin.payments.demo', { count: payments.demoPayments })}</p> : null}
    </Section>
  );
}

export function CropsSection({ crops }: { crops: AdminOverview['crops'] }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  return (
    <Section title={t('admin.crops.title')} subtitle={t('admin.historical')}>
      {crops.length === 0 ? (
        <p className="rounded-lg bg-stone-50 px-3 py-3 text-sm text-stone-600">{t('admin.emptyPeriod')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500">
                {['crop', 'quantity', 'value', 'farmers', 'aiRisk'].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-2 font-medium">{t(`admin.col.${h}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {crops.map((c) => (
                <tr key={c.cropId ?? c.crop} className="border-t border-stone-100">
                  <td className="py-1.5 pr-2 font-medium text-stone-900">{c.crop}</td>
                  <td className="py-1.5 pr-2">{fmt.tonnes(c.acceptedKg)}</td>
                  <td className="py-1.5 pr-2 font-mono">{fmt.inr(c.value)}</td>
                  <td className="py-1.5 pr-2">{fmt.num(c.farmers)}</td>
                  <td className="py-1.5 text-xs text-stone-700">
                    {t('quality.ai.riskLevel.LOW')} {c.aiRisk.LOW} · {t('quality.ai.riskLevel.MEDIUM')} {c.aiRisk.MEDIUM} · {t('quality.ai.riskLevel.HIGH')} {c.aiRisk.HIGH}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// View 2 — Centre-by-centre analysis
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'name', label: 'centre' },
  { key: 'district', label: 'district', stateOnly: true },
  { key: 'status', label: 'status' },
  { key: 'farmersServed', label: 'farmersServed' },
  { key: 'acceptedKg', label: 'quantity' },
  { key: 'value', label: 'value' },
  { key: 'averageWaitMinutes', label: 'avgWait' },
  { key: 'averageProcessingMinutes', label: 'avgProcessing' },
  { key: 'currentQueue', label: 'queueNow' },
  { key: 'slotUtilisation', label: 'slotUtilisation' },
  { key: 'paymentsPending', label: 'paymentsPending' },
] as const;

function CentreAnalysis({ me, filters, districtId, onDistrict }: { me: AdminMe; filters: Filters; districtId: string; onDistrict: (id: string) => void }): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const [data, setData] = useState<CentrePerformancePage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CentreStatus | ''>('');
  const [sort, setSort] = useState<string>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [districts, setDistricts] = useState<Array<{ id: string; name: string }>>([]);
  const [exportError, setExportError] = useState<unknown>(null);

  const qs = queryString({ ...filters, search: search.trim() || null, status: status || null, sort, dir, page, pageSize: 20 });

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await api.get<CentrePerformancePage>(`/api/admin/centres/performance${qs}`));
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [qs]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (me.scope === 'STATE') {
      api.get<{ districts: Array<{ id: string; name: string }> }>('/api/admin/centres').then((r) => setDistricts(r.districts)).catch(() => undefined);
    }
  }, [me.scope]);

  useAdminRealtime(() => void load());

  const toggleSort = (key: string): void => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir(key === 'name' || key === 'district' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const exportQs = queryString({ from: filters.from, to: filters.to, districtId: filters.districtId, cropId: filters.cropId });
  const reports: AdminExportReport[] = ['centre-performance', 'crop-procurement', 'payment-summary', 'queue-performance'];

  return (
    <div className="space-y-4">
      <Section
        title={t('admin.centres.title')}
        subtitle={t('admin.centres.subtitle')}
        actions={
          <div className="flex flex-wrap gap-1">
            {reports.map((r) => (
              <button
                key={r}
                type="button"
                className="rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
                onClick={() => {
                  setExportError(null);
                  downloadReport(r, exportQs).catch(setExportError);
                }}
              >
                ⬇ {t(`admin.export.${r}`)}
              </button>
            ))}
          </div>
        }
      >
        {exportError ? <ErrorPanel error={exportError} /> : null}
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-600">
            {t('admin.filter.search')}
            <input className="field-input mt-0.5 py-1" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </label>
          <label className="text-xs text-stone-600">
            {t('admin.filter.status')}
            <select className="field-input mt-0.5 py-1" value={status} onChange={(e) => { setStatus(e.target.value as CentreStatus | ''); setPage(1); }}>
              <option value="">{t('admin.filter.any')}</option>
              {(['OPERATIONAL', 'HIGH_LOAD', 'DELAYED', 'LOW_ACTIVITY', 'CLOSED', 'INACTIVE'] as const).map((s) => (
                <option key={s} value={s}>{t(`admin.status.${s}`)}</option>
              ))}
            </select>
          </label>
          {me.scope === 'STATE' ? (
            <label className="text-xs text-stone-600">
              {t('admin.filter.district')}
              <select className="field-input mt-0.5 py-1" value={districtId} onChange={(e) => { onDistrict(e.target.value); setPage(1); }}>
                <option value="">{t('admin.filter.allDistricts')}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {error ? <ErrorPanel error={error} /> : null}
        {!data ? (
          <Spinner label={t('admin.loading')} />
        ) : data.rows.length === 0 ? (
          <p className="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">{t('admin.centres.none')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500">
                    {COLUMNS.filter((c) => !('stateOnly' in c) || me.scope === 'STATE').map((c) => (
                      <th key={c.key} scope="col" className="py-1 pr-2 font-medium" aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="underline-offset-2 hover:underline" onClick={() => toggleSort(c.key)}>
                          {t(`admin.col.${c.label}`)}
                          {sort === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.centreId} className="border-t border-stone-100">
                      <td className="py-1.5 pr-2">
                        <Link to={`/admin/centres/${r.centreId}${queryString({ from: filters.from, to: filters.to })}`} className="font-medium text-stone-900 underline-offset-2 hover:underline">
                          {r.name}
                        </Link>
                        <p className="font-mono text-xs text-stone-500">{r.code}</p>
                      </td>
                      {me.scope === 'STATE' ? <td className="py-1.5 pr-2">{r.districtName ?? fmt.na}</td> : null}
                      <td className="py-1.5 pr-2 text-xs">{t(`admin.status.${r.status}`)}</td>
                      <td className="py-1.5 pr-2">{fmt.num(r.farmersServed)}</td>
                      <td className="py-1.5 pr-2">{fmt.tonnes(r.acceptedKg)}</td>
                      <td className="py-1.5 pr-2 font-mono">{fmt.inr(r.value)}</td>
                      <td className="py-1.5 pr-2">{fmt.mins(r.averageWaitMinutes)}</td>
                      <td className="py-1.5 pr-2">{fmt.mins(r.averageProcessingMinutes)}</td>
                      <td className="py-1.5 pr-2">{fmt.num(r.currentQueue)}</td>
                      <td className="py-1.5 pr-2">{fmt.pct(r.slotUtilisation)}</td>
                      <td className="py-1.5">{fmt.num(r.paymentsPending)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-stone-600">
              <span>{t('admin.pagination', { from: (data.page - 1) * data.pageSize + 1, to: Math.min(data.page * data.pageSize, data.total), total: data.total })}</span>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary py-1" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>{t('common.back')}</button>
                <button type="button" className="btn-secondary py-1" disabled={data.page * data.pageSize >= data.total} onClick={() => setPage(data.page + 1)}>{t('common.next')}</button>
              </div>
            </div>
          </>
        )}
        <p className="mt-2 text-xs text-stone-500">{t('admin.centres.statusNote')}</p>
      </Section>
    </div>
  );
}
