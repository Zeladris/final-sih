import { toCalendarDate, zonedInstant } from '@kisansetu/shared';
import type {
  AdminAlert,
  AdminExportReport,
  AdminMe,
  AdminOverview,
  AdminPeriod,
  CentreDetail,
  CentrePerformancePage,
  CentrePerformanceRow,
  CentreStatus,
  DistrictSummaryRow,
  QueueBlock,
  Ranking,
  WaitSummary,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { forbidden, validationError } from '../../lib/errors.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { policyFromEnv } from '../queue/optimizer/policy.js';
import { simulate } from '../queue/optimizer/simulation.js';
import type { SimulationJob } from '../queue/optimizer/simulation.js';
import type { WorkstationInput } from '../queue/optimizer/types.js';
import { resolvePeriod, resolveScope } from './adminScope.js';
import type { ResolvedScope, ScopeCentre } from './adminScope.js';
import { loadFarmerStatuses, loadLive, loadPeriod, loadPrevious } from './dataset.js';
import type { LiveDataset, PeriodDataset } from './dataset.js';
import {
  bookingBlock,
  changeRatio,
  cropRows,
  operationsBlock,
  paymentBlock,
  procurementBlock,
  processingMinutes,
  qualityBlock,
  queueBlock,
  queueWaits,
  trendSeries,
  waitSummary,
} from './metrics.js';
import type { CentreSet } from './metrics.js';
import type { AuthContext } from '../../types/request.js';

/**
 * District & State admin analytics (Phase 12).
 *
 * One architecture, two scopes. The SAME functions produce the district
 * overview, the state overview, each district's comparison row and each
 * centre's row — only the centre set differs. Admins monitor; nothing here
 * writes to an operational table, reorders a queue, decides quality or moves
 * a payment (§41–§44).
 */

export interface AdminQuery {
  from?: string;
  to?: string;
  districtId?: string;
  cropId?: string;
}

interface Context {
  scope: ResolvedScope;
  period: AdminPeriod;
  ds: PeriodDataset;
  live: LiveDataset;
  now: Date;
}

/** Applies the crop filter to every crop-bearing record, inside the scope (§30). */
function filterByCrop(ds: PeriodDataset, cropId: string | undefined): PeriodDataset {
  if (!cropId) return ds;
  const bookings = ds.bookings.filter((b) => b.crop_id === cropId);
  const ids = new Set(bookings.map((b) => b.id));
  const procurements = ds.procurements.filter((p) => p.crop_id === cropId);
  const procurementIds = new Set(procurements.map((p) => p.id));
  return {
    ...ds,
    bookings,
    operations: ds.operations.filter((o) => ids.has(o.booking_id)),
    official: ds.official.filter((q) => ids.has(q.booking_id)),
    entries: ds.entries.filter((e) => e.crop_id === cropId),
    procurements,
    payments: ds.payments.filter((p) => procurementIds.has(p.procurement_id)),
    predictions: ds.predictions.filter((p) => p.crop_id === cropId),
  };
}

async function context(auth: AuthContext, query: AdminQuery, centreId?: string): Promise<Context> {
  const scope = await resolveScope(auth, { districtId: query.districtId, centreId });
  const period = resolvePeriod(query.from, query.to);
  const ids = scope.centres.map((c) => c.id);
  const [ds, live] = await Promise.all([loadPeriod(ids, period), loadLive(ids)]);
  return { scope, period, ds: filterByCrop(ds, query.cropId), live, now: new Date() };
}

// ---------------------------------------------------------------------------
// Centre status (§21) — from today's actual state, by configured thresholds
// ---------------------------------------------------------------------------

function centreStatus(centre: ScopeCentre, live: LiveDataset, now: Date): CentreStatus {
  if (!centre.isActive) return 'INACTIVE';
  const session = live.todaySessions.find((s) => s.centre_id === centre.id);
  if (!session || session.status === 'SCHEDULED' || session.status === 'CLOSED') return 'CLOSED';

  const queued = live.queued.filter((q) => q.centre_id === centre.id);
  if (queued.length >= env.ADMIN_HIGH_LOAD_QUEUE) return 'HIGH_LOAD';

  const longest = queued.reduce((max, q) => Math.max(max, (now.getTime() - Date.parse(q.entered_at)) / 60_000), 0);
  if (longest >= env.ADMIN_DELAYED_WAIT_MINUTES) return 'DELAYED';

  const arrivals = live.arrivals.filter((a) => a.centre_id === centre.id).length;
  const processing = live.processing.filter((p) => p.centre_id === centre.id).length;
  if (arrivals === 0 && queued.length === 0 && processing === 0) return 'LOW_ACTIVITY';

  return 'OPERATIONAL';
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function centreRow(c: Context, centre: ScopeCentre): CentrePerformanceRow {
  const set: CentreSet = new Set([centre.id]);
  const procurement = procurementBlock(c.ds.procurements.filter((p) => p.centre_id === centre.id));
  const ops = operationsBlock(c.ds, set, c.now);
  const pay = paymentBlock(c.ds, set);
  return {
    centreId: centre.id,
    code: centre.code,
    name: centre.name,
    districtId: centre.districtId,
    districtName: centre.districtName,
    status: centreStatus(centre, c.live, c.now),
    farmersServed: procurement.farmersServed,
    acceptedKg: procurement.acceptedKg,
    value: procurement.value,
    averageWaitMinutes: ops.queueWait.averageMinutes,
    averageProcessingMinutes: ops.averageProcessingMinutes,
    farmersPerHour: ops.farmersPerHour,
    currentQueue: c.live.queued.filter((q) => q.centre_id === centre.id).length,
    slotUtilisation: ops.slotUtilisation,
    paymentsPending: c.live.outstandingPayments.filter((p) => p.centre_id === centre.id).length,
    paymentCompletionRate: pay.completionRate,
  };
}

function districtRows(c: Context): DistrictSummaryRow[] {
  return c.scope.districts.map((district) => {
    const centres = c.scope.centres.filter((x) => x.districtId === district.id);
    const set: CentreSet = new Set(centres.map((x) => x.id));
    const procurement = procurementBlock(c.ds.procurements.filter((p) => set.has(p.centre_id)));
    const ops = operationsBlock(c.ds, set, c.now);
    return {
      districtId: district.id,
      districtName: district.name,
      centres: centres.length,
      farmersServed: procurement.farmersServed,
      acceptedKg: procurement.acceptedKg,
      value: procurement.value,
      averageWaitMinutes: ops.queueWait.averageMinutes,
      averageProcessingMinutes: ops.averageProcessingMinutes,
      farmersPerHour: ops.farmersPerHour,
      paymentCompletionRate: paymentBlock(c.ds, set).completionRate,
    };
  });
}

// ---------------------------------------------------------------------------
// FCFS vs FA-DQO on the recorded workload (§12) — Phase 7's own simulation
// ---------------------------------------------------------------------------

function comparisonFor(c: Context, set: CentreSet): QueueBlock['comparison'] {
  const policy = policyFromEnv();
  const entries = c.ds.entries.filter((e) => set.has(e.centre_id) && e.state !== 'REMOVED' && e.estimated_processing_minutes !== null);
  if (entries.length === 0) return null;

  // Pooled exactly from per-replay summaries: count-weighted mean, and the
  // maximum of maxima. A pooled median is not derivable, so none is claimed.
  const pool = { fcfs: { count: 0, sum: 0, max: null as number | null, starve: 0 }, opt: { count: 0, sum: 0, max: null as number | null, starve: 0 } };
  const add = (bucket: typeof pool.fcfs, r: NonNullable<ReturnType<typeof simulate>>): void => {
    bucket.count += r.waits.count;
    bucket.sum += (r.waits.averageMinutes ?? 0) * r.waits.count;
    if (r.waits.maxMinutes !== null) bucket.max = Math.max(bucket.max ?? 0, r.waits.maxMinutes);
    bucket.starve += r.starvationEvents;
  };

  // One replay per centre-day: queues do not span centres or days.
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const key = `${e.centre_id}|${toCalendarDate(new Date(e.entered_at), env.APP_TIMEZONE)}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  for (const [key, group] of groups) {
    const [centreId, date] = key.split('|') as [string, string];
    const stations: WorkstationInput[] = c.ds.workstations
      .filter((w) => w.centre_id === centreId && w.status !== 'OFFLINE')
      .map((w) => ({ id: w.id, code: w.code, cropIds: w.crop_ids ?? [], status: 'AVAILABLE', remainingMinutes: null }));

    const jobs: SimulationJob[] = group.map((e) => ({
      estimatedMinutes: Number(e.estimated_processing_minutes),
      input: {
        entryId: e.booking_id, bookingId: e.booking_id, bookingReference: e.booking_id, farmerName: null,
        bookingCreatedAt: new Date(e.entered_at), cropId: e.crop_id, cropName: '', quantityKg: 0,
        enteredAt: new Date(e.entered_at), slotEndAt: e.slot_end_at ? new Date(e.slot_end_at) : null,
        entryState: 'QUEUED', operationState: 'WAITING', bookingStatus: 'BOOKED', cropVerified: true,
        qualityResult: e.quality_result === 'CONDITIONAL' ? 'CONDITIONAL' : 'PASSED',
        aiRisk: (e.quality_risk as never) ?? null,
        aiConfidence: e.quality_confidence === null ? null : Number(e.quality_confidence),
        aiManualInspection: e.prediction_id ? e.manual_inspection_required : null,
        // Not joined into this dataset (aggregate-stats simulation, not live
        // ranking) — null is the correct "no signal" input: qualityFactorScore
        // treats it as fully neutral, never as a penalty.
        aiQualityScore: null,
        estimatedProcessingMinutes: Number(e.estimated_processing_minutes), estimateSource: null,
        priorityAdvantageCount: 0, lastAdvantageAt: null, previousRank: null,
      },
    }));

    const centre = c.scope.centres.find((x) => x.id === centreId);
    const closeAt = centre?.closeTime ? zonedInstant(date, centre.closeTime, env.APP_TIMEZONE) : null;

    const fcfs = simulate('FCFS', jobs, stations, policy, closeAt);
    const opt = simulate('FA_DQO', jobs, stations, policy, closeAt);
    if (!fcfs || !opt) continue;
    add(pool.fcfs, fcfs);
    add(pool.opt, opt);
  }

  if (pool.fcfs.count === 0) return null;

  const summary = (b: typeof pool.fcfs): WaitSummary & { starvationEvents: number } => ({
    count: b.count,
    averageMinutes: Math.round((b.sum / b.count) * 10) / 10,
    medianMinutes: null,
    maxMinutes: b.max,
    starvationEvents: b.starve,
  });

  return { workloadSize: pool.fcfs.count, fcfs: summary(pool.fcfs), optimized: summary(pool.opt) };
}
// ---------------------------------------------------------------------------
// Alerts (§26) — deterministic, explicit thresholds, no LLM
// ---------------------------------------------------------------------------

function alertsFor(c: Context, centres: ScopeCentre[]): AdminAlert[] {
  const alerts: AdminAlert[] = [];
  const minSample = env.ADMIN_ALERT_MIN_SAMPLE;

  for (const centre of centres) {
    const set: CentreSet = new Set([centre.id]);
    const base = { centreId: centre.id, centreName: centre.name, districtName: centre.districtName };
    const ops = operationsBlock(c.ds, set, c.now);
    const quality = qualityBlock(c.ds, set);
    const bookings = bookingBlock(c.ds, set);
    const queued = c.live.queued.filter((q) => q.centre_id === centre.id).length;
    const failed = c.live.outstandingPayments.filter((p) => p.centre_id === centre.id && (p.status === 'FAILED' || p.status === 'RETRY_PENDING')).length;

    if (ops.queueWait.averageMinutes !== null && ops.queueWait.count >= 1 && ops.queueWait.averageMinutes > env.ADMIN_ALERT_AVG_WAIT_MINUTES) {
      alerts.push({ ...base, code: 'HIGH_AVERAGE_WAIT', severity: 'SERIOUS', value: ops.queueWait.averageMinutes, threshold: env.ADMIN_ALERT_AVG_WAIT_MINUTES, unit: 'MINUTES', live: false });
    }
    if (queued >= env.ADMIN_HIGH_LOAD_QUEUE) {
      alerts.push({ ...base, code: 'QUEUE_OVERLOAD', severity: 'SERIOUS', value: queued, threshold: env.ADMIN_HIGH_LOAD_QUEUE, unit: 'COUNT', live: true });
    }
    if (ops.averageSlotDelayMinutes !== null && ops.averageSlotDelayMinutes > env.ADMIN_ALERT_SLOT_DELAY_MINUTES) {
      alerts.push({ ...base, code: 'SLOT_DELAYS', severity: 'WARNING', value: ops.averageSlotDelayMinutes, threshold: env.ADMIN_ALERT_SLOT_DELAY_MINUTES, unit: 'MINUTES', live: false });
    }
    if (failed > 0) {
      alerts.push({ ...base, code: 'PAYMENT_FAILURES', severity: 'SERIOUS', value: failed, threshold: 1, unit: 'COUNT', live: true });
    }
    const entries = c.ds.entries.filter((e) => e.centre_id === centre.id).length;
    if (quality.manualInspectionRate !== null && entries >= minSample && quality.manualInspectionRate > env.ADMIN_ALERT_MANUAL_REVIEW_RATE) {
      alerts.push({ ...base, code: 'HIGH_MANUAL_REVIEW', severity: 'WARNING', value: quality.manualInspectionRate, threshold: env.ADMIN_ALERT_MANUAL_REVIEW_RATE, unit: 'RATIO', live: false });
    }
    if (quality.aiLowConfidenceRate !== null && quality.aiAssessments >= minSample && quality.aiLowConfidenceRate > env.ADMIN_ALERT_LOW_CONFIDENCE_RATE) {
      alerts.push({ ...base, code: 'LOW_CONFIDENCE_AI', severity: 'WARNING', value: quality.aiLowConfidenceRate, threshold: env.ADMIN_ALERT_LOW_CONFIDENCE_RATE, unit: 'RATIO', live: false });
    }
    // Bookings in the period but the centre never opened a session.
    const opened = c.ds.sessions.some((s) => s.centre_id === centre.id && s.opened_at);
    const due = c.ds.bookings.filter((b) => b.centre_id === centre.id && b.status !== 'CANCELLED').length;
    if (centre.isActive && !opened && due > 0) {
      alerts.push({ ...base, code: 'CENTRE_NOT_OPENED', severity: 'SERIOUS', value: due, threshold: 1, unit: 'COUNT', live: false });
    }
    if (bookings.total >= minSample) {
      const rate = (bookings.cancelled + bookings.noShow) / bookings.total;
      if (rate > env.ADMIN_ALERT_CANCELLATION_RATE) {
        alerts.push({ ...base, code: 'HIGH_CANCELLATION', severity: 'WARNING', value: Math.round(rate * 1000) / 1000, threshold: env.ADMIN_ALERT_CANCELLATION_RATE, unit: 'RATIO', live: false });
      }
    }
  }

  return alerts.sort((a, b) => (a.severity === b.severity ? a.centreName.localeCompare(b.centreName) : a.severity === 'SERIOUS' ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Rankings (§25) — one metric each, never a composite score
// ---------------------------------------------------------------------------

function rankingsFor(c: Context, rows: CentrePerformanceRow[]): Ranking[] {
  const min = env.ADMIN_RANKING_MIN_SAMPLE;
  const served = new Map(c.scope.centres.map((centre) => [centre.id, c.ds.procurements.filter((p) => p.centre_id === centre.id).length]));
  const eligible = rows.filter((r) => (served.get(r.centreId) ?? 0) >= min);

  const top = (metric: Ranking['metric'], value: (r: CentrePerformanceRow) => number | null, ascending = false): Ranking => ({
    metric,
    minimumSample: min,
    entries: eligible
      .map((r) => ({ centreId: r.centreId, centreName: r.name, value: value(r) }))
      .filter((e): e is { centreId: string; centreName: string; value: number } => e.value !== null)
      .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value) || a.centreName.localeCompare(b.centreName))
      .slice(0, 3),
  });

  return [
    top('LOWEST_AVERAGE_WAIT', (r) => r.averageWaitMinutes, true),
    top('HIGHEST_THROUGHPUT', (r) => r.farmersPerHour),
    top('HIGHEST_SLOT_UTILISATION', (r) => r.slotUtilisation),
    top('HIGHEST_VOLUME', (r) => Number(r.acceptedKg)),
    top('HIGHEST_PAYMENT_COMPLETION', (r) => r.paymentCompletionRate),
  ];
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export async function getAdminMe(auth: AuthContext): Promise<AdminMe> {
  const scope = await resolveScope(auth);
  const db = supabaseAdminClient;
  const profileTable = auth.role === 'DISTRICT_ADMIN' ? 'district_admin_profiles' : 'state_admin_profiles';
  const { data: profile } = await db.from(profileTable).select('employee_reference_id').eq('user_id', auth.userId).maybeSingle();
  const { data: state } = scope.stateId
    ? await db.from('states').select('id, name').eq('id', scope.stateId).maybeSingle()
    : { data: null };

  return {
    role: auth.role as AdminMe['role'],
    name: auth.fullName,
    employeeReferenceId: (profile as { employee_reference_id: string } | null)?.employee_reference_id ?? null,
    scope: scope.kind,
    state: (state as { id: string; name: string } | null) ?? null,
    district: scope.kind === 'DISTRICT' ? (scope.districts[0] ?? null) : null,
    centreCount: scope.centres.length,
    districtCount: scope.districts.length,
  };
}

export async function getOverview(auth: AuthContext, query: AdminQuery): Promise<AdminOverview> {
  const c = await context(auth, query);
  const all: CentreSet = new Set(c.scope.centres.map((x) => x.id));
  const [previous, farmerStatuses] = await Promise.all([
    loadPrevious([...all], c.period),
    loadFarmerStatuses(c.scope.districts.map((d) => d.id)),
  ]);

  const rows = c.scope.centres.map((centre) => centreRow(c, centre));
  const statuses = rows.map((r) => r.status);
  const procurement = procurementBlock(c.ds.procurements);
  const operations = operationsBlock(c.ds, all, c.now);

  const prevProcurement = procurementBlock(previous.procurements.filter((p) => !query.cropId || p.crop_id === query.cropId));
  const prevEntries = previous.entries.filter((e) => !query.cropId || e.crop_id === query.cropId);
  const prevWait = waitSummary(queueWaits(prevEntries)).averageMinutes;
  const prevProcessing = processingMinutes(prevEntries);
  const prevProcessingAvg = prevProcessing.length ? Math.round((prevProcessing.reduce((a, b) => a + b, 0) / prevProcessing.length) * 10) / 10 : null;

  const count = (status: string): number => farmerStatuses.filter((s) => s === status).length;

  return {
    scope: c.scope.kind,
    period: c.period,
    centres: {
      total: rows.length,
      operating: statuses.filter((s) => s !== 'CLOSED' && s !== 'INACTIVE').length,
      highLoad: statuses.filter((s) => s === 'HIGH_LOAD').length,
      closedOrInactive: statuses.filter((s) => s === 'CLOSED' || s === 'INACTIVE').length,
    },
    live: {
      asOf: c.live.asOf,
      centresOperating: statuses.filter((s) => s !== 'CLOSED' && s !== 'INACTIVE').length,
      arrivalsToday: c.live.arrivals.length,
      inQueue: c.live.queued.length,
      processing: c.live.processing.length,
    },
    farmers: {
      registered: farmerStatuses.length,
      verified: count('VERIFIED'),
      pendingReview: count('SUBMITTED'),
      underReview: count('UNDER_REVIEW'),
      actionRequired: count('RESUBMISSION_REQUIRED'),
      rejected: count('REJECTED'),
      draft: count('DRAFT'),
    },
    bookings: bookingBlock(c.ds, all),
    procurement,
    operations,
    queue: { ...queueBlock(c.ds, all), comparison: comparisonFor(c, all) },
    quality: qualityBlock(c.ds, all),
    payments: paymentBlock(c.ds, all),
    crops: cropRows(c.ds, all),
    trends: trendSeries(c.ds, all, c.period.from, c.period.to),
    changes: {
      averageWaitMinutes: { current: operations.queueWait.averageMinutes, previous: prevWait, changeRatio: changeRatio(operations.queueWait.averageMinutes, prevWait) },
      averageProcessingMinutes: { current: operations.averageProcessingMinutes, previous: prevProcessingAvg, changeRatio: changeRatio(operations.averageProcessingMinutes, prevProcessingAvg) },
      farmersServed: { current: procurement.farmersServed, previous: prevProcurement.farmersServed, changeRatio: changeRatio(procurement.farmersServed, prevProcurement.farmersServed) },
      value: { current: Number(procurement.value), previous: Number(prevProcurement.value), changeRatio: changeRatio(Number(procurement.value), Number(prevProcurement.value)) },
    },
    rankings: rankingsFor(c, rows),
    alerts: alertsFor(c, c.scope.centres),
    districts: c.scope.kind === 'STATE' ? districtRows(c) : null,
  };
}

const SORTS: Record<string, (r: CentrePerformanceRow) => number | string | null> = {
  name: (r) => r.name,
  district: (r) => r.districtName,
  status: (r) => r.status,
  farmersServed: (r) => r.farmersServed,
  acceptedKg: (r) => Number(r.acceptedKg),
  value: (r) => Number(r.value),
  averageWaitMinutes: (r) => r.averageWaitMinutes,
  averageProcessingMinutes: (r) => r.averageProcessingMinutes,
  farmersPerHour: (r) => r.farmersPerHour,
  currentQueue: (r) => r.currentQueue,
  slotUtilisation: (r) => r.slotUtilisation,
  paymentsPending: (r) => r.paymentsPending,
};

/** §20 — server-side sort, search, filter and pagination. */
export async function getCentrePerformance(
  auth: AuthContext,
  query: AdminQuery & { search?: string; status?: CentreStatus; sort?: string; dir?: 'asc' | 'desc'; page?: number; pageSize?: number },
): Promise<CentrePerformancePage> {
  const c = await context(auth, query);
  let rows = c.scope.centres.map((centre) => centreRow(c, centre));

  const search = query.search?.trim().toLowerCase();
  if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(search) || r.code.toLowerCase().includes(search));
  if (query.status) rows = rows.filter((r) => r.status === query.status);

  const key = SORTS[query.sort ?? 'name'];
  if (!key) throw validationError('Unknown sort column.');
  const dir = query.dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    // "Not available" always sorts last, whichever direction.
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir || a.name.localeCompare(b.name);
  });

  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

/** §22, §23 — the centre must be inside the admin's scope, or it does not exist. */
export async function getCentreDetail(auth: AuthContext, centreId: string, query: AdminQuery): Promise<CentreDetail> {
  const c = await context(auth, { ...query, districtId: undefined }, centreId);
  const centre = c.scope.centres[0]!;
  const set: CentreSet = new Set([centre.id]);
  const live = c.live;

  return {
    centre: {
      id: centre.id,
      code: centre.code,
      name: centre.name,
      districtName: centre.districtName,
      village: centre.village,
      isActive: centre.isActive,
      status: centreStatus(centre, live, c.now),
      openTime: centre.openTime,
      closeTime: centre.closeTime,
    },
    period: c.period,
    today: {
      bookings: live.todayBookings.filter((b) => b.status !== 'CANCELLED').length,
      arrivals: live.arrivals.length,
      inQueue: live.queued.length,
      processing: live.processing.length,
      completed: live.todayProcurements.length,
      paymentsCompleted: live.todayPaid.length,
    },
    procurement: procurementBlock(c.ds.procurements),
    operations: operationsBlock(c.ds, set, c.now),
    queue: { ...queueBlock(c.ds, set), comparison: comparisonFor(c, set) },
    quality: qualityBlock(c.ds, set),
    payments: paymentBlock(c.ds, set),
    bookings: bookingBlock(c.ds, set),
    crops: cropRows(c.ds, set),
    trends: trendSeries(c.ds, set, c.period.from, c.period.to),
    alerts: alertsFor(c, [centre]),
  };
}

export async function getDistrictSummary(auth: AuthContext, query: AdminQuery): Promise<{ period: AdminPeriod; districts: DistrictSummaryRow[] }> {
  if (auth.role !== 'STATE_ADMIN') throw forbidden('District comparison is for state admins.');
  const c = await context(auth, { ...query, districtId: undefined });
  return { period: c.period, districts: districtRows(c) };
}

export async function getAlerts(auth: AuthContext, query: AdminQuery): Promise<{ period: AdminPeriod; alerts: AdminAlert[] }> {
  const c = await context(auth, query);
  return { period: c.period, alerts: alertsFor(c, c.scope.centres) };
}

/** §29 analytics sections — the overview's blocks, individually. */
export async function getAnalyticsSection(auth: AuthContext, section: string, query: AdminQuery): Promise<unknown> {
  const o = await getOverview(auth, query);
  switch (section) {
    case 'procurement': return { period: o.period, procurement: o.procurement, crops: o.crops, trends: o.trends, bookings: o.bookings };
    case 'operations': return { period: o.period, operations: o.operations, live: o.live, changes: o.changes };
    case 'queue': return { period: o.period, queue: o.queue, operations: o.operations };
    case 'quality': return { period: o.period, quality: o.quality };
    case 'payments': return { period: o.period, payments: o.payments };
    default: throw validationError('Unknown analytics section.');
  }
}

// ---------------------------------------------------------------------------
// CSV export (§35) — the same scope rules as the dashboard, no personal data
// ---------------------------------------------------------------------------

function csv(rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null): string => {
    if (value === null) return '';
    const text = String(value);
    // Guard against spreadsheet formula injection as well as commas/quotes.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return rows.map((row) => row.map(cell).join(',')).join('\n') + '\n';
}

export async function exportReport(auth: AuthContext, report: AdminExportReport, query: AdminQuery): Promise<{ filename: string; body: string }> {
  const c = await context(auth, query);
  const suffix = `${c.period.from}_${c.period.to}`;

  switch (report) {
    case 'centre-performance': {
      const rows = c.scope.centres.map((centre) => centreRow(c, centre));
      return {
        filename: `centre-performance_${suffix}.csv`,
        body: csv([
          ['centre_code', 'centre', 'district', 'status_now', 'farmers_served', 'accepted_kg', 'procurement_value_inr', 'avg_wait_min', 'avg_processing_min', 'farmers_per_hour', 'queue_now', 'slot_utilisation', 'payments_pending_now', 'payment_completion_rate'],
          ...rows.map((r) => [r.code, r.name, r.districtName, r.status, r.farmersServed, r.acceptedKg, r.value, r.averageWaitMinutes, r.averageProcessingMinutes, r.farmersPerHour, r.currentQueue, r.slotUtilisation, r.paymentsPending, r.paymentCompletionRate]),
        ]),
      };
    }
    case 'crop-procurement': {
      const rows = cropRows(c.ds, new Set(c.scope.centres.map((x) => x.id)));
      return {
        filename: `crop-procurement_${suffix}.csv`,
        body: csv([
          ['crop', 'accepted_kg', 'procurement_value_inr', 'farmers', 'ai_risk_low', 'ai_risk_medium', 'ai_risk_high'],
          ...rows.map((r) => [r.crop, r.acceptedKg, r.value, r.farmers, r.aiRisk.LOW, r.aiRisk.MEDIUM, r.aiRisk.HIGH]),
        ]),
      };
    }
    case 'payment-summary': {
      return {
        filename: `payment-summary_${suffix}.csv`,
        body: csv([
          ['centre_code', 'centre', 'district', 'pending', 'initiated', 'processing', 'success', 'failed', 'retry_pending', 'total_paid_inr', 'total_payable_inr', 'completion_rate', 'demo_payments'],
          ...c.scope.centres.map((centre) => {
            const p = paymentBlock(c.ds, new Set([centre.id]));
            return [centre.code, centre.name, centre.districtName, p.byStatus.PENDING, p.byStatus.INITIATED, p.byStatus.PROCESSING, p.byStatus.SUCCESS, p.byStatus.FAILED, p.byStatus.RETRY_PENDING, p.totalPaid, p.totalPayable, p.completionRate, p.demoPayments];
          }),
        ]),
      };
    }
    case 'queue-performance': {
      return {
        filename: `queue-performance_${suffix}.csv`,
        body: csv([
          ['centre_code', 'centre', 'district', 'queue_waits', 'avg_wait_min', 'median_wait_min', 'max_wait_min', 'avg_slot_delay_min', 'long_wait_cases', 'starvation_events', 'max_wait_protections', 'reorders', 'selection_overrides', 'avg_queue_length', 'workstation_utilisation'],
          ...c.scope.centres.map((centre) => {
            const set = new Set([centre.id]);
            const o = operationsBlock(c.ds, set, c.now);
            const q = queueBlock(c.ds, set);
            return [centre.code, centre.name, centre.districtName, o.queueWait.count, o.queueWait.averageMinutes, o.queueWait.medianMinutes, o.queueWait.maxMinutes, o.averageSlotDelayMinutes, q.longWaitCases, q.starvationEvents, q.maxWaitProtections, q.reorders, q.selectionOverrides, o.averageQueueLength, o.workstationUtilisation];
          }),
        ]),
      };
    }
  }
}
