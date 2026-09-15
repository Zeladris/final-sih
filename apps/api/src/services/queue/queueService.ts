import type { SupabaseClient } from '@supabase/supabase-js';
import {
  addDays,
  businessToday,
  sessionIsActive,
  zonedInstant,
} from '@kisansetu/shared';
import type {
  BookingStatus,
  EstimateSource,
  IneligibleReasonCode,
  OperationState,
  QualityResult,
  QualityRisk,
  QueueCandidateView,
  QueueComparison,
  QueueMetrics,
  QueueReasonCode,
  QueueTrigger,
  QueueView,
  ScoreBreakdown,
  WorkstationView,
} from '@kisansetu/shared';
import { env } from '../../config/env.js';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { supabaseAdminClient } from '../../lib/supabaseAdmin.js';
import { unwrap } from '../../repositories/postgrestError.js';
import * as ops from '../../repositories/operationsRepository.js';
import * as quality from '../../repositories/qualityRepository.js';
import * as repo from '../../repositories/queueRepository.js';
import { recordDeterministicEstimate } from '../quality/qualityService.js';
import { applyWaits, optimizeQueue } from './optimizer/optimizer.js';
import { ALGORITHM_VERSION, policyFromEnv, policyHash, policySummary } from './optimizer/policy.js';
import type { QueuePolicy } from './optimizer/policy.js';
import { simulate, waitStats } from './optimizer/simulation.js';
import type { SimulationJob } from './optimizer/simulation.js';
import type { CandidateInput, RankedCandidate, WorkstationInput } from './optimizer/types.js';
import type { AuthContext } from '../../types/request.js';

/**
 * QueueService — the only thing that changes queue order (§25).
 *
 * Modules never set ranks. They change INPUTS (a farmer enters the queue, a
 * station goes offline, an estimate changes) and call
 * `recalculateCentreQueue(centreId, trigger)`. The recalculation reads the
 * inputs at version N, ranks them with the pure optimizer, and applies the
 * result through `apply_queue_snapshot`, which refuses if the version moved —
 * so two recalculations can never overwrite each other with stale data (§49).
 */

let cachedPolicy: QueuePolicy | null = null;
const policy = (): QueuePolicy => (cachedPolicy ??= policyFromEnv());

const tz = (): string => env.APP_TIMEZONE;
const minutes = (later: number, earlier: number): number => (later - earlier) / 60_000;
const num = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

function centreOf(auth: AuthContext): string {
  const centreId = auth.scope.centreId;
  if (!centreId) throw forbidden('No procurement centre is assigned to this account.');
  return centreId;
}

// ---------------------------------------------------------------------------
// Entering the queue
// ---------------------------------------------------------------------------

/**
 * Adds a booking that has just passed the quality check (§48 "Quality
 * completes"). Idempotent: a second call for the same booking does nothing.
 */
export async function enqueueBooking(
  centreId: string,
  bookingId: string,
  actorId: string | null,
): Promise<void> {
  const db = supabaseAdminClient;
  const [booking, operation, existing] = await Promise.all([
    ops.findBooking(db, bookingId),
    ops.findOperation(db, bookingId),
    repo.findEntry(db, bookingId),
  ]);

  if (!booking || booking.centre_id !== centreId) return;
  if (!operation || operation.state !== 'WAITING' || existing) return;

  const [slot, official, prediction, cropCode, estimates] = await Promise.all([
    ops.findSlot(db, booking.slot_id),
    quality.latestOfficialResult(db, bookingId),
    quality.latestCompletedPrediction(db, bookingId),
    quality.findCropCode(db, booking.crop_id),
    quality.listEstimates(db, bookingId),
  ]);

  // A staff member's own estimate is kept; otherwise estimate from what is
  // now known — the official result plus any AI output (§32).
  const estimate =
    estimates[0]?.source === 'STAFF_OVERRIDE'
      ? estimates[0]
      : await recordDeterministicEstimate(db, {
          bookingId,
          centreId,
          cropCode,
          quantityKg: Number(booking.expected_quantity_kg),
          officialResult: official,
          prediction,
          actorId,
        });

  await repo.insertEntry(db, {
    centre_id: centreId,
    booking_id: bookingId,
    operation_id: operation.id,
    crop_id: booking.crop_id,
    state: 'QUEUED',
    quantity_kg: Number(booking.expected_quantity_kg),
    slot_end_at: slot ? zonedInstant(slot.slot_date, slot.end_time, tz()).toISOString() : null,
    quality_result: official,
    quality_risk: prediction?.quality_risk ?? null,
    quality_confidence: prediction ? num(prediction.confidence) : null,
    manual_inspection_required: prediction?.manual_inspection_required === true,
    prediction_id: prediction?.id ?? null,
    estimated_processing_minutes: Number(estimate.estimated_minutes),
    estimate_id: estimate.id,
  });
}

/** Heals the one gap a crash could leave: a WAITING farmer with no entry. */
async function ensureEntries(centreId: string): Promise<void> {
  const waiting = unwrap<Array<{ booking_id: string }>>(
    await supabaseAdminClient
      .from('booking_operations')
      .select('booking_id')
      .eq('centre_id', centreId)
      .eq('state', 'WAITING'),
    'queue.waitingOps',
  );
  if (waiting.length === 0) return;

  const present = unwrap<Array<{ booking_id: string }>>(
    await supabaseAdminClient
      .from('queue_entries')
      .select('booking_id')
      .in('booking_id', waiting.map((row) => row.booking_id)),
    'queue.presentEntries',
  );
  const have = new Set(present.map((row) => row.booking_id));

  for (const row of waiting) {
    if (!have.has(row.booking_id)) await enqueueBooking(centreId, row.booking_id, null);
  }
}

// ---------------------------------------------------------------------------
// Loading optimizer inputs
// ---------------------------------------------------------------------------

interface LoadedQueue {
  entries: repo.EntryRow[];
  candidates: CandidateInput[];
  stations: WorkstationInput[];
  stationRows: repo.WorkstationRow[];
  centreCloseAt: Date | null;
  state: repo.CentreStateRow | null;
  bookingRefs: Map<string, string>;
  cropNames: Map<string, string>;
  estimateSources: Map<number, EstimateSource>;
}

async function loadQueue(db: SupabaseClient, centreId: string, now: Date): Promise<LoadedQueue> {
  const [entries, stationRows, state, centre, processing] = await Promise.all([
    repo.listEntries(db, centreId, ['QUEUED']),
    repo.listWorkstations(db, centreId),
    repo.findCentreState(db, centreId),
    unwrap<{ close_time: string | null }>(
      await db.from('procurement_centres').select('close_time').eq('id', centreId).single(),
      'queue.centre',
    ),
    repo.listEntries(db, centreId, ['PROCESSING', 'SELECTED']),
  ]);

  const bookingIds = entries.map((entry) => entry.booking_id);

  const [bookings, operations, officials, profiles, crops, estimates] = await Promise.all([
    bookingIds.length
      ? unwrap<Array<{ id: string; booking_reference: string; farmer_user_id: string; status: BookingStatus; created_at: string; crop: string }>>(
          await db.from('bookings').select('id, booking_reference, farmer_user_id, status, created_at, crop').in('id', bookingIds),
          'queue.bookings',
        )
      : Promise.resolve([]),
    ops.listOperations(db, bookingIds),
    bookingIds.length
      ? unwrap<Array<{ booking_id: string; result: QualityResult; assessed_at: string }>>(
          await db
            .from('quality_assessments')
            .select('booking_id, result, assessed_at')
            .in('booking_id', bookingIds)
            .order('assessed_at', { ascending: false }),
          'queue.officialResults',
        )
      : Promise.resolve([]),
    Promise.resolve(null),
    unwrap<Array<{ id: string; name_en: string }>>(
      await db.from('crops').select('id, name_en'),
      'queue.crops',
    ),
    entries.some((entry) => entry.estimate_id !== null)
      ? unwrap<Array<{ id: number; source: EstimateSource }>>(
          await db
            .from('processing_estimates')
            .select('id, source')
            .in('id', entries.map((entry) => entry.estimate_id).filter((id): id is number => id !== null)),
          'queue.estimateSources',
        )
      : Promise.resolve([]),
  ]);
  void profiles;

  // The AI's own quality score (0–100), for the top-level QualityFactor
  // (§23) — distinct from quality_risk/quality_confidence, already on the
  // entry row, which feed the workflow-readiness score inside efficiency.
  const predictionIds = entries
    .map((entry) => entry.prediction_id)
    .filter((id): id is string => id !== null);
  const predictionScores = predictionIds.length
    ? unwrap<Array<{ id: string; quality_score: string | number | null }>>(
        await db.from('quality_predictions').select('id, quality_score').in('id', predictionIds),
        'queue.predictionScores',
      )
    : [];
  const qualityScoreByPrediction = new Map(
    predictionScores.map((row) => [row.id, num(row.quality_score)]),
  );

  const farmerIds = [...new Set(bookings.map((booking) => booking.farmer_user_id))];
  const names = farmerIds.length
    ? unwrap<Array<{ id: string; full_name: string | null }>>(
        await db.from('profiles').select('id, full_name').in('id', farmerIds),
        'queue.farmerNames',
      )
    : [];

  const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));
  const opByBooking = new Map(operations.map((operation) => [operation.booking_id, operation]));
  const officialByBooking = new Map<string, QualityResult>();
  for (const row of officials) if (!officialByBooking.has(row.booking_id)) officialByBooking.set(row.booking_id, row.result);
  const nameById = new Map(names.map((row) => [row.id, row.full_name]));
  const cropNames = new Map(crops.map((crop) => [crop.id, crop.name_en]));
  const estimateSources = new Map(estimates.map((row) => [Number(row.id), row.source]));

  const candidates: CandidateInput[] = [];
  for (const entry of entries) {
    const booking = bookingById.get(entry.booking_id);
    const operation = opByBooking.get(entry.booking_id);
    if (!booking || !operation) continue;

    candidates.push({
      entryId: entry.id,
      bookingId: entry.booking_id,
      bookingReference: booking.booking_reference,
      farmerName: nameById.get(booking.farmer_user_id) ?? null,
      bookingCreatedAt: new Date(booking.created_at),
      cropId: entry.crop_id,
      cropName: (entry.crop_id && cropNames.get(entry.crop_id)) || booking.crop,
      quantityKg: Number(entry.quantity_kg),
      enteredAt: new Date(entry.entered_at),
      slotEndAt: entry.slot_end_at ? new Date(entry.slot_end_at) : null,
      entryState: entry.state,
      operationState: operation.state as OperationState,
      bookingStatus: booking.status,
      cropVerified: operation.crop_verified,
      qualityResult: officialByBooking.get(entry.booking_id) ?? null,
      aiRisk: (entry.quality_risk as QualityRisk | null) ?? null,
      aiConfidence: num(entry.quality_confidence),
      aiManualInspection: entry.prediction_id ? entry.manual_inspection_required : null,
      aiQualityScore: entry.prediction_id ? (qualityScoreByPrediction.get(entry.prediction_id) ?? null) : null,
      estimatedProcessingMinutes: num(entry.estimated_processing_minutes),
      estimateSource: entry.estimate_id !== null ? (estimateSources.get(Number(entry.estimate_id)) ?? null) : null,
      priorityAdvantageCount: entry.priority_advantage_count,
      lastAdvantageAt: entry.last_advantage_at ? new Date(entry.last_advantage_at) : null,
      previousRank: entry.current_rank,
    });
  }

  // How long each busy station still needs, from its job's own estimate.
  const processingByBooking = new Map(processing.map((entry) => [entry.booking_id, entry]));
  const stations: WorkstationInput[] = stationRows.map((row) => {
    let remaining: number | null = null;
    if (row.status === 'BUSY' && row.current_booking_id) {
      const job = processingByBooking.get(row.current_booking_id);
      const est = num(job?.estimated_processing_minutes);
      if (job?.selected_at && est !== null) {
        remaining = Math.max(0, est - minutes(now.getTime(), new Date(job.selected_at).getTime()));
      }
    }
    return { id: row.id, code: row.code, cropIds: row.crop_ids ?? [], status: row.status, remainingMinutes: remaining };
  });

  const today = businessToday(tz());
  const centreCloseAt = centre.close_time ? zonedInstant(today, centre.close_time, tz()) : null;

  return {
    entries,
    candidates,
    stations,
    stationRows,
    centreCloseAt,
    state,
    bookingRefs: new Map(bookings.map((booking) => [booking.id, booking.booking_reference])),
    cropNames,
    estimateSources,
  };
}

// ---------------------------------------------------------------------------
// Recalculation (§25, §26, §49)
// ---------------------------------------------------------------------------

export async function recalculateCentreQueue(
  centreId: string,
  trigger: QueueTrigger,
): Promise<string | null> {
  const activePolicy = policy();
  await ensureEntries(centreId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const loaded = await loadQueue(supabaseAdminClient, centreId, now);
    const version = Number(loaded.state?.version ?? 0);

    const result = optimizeQueue(loaded.candidates, loaded.stations, {
      now,
      centreCloseAt: loaded.centreCloseAt,
      policy: activePolicy,
      previousNextBookingId: loaded.state?.next_booking_id ?? null,
    });

    const entryByBooking = new Map(loaded.entries.map((entry) => [entry.booking_id, entry]));
    const previousOrder = loaded.candidates
      .filter((candidate) => candidate.previousRank !== null)
      .sort((a, b) => a.previousRank! - b.previousRank!)
      .map((candidate) => candidate.bookingId);

    let ordered = result.ranked;
    // A REORDER is a change in the relative order of farmers who were already
    // ranked. Someone joining or leaving the queue is not one.
    let reordered = relativeOrderChanged(previousOrder, ordered.map((entry) => entry.input.bookingId));

    /**
     * Stability (§26). The passage of time alone nudges every score a little;
     * a queue that reshuffles every minute is one staff cannot follow. On a
     * time tick the previous order is kept unless something MATERIAL changed:
     * who is next, who is protected, or who is in the queue at all.
     */
    if (trigger === 'TIME_TICK' && reordered) {
      const sameMembers = sameSet(previousOrder, ordered.map((entry) => entry.input.bookingId));
      const sameNext = ordered[0]?.input.bookingId === previousOrder[0];
      const protectionChanged = ordered.some(
        (entry) => entry.breakdown?.isProtected !== entryByBooking.get(entry.input.bookingId)?.is_protected,
      );

      if (sameMembers && sameNext && !protectionChanged) {
        ordered = [...ordered].sort((a, b) => a.input.previousRank! - b.input.previousRank!);
        ordered.forEach((entry, index) => {
          entry.rank = index + 1;
          entry.advantage = false;
        });
        applyWaits(ordered, loaded.stations, activePolicy.fitScaleMinutes);
        reordered = false;
      }
    }

    // A tick that changes nothing anyone can see writes nothing.
    if (trigger === 'TIME_TICK' && !reordered && loaded.state?.last_snapshot_id) {
      const visibleChange =
        ordered.some((entry) => {
          const row = entryByBooking.get(entry.input.bookingId);
          return (
            !row ||
            row.current_rank !== entry.rank ||
            row.eligible !== true ||
            Math.abs((row.estimated_wait_minutes ?? -1) - (entry.estimatedWaitMinutes ?? -1)) > 1
          );
        }) ||
        result.ineligible.some((entry) => entryByBooking.get(entry.input.bookingId)?.eligible !== false);

      if (!visibleChange) return loaded.state.last_snapshot_id;
    }

    const all = [...ordered, ...result.ineligible];

    const { data, error } = await supabaseAdminClient.rpc('apply_queue_snapshot', {
      p_centre_id: centreId,
      p_based_on_version: version,
      p_snapshot: {
        triggerType: trigger,
        algorithmVersion: ALGORITHM_VERSION,
        configHash: policyHash(activePolicy),
        config: activePolicy,
        candidateCount: all.length,
        eligibleCount: ordered.length,
        reordered,
        nextBookingId: ordered[0]?.input.bookingId ?? '',
      },
      p_rankings: all.map(rankingPayload),
      p_entries: all.map((entry) => ({
        entryId: entry.input.entryId,
        rank: entry.rank,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        finalPriority: entry.breakdown?.finalPriority ?? null,
        isProtected: entry.breakdown?.isProtected ?? false,
        eligible: entry.eligible,
        ineligibleReasons: entry.ineligibleReasons,
        advantage: entry.advantage,
      })),
    });

    if (error) {
      logger.error('queue snapshot could not be applied', { centreId, trigger, reason: error.message });
      return null;
    }
    if (data) return data as string;
    // The inputs moved under us. Recompute from fresh data, never overwrite.
  }

  logger.warn('queue recalculation lost three races in a row', { centreId, trigger });
  return null;
}

/** Recalculation is a side effect of a staff action; its failure must not undo that action. */
export async function recalculateQuietly(centreId: string, trigger: QueueTrigger): Promise<void> {
  try {
    await recalculateCentreQueue(centreId, trigger);
  } catch (cause) {
    logger.error('queue recalculation failed', { centreId, trigger, reason: (cause as Error).message });
  }
}

function rankingPayload(entry: RankedCandidate): Record<string, unknown> {
  const b = entry.breakdown;
  return {
    bookingId: entry.input.bookingId,
    rank: entry.rank,
    eligible: entry.eligible,
    isProtected: b?.isProtected ?? false,
    fairnessScore: b?.fairnessScore ?? null,
    operationalEfficiencyScore: b?.operationalEfficiencyScore ?? null,
    urgencyScore: b?.urgencyScore ?? null,
    fairnessPenalty: b?.fairnessPenalty ?? null,
    finalPriority: b?.finalPriority ?? null,
    waitMinutes: b?.waitMinutes ?? null,
    slotLatenessMinutes: b?.slotLatenessMinutes ?? null,
    estimatedProcessingMinutes: entry.input.estimatedProcessingMinutes,
    estimatedWaitMinutes: entry.estimatedWaitMinutes,
    waitScore: b?.waitScore ?? null,
    slotLatenessScore: b?.slotLatenessScore ?? null,
    agingScore: b?.agingScore ?? null,
    qualityReadinessScore: b?.qualityReadinessScore ?? null,
    qualityFactorScore: b?.qualityFactorScore ?? null,
    qualityConfidence: entry.quality.confidence,
    processingFitScore: b?.processingFitScore ?? null,
    workstationFitScore: b?.workstationFitScore ?? null,
    reasonCodes: entry.eligible ? entry.reasonCodes : entry.ineligibleReasons,
  };
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function relativeOrderChanged(previous: string[], next: string[]): boolean {
  const inBoth = new Set(previous.filter((id) => next.includes(id)));
  return !sameList(
    previous.filter((id) => inBoth.has(id)),
    next.filter((id) => inBoth.has(id)),
  );
}

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value) => b.includes(value));

// ---------------------------------------------------------------------------
// Staff reads
// ---------------------------------------------------------------------------

function breakdownOf(row: repo.RankingRow | undefined): ScoreBreakdown | null {
  if (!row || !row.eligible) return null;
  const n = (value: string | number | null): number => Number(value ?? 0);
  return {
    waitMinutes: n(row.wait_minutes),
    slotLatenessMinutes: n(row.slot_lateness_minutes),
    waitScore: n(row.wait_score),
    slotLatenessScore: n(row.slot_lateness_score),
    agingScore: n(row.aging_score),
    urgencyScore: n(row.urgency_score),
    fairnessScore: n(row.fairness_score),
    processingFitScore: n(row.processing_fit_score),
    workstationFitScore: n(row.workstation_fit_score),
    qualityReadinessScore: n(row.quality_readiness_score),
    operationalEfficiencyScore: n(row.operational_efficiency_score),
    qualityFactorScore: n(row.quality_factor_score),
    fairnessPenalty: n(row.fairness_penalty),
    finalPriority: n(row.final_priority),
    isProtected: row.is_protected,
  };
}

function isCompatibleRow(station: repo.WorkstationRow, cropId: string | null): boolean {
  const crops = station.crop_ids ?? [];
  return crops.length === 0 || (cropId !== null && crops.includes(cropId));
}

function toWorkstationView(
  row: repo.WorkstationRow,
  cropNames: Map<string, string>,
  bookingRefs: Map<string, string>,
): WorkstationView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    cropIds: row.crop_ids ?? [],
    cropNames: (row.crop_ids ?? []).map((id) => cropNames.get(id) ?? id),
    currentBookingReference: row.current_booking_id ? (bookingRefs.get(row.current_booking_id) ?? null) : null,
    busySince: row.busy_since,
  };
}

export async function getQueueView(auth: AuthContext): Promise<QueueView> {
  const centreId = centreOf(auth);
  const activePolicy = policy();

  // The background tick normally keeps this fresh; if it is not running (or
  // has fallen behind) the view refreshes itself rather than show stale ranks.
  const state = await repo.findCentreState(supabaseAdminClient, centreId);
  const staleAfterMs = Math.max(2 * env.QUEUE_RECALC_INTERVAL_SECONDS, 120) * 1000;
  if (!state?.last_recalculated_at || Date.now() - new Date(state.last_recalculated_at).getTime() > staleAfterMs) {
    await recalculateQuietly(centreId, 'TIME_TICK');
  }

  // Reads under the staff member's own RLS-bound client.
  const now = new Date();
  const loaded = await loadQueue(auth.db, centreId, now);
  const fresh = await repo.findCentreState(auth.db, centreId);
  const snapshot = fresh?.last_snapshot_id ? await repo.findSnapshot(auth.db, fresh.last_snapshot_id) : null;
  const rankings = snapshot ? await repo.listRankings(auth.db, snapshot.id) : [];
  const rankingByBooking = new Map(rankings.map((row) => [row.booking_id, row]));

  const busyRefs = await bookingReferences(
    auth.db,
    loaded.stationRows.map((row) => row.current_booking_id).filter((id): id is string => Boolean(id)),
  );

  const views = loaded.candidates.map((candidate) =>
    toCandidateView(candidate, loaded.entries.find((entry) => entry.id === candidate.entryId)!, rankingByBooking.get(candidate.bookingId), loaded.stationRows, now),
  );

  const ranked = views.filter((view) => view.eligible && view.rank !== null).sort((a, b) => a.rank! - b.rank!);
  const ineligible = views.filter((view) => !(view.eligible && view.rank !== null));

  return {
    centreId,
    algorithmVersion: snapshot?.algorithm_version ?? ALGORITHM_VERSION,
    configHash: snapshot?.config_hash ?? policyHash(activePolicy),
    snapshotId: snapshot?.id ?? null,
    generatedAt: snapshot?.generated_at ?? null,
    trigger: snapshot?.trigger_type ?? null,
    version: Number(fresh?.version ?? 0),
    next: ranked[0] ?? null,
    candidates: ranked,
    ineligible,
    workstations: loaded.stationRows.map((row) => toWorkstationView(row, loaded.cropNames, busyRefs)),
    policy: policySummary(activePolicy),
  };
}

async function bookingReferences(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = unwrap<Array<{ id: string; booking_reference: string }>>(
    await db.from('bookings').select('id, booking_reference').in('id', ids),
    'queue.bookingRefs',
  );
  return new Map(rows.map((row) => [row.id, row.booking_reference]));
}

function toCandidateView(
  candidate: CandidateInput,
  entry: repo.EntryRow,
  ranking: repo.RankingRow | undefined,
  stations: repo.WorkstationRow[],
  now: Date,
): QueueCandidateView {
  const eligible = entry.eligible === true && entry.current_rank !== null;
  return {
    bookingId: candidate.bookingId,
    bookingReference: candidate.bookingReference,
    farmerName: candidate.farmerName,
    cropName: candidate.cropName,
    quantityKg: candidate.quantityKg,
    enteredAt: entry.entered_at,
    slotEnd: entry.slot_end_at,
    waitMinutes: Math.max(0, Math.floor(minutes(now.getTime(), new Date(entry.entered_at).getTime()))),
    rank: entry.current_rank,
    eligible,
    isProtected: entry.is_protected,
    estimatedProcessingMinutes: candidate.estimatedProcessingMinutes,
    estimateSource: candidate.estimateSource,
    estimatedWaitMinutes: entry.estimated_wait_minutes,
    qualityResult: candidate.qualityResult,
    qualityRisk: candidate.aiRisk,
    qualityConfidence: candidate.aiConfidence,
    manualInspectionRequired:
      candidate.qualityResult === 'CONDITIONAL' ||
      Boolean(candidate.aiManualInspection) ||
      (candidate.aiConfidence !== null && candidate.aiConfidence < policy().qualityConfidenceThreshold),
    reasonCodes: eligible ? ((ranking?.reason_codes ?? []) as QueueReasonCode[]) : [],
    ineligibleReasons: (entry.ineligible_reasons ?? []) as IneligibleReasonCode[],
    compatibleAvailableWorkstationIds: stations
      .filter((station) => station.status === 'AVAILABLE' && isCompatibleRow(station, candidate.cropId))
      .map((station) => station.id),
    breakdown: breakdownOf(ranking),
  };
}

export async function getCandidate(auth: AuthContext, bookingId: string): Promise<QueueCandidateView> {
  const view = await getQueueView(auth);
  const found = [...view.candidates, ...view.ineligible].find((entry) => entry.bookingId === bookingId);
  if (!found) throw notFound('This farmer is not in the queue at your centre.');
  return found;
}

export async function getExplanation(auth: AuthContext, bookingId: string): Promise<{
  candidate: QueueCandidateView;
  history: Array<{ at: string; rank: number | null; finalPriority: number | null; reasonCodes: string[] }>;
  decisions: repo.DecisionRow[];
  algorithmVersion: string;
}> {
  const candidate = await getCandidate(auth, bookingId);
  const [history, decisions] = await Promise.all([
    repo.rankingHistory(auth.db, bookingId, 30),
    repo.listDecisions(auth.db, { bookingId }),
  ]);

  return {
    candidate,
    history: history.map((row) => ({
      at: row.created_at,
      rank: row.rank,
      finalPriority: num(row.final_priority),
      reasonCodes: (row.reason_codes ?? []) as string[],
    })),
    decisions,
    algorithmVersion: ALGORITHM_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

async function requireActiveSession(auth: AuthContext, centreId: string): Promise<void> {
  const session = await ops.findSession(auth.db, centreId, businessToday(tz()));
  if (!session || !sessionIsActive(session.status)) {
    throw conflict("Open today's procurement session before processing farmers.");
  }
}

const SELECT_FAILURES: Record<string, string> = {
  NOT_IN_QUEUE: 'This farmer is not in the queue.',
  ALREADY_SELECTED: 'Another staff member has already started this farmer.',
  NOT_WAITING: 'This farmer is no longer waiting in the queue.',
  BOOKING_NOT_ACTIVE: 'This booking is no longer active.',
  QUALITY_NOT_READY: 'A passed quality assessment is required before procurement.',
  NO_PROCESSING_ESTIMATE: 'This farmer has no processing estimate yet.',
  WORKSTATION_NOT_FOUND: 'That workstation is not at your centre.',
  WORKSTATION_NOT_AVAILABLE: 'That workstation is no longer free.',
  WORKSTATION_INCOMPATIBLE: 'That workstation cannot handle this crop.',
};

/**
 * Start procurement for a queued farmer (§28).
 *
 * The optimizer's recommendation is not an authorization. Everything is
 * revalidated inside `select_queue_candidate`, under a lock, at the moment of
 * selection; a lost race is a 409 followed by a recalculation, never an
 * overwrite. Choosing someone other than NEXT is allowed, with a reason, and
 * is recorded as an override.
 */
export async function selectCandidate(
  auth: AuthContext,
  bookingId: string,
  input: { workstationId: string; overrideReason?: string },
): Promise<{ decision: 'SELECTED' | 'SELECTED_OVERRIDE' }> {
  const centreId = centreOf(auth);
  await requireActiveSession(auth, centreId);

  const entry = await repo.findEntry(auth.db, bookingId);
  if (!entry || entry.centre_id !== centreId) throw notFound('This farmer is not in the queue at your centre.');
  if (entry.state !== 'QUEUED') throw conflict(SELECT_FAILURES.ALREADY_SELECTED!);
  if (entry.eligible !== true || entry.current_rank === null) {
    throw conflict('This farmer cannot be started yet. See the reasons shown in the queue.');
  }

  const isNext = entry.current_rank === 1;
  const reason = input.overrideReason?.trim() ?? '';
  if (!isNext && reason.length < 5) {
    throw validationError('This farmer is not the recommended next. Give a reason for choosing them now.');
  }

  const ranking = entry.last_snapshot_id
    ? (await repo.listRankings(auth.db, entry.last_snapshot_id)).find((row) => row.booking_id === bookingId)
    : undefined;

  const decision = isNext ? 'SELECTED' : 'SELECTED_OVERRIDE';

  const { data, error } = await supabaseAdminClient.rpc('select_queue_candidate', {
    p_centre_id: centreId,
    p_booking_id: bookingId,
    p_workstation_id: input.workstationId,
    p_actor: auth.userId,
    p_decision: decision,
    p_note: isNext ? null : reason,
    p_metadata: {
      queueAlgorithmVersion: ALGORITHM_VERSION,
      configHash: policyHash(policy()),
      snapshotId: entry.last_snapshot_id,
      queueRank: entry.current_rank,
      selectionReasonCodes: ranking?.reason_codes ?? [],
      scoreBreakdown: breakdownOf(ranking),
      decision,
    },
  });

  if (error) throw conflict('Could not start procurement for this farmer. Refresh and try again.');

  const outcome = data as { ok: boolean; code?: string };
  if (!outcome.ok) {
    await recalculateQuietly(centreId, 'MANUAL');
    throw conflict(SELECT_FAILURES[outcome.code ?? ''] ?? 'This farmer could not be started. Refresh and try again.');
  }

  await recalculateQuietly(centreId, 'PROCUREMENT_STARTED');
  return { decision };
}

export async function removeCandidate(auth: AuthContext, bookingId: string, reason: string): Promise<void> {
  const centreId = centreOf(auth);
  if (reason.trim().length < 5) throw validationError('Explain why this farmer is being taken out of the queue.');

  const { data, error } = await supabaseAdminClient.rpc('remove_queue_candidate', {
    p_centre_id: centreId,
    p_booking_id: bookingId,
    p_actor: auth.userId,
    p_note: reason.trim(),
    p_algorithm_version: ALGORITHM_VERSION,
  });
  if (error) throw conflict('Could not remove this farmer from the queue.');
  if (!(data as { ok: boolean }).ok) throw conflict('This farmer is not waiting in the queue.');

  await recalculateQuietly(centreId, 'CANDIDATE_REMOVED');
}

export async function requeueCandidate(auth: AuthContext, bookingId: string): Promise<void> {
  const centreId = centreOf(auth);

  const { data, error } = await supabaseAdminClient.rpc('requeue_candidate', {
    p_centre_id: centreId,
    p_booking_id: bookingId,
    p_actor: auth.userId,
    p_algorithm_version: ALGORITHM_VERSION,
  });
  if (error) throw conflict('Could not return this farmer to the queue.');
  if (!(data as { ok: boolean }).ok) throw conflict('This farmer is not on hold from the queue.');

  await recalculateQuietly(centreId, 'CANDIDATE_REQUEUED');
}

export async function listWorkstationViews(auth: AuthContext): Promise<WorkstationView[]> {
  const centreId = centreOf(auth);
  const [rows, crops] = await Promise.all([
    repo.listWorkstations(auth.db, centreId),
    unwrap<Array<{ id: string; name_en: string }>>(await auth.db.from('crops').select('id, name_en'), 'queue.crops'),
  ]);
  const refs = await bookingReferences(
    auth.db,
    rows.map((row) => row.current_booking_id).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => toWorkstationView(row, new Map(crops.map((c) => [c.id, c.name_en])), refs));
}

/** Staff take a station offline or bring it back. A busy station finishes first. */
export async function setWorkstationStatus(
  auth: AuthContext,
  workstationId: string,
  status: 'AVAILABLE' | 'OFFLINE',
): Promise<WorkstationView[]> {
  const centreId = centreOf(auth);

  const { data, error } = await supabaseAdminClient
    .from('queue_workstations')
    .update({ status })
    .eq('id', workstationId)
    .eq('centre_id', centreId)
    .neq('status', 'BUSY')
    .select('id');

  if (error) throw conflict('Could not update the workstation.');
  if (!data || data.length === 0) {
    throw conflict('That workstation is busy or not at your centre. Finish the current farmer first.');
  }

  await recalculateQuietly(centreId, status === 'AVAILABLE' ? 'WORKSTATION_AVAILABLE' : 'WORKSTATION_OFFLINE');
  return listWorkstationViews(auth);
}

// ---------------------------------------------------------------------------
// Metrics and the FCFS comparison (§43, §44)
// ---------------------------------------------------------------------------

function dayBounds(date: string): { from: Date; to: Date } {
  return { from: zonedInstant(date, '00:00', tz()), to: zonedInstant(addDays(date, 1), '00:00', tz()) };
}

export async function getMetrics(auth: AuthContext, date: string): Promise<QueueMetrics> {
  const centreId = centreOf(auth);
  const activePolicy = policy();
  const { from, to } = dayBounds(date);
  const now = Date.now();
  const end = Math.min(now, to.getTime());

  const [entries, queued, snapshots, decisions, stations, predictions] = await Promise.all([
    repo.listEntriesSince(auth.db, centreId, from.toISOString(), to.toISOString()),
    repo.listEntries(auth.db, centreId, ['QUEUED']),
    repo.listSnapshotsBetween(auth.db, centreId, from.toISOString(), to.toISOString()),
    repo.listDecisions(auth.db, { centreId, fromIso: from.toISOString(), toIso: to.toISOString() }),
    repo.listWorkstations(auth.db, centreId),
    unwrap<Array<{ assessment_status: string; confidence: string | number | null }>>(
      await auth.db
        .from('quality_predictions')
        .select('assessment_status, confidence')
        .eq('centre_id', centreId)
        .gte('created_at', from.toISOString())
        .lt('created_at', to.toISOString()),
      'queue.metricsPredictions',
    ),
  ]);

  const t = (iso: string | null): number | null => (iso ? new Date(iso).getTime() : null);

  const started = entries.filter((entry) => entry.selected_at);
  const waits = started.map((entry) => minutes(t(entry.selected_at)!, t(entry.entered_at)!));
  const slotDelays = started
    .filter((entry) => entry.slot_end_at)
    .map((entry) => Math.max(0, minutes(t(entry.selected_at)!, t(entry.slot_end_at)!)));
  const done = entries.filter((entry) => entry.state === 'DONE' && entry.processed_at && entry.selected_at);
  const processingTimes = done.map((entry) => minutes(t(entry.processed_at)!, t(entry.selected_at)!));

  const firstStart = started.length ? Math.min(...started.map((entry) => t(entry.selected_at)!)) : null;
  const lastDone = done.length ? Math.max(...done.map((entry) => t(entry.processed_at)!)) : null;
  const spanHours = firstStart !== null && lastDone !== null ? (lastDone - firstStart) / 3_600_000 : 0;

  const busyMinutes = started.reduce(
    (sum, entry) => sum + Math.max(0, minutes(t(entry.processed_at) ?? end, t(entry.selected_at)!)),
    0,
  );
  const firstEntered = entries.length ? Math.min(...entries.map((entry) => t(entry.entered_at)!)) : null;
  const liveStations = stations.filter((station) => station.status !== 'OFFLINE').length;
  const windowMinutes = firstEntered !== null ? minutes(end, firstEntered) : 0;

  const currentWaits = queued.map((entry) => minutes(now, t(entry.entered_at)!));
  const starvation =
    waits.filter((wait) => wait >= activePolicy.maxWaitOverrideMinutes).length +
    currentWaits.filter((wait) => wait >= activePolicy.maxWaitOverrideMinutes).length;

  const manual = entries.filter(
    (entry) =>
      entry.quality_result === 'CONDITIONAL' ||
      entry.manual_inspection_required ||
      (entry.quality_confidence !== null && Number(entry.quality_confidence) < activePolicy.qualityConfidenceThreshold),
  ).length;

  const completedPredictions = predictions.filter((row) => row.assessment_status === 'COMPLETED');
  const lowConfidence = completedPredictions.filter(
    (row) => row.confidence !== null && Number(row.confidence) < activePolicy.qualityConfidenceThreshold,
  ).length;

  // At most ~200 points: enough to draw, not enough to flood a phone.
  const step = Math.max(1, Math.ceil(snapshots.length / 200));

  return {
    date,
    completedWaits: waitStats(waits),
    currentQueueLength: queued.length,
    longestCurrentWaitMinutes: currentWaits.length ? Math.round(Math.max(...currentWaits)) : null,
    averageSlotDelayMinutes: slotDelays.length ? round1(slotDelays.reduce((a, b) => a + b, 0) / slotDelays.length) : null,
    processedCount: done.length,
    farmersPerHour: spanHours >= 0.25 ? round1(done.length / spanHours) : null,
    averageProcessingMinutes: processingTimes.length
      ? round1(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length)
      : null,
    workstationUtilisation:
      liveStations > 0 && windowMinutes > 0 ? round3(Math.min(1, busyMinutes / (liveStations * windowMinutes))) : null,
    queueLengthOverTime: snapshots
      .filter((_, index) => index % step === 0)
      .map((row) => ({ at: row.generated_at, length: row.eligible_count })),
    starvationEvents: starvation,
    fairnessOverrides: decisions.filter(
      (row) => row.decision.startsWith('SELECTED') && (row.reason_codes ?? []).includes('MAX_WAIT_PROTECTION'),
    ).length,
    dynamicReorders: snapshots.filter((row) => row.reordered).length,
    selectionOverrides: decisions.filter((row) => row.decision === 'SELECTED_OVERRIDE').length,
    manualQualityReviewRate: entries.length ? round3(manual / entries.length) : null,
    mlPredictions: completedPredictions.length,
    mlLowConfidenceRate: completedPredictions.length ? round3(lowConfidence / completedPredictions.length) : null,
    mlUnavailableCount: predictions.length - completedPredictions.length,
  };
}

export async function getComparison(auth: AuthContext, date: string): Promise<QueueComparison> {
  const centreId = centreOf(auth);
  const activePolicy = policy();
  const { from, to } = dayBounds(date);

  const [entries, stationRows, centre] = await Promise.all([
    repo.listEntriesSince(auth.db, centreId, from.toISOString(), to.toISOString()),
    repo.listWorkstations(auth.db, centreId),
    unwrap<{ close_time: string | null }>(
      await auth.db.from('procurement_centres').select('close_time').eq('id', centreId).single(),
      'queue.centreClose',
    ),
  ]);

  // The workload: everyone who actually joined the queue that day and was
  // served or is still waiting. Removed farmers are not part of it.
  const workload = entries.filter(
    (entry) => entry.state !== 'REMOVED' && entry.estimated_processing_minutes !== null,
  );
  const refs = await bookingReferences(auth.db, workload.map((entry) => entry.booking_id));
  const created = workload.length
    ? unwrap<Array<{ id: string; created_at: string }>>(
        await auth.db.from('bookings').select('id, created_at').in('id', workload.map((entry) => entry.booking_id)),
        'queue.bookingCreated',
      )
    : [];
  const createdAt = new Map(created.map((row) => [row.id, row.created_at]));

  const workloadPredictionIds = workload
    .map((entry) => entry.prediction_id)
    .filter((id): id is string => id !== null);
  const workloadPredictionScores = workloadPredictionIds.length
    ? unwrap<Array<{ id: string; quality_score: string | number | null }>>(
        await auth.db.from('quality_predictions').select('id, quality_score').in('id', workloadPredictionIds),
        'queue.comparisonPredictionScores',
      )
    : [];
  const qualityScoreByPrediction = new Map(
    workloadPredictionScores.map((row) => [row.id, num(row.quality_score)]),
  );

  const jobs: SimulationJob[] = workload.map((entry) => ({
    estimatedMinutes: Number(entry.estimated_processing_minutes),
    input: {
      entryId: entry.id,
      bookingId: entry.booking_id,
      bookingReference: refs.get(entry.booking_id) ?? entry.booking_id,
      farmerName: null,
      bookingCreatedAt: new Date(createdAt.get(entry.booking_id) ?? entry.entered_at),
      cropId: entry.crop_id,
      cropName: '',
      quantityKg: Number(entry.quantity_kg),
      enteredAt: new Date(entry.entered_at),
      slotEndAt: entry.slot_end_at ? new Date(entry.slot_end_at) : null,
      entryState: 'QUEUED',
      operationState: 'WAITING',
      bookingStatus: 'BOOKED',
      cropVerified: true,
      qualityResult: (entry.quality_result as QualityResult | null) ?? 'PASSED',
      aiRisk: (entry.quality_risk as QualityRisk | null) ?? null,
      aiConfidence: num(entry.quality_confidence),
      aiManualInspection: entry.prediction_id ? entry.manual_inspection_required : null,
      aiQualityScore: entry.prediction_id ? (qualityScoreByPrediction.get(entry.prediction_id) ?? null) : null,
      estimatedProcessingMinutes: Number(entry.estimated_processing_minutes),
      estimateSource: null,
      priorityAdvantageCount: 0,
      lastAdvantageAt: null,
      previousRank: null,
    },
  }));

  const stations: WorkstationInput[] = stationRows
    .filter((row) => row.status !== 'OFFLINE')
    .map((row) => ({ id: row.id, code: row.code, cropIds: row.crop_ids ?? [], status: 'AVAILABLE', remainingMinutes: null }));

  const closeAt = centre.close_time ? zonedInstant(date, centre.close_time, tz()) : null;

  return {
    date,
    workloadSize: jobs.length,
    workstationCount: stations.length,
    basis: 'RECORDED_ARRIVALS_WITH_ESTIMATED_PROCESSING_TIMES',
    fcfs: simulate('FCFS', jobs, stations, activePolicy, closeAt),
    optimized: simulate('FA_DQO', jobs, stations, activePolicy, closeAt),
  };
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------------------
// Background recalculation
// ---------------------------------------------------------------------------

/**
 * Waits grow as time passes, so the queue is re-evaluated periodically for
 * every centre that has someone waiting. Stability rules mean most ticks
 * change nothing and write nothing (§26).
 */
export function startQueueScheduler(): () => void {
  const seconds = env.QUEUE_RECALC_INTERVAL_SECONDS;
  if (seconds <= 0) return () => undefined;

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const rows = unwrap<Array<{ centre_id: string }>>(
          await supabaseAdminClient.from('queue_entries').select('centre_id').eq('state', 'QUEUED'),
          'queue.activeCentres',
        );
        for (const centreId of new Set(rows.map((row) => row.centre_id))) {
          await recalculateQuietly(centreId, 'TIME_TICK');
        }
      } catch (cause) {
        logger.error('queue scheduler tick failed', { reason: (cause as Error).message });
      } finally {
        running = false;
      }
    })();
  }, seconds * 1000);

  timer.unref();
  return () => clearInterval(timer);
}
