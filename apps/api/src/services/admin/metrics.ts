import { addDays, formatScaled, parseDecimal, toCalendarDate, zonedInstant } from '@kisansetu/shared';
import type {
  BookingBlock,
  CropRow,
  FunnelStep,
  OperationsBlock,
  PaymentBlock,
  PaymentStatus,
  ProcurementBlock,
  QualityBlock,
  QualityRisk,
  QueueBlock,
  TrendPoint,
  WaitSummary,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import type { EntryRow, PeriodDataset, ProcurementRow } from './dataset.js';

/**
 * Pure aggregation (§28 "ScopedAnalyticsService").
 *
 * One set of functions, applied to any subset of centres: the whole district
 * or state, one district, or one centre. There is exactly one definition of
 * "average wait" in the admin layer, and it is this file's.
 *
 * Money and quantity are summed in exact integers (paise, grams) — Phase 8's
 * precision rules, not a second calculation system (§16).
 */

const tz = (): string => env.APP_TIMEZONE;
const minutes = (later: string, earlier: string): number => (Date.parse(later) - Date.parse(earlier)) / 60_000;
const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const paise = (value: string | number): bigint => parseDecimal(String(value), 2);
const grams = (value: string | number): bigint => parseDecimal(String(value), 3);
const rupees = (value: bigint): string => formatScaled(value, 2);
const kilos = (value: bigint): string => formatScaled(value, 3);

export type CentreSet = ReadonlySet<string>;

const inSet = <T extends { centre_id: string }>(rows: T[], set: CentreSet): T[] => rows.filter((row) => set.has(row.centre_id));

export function waitSummary(values: number[]): WaitSummary {
  if (values.length === 0) return { count: 0, averageMinutes: null, medianMinutes: null, maxMinutes: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return {
    count: values.length,
    averageMinutes: round1(values.reduce((a, b) => a + b, 0) / values.length),
    medianMinutes: round1(median),
    maxMinutes: round1(sorted[sorted.length - 1]!),
  };
}

/** Queue wait = joined the queue → started at a station. */
export function queueWaits(entries: EntryRow[]): number[] {
  return entries.filter((e) => e.selected_at).map((e) => Math.max(0, minutes(e.selected_at!, e.entered_at)));
}

export function processingMinutes(entries: EntryRow[]): number[] {
  return entries.filter((e) => e.state === 'DONE' && e.selected_at && e.processed_at).map((e) => minutes(e.processed_at!, e.selected_at!));
}

const acceptedOf = (p: ProcurementRow): string | number => p.accepted_quantity_kg ?? p.quantity_kg;

export function procurementBlock(procurements: ProcurementRow[]): ProcurementBlock {
  let kg = 0n;
  let value = 0n;
  for (const p of procurements) {
    kg += grams(acceptedOf(p));
    value += paise(p.total_value);
  }
  return {
    completedProcurements: procurements.length,
    acceptedKg: kilos(kg),
    value: rupees(value),
    averageValue: procurements.length ? rupees(value / BigInt(procurements.length)) : null,
    farmersServed: new Set(procurements.map((p) => p.farmer_user_id)).size,
  };
}

export function operationsBlock(ds: PeriodDataset, set: CentreSet, now: Date): OperationsBlock {
  const entries = inSet(ds.entries, set);
  const waits = queueWaits(entries);
  const processing = processingMinutes(entries);

  // Throughput: processed ÷ hours actually spent processing, per centre-day.
  const spans = new Map<string, { first: number; last: number; count: number }>();
  for (const e of entries) {
    if (e.state !== 'DONE' || !e.selected_at || !e.processed_at) continue;
    const key = `${e.centre_id}|${toCalendarDate(new Date(e.selected_at), tz())}`;
    const s = spans.get(key) ?? { first: Infinity, last: -Infinity, count: 0 };
    s.first = Math.min(s.first, Date.parse(e.selected_at));
    s.last = Math.max(s.last, Date.parse(e.processed_at));
    s.count += 1;
    spans.set(key, s);
  }
  let processed = 0;
  let hours = 0;
  for (const s of spans.values()) {
    processed += s.count;
    hours += (s.last - s.first) / 3_600_000;
  }

  const snapshots = inSet(ds.snapshots, set);
  const slots = inSet(ds.slots, set).filter((s) => s.status !== 'CANCELLED' && s.status !== 'DRAFT');
  const slotIds = new Set(slots.map((s) => s.id));
  const capacity = slots.reduce((sum, s) => sum + s.capacity, 0);
  const booked = ds.bookings.filter((b) => slotIds.has(b.slot_id) && b.status !== 'CANCELLED').length;

  // Workstation use: busy station-minutes ÷ open station-minutes.
  const liveStations = new Map<string, number>();
  for (const w of inSet(ds.workstations, set)) if (w.status !== 'OFFLINE') liveStations.set(w.centre_id, (liveStations.get(w.centre_id) ?? 0) + 1);
  let available = 0;
  for (const s of inSet(ds.sessions, set)) {
    if (!s.opened_at) continue;
    const dayEnd = zonedInstant(addDays(s.session_date, 1), '00:00', tz()).getTime();
    const end = s.closed_at ? Date.parse(s.closed_at) : Math.min(now.getTime(), dayEnd);
    available += Math.max(0, (end - Date.parse(s.opened_at)) / 60_000) * (liveStations.get(s.centre_id) ?? 0);
  }
  const busy = entries
    .filter((e) => e.selected_at)
    .reduce((sum, e) => sum + Math.max(0, minutes(e.processed_at ?? now.toISOString(), e.selected_at!)), 0);

  const delays = entries
    .filter((e) => e.selected_at && e.slot_end_at)
    .map((e) => Math.max(0, minutes(e.selected_at!, e.slot_end_at!)));

  return {
    queueWait: waitSummary(waits),
    averageProcessingMinutes: processing.length ? round1(processing.reduce((a, b) => a + b, 0) / processing.length) : null,
    farmersPerHour: hours >= 0.25 ? round1(processed / hours) : null,
    averageQueueLength: snapshots.length ? round1(snapshots.reduce((sum, s) => sum + s.eligible_count, 0) / snapshots.length) : null,
    slotUtilisation: capacity > 0 ? round3(booked / capacity) : null,
    workstationUtilisation: available > 0 ? round3(Math.min(1, busy / available)) : null,
    averageSlotDelayMinutes: delays.length ? round1(delays.reduce((a, b) => a + b, 0) / delays.length) : null,
  };
}

export function queueBlock(ds: PeriodDataset, set: CentreSet): Omit<QueueBlock, 'comparison'> {
  const waits = queueWaits(inSet(ds.entries, set));
  const decisions = inSet(ds.decisions, set);
  return {
    longWaitCases: waits.filter((w) => w >= env.QUEUE_TARGET_WAIT_MINUTES).length,
    starvationEvents: waits.filter((w) => w >= env.QUEUE_MAX_WAIT_OVERRIDE_MINUTES).length,
    maxWaitProtections: decisions.filter((d) => d.decision.startsWith('SELECTED') && (d.reason_codes ?? []).includes('MAX_WAIT_PROTECTION')).length,
    reorders: inSet(ds.snapshots, set).filter((s) => s.reordered).length,
    selectionOverrides: decisions.filter((d) => d.decision === 'SELECTED_OVERRIDE').length,
  };
}

const RISKS: QualityRisk[] = ['LOW', 'MEDIUM', 'HIGH'];
const emptyRisk = (): Record<QualityRisk, number> => ({ LOW: 0, MEDIUM: 0, HIGH: 0 });

export function qualityBlock(ds: PeriodDataset, set: CentreSet): QualityBlock {
  const bookingIds = new Set(ds.bookings.filter((b) => set.has(b.centre_id)).map((b) => b.id));
  const official = { PASSED: 0, CONDITIONAL: 0, FAILED: 0 };
  for (const q of ds.official) if (bookingIds.has(q.booking_id)) official[q.result] += 1;

  const predictions = inSet(ds.predictions, set);
  const completed = predictions.filter((p) => p.assessment_status === 'COMPLETED');
  const risk = emptyRisk();
  for (const p of completed) if (p.quality_risk && RISKS.includes(p.quality_risk as QualityRisk)) risk[p.quality_risk as QualityRisk] += 1;
  const low = completed.filter((p) => p.confidence !== null && Number(p.confidence) < env.QUALITY_CONFIDENCE_THRESHOLD).length;
  const scores = completed.filter((p) => p.quality_score !== null).map((p) => Number(p.quality_score));

  const entries = inSet(ds.entries, set);
  const manual = entries.filter(
    (e) => e.quality_result === 'CONDITIONAL' || e.manual_inspection_required ||
      (e.quality_confidence !== null && Number(e.quality_confidence) < env.QUALITY_CONFIDENCE_THRESHOLD),
  ).length;

  return {
    officialResults: official,
    aiAssessments: completed.length,
    aiUnavailable: predictions.length - completed.length,
    aiRiskDistribution: risk,
    aiLowConfidenceRate: completed.length ? round3(low / completed.length) : null,
    averagePredictedScore: scores.length ? round1(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    manualInspectionRate: entries.length ? round3(manual / entries.length) : null,
    modelVersions: [...new Set(completed.map((p) => p.model_version).filter((v): v is string => Boolean(v)))].sort(),
    developmentModelsOnly: completed.length > 0 && completed.every((p) => p.training_data === 'SYNTHETIC_DEVELOPMENT'),
  };
}

const STATUSES: PaymentStatus[] = ['PENDING', 'INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRY_PENDING'];

export function paymentBlock(ds: PeriodDataset, set: CentreSet): PaymentBlock {
  const payments = inSet(ds.payments, set);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<PaymentStatus, number>;
  let paid = 0n;
  let payable = 0n;
  for (const p of payments) {
    byStatus[p.status as PaymentStatus] = (byStatus[p.status as PaymentStatus] ?? 0) + 1;
    if (p.status === 'SUCCESS') paid += paise(p.net_amount);
    else payable += paise(p.net_amount);
  }
  const settled = payments.filter((p) => p.status === 'SUCCESS' && p.initiated_at && p.completed_at);
  return {
    byStatus,
    totalPaid: rupees(paid),
    totalPayable: rupees(payable),
    completionRate: payments.length ? round3(byStatus.SUCCESS / payments.length) : null,
    averageSettlementSeconds: settled.length
      ? Math.round(settled.reduce((sum, p) => sum + (Date.parse(p.completed_at!) - Date.parse(p.initiated_at!)) / 1000, 0) / settled.length)
      : null,
    demoPayments: payments.filter((p) => p.is_demo).length,
  };
}

/** The booking cohort of the period: bookings whose slot falls inside it. */
export function bookingBlock(ds: PeriodDataset, set: CentreSet): BookingBlock {
  const bookings = ds.bookings.filter((b) => set.has(b.centre_id));
  const ids = new Set(bookings.map((b) => b.id));
  const arrived = new Set(ds.operations.filter((o) => ids.has(o.booking_id) && o.arrived_at).map((o) => o.booking_id));
  const checked = new Set(ds.official.filter((q) => ids.has(q.booking_id)).map((q) => q.booking_id));
  const queued = new Set(ds.entries.filter((e) => ids.has(e.booking_id)).map((e) => e.booking_id));
  const procured = ds.procurements.filter((p) => ids.has(p.booking_id));
  const procuredIds = new Set(procured.map((p) => p.id));
  const paid = ds.payments.filter((p) => procuredIds.has(p.procurement_id) && p.status === 'SUCCESS').length;

  const funnel: FunnelStep[] = [
    { step: 'BOOKED', count: bookings.filter((b) => b.status !== 'CANCELLED').length },
    { step: 'ARRIVED', count: arrived.size },
    { step: 'QUALITY_CHECKED', count: checked.size },
    { step: 'QUEUED', count: queued.size },
    { step: 'PROCURED', count: procured.length },
    { step: 'PAID', count: paid },
  ];

  return {
    total: bookings.length,
    active: bookings.filter((b) => b.status === 'BOOKED').length,
    completed: bookings.filter((b) => b.status === 'COMPLETED').length,
    cancelled: bookings.filter((b) => b.status === 'CANCELLED').length,
    noShow: bookings.filter((b) => b.status === 'NO_SHOW').length,
    funnel,
  };
}

export function cropRows(ds: PeriodDataset, set: CentreSet): CropRow[] {
  const rows = new Map<string, { cropId: string | null; crop: string; kg: bigint; value: bigint; farmers: Set<string>; risk: Record<QualityRisk, number> }>();
  const keyOf = (cropId: string | null, crop: string): string => cropId ?? `name:${crop}`;

  for (const p of inSet(ds.procurements, set)) {
    const key = keyOf(p.crop_id, p.crop);
    const row = rows.get(key) ?? { cropId: p.crop_id, crop: (p.crop_id && ds.cropNames.get(p.crop_id)) || p.crop, kg: 0n, value: 0n, farmers: new Set(), risk: emptyRisk() };
    row.kg += grams(acceptedOf(p));
    row.value += paise(p.total_value);
    row.farmers.add(p.farmer_user_id);
    rows.set(key, row);
  }
  for (const pr of inSet(ds.predictions, set)) {
    if (pr.assessment_status !== 'COMPLETED' || !pr.quality_risk || !pr.crop_id) continue;
    const row = rows.get(pr.crop_id) ?? { cropId: pr.crop_id, crop: ds.cropNames.get(pr.crop_id) ?? pr.crop_id, kg: 0n, value: 0n, farmers: new Set<string>(), risk: emptyRisk() };
    row.risk[pr.quality_risk as QualityRisk] += 1;
    rows.set(pr.crop_id, row);
  }

  return [...rows.values()]
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : a.crop.localeCompare(b.crop)))
    .map((r) => ({ cropId: r.cropId, crop: r.crop, acceptedKg: kilos(r.kg), value: rupees(r.value), farmers: r.farmers.size, aiRisk: r.risk }));
}

/** Daily series across the whole period, including days with no activity (a real zero). */
export function trendSeries(ds: PeriodDataset, set: CentreSet, from: string, to: string): TrendPoint[] {
  const days = new Map<string, { kg: bigint; value: bigint; farmers: Set<string> }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { kg: 0n, value: 0n, farmers: new Set() });
  for (const p of inSet(ds.procurements, set)) {
    const day = days.get(toCalendarDate(new Date(p.confirmed_at), tz()));
    if (!day) continue;
    day.kg += grams(acceptedOf(p));
    day.value += paise(p.total_value);
    day.farmers.add(p.farmer_user_id);
  }
  return [...days.entries()].map(([date, d]) => ({ date, acceptedKg: kilos(d.kg), value: rupees(d.value), farmersServed: d.farmers.size }));
}

export function changeRatio(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round3((current - previous) / previous);
}
