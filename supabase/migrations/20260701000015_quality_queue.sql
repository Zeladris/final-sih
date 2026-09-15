-- ===========================================================================
-- Phase 7 / 0015 — AI-assisted quality + fairness-aware dynamic queue
--
-- 1. WORKFLOW ORDER. The queue now comes AFTER the quality check, as the
--    Phase 6/7 lifecycle specifies:
--        ARRIVED → CHECKED_IN → QUALITY_CHECK → WAITING (queue) → WEIGHING …
--    The optimizer ranks farmers whose quality outcome and processing
--    estimate are known; ranking before the check would be ranking blind.
--
-- 2. NO SECOND STATUS SYSTEM. Queue state (QUEUED / PROCESSING / …) is
--    metadata about ordering. The authoritative lifecycle is still
--    booking_operations.state, moved only through transition functions that
--    write Phase 6 history in the same transaction.
--
-- 3. AI IS ADVISORY. quality_predictions (model output, append-only) is kept
--    apart from quality_assessments (the staff member's official result).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Generic append-only guard
-- ---------------------------------------------------------------------------

create or replace function app.forbid_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The operational state machine, reordered
-- ---------------------------------------------------------------------------

create or replace function app.assert_operation_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed boolean;
  booking_state public.booking_status;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'BOOKED' then
      raise exception 'An operation must start at BOOKED, not %', new.state
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.state = new.state then
    return new;
  end if;

  -- Mirrors OPERATION_TRANSITIONS in packages/shared/src/operations.ts.
  allowed := case old.state
    when 'BOOKED'          then new.state in ('ARRIVED', 'CANCELLED')
    when 'ARRIVED'         then new.state in ('CHECKED_IN', 'ON_HOLD', 'CANCELLED')
    when 'CHECKED_IN'      then new.state in ('QUALITY_CHECK', 'ON_HOLD', 'REJECTED')
    when 'QUALITY_CHECK'   then new.state in ('WAITING', 'REJECTED', 'ON_HOLD')
    when 'WAITING'         then new.state in ('WEIGHING', 'ON_HOLD', 'REJECTED')
    when 'WEIGHING'        then new.state in ('PROCUREMENT', 'ON_HOLD', 'REJECTED')
    when 'PROCUREMENT'     then new.state in ('PAYMENT_PENDING', 'COMPLETED')
    when 'PAYMENT_PENDING' then new.state in ('COMPLETED')
    when 'ON_HOLD'         then new.state in ('WAITING', 'CHECKED_IN', 'QUALITY_CHECK', 'REJECTED', 'CANCELLED')
    else false
  end;

  if not allowed then
    raise exception 'Invalid operation transition % -> %', old.state, new.state
      using errcode = 'check_violation';
  end if;

  if old.state = 'BOOKED' and new.state = 'ARRIVED' then
    select status into booking_state
    from public.bookings where id = new.booking_id
    for update;

    if booking_state is distinct from 'BOOKED' then
      raise exception 'Booking is %, it cannot be processed', booking_state
        using errcode = 'check_violation';
    end if;
  end if;

  -- Leaving the queue clears the farmer-visible queue figures, whichever path
  -- the farmer left by, so a stale "position 3" can never outlive the queue.
  if old.state = 'WAITING' then
    new.queue_position := null;
    new.estimated_wait_minutes := null;
  end if;

  return new;
end;
$$;

-- History rows now carry transition metadata (queue algorithm, rank, reasons).
create or replace function app.record_operation_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b record;
  actor uuid;
  procurement uuid;
begin
  if tg_op = 'INSERT' then
    return null;
  end if;

  if old.state is distinct from new.state then
    select id, status, centre_id, farmer_user_id into b
    from public.bookings where id = new.booking_id;

    select id into procurement from public.procurements where booking_id = new.booking_id;

    actor := app.transition_actor();

    insert into public.procurement_status_history (
      booking_id, centre_id, farmer_user_id, operation_id, procurement_id,
      from_status, to_status, from_state, to_state,
      changed_by_user_id, changed_by_role, reason, metadata
    ) values (
      new.booking_id, b.centre_id, b.farmer_user_id, new.id, procurement,
      app.farmer_status(b.status, old.state), app.farmer_status(b.status, new.state),
      old.state, new.state,
      actor, app.role_of(actor),
      nullif(current_setting('app.transition_reason', true), ''),
      nullif(current_setting('app.transition_metadata', true), '')::jsonb
    );

    if new.state = 'COMPLETED' then
      update public.procurements
      set completed_at = coalesce(completed_at, now())
      where booking_id = new.booking_id;
    end if;
  end if;

  if old.state is distinct from new.state
     or old.estimated_wait_minutes is distinct from new.estimated_wait_minutes
     or old.queue_updated_at is distinct from new.queue_updated_at
     or (new.queue_updated_at is not null and old.queue_position is distinct from new.queue_position) then
    update public.bookings
    set status_version = status_version + 1
    where id = new.booking_id;
  end if;

  return null;
end;
$$;

-- The transition function gains a metadata argument and claim fields.
drop function if exists public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb);

create or replace function public.transition_booking_operation(
  p_operation_id uuid,
  p_expected_from public.operation_state,
  p_to public.operation_state,
  p_actor uuid,
  p_reason text default null,
  p_patch jsonb default '{}'::jsonb,
  p_metadata jsonb default null
)
returns setof public.booking_operations
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.transition_reason', coalesce(p_reason, ''), true);
  perform set_config('app.transition_metadata', coalesce(p_metadata::text, ''), true);

  return query
  update public.booking_operations o
  set state          = p_to,
      session_id     = case when p_patch ? 'session_id'     then (p_patch->>'session_id')::uuid           else o.session_id end,
      arrived_at     = case when p_patch ? 'arrived_at'     then (p_patch->>'arrived_at')::timestamptz    else o.arrived_at end,
      arrived_by     = case when p_patch ? 'arrived_by'     then (p_patch->>'arrived_by')::uuid           else o.arrived_by end,
      checked_in_at  = case when p_patch ? 'checked_in_at'  then (p_patch->>'checked_in_at')::timestamptz else o.checked_in_at end,
      queue_position = case when p_patch ? 'queue_position' then (p_patch->>'queue_position')::integer    else o.queue_position end,
      crop_verified  = case when p_patch ? 'crop_verified'  then (p_patch->>'crop_verified')::boolean     else o.crop_verified end,
      crop_issue     = case when p_patch ? 'crop_issue'     then p_patch->>'crop_issue'                   else o.crop_issue end,
      hold_reason    = case when p_patch ? 'hold_reason'    then p_patch->>'hold_reason'                  else o.hold_reason end,
      claimed_by     = case when p_patch ? 'claimed_by'     then (p_patch->>'claimed_by')::uuid           else o.claimed_by end,
      claimed_at     = case when p_patch ? 'claimed_at'     then (p_patch->>'claimed_at')::timestamptz    else o.claimed_at end
  where o.id = p_operation_id
    and o.state = p_expected_from
  returning o.*;
end;
$$;

revoke all on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb, jsonb) from public;
revoke all on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb, jsonb) from anon, authenticated;
grant execute on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Workstations (§18)
-- ---------------------------------------------------------------------------

create table if not exists public.queue_workstations (
  id                  uuid primary key default gen_random_uuid(),
  centre_id           uuid not null references public.procurement_centres (id) on delete restrict,
  code                text not null,
  name                text not null,
  -- Crops this station can handle. EMPTY means every crop — a general line.
  crop_ids            uuid[] not null default '{}',
  status              text not null default 'AVAILABLE',
  current_booking_id  uuid references public.bookings (id) on delete set null,
  busy_since          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint queue_workstations_code_key unique (centre_id, code),
  constraint queue_workstations_status_known check (status in ('AVAILABLE', 'BUSY', 'OFFLINE')),
  constraint queue_workstations_busy_consistent
    check ((status = 'BUSY') = (current_booking_id is not null))
);

create index if not exists queue_workstations_centre_idx
  on public.queue_workstations (centre_id, status);

create trigger queue_workstations_touch_updated_at
  before update on public.queue_workstations
  for each row execute function app.touch_updated_at();

-- Two stations per active centre: a general line and a paddy-only line, so
-- compatibility is a real constraint from day one rather than vacuous.
insert into public.queue_workstations (centre_id, code, name, crop_ids)
select pc.id, 'WS-1', 'Weighbridge 1 (all crops)', '{}'::uuid[]
from public.procurement_centres pc
where pc.is_active
on conflict (centre_id, code) do nothing;

insert into public.queue_workstations (centre_id, code, name, crop_ids)
select pc.id, 'WS-2', 'Paddy line 2',
       coalesce((select array_agg(c.id order by c.code) from public.crops c where c.code like 'PADDY%'), '{}'::uuid[])
from public.procurement_centres pc
where pc.is_active
on conflict (centre_id, code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. AI quality predictions (§4, §31) — advisory, append-only
-- ---------------------------------------------------------------------------

create table if not exists public.quality_predictions (
  id                            uuid primary key default gen_random_uuid(),
  booking_id                    uuid not null references public.bookings (id) on delete restrict,
  centre_id                     uuid not null references public.procurement_centres (id) on delete restrict,
  crop_id                       uuid references public.crops (id) on delete restrict,

  image_bucket                  text,
  image_path                    text,

  -- COMPLETED: the model answered. UNAVAILABLE / FAILED / UNSUPPORTED_CROP:
  -- it did not, and the procurement continued manually (§33).
  assessment_status             text not null,

  quality_score                 numeric(5, 2),
  quality_risk                  text,
  confidence                    numeric(4, 3),
  manual_inspection_required    boolean,
  estimated_processing_minutes  numeric(6, 1),

  model_name                    text,
  model_version                 text,
  -- Where the model's training data came from. SYNTHETIC_DEVELOPMENT is
  -- shown to staff: this is not a validated grading model (§6, §45).
  training_data                 text,
  reason_codes                  jsonb not null default '[]'::jsonb,
  failure_reason                text,

  requested_by                  uuid references public.profiles (id) on delete set null,
  inference_at                  timestamptz,
  created_at                    timestamptz not null default now(),

  constraint quality_predictions_status_known
    check (assessment_status in ('COMPLETED', 'UNAVAILABLE', 'FAILED', 'UNSUPPORTED_CROP')),
  constraint quality_predictions_score_range
    check (quality_score is null or quality_score between 0 and 100),
  constraint quality_predictions_confidence_range
    check (confidence is null or confidence between 0 and 1),
  constraint quality_predictions_risk_known
    check (quality_risk is null or quality_risk in ('LOW', 'MEDIUM', 'HIGH')),
  constraint quality_predictions_completed_has_output
    check (assessment_status <> 'COMPLETED'
           or (quality_risk is not null and confidence is not null and model_version is not null))
);

create index if not exists quality_predictions_booking_idx
  on public.quality_predictions (booking_id, created_at desc);
create index if not exists quality_predictions_centre_idx
  on public.quality_predictions (centre_id, created_at desc);

create trigger quality_predictions_append_only
  before update or delete on public.quality_predictions
  for each row execute function app.forbid_mutation();

comment on table public.quality_predictions is
  'AI pre-quality assessments. Advisory only — the official quality decision is quality_assessments, made by staff. Never overwritten.';

-- ---------------------------------------------------------------------------
-- 4. Processing-time estimates (§8, §32) — append-only; latest row wins
-- ---------------------------------------------------------------------------

create table if not exists public.processing_estimates (
  id                          bigint generated always as identity primary key,
  booking_id                  uuid not null references public.bookings (id) on delete restrict,
  centre_id                   uuid not null references public.procurement_centres (id) on delete restrict,
  prediction_id               uuid references public.quality_predictions (id) on delete restrict,

  source                      text not null,
  estimated_minutes           numeric(6, 1) not null,
  lower_minutes               numeric(6, 1),
  upper_minutes               numeric(6, 1),
  confidence                  numeric(4, 3),
  model_version               text not null,
  inputs                      jsonb,

  -- A staff override keeps what it replaced (§32).
  original_estimate_minutes   numeric(6, 1),
  override_reason             text,

  created_by                  uuid references public.profiles (id) on delete set null,
  created_at                  timestamptz not null default now(),

  constraint processing_estimates_source_known
    check (source in ('DETERMINISTIC', 'MODEL', 'STAFF_OVERRIDE')),
  constraint processing_estimates_minutes_sane
    check (estimated_minutes > 0 and estimated_minutes <= 600),
  constraint processing_estimates_override_explained
    check (source <> 'STAFF_OVERRIDE'
           or (override_reason is not null and char_length(trim(override_reason)) >= 5))
);

create index if not exists processing_estimates_booking_idx
  on public.processing_estimates (booking_id, id desc);

create trigger processing_estimates_append_only
  before update or delete on public.processing_estimates
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 5. Queue entries (§27) — ordering metadata, not a lifecycle
-- ---------------------------------------------------------------------------

create table if not exists public.queue_entries (
  id                            uuid primary key default gen_random_uuid(),
  centre_id                     uuid not null references public.procurement_centres (id) on delete restrict,
  booking_id                    uuid not null references public.bookings (id) on delete restrict,
  operation_id                  uuid not null references public.booking_operations (id) on delete restrict,
  crop_id                       uuid references public.crops (id) on delete restrict,

  state                         text not null default 'QUEUED',
  -- When the farmer joined the queue. Preserved across hold/requeue: time
  -- already waited is not forfeited.
  entered_at                    timestamptz not null default now(),
  quantity_kg                   numeric(12, 3) not null,
  slot_end_at                   timestamptz,

  quality_result                text,
  quality_risk                  text,
  quality_confidence            numeric(4, 3),
  manual_inspection_required    boolean not null default false,
  prediction_id                 uuid references public.quality_predictions (id) on delete restrict,

  estimated_processing_minutes  numeric(6, 1),
  estimate_id                   bigint references public.processing_estimates (id) on delete restrict,

  -- Fairness penalty bookkeeping (§19), with decay.
  priority_advantage_count      integer not null default 0,
  last_advantage_at             timestamptz,

  -- Written only by apply_queue_snapshot.
  current_rank                  integer,
  estimated_wait_minutes        integer,
  final_priority                numeric(8, 6),
  is_protected                  boolean not null default false,
  eligible                      boolean,
  ineligible_reasons            jsonb not null default '[]'::jsonb,
  last_snapshot_id              uuid,

  workstation_id                uuid references public.queue_workstations (id) on delete set null,
  selected_at                   timestamptz,
  selected_by                   uuid references public.profiles (id) on delete set null,
  processed_at                  timestamptz,
  removed_at                    timestamptz,
  removed_by                    uuid references public.profiles (id) on delete set null,
  removed_reason                text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint queue_entries_booking_key unique (booking_id),
  constraint queue_entries_state_known
    check (state in ('QUEUED', 'SELECTED', 'PROCESSING', 'DONE', 'REMOVED'))
);

create index if not exists queue_entries_centre_state_idx on public.queue_entries (centre_id, state);
create index if not exists queue_entries_centre_entered_idx on public.queue_entries (centre_id, entered_at);

create trigger queue_entries_touch_updated_at
  before update on public.queue_entries
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Per-centre queue version (§49) — the concurrency control for recalcs
-- ---------------------------------------------------------------------------

create table if not exists public.queue_centre_state (
  centre_id             uuid primary key references public.procurement_centres (id) on delete cascade,
  -- Bumped on every change to queue INPUTS. A recalculation computed from
  -- version N may only be applied while the version is still N.
  version               bigint not null default 1,
  last_recalculated_at  timestamptz,
  last_snapshot_id      uuid,
  next_booking_id       uuid,
  updated_at            timestamptz not null default now()
);

create or replace function app.bump_queue_version(p_centre_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.queue_centre_state (centre_id, version)
  values (p_centre_id, 1)
  on conflict (centre_id) do update
    set version = public.queue_centre_state.version + 1,
        updated_at = now();
$$;

create or replace function app.queue_inputs_changed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.bump_queue_version(coalesce(new.centre_id, old.centre_id));
  return null;
end;
$$;

create trigger queue_entries_inputs_changed
  after insert or delete or update of state, estimated_processing_minutes, quality_risk,
    quality_confidence, manual_inspection_required, crop_id, entered_at
  on public.queue_entries
  for each row execute function app.queue_inputs_changed();

create trigger queue_workstations_inputs_changed
  after insert or delete or update of status, crop_ids, current_booking_id
  on public.queue_workstations
  for each row execute function app.queue_inputs_changed();

-- ---------------------------------------------------------------------------
-- 7. Snapshots, rankings, decisions (§29, §30) — the audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.queue_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  centre_id             uuid not null references public.procurement_centres (id) on delete restrict,
  generated_at          timestamptz not null default now(),
  trigger_type          text not null,
  algorithm_version     text not null,
  config_hash           text not null,
  config                jsonb not null,
  based_on_version      bigint not null,
  candidate_count       integer not null,
  eligible_count        integer not null,
  -- True when the published order differs from the previous snapshot's.
  reordered             boolean not null default false,
  next_booking_id       uuid references public.bookings (id) on delete restrict,
  selected_booking_id   uuid references public.bookings (id) on delete restrict
);

create index if not exists queue_snapshots_centre_idx
  on public.queue_snapshots (centre_id, generated_at desc);

create table if not exists public.queue_rankings (
  id                              bigint generated always as identity primary key,
  snapshot_id                     uuid not null references public.queue_snapshots (id) on delete restrict,
  centre_id                       uuid not null references public.procurement_centres (id) on delete restrict,
  booking_id                      uuid not null references public.bookings (id) on delete restrict,
  rank                            integer,
  eligible                        boolean not null,
  is_protected                    boolean not null default false,

  fairness_score                  numeric(8, 6),
  operational_efficiency_score    numeric(8, 6),
  urgency_score                   numeric(8, 6),
  fairness_penalty                numeric(8, 6),
  final_priority                  numeric(8, 6),

  wait_minutes                    numeric(8, 2),
  slot_lateness_minutes           numeric(8, 2),
  estimated_processing_minutes    numeric(6, 1),
  estimated_wait_minutes          integer,

  wait_score                      numeric(8, 6),
  slot_lateness_score             numeric(8, 6),
  aging_score                     numeric(8, 6),
  quality_readiness_score         numeric(8, 6),
  quality_confidence              numeric(4, 3),
  processing_fit_score            numeric(8, 6),
  workstation_fit_score           numeric(8, 6),

  reason_codes                    jsonb not null default '[]'::jsonb,
  created_at                      timestamptz not null default now()
);

create index if not exists queue_rankings_snapshot_idx on public.queue_rankings (snapshot_id, rank);
create index if not exists queue_rankings_booking_idx on public.queue_rankings (booking_id, id desc);

create table if not exists public.queue_decisions (
  id                  bigint generated always as identity primary key,
  centre_id           uuid not null references public.procurement_centres (id) on delete restrict,
  booking_id          uuid not null references public.bookings (id) on delete restrict,
  procurement_id      uuid references public.procurements (id) on delete restrict,
  snapshot_id         uuid references public.queue_snapshots (id) on delete restrict,
  workstation_id      uuid references public.queue_workstations (id) on delete restrict,

  -- SELECTED: the recommended NEXT. SELECTED_OVERRIDE: staff chose someone
  -- else, with a reason. REMOVED / REQUEUED: taken out of / put back in.
  decision            text not null,
  algorithm_version   text not null,
  selected_rank       integer,
  final_priority      numeric(8, 6),
  reason_codes        jsonb not null default '[]'::jsonb,
  score_breakdown     jsonb,
  note                text,

  decided_at          timestamptz not null default now(),
  decided_by_user_id  uuid references public.profiles (id) on delete set null,

  constraint queue_decisions_kind_known
    check (decision in ('SELECTED', 'SELECTED_OVERRIDE', 'REMOVED', 'REQUEUED')),
  constraint queue_decisions_override_explained
    check (decision not in ('SELECTED_OVERRIDE', 'REMOVED')
           or (note is not null and char_length(trim(note)) >= 5))
);

create index if not exists queue_decisions_centre_idx on public.queue_decisions (centre_id, decided_at desc);

create trigger queue_snapshots_append_only
  before update or delete on public.queue_snapshots
  for each row execute function app.forbid_mutation();
create trigger queue_rankings_append_only
  before update or delete on public.queue_rankings
  for each row execute function app.forbid_mutation();
create trigger queue_decisions_append_only
  before update or delete on public.queue_decisions
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 8. Leaving the queue or a workstation, whichever path it happens by
-- ---------------------------------------------------------------------------

create or replace function app.sync_queue_on_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.state is not distinct from new.state then
    return null;
  end if;

  -- Left the queue other than by being selected: no longer a candidate.
  if old.state = 'WAITING' and new.state <> 'WEIGHING' then
    update public.queue_entries
    set state = 'REMOVED', removed_at = now(), current_rank = null, estimated_wait_minutes = null
    where booking_id = new.booking_id and state = 'QUEUED';
  end if;

  -- Finished (or stopped) at the station: free it for the next farmer.
  if old.state in ('WEIGHING', 'PROCUREMENT') and new.state not in ('WEIGHING', 'PROCUREMENT') then
    update public.queue_entries
    set state = case when new.state in ('PAYMENT_PENDING', 'COMPLETED') then 'DONE' else 'REMOVED' end,
        processed_at = now()
    where booking_id = new.booking_id and state in ('SELECTED', 'PROCESSING');

    update public.queue_workstations
    set status = 'AVAILABLE', current_booking_id = null, busy_since = null
    where current_booking_id = new.booking_id and status = 'BUSY';
  end if;

  return null;
end;
$$;

create trigger booking_operations_sync_queue
  after update of state on public.booking_operations
  for each row execute function app.sync_queue_on_transition();

-- ---------------------------------------------------------------------------
-- 9. Applying a recalculation (§25, §26, §49)
--
-- Everything a recalculation writes lands in one transaction, serialised per
-- centre by an advisory lock, and only if the queue's inputs have not changed
-- since the ranking was computed. Returns null when they have: the caller
-- recomputes from fresh data instead of overwriting newer state.
-- ---------------------------------------------------------------------------

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
    wait_score, slot_lateness_score, aging_score, quality_readiness_score, quality_confidence,
    processing_fit_score, workstation_fit_score, reason_codes
  )
  select sid, p_centre_id, r."bookingId", r.rank, r.eligible, r."isProtected",
         r."fairnessScore", r."operationalEfficiencyScore", r."urgencyScore", r."fairnessPenalty", r."finalPriority",
         r."waitMinutes", r."slotLatenessMinutes", r."estimatedProcessingMinutes", r."estimatedWaitMinutes",
         r."waitScore", r."slotLatenessScore", r."agingScore", r."qualityReadinessScore", r."qualityConfidence",
         r."processingFitScore", r."workstationFitScore", coalesce(r."reasonCodes", '[]'::jsonb)
  from jsonb_to_recordset(p_rankings) as r(
    "bookingId" uuid, rank integer, eligible boolean, "isProtected" boolean,
    "fairnessScore" numeric, "operationalEfficiencyScore" numeric, "urgencyScore" numeric,
    "fairnessPenalty" numeric, "finalPriority" numeric,
    "waitMinutes" numeric, "slotLatenessMinutes" numeric, "estimatedProcessingMinutes" numeric,
    "estimatedWaitMinutes" integer,
    "waitScore" numeric, "slotLatenessScore" numeric, "agingScore" numeric,
    "qualityReadinessScore" numeric, "qualityConfidence" numeric,
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

-- ---------------------------------------------------------------------------
-- 10. Selecting the next farmer (§28) — revalidated at the moment of selection
-- ---------------------------------------------------------------------------

create or replace function public.select_queue_candidate(
  p_centre_id uuid,
  p_booking_id uuid,
  p_workstation_id uuid,
  p_actor uuid,
  p_decision text,
  p_note text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.queue_entries%rowtype;
  op public.booking_operations%rowtype;
  ws public.queue_workstations%rowtype;
  booking_state public.booking_status;
  quality text;
begin
  perform pg_advisory_xact_lock(hashtextextended('queue:' || p_centre_id::text, 0));

  select * into e from public.queue_entries
  where booking_id = p_booking_id and centre_id = p_centre_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_IN_QUEUE');
  end if;
  if e.state <> 'QUEUED' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SELECTED');
  end if;

  select * into op from public.booking_operations where id = e.operation_id for update;
  if op.state <> 'WAITING' then
    return jsonb_build_object('ok', false, 'code', 'NOT_WAITING');
  end if;

  select status into booking_state from public.bookings where id = p_booking_id;
  if booking_state is distinct from 'BOOKED' then
    return jsonb_build_object('ok', false, 'code', 'BOOKING_NOT_ACTIVE');
  end if;

  select result::text into quality from public.quality_assessments
  where booking_id = p_booking_id order by assessed_at desc limit 1;
  if quality is null or quality = 'FAILED' then
    return jsonb_build_object('ok', false, 'code', 'QUALITY_NOT_READY');
  end if;

  if e.estimated_processing_minutes is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PROCESSING_ESTIMATE');
  end if;

  select * into ws from public.queue_workstations
  where id = p_workstation_id and centre_id = p_centre_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'WORKSTATION_NOT_FOUND');
  end if;
  if ws.status <> 'AVAILABLE' then
    return jsonb_build_object('ok', false, 'code', 'WORKSTATION_NOT_AVAILABLE');
  end if;
  if cardinality(ws.crop_ids) > 0 and (e.crop_id is null or not (e.crop_id = any (ws.crop_ids))) then
    return jsonb_build_object('ok', false, 'code', 'WORKSTATION_INCOMPATIBLE');
  end if;

  -- The Phase 6 transition: IN_QUEUE -> PROCUREMENT, with its history row
  -- carrying the queue decision (§42).
  perform set_config('app.actor_id', p_actor::text, true);
  perform set_config('app.transition_reason', coalesce(p_note, ''), true);
  perform set_config('app.transition_metadata', coalesce(p_metadata::text, ''), true);

  update public.booking_operations
  set state = 'WEIGHING', claimed_by = p_actor, claimed_at = now(), queue_updated_at = now()
  where id = op.id and state = 'WAITING';

  update public.queue_entries
  set state = 'PROCESSING', selected_at = now(), selected_by = p_actor,
      workstation_id = p_workstation_id, current_rank = null, estimated_wait_minutes = null
  where id = e.id;

  update public.queue_workstations
  set status = 'BUSY', current_booking_id = p_booking_id, busy_since = now()
  where id = ws.id;

  insert into public.queue_decisions (
    centre_id, booking_id, snapshot_id, workstation_id, decision, algorithm_version,
    selected_rank, final_priority, reason_codes, score_breakdown, note, decided_by_user_id
  ) values (
    p_centre_id, p_booking_id, e.last_snapshot_id, ws.id, p_decision,
    coalesce(p_metadata->>'queueAlgorithmVersion', 'unknown'),
    e.current_rank, e.final_priority,
    coalesce(p_metadata->'selectionReasonCodes', '[]'::jsonb),
    p_metadata->'scoreBreakdown', p_note, p_actor
  );

  return jsonb_build_object('ok', true, 'rank', e.current_rank);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Taking a farmer out of the queue, and putting them back
-- ---------------------------------------------------------------------------

create or replace function public.remove_queue_candidate(
  p_centre_id uuid,
  p_booking_id uuid,
  p_actor uuid,
  p_note text,
  p_algorithm_version text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.queue_entries%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('queue:' || p_centre_id::text, 0));

  select * into e from public.queue_entries
  where booking_id = p_booking_id and centre_id = p_centre_id
  for update;

  if not found or e.state <> 'QUEUED' then
    return jsonb_build_object('ok', false, 'code', 'NOT_IN_QUEUE');
  end if;

  perform set_config('app.actor_id', p_actor::text, true);
  perform set_config('app.transition_reason', coalesce(p_note, ''), true);

  update public.booking_operations
  set state = 'ON_HOLD', hold_reason = p_note
  where id = e.operation_id and state = 'WAITING';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_WAITING');
  end if;

  update public.queue_entries
  set removed_by = p_actor, removed_reason = p_note
  where id = e.id;

  insert into public.queue_decisions (
    centre_id, booking_id, snapshot_id, decision, algorithm_version, selected_rank, note, decided_by_user_id
  ) values (
    p_centre_id, p_booking_id, e.last_snapshot_id, 'REMOVED', p_algorithm_version, e.current_rank, p_note, p_actor
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.requeue_candidate(
  p_centre_id uuid,
  p_booking_id uuid,
  p_actor uuid,
  p_algorithm_version text
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.queue_entries%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('queue:' || p_centre_id::text, 0));

  select * into e from public.queue_entries
  where booking_id = p_booking_id and centre_id = p_centre_id
  for update;

  if not found or e.state <> 'REMOVED' then
    return jsonb_build_object('ok', false, 'code', 'NOT_REMOVED');
  end if;

  perform set_config('app.actor_id', p_actor::text, true);

  update public.booking_operations
  set state = 'WAITING', hold_reason = null
  where id = e.operation_id and state = 'ON_HOLD';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_ON_HOLD');
  end if;

  -- entered_at is kept: the time already waited still counts (§13, §22).
  update public.queue_entries
  set state = 'QUEUED', removed_at = null, removed_by = null, removed_reason = null
  where id = e.id;

  insert into public.queue_decisions (
    centre_id, booking_id, decision, algorithm_version, decided_by_user_id
  ) values (
    p_centre_id, p_booking_id, 'REQUEUED', p_algorithm_version, p_actor
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- Service role only, like transition_booking_operation.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.apply_queue_snapshot(uuid, bigint, jsonb, jsonb, jsonb)',
    'public.select_queue_candidate(uuid, uuid, uuid, uuid, text, text, jsonb)',
    'public.remove_queue_candidate(uuid, uuid, uuid, text, text)',
    'public.requeue_candidate(uuid, uuid, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. RLS — staff read their own centre; nobody writes from a browser
-- ---------------------------------------------------------------------------

alter table public.queue_workstations   enable row level security;
alter table public.quality_predictions  enable row level security;
alter table public.processing_estimates enable row level security;
alter table public.queue_entries        enable row level security;
alter table public.queue_centre_state   enable row level security;
alter table public.queue_snapshots      enable row level security;
alter table public.queue_rankings       enable row level security;
alter table public.queue_decisions      enable row level security;

create policy queue_workstations_select_staff on public.queue_workstations
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy quality_predictions_select_staff on public.quality_predictions
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy processing_estimates_select_staff on public.processing_estimates
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy queue_entries_select_staff on public.queue_entries
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy queue_centre_state_select_staff on public.queue_centre_state
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy queue_snapshots_select_staff on public.queue_snapshots
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy queue_rankings_select_staff on public.queue_rankings
  for select to authenticated using (app.is_centre_staff_of(centre_id));
create policy queue_decisions_select_staff on public.queue_decisions
  for select to authenticated using (app.is_centre_staff_of(centre_id));

-- ---------------------------------------------------------------------------
-- 13. Produce photos — private bucket, staff of the centre only
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produce-photos', 'produce-photos', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path: <centre_id>/<booking_id>/<file>. The first segment decides access.
create policy produce_photos_select_centre_staff
  on storage.objects for select to authenticated
  using (
    bucket_id = 'produce-photos'
    and app.is_centre_staff_of(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 14. Realtime — staff follow their centre's queue through this one row
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_centre_state'
     ) then
    alter publication supabase_realtime add table public.queue_centre_state;
  end if;
end $$;
