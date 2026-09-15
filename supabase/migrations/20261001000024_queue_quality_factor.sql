-- ===========================================================================
-- Phase 15 / 0024 — fa-dqo-v2: a bounded, TOP-LEVEL AI Quality Factor
--
-- Phase 7's optimizer let quality influence ranking only indirectly, as one
-- component of OperationalEfficiencyScore (workflow-effort "readiness" —
-- risk/confidence/manual-inspection). That component stays exactly as it
-- was. This adds a second, independent, small, BOUNDED quality input at the
-- top level of FinalPriority — built from the AI's own quality score, not
-- the risk-derived readiness figure — so the AI's actual assessment is
-- represented in ranking, without ever approaching fairness's dominant
-- share. Low AI confidence blends this factor toward neutral (0.5) rather
-- than letting an uncertain prediction move anyone (see optimizer/scores.ts
-- qualityFactorScore()).
--
-- FinalPriority becomes:
--   fairnessWeight·Fairness + efficiencyWeight·Efficiency
--     + qualityWeight·QualityFactor + urgencyWeight·Urgency
--     − penaltyWeight·FairnessPenalty
-- (application code, apps/api/src/services/queue/optimizer/optimizer.ts —
-- this migration only adds the column the new score is persisted into.)
-- ===========================================================================

alter table public.queue_rankings
  add column if not exists quality_factor_score numeric(8, 6);

comment on column public.queue_rankings.quality_factor_score is
  'The bounded, top-level AI Quality Factor (fa-dqo-v2) — the models quality score blended toward neutral under low confidence. Distinct from quality_readiness_score, which stays inside operational_efficiency_score.';

create or replace function public.apply_queue_snapshot(
  p_centre_id uuid,
  p_based_on_version bigint,
  p_snapshot jsonb,
  p_rankings jsonb,
  p_entries jsonb
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_version bigint;
  sid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('queue:' || p_centre_id::text, 0));

  select version into current_version from public.queue_centre_state where centre_id = p_centre_id;
  if coalesce(current_version, 0) <> p_based_on_version then
    return null;
  end if;

  insert into public.queue_snapshots (
    centre_id, trigger_type, algorithm_version, config_hash, config, based_on_version,
    candidate_count, eligible_count, reordered, next_booking_id
  ) values (
    p_centre_id,
    p_snapshot->>'triggerType',
    p_snapshot->>'algorithmVersion',
    p_snapshot->>'configHash',
    p_snapshot->'config',
    p_based_on_version,
    (p_snapshot->>'candidateCount')::integer,
    (p_snapshot->>'eligibleCount')::integer,
    coalesce((p_snapshot->>'reordered')::boolean, false),
    nullif(p_snapshot->>'nextBookingId', '')::uuid
  )
  returning id into sid;

  insert into public.queue_rankings (
    snapshot_id, centre_id, booking_id, rank, eligible, is_protected,
    fairness_score, operational_efficiency_score, urgency_score, fairness_penalty, final_priority,
    wait_minutes, slot_lateness_minutes, estimated_processing_minutes, estimated_wait_minutes,
    wait_score, slot_lateness_score, aging_score, quality_readiness_score, quality_factor_score,
    quality_confidence, processing_fit_score, workstation_fit_score, reason_codes
  )
  select sid, p_centre_id, r."bookingId", r.rank, r.eligible, r."isProtected",
         r."fairnessScore", r."operationalEfficiencyScore", r."urgencyScore", r."fairnessPenalty", r."finalPriority",
         r."waitMinutes", r."slotLatenessMinutes", r."estimatedProcessingMinutes", r."estimatedWaitMinutes",
         r."waitScore", r."slotLatenessScore", r."agingScore", r."qualityReadinessScore", r."qualityFactorScore",
         r."qualityConfidence", r."processingFitScore", r."workstationFitScore", coalesce(r."reasonCodes", '[]'::jsonb)
  from jsonb_to_recordset(p_rankings) as r(
    "bookingId" uuid, rank integer, eligible boolean, "isProtected" boolean,
    "fairnessScore" numeric, "operationalEfficiencyScore" numeric, "urgencyScore" numeric,
    "fairnessPenalty" numeric, "finalPriority" numeric,
    "waitMinutes" numeric, "slotLatenessMinutes" numeric, "estimatedProcessingMinutes" numeric,
    "estimatedWaitMinutes" integer,
    "waitScore" numeric, "slotLatenessScore" numeric, "agingScore" numeric,
    "qualityReadinessScore" numeric, "qualityFactorScore" numeric, "qualityConfidence" numeric,
    "processingFitScore" numeric, "workstationFitScore" numeric, "reasonCodes" jsonb
  );

  update public.queue_entries e
  set current_rank           = x.rank,
      estimated_wait_minutes = x."estimatedWaitMinutes",
      final_priority         = x."finalPriority",
      is_protected           = coalesce(x."isProtected", false),
      eligible               = x.eligible,
      ineligible_reasons     = coalesce(x."ineligibleReasons", '[]'::jsonb),
      last_snapshot_id       = sid,
      priority_advantage_count = e.priority_advantage_count + case when x.advantage then 1 else 0 end,
      last_advantage_at      = case when x.advantage then now() else e.last_advantage_at end
  from jsonb_to_recordset(p_entries) as x(
    "entryId" uuid, rank integer, "estimatedWaitMinutes" integer, "finalPriority" numeric,
    "isProtected" boolean, eligible boolean, "ineligibleReasons" jsonb, advantage boolean
  )
  where e.id = x."entryId" and e.state = 'QUEUED';

  -- The Phase 6 farmer contract. Written only where something the farmer can
  -- see actually changed, so an unchanged queue does not ping every phone.
  update public.booking_operations o
  set queue_position         = e.current_rank,
      estimated_wait_minutes = e.estimated_wait_minutes,
      queue_updated_at       = now()
  from public.queue_entries e
  where e.last_snapshot_id = sid
    and e.state = 'QUEUED'
    and o.id = e.operation_id
    and o.state = 'WAITING'
    and (o.queue_updated_at is null
         or o.queue_position is distinct from e.current_rank
         or o.estimated_wait_minutes is distinct from e.estimated_wait_minutes);

  insert into public.queue_centre_state (centre_id, version, last_recalculated_at, last_snapshot_id, next_booking_id)
  values (p_centre_id, p_based_on_version, now(), sid, nullif(p_snapshot->>'nextBookingId', '')::uuid)
  on conflict (centre_id) do update
    set last_recalculated_at = now(),
        last_snapshot_id = sid,
        next_booking_id = excluded.next_booking_id,
        updated_at = now();

  return sid;
end;
$$;
