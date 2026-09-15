import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, businessToday, zonedInstant } from '@kisansetu/shared';
import type { AdminPeriod } from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap } from '../../repositories/postgrestError.js';

/**
 * Loads the persisted records a dashboard needs — and only those.
 *
 * Every query is (a) pinned to the admin's resolved centre ids and (b) bounded
 * by the reporting period, selecting only the columns the aggregation reads.
 * No farmer names, phones or documents are loaded at all (§36). These rows
 * never leave the server: they are aggregated in metrics.ts and only the
 * compact result is returned (§31).
 */

const CHUNK = 150;
/** PostgREST caps a response (1000 rows by default); every read pages past it. */
const PAGE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

/**
 * Reads EVERY matching row, a page at a time, in a stable order. Without
 * this, a busy state would silently be summed from the first thousand rows
 * only — a wrong number presented as a real one.
 */
async function pageAll<T>(make: () => Query, name: string, orderColumn = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap<T[]>(await make().order(orderColumn, { ascending: true }).range(from, from + PAGE - 1), name);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fetch(ids.slice(i, i + CHUNK))));
  return out;
}

export interface SlotRow { id: string; centre_id: string; slot_date: string; capacity: number; status: string }
export interface BookingRow { id: string; centre_id: string; slot_id: string; farmer_user_id: string; crop_id: string | null; crop: string; status: string }
export interface OperationRow { booking_id: string; centre_id: string; state: string; arrived_at: string | null }
export interface OfficialQualityRow { booking_id: string; result: 'PASSED' | 'CONDITIONAL' | 'FAILED' }
export interface EntryRow {
  centre_id: string; booking_id: string; state: string; entered_at: string; slot_end_at: string | null;
  selected_at: string | null; processed_at: string | null; quality_result: string | null;
  quality_risk: string | null; quality_confidence: string | number | null; manual_inspection_required: boolean;
  estimated_processing_minutes: string | number | null; crop_id: string | null; prediction_id: string | null;
}
export interface ProcurementRow {
  id: string; centre_id: string; booking_id: string; farmer_user_id: string; crop: string; crop_id: string | null;
  accepted_quantity_kg: string | number | null; quantity_kg: string | number; total_value: string | number; confirmed_at: string;
}
export interface PaymentRow {
  procurement_id: string; centre_id: string; status: string; net_amount: string | number;
  initiated_at: string | null; completed_at: string | null; is_demo: boolean;
}
export interface PredictionRow {
  centre_id: string; crop_id: string | null; assessment_status: string; quality_risk: string | null;
  confidence: string | number | null; quality_score: string | number | null; model_version: string | null; training_data: string | null;
}
export interface SnapshotRow { centre_id: string; eligible_count: number; reordered: boolean }
export interface DecisionRow { centre_id: string; decision: string; reason_codes: string[] | null }
export interface SessionRow { centre_id: string; session_date: string; status: string; opened_at: string | null; closed_at: string | null }
export interface WorkstationRow { id: string; code: string; centre_id: string; status: string; crop_ids: string[] | null }

export interface PeriodDataset {
  fromIso: string;
  toIso: string;
  slots: SlotRow[];
  bookings: BookingRow[];
  operations: OperationRow[];
  official: OfficialQualityRow[];
  entries: EntryRow[];
  procurements: ProcurementRow[];
  payments: PaymentRow[];
  predictions: PredictionRow[];
  snapshots: SnapshotRow[];
  decisions: DecisionRow[];
  sessions: SessionRow[];
  workstations: WorkstationRow[];
  cropNames: Map<string, string>;
}

export interface LiveDataset {
  asOf: string;
  today: string;
  todaySessions: Array<{ centre_id: string; status: string }>;
  queued: Array<{ centre_id: string; entered_at: string }>;
  processing: Array<{ centre_id: string }>;
  arrivals: Array<{ centre_id: string }>;
  todayBookings: Array<{ centre_id: string; status: string }>;
  todayProcurements: Array<{ centre_id: string }>;
  todayPaid: Array<{ centre_id: string }>;
  outstandingPayments: Array<{ centre_id: string; status: string }>;
}

export function periodBounds(period: { from: string; to: string }): { fromIso: string; toIso: string } {
  return {
    fromIso: zonedInstant(period.from, '00:00', env.APP_TIMEZONE).toISOString(),
    toIso: zonedInstant(addDays(period.to, 1), '00:00', env.APP_TIMEZONE).toISOString(),
  };
}

export async function loadPeriod(centreIds: string[], period: AdminPeriod): Promise<PeriodDataset> {
  const db: SupabaseClient = supabaseAdminClient;
  const { fromIso, toIso } = periodBounds(period);

  const byCentre = <T>(table: string, columns: string, timeColumn: string, op: 'range' | 'date' = 'range', order = 'id') =>
    inChunks<T>(centreIds, (chunk) =>
      pageAll<T>(
        () => {
          const q = db.from(table).select(columns).in('centre_id', chunk);
          return op === 'date'
            ? q.gte(timeColumn, period.from).lte(timeColumn, period.to)
            : q.gte(timeColumn, fromIso).lt(timeColumn, toIso);
        },
        `admin.${table}`,
        order,
      ),
    );

  const [slots, entries, procurements, predictions, snapshots, decisions, sessions, workstations, crops] = await Promise.all([
    byCentre<SlotRow>('procurement_slots', 'id, centre_id, slot_date, capacity, status', 'slot_date', 'date'),
    byCentre<EntryRow>(
      'queue_entries',
      'centre_id, booking_id, state, entered_at, slot_end_at, selected_at, processed_at, quality_result, quality_risk, quality_confidence, manual_inspection_required, estimated_processing_minutes, crop_id, prediction_id',
      'entered_at',
    ),
    byCentre<ProcurementRow>(
      'procurements',
      'id, centre_id, booking_id, farmer_user_id, crop, crop_id, accepted_quantity_kg, quantity_kg, total_value, confirmed_at',
      'confirmed_at',
    ),
    byCentre<PredictionRow>(
      'quality_predictions',
      'centre_id, crop_id, assessment_status, quality_risk, confidence, quality_score, model_version, training_data',
      'created_at',
    ),
    byCentre<SnapshotRow>('queue_snapshots', 'centre_id, eligible_count, reordered', 'generated_at'),
    byCentre<DecisionRow>('queue_decisions', 'centre_id, decision, reason_codes', 'decided_at'),
    byCentre<SessionRow>('procurement_sessions', 'centre_id, session_date, status, opened_at, closed_at', 'session_date', 'date'),
    inChunks<WorkstationRow>(centreIds, (chunk) =>
      pageAll<WorkstationRow>(() => db.from('queue_workstations').select('id, code, centre_id, status, crop_ids').in('centre_id', chunk), 'admin.workstations'),
    ),
    pageAll<{ id: string; name_en: string }>(() => db.from('crops').select('id, name_en'), 'admin.crops'),
  ]);

  const bookings = await inChunks<BookingRow>(slots.map((s) => s.id), (chunk) =>
    pageAll<BookingRow>(() => db.from('bookings').select('id, centre_id, slot_id, farmer_user_id, crop_id, crop, status').in('slot_id', chunk), 'admin.bookings'),
  );

  const bookingIds = bookings.map((b) => b.id);
  const [operations, official, payments] = await Promise.all([
    inChunks<OperationRow>(bookingIds, (chunk) =>
      pageAll<OperationRow>(() => db.from('booking_operations').select('booking_id, centre_id, state, arrived_at').in('booking_id', chunk), 'admin.operations'),
    ),
    inChunks<OfficialQualityRow>(bookingIds, (chunk) =>
      pageAll<OfficialQualityRow>(() => db.from('quality_assessments').select('booking_id, result').in('booking_id', chunk), 'admin.quality'),
    ),
    inChunks<PaymentRow>(procurements.map((p) => p.id), (chunk) =>
      pageAll<PaymentRow>(
        () => db.from('payments').select('procurement_id, centre_id, status, net_amount, initiated_at, completed_at, is_demo').in('procurement_id', chunk),
        'admin.payments',
      ),
    ),
  ]);

  return {
    fromIso,
    toIso,
    slots,
    bookings,
    operations,
    official,
    entries,
    procurements,
    payments,
    predictions,
    snapshots,
    decisions,
    sessions,
    workstations,
    cropNames: new Map(crops.map((c) => [c.id, c.name_en])),
  };
}

const ENTRY_COLUMNS =
  'centre_id, booking_id, state, entered_at, slot_end_at, selected_at, processed_at, quality_result, quality_risk, quality_confidence, manual_inspection_required, estimated_processing_minutes, crop_id, prediction_id';
const PROCUREMENT_COLUMNS =
  'id, centre_id, booking_id, farmer_user_id, crop, crop_id, accepted_quantity_kg, quantity_kg, total_value, confirmed_at';

/** Only what the change figures need, for the comparison period. */
export async function loadPrevious(centreIds: string[], period: AdminPeriod): Promise<Pick<PeriodDataset, 'entries' | 'procurements'>> {
  const db = supabaseAdminClient;
  const { fromIso, toIso } = periodBounds({ from: period.previousFrom, to: period.previousTo });

  const [entries, procurements] = await Promise.all([
    inChunks<EntryRow>(centreIds, (chunk) =>
      pageAll<EntryRow>(() => db.from('queue_entries').select(ENTRY_COLUMNS).in('centre_id', chunk).gte('entered_at', fromIso).lt('entered_at', toIso), 'admin.prevEntries'),
    ),
    inChunks<ProcurementRow>(centreIds, (chunk) =>
      pageAll<ProcurementRow>(() => db.from('procurements').select(PROCUREMENT_COLUMNS).in('centre_id', chunk).gte('confirmed_at', fromIso).lt('confirmed_at', toIso), 'admin.prevProcurements'),
    ),
  ]);
  return { entries, procurements };
}

/** Right now, regardless of the reporting period (§8). */
export async function loadLive(centreIds: string[]): Promise<LiveDataset> {
  const db = supabaseAdminClient;
  const today = businessToday(env.APP_TIMEZONE);
  const startOfToday = zonedInstant(today, '00:00', env.APP_TIMEZONE).toISOString();

  const each = <T>(make: (chunk: string[]) => Query, name: string, order = 'id') =>
    inChunks<T>(centreIds, (chunk) => pageAll<T>(() => make(chunk), name, order));

  const [todaySessions, queued, processing, arrivals, todaySlots, todayProcurements, todayPaid, outstandingPayments] = await Promise.all([
    each<{ centre_id: string; status: string }>((c) => db.from('procurement_sessions').select('centre_id, status').in('centre_id', c).eq('session_date', today), 'admin.liveSessions'),
    each<{ centre_id: string; entered_at: string }>((c) => db.from('queue_entries').select('centre_id, entered_at').in('centre_id', c).eq('state', 'QUEUED'), 'admin.liveQueue'),
    each<{ centre_id: string }>((c) => db.from('booking_operations').select('centre_id').in('centre_id', c).in('state', ['QUALITY_CHECK', 'WEIGHING', 'PROCUREMENT']), 'admin.liveProcessing'),
    each<{ centre_id: string }>((c) => db.from('booking_operations').select('centre_id').in('centre_id', c).gte('arrived_at', startOfToday), 'admin.liveArrivals'),
    each<{ id: string; centre_id: string }>((c) => db.from('procurement_slots').select('id, centre_id').in('centre_id', c).eq('slot_date', today), 'admin.todaySlots'),
    each<{ centre_id: string }>((c) => db.from('procurements').select('centre_id').in('centre_id', c).gte('confirmed_at', startOfToday), 'admin.todayProcurements'),
    each<{ centre_id: string }>((c) => db.from('payments').select('centre_id').in('centre_id', c).eq('status', 'SUCCESS').gte('completed_at', startOfToday), 'admin.todayPaid'),
    each<{ centre_id: string; status: string }>((c) => db.from('payments').select('centre_id, status').in('centre_id', c).neq('status', 'SUCCESS'), 'admin.outstanding'),
  ]);

  const todayBookings = await inChunks<{ centre_id: string; status: string }>(todaySlots.map((s) => s.id), (chunk) =>
    pageAll<{ centre_id: string; status: string }>(() => db.from('bookings').select('centre_id, status').in('slot_id', chunk), 'admin.todayBookings'),
  );

  return { asOf: new Date().toISOString(), today, todaySessions, queued, processing, arrivals, todayBookings, todayProcurements, todayPaid, outstandingPayments };
}

/** Current registration counts for farmers living in the scope's districts. */
export async function loadFarmerStatuses(districtIds: string[]): Promise<string[]> {
  const rows = await inChunks<{ registration_status: string }>(districtIds, (chunk) =>
    pageAll<{ registration_status: string }>(
      () => supabaseAdminClient.from('farmer_profiles').select('registration_status').in('district_id', chunk),
      'admin.farmers',
      'user_id',
    ),
  );
  return rows.map((r) => r.registration_status);
}
