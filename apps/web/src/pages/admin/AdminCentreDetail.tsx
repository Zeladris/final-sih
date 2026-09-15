import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { CentreDetail } from '@kisansetu/shared';
import { DASHBOARD_PATH } from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';
import { DailyBars, Kpi, KpiGrid, LabelledBars, PeriodPicker, Section, useAdminFormat } from '../../features/admin/components.js';
import { presetRange, queryString } from '../../features/admin/period.js';
import type { PeriodSelection } from '../../features/admin/period.js';
import { useAdminRealtime } from '../../features/admin/useAdminRealtime.js';
import { AlertList, Comparison, CropsSection, PaymentsSection, QualitySection } from './AdminDashboard.js';

/**
 * Centre drill-down (§22, §23) — /admin/centres/:centreId.
 *
 * The server checks the centre is inside this admin's district or state and
 * answers "not found" otherwise; this page adds no authority of its own.
 */
export function AdminCentreDetail(): JSX.Element {
  const t = useT();
  const fmt = useAdminFormat();
  const { profile } = useAuth();
  const { centreId = '' } = useParams();
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<PeriodSelection>(() => {
    const from = params.get('from');
    const to = params.get('to');
    return from && to ? { preset: 'CUSTOM', from, to } : presetRange('LAST_7');
  });
  const [data, setData] = useState<CentreDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setData(await api.get<CentreDetail>(`/api/admin/centres/${centreId}${queryString({ from: period.from, to: period.to })}`));
      setError(null);
    } catch (cause) {
      setError(cause);
    }
  }, [centreId, period.from, period.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useAdminRealtime(() => void load());

  const back = profile ? DASHBOARD_PATH[profile.role] : '/';

  if (error && !data) {
    return (
      <AppShell title={t('admin.centre.title')}>
        <ErrorPanel error={error} />
        <Link to={back} className="btn-secondary mt-4 inline-block">{t('admin.backToDashboard')}</Link>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell title={t('admin.centre.title')}>
        <Spinner label={t('admin.loading')} />
      </AppShell>
    );
  }

  const c = data.centre;

  return (
    <AppShell title={c.name} subtitle={[c.code, c.districtName, c.village].filter(Boolean).join(' · ')}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to={back} className="text-sm text-stone-600 underline underline-offset-2">← {t('admin.backToDashboard')}</Link>
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        <Section title={t('admin.centre.info')}>
          <KpiGrid>
            <Kpi label={t('admin.col.status')} value={t(`admin.status.${c.status}`)} />
            <Kpi label={t('admin.centre.hours')} value={c.openTime && c.closeTime ? `${c.openTime}–${c.closeTime}` : fmt.na} />
            <Kpi label={t('admin.centre.active')} value={c.isActive ? t('admin.yes') : t('admin.no')} />
          </KpiGrid>
        </Section>

        <AlertList alerts={data.alerts} />

        <Section title={t('admin.centre.today')} live>
          <KpiGrid>
            <Kpi label={t('admin.kpi.bookingsToday')} value={fmt.num(data.today.bookings)} />
            <Kpi label={t('admin.kpi.arrivalsToday')} value={fmt.num(data.today.arrivals)} />
            <Kpi label={t('admin.kpi.inQueue')} value={fmt.num(data.today.inQueue)} />
            <Kpi label={t('admin.kpi.processing')} value={fmt.num(data.today.processing)} />
            <Kpi label={t('admin.kpi.completedToday')} value={fmt.num(data.today.completed)} />
            <Kpi label={t('admin.kpi.paidToday')} value={fmt.num(data.today.paymentsCompleted)} />
          </KpiGrid>
        </Section>

        <Section title={t('admin.efficiency.title')} subtitle={t('admin.historical')}>
          <KpiGrid>
            <Kpi label={t('admin.kpi.avgWait')} value={fmt.mins(data.operations.queueWait.averageMinutes)} />
            <Kpi label={t('admin.kpi.medianWait')} value={fmt.mins(data.operations.queueWait.medianMinutes)} />
            <Kpi label={t('admin.kpi.maxWait')} value={fmt.mins(data.operations.queueWait.maxMinutes)} />
            <Kpi label={t('admin.kpi.avgProcessing')} value={fmt.mins(data.operations.averageProcessingMinutes)} />
            <Kpi label={t('admin.kpi.farmersPerHour')} value={fmt.num(data.operations.farmersPerHour, 1)} />
            <Kpi label={t('admin.kpi.slotUtilisation')} value={fmt.pct(data.operations.slotUtilisation)} />
            <Kpi label={t('admin.kpi.avgQueueLength')} value={fmt.num(data.operations.averageQueueLength, 1)} />
            <Kpi label={t('admin.kpi.workstationUtilisation')} value={fmt.pct(data.operations.workstationUtilisation)} />
          </KpiGrid>
        </Section>

        <Section title={t('admin.procurement.title')} subtitle={t('admin.historical')}>
          <KpiGrid>
            <Kpi label={t('admin.kpi.completedProcurements')} value={fmt.num(data.procurement.completedProcurements)} />
            <Kpi label={t('admin.kpi.acceptedQuantity')} value={fmt.tonnes(data.procurement.acceptedKg)} />
            <Kpi label={t('admin.kpi.procurementValue')} value={fmt.inr(data.procurement.value)} />
            <Kpi label={t('admin.kpi.farmersServed')} value={fmt.num(data.procurement.farmersServed)} />
          </KpiGrid>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <DailyBars title={t('admin.chart.quantity')} points={data.trends} pick={(p) => Number(p.acceptedKg)} format={(p) => fmt.tonnes(p.acceptedKg)} />
            <DailyBars title={t('admin.chart.value')} points={data.trends} pick={(p) => Number(p.value)} format={(p) => fmt.inr(p.value)} />
          </div>
        </Section>

        <Section title={t('admin.fairness.title')} subtitle={t('admin.fairness.subtitle')}>
          <KpiGrid>
            <Kpi label={t('admin.kpi.longWaits')} value={fmt.num(data.queue.longWaitCases)} />
            <Kpi label={t('admin.kpi.protections')} value={fmt.num(data.queue.maxWaitProtections)} />
            <Kpi label={t('admin.kpi.reorders')} value={fmt.num(data.queue.reorders)} />
            <Kpi label={t('admin.kpi.overrides')} value={fmt.num(data.queue.selectionOverrides)} />
          </KpiGrid>
          <Comparison queue={data.queue} />
        </Section>

        <Section title={t('admin.bookings.title')} subtitle={t('admin.bookings.cohort')}>
          <LabelledBars total={data.bookings.funnel[0]?.count} rows={data.bookings.funnel.map((f) => ({ label: t(`admin.funnel.${f.step}`), value: f.count }))} />
        </Section>

        <QualitySection quality={data.quality} />
        <PaymentsSection payments={data.payments} />
        <CropsSection crops={data.crops} />
      </div>
    </AppShell>
  );
}
