import type { SupabaseClient } from '@supabase/supabase-js';
import type { IneligibleReasonCode, QueueReasonCode, WorkstationStatus } from '@kisansetu/shared';
import { unwrap, unwrapMaybe } from './postgrestError.js';

/**
 * Queue data access. Ranks, waits and decisions are WRITTEN only through the
 * database functions (apply_queue_snapshot, select_queue_candidate, …), which
 * serialise per centre and revalidate. This file reads, and inserts entries.
 */

export interface EntryRow {
  id: string;
  centre_id: string;
  booking_id: string;
  operation_id: string;
  crop_id: string | null;
  state: string;
  entered_at: string;
  quantity_kg: string | number;
  slot_end_at: string | null;
  quality_result: string | null;
  quality_risk: string | null;
  quality_confidence: string | number | null;
  manual_inspection_required: boolean;
  prediction_id: string | null;
  estimated_processing_minutes: string | number | null;
  estimate_id: number | null;
  priority_advantage_count: number;
  last_advantage_at: string | null;
  current_rank: number | null;
  estimated_wait_minutes: number | null;
  final_priority: string | number | null;
  is_protected: boolean;
  eligible: boolean | null;
  ineligible_reasons: IneligibleReasonCode[] | null;
  last_snapshot_id: string | null;
  workstation_id: string | null;
  selected_at: string | null;
  processed_at: string | null;
  removed_reason: string | null;
}

export const ENTRY_COLUMNS =
  'id, centre_id, booking_id, operation_id, crop_id, state, entered_at, quantity_kg, slot_end_at, ' +
  'quality_result, quality_risk, quality_confidence, manual_inspection_required, prediction_id, ' +
  'estimated_processing_minutes, estimate_id, priority_advantage_count, last_advantage_at, ' +
  'current_rank, estimated_wait_minutes, final_priority, is_protected, eligible, ineligible_reasons, ' +
  'last_snapshot_id, workstation_id, selected_at, processed_at, removed_reason';

export async function listEntries(
  db: SupabaseClient,
  centreId: string,
  states: string[],
): Promise<EntryRow[]> {
  return unwrap<EntryRow[]>(
    await db
      .from('queue_entries')
      .select(ENTRY_COLUMNS)
      .eq('centre_id', centreId)
      .in('state', states)
      .order('entered_at', { ascending: true }),
    'queue.listEntries',
  );
}

export async function listEntriesSince(
  db: SupabaseClient,
  centreId: string,
  fromIso: string,
  toIso: string,
): Promise<EntryRow[]> {
  return unwrap<EntryRow[]>(
    await db
      .from('queue_entries')
      .select(ENTRY_COLUMNS)
      .eq('centre_id', centreId)
      .gte('entered_at', fromIso)
      .lt('entered_at', toIso)
      .order('entered_at', { ascending: true }),
    'queue.entriesForDay',
  );
}

export async function findEntry(db: SupabaseClient, bookingId: string): Promise<EntryRow | null> {
  return unwrapMaybe<EntryRow>(
    await db.from('queue_entries').select(ENTRY_COLUMNS).eq('booking_id', bookingId).maybeSingle(),
    'queue.findEntry',
  );
}

export async function insertEntry(
  adminDb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await adminDb
    .from('queue_entries')
    .upsert(row, { onConflict: 'booking_id', ignoreDuplicates: true });
  if (error) throw new Error(`Could not add to queue: ${error.message}`);
}

export interface WorkstationRow {
  id: string;
  centre_id: string;
  code: string;
  name: string;
  crop_ids: string[];
  status: WorkstationStatus;
  current_booking_id: string | null;
  busy_since: string | null;
}

const WORKSTATION_COLUMNS = 'id, centre_id, code, name, crop_ids, status, current_booking_id, busy_since';

export async function listWorkstations(db: SupabaseClient, centreId: string): Promise<WorkstationRow[]> {
  return unwrap<WorkstationRow[]>(
    await db
      .from('queue_workstations')
      .select(WORKSTATION_COLUMNS)
      .eq('centre_id', centreId)
      .order('code', { ascending: true }),
    'queue.workstations',
  );
}

export interface CentreStateRow {
  centre_id: string;
  version: number;
  last_recalculated_at: string | null;
  last_snapshot_id: string | null;
  next_booking_id: string | null;
}

export async function findCentreState(
  db: SupabaseClient,
  centreId: string,
): Promise<CentreStateRow | null> {
  return unwrapMaybe<CentreStateRow>(
    await db
      .from('queue_centre_state')
      .select('centre_id, version, last_recalculated_at, last_snapshot_id, next_booking_id')
      .eq('centre_id', centreId)
      .maybeSingle(),
    'queue.centreState',
  );
}

export interface SnapshotRow {
  id: string;
  generated_at: string;
  trigger_type: string;
  algorithm_version: string;
  config_hash: string;
  candidate_count: number;
  reordered: boolean;
  next_booking_id: string | null;
}

export async function findSnapshot(db: SupabaseClient, id: string): Promise<SnapshotRow | null> {
  return unwrapMaybe<SnapshotRow>(
    await db
      .from('queue_snapshots')
      .select('id, generated_at, trigger_type, algorithm_version, config_hash, candidate_count, reordered, next_booking_id')
      .eq('id', id)
      .maybeSingle(),
    'queue.snapshot',
  );
}

export async function listSnapshotsBetween(
  db: SupabaseClient,
  centreId: string,
  fromIso: string,
  toIso: string,
): Promise<Array<SnapshotRow & { eligible_count: number }>> {
  return unwrap<Array<SnapshotRow & { eligible_count: number }>>(
    await db
      .from('queue_snapshots')
      .select('id, generated_at, trigger_type, algorithm_version, config_hash, candidate_count, eligible_count, reordered, next_booking_id')
      .eq('centre_id', centreId)
      .gte('generated_at', fromIso)
      .lt('generated_at', toIso)
      .order('generated_at', { ascending: true }),
    'queue.snapshotsForDay',
  );
}

export interface RankingRow {
  booking_id: string;
  rank: number | null;
  eligible: boolean;
  is_protected: boolean;
  fairness_score: string | number | null;
  operational_efficiency_score: string | number | null;
  urgency_score: string | number | null;
  fairness_penalty: string | number | null;
  final_priority: string | number | null;
  wait_minutes: string | number | null;
  slot_lateness_minutes: string | number | null;
  wait_score: string | number | null;
  slot_lateness_score: string | number | null;
  aging_score: string | number | null;
  quality_readiness_score: string | number | null;
  quality_factor_score: string | number | null;
  processing_fit_score: string | number | null;
  workstation_fit_score: string | number | null;
  reason_codes: QueueReasonCode[] | null;
  snapshot_id: string;
  created_at: string;
}

const RANKING_COLUMNS =
  'booking_id, rank, eligible, is_protected, fairness_score, operational_efficiency_score, ' +
  'urgency_score, fairness_penalty, final_priority, wait_minutes, slot_lateness_minutes, wait_score, ' +
  'slot_lateness_score, aging_score, quality_readiness_score, quality_factor_score, processing_fit_score, ' +
  'workstation_fit_score, reason_codes, snapshot_id, created_at';

export async function listRankings(db: SupabaseClient, snapshotId: string): Promise<RankingRow[]> {
  return unwrap<RankingRow[]>(
    await db.from('queue_rankings').select(RANKING_COLUMNS).eq('snapshot_id', snapshotId),
    'queue.rankings',
  );
}

export async function rankingHistory(
  db: SupabaseClient,
  bookingId: string,
  limit: number,
): Promise<RankingRow[]> {
  return unwrap<RankingRow[]>(
    await db
      .from('queue_rankings')
      .select(RANKING_COLUMNS)
      .eq('booking_id', bookingId)
      .order('id', { ascending: false })
      .limit(limit),
    'queue.rankingHistory',
  );
}

export interface DecisionRow {
  booking_id: string;
  decision: string;
  selected_rank: number | null;
  reason_codes: string[] | null;
  note: string | null;
  decided_at: string;
}

export async function listDecisions(
  db: SupabaseClient,
  filter: { centreId?: string; bookingId?: string; fromIso?: string; toIso?: string },
): Promise<DecisionRow[]> {
  let query = db
    .from('queue_decisions')
    .select('booking_id, decision, selected_rank, reason_codes, note, decided_at')
    .order('decided_at', { ascending: true });
  if (filter.centreId) query = query.eq('centre_id', filter.centreId);
  if (filter.bookingId) query = query.eq('booking_id', filter.bookingId);
  if (filter.fromIso) query = query.gte('decided_at', filter.fromIso);
  if (filter.toIso) query = query.lt('decided_at', filter.toIso);
  return unwrap<DecisionRow[]>(await query, 'queue.decisions');
}
