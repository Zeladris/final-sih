-- ===========================================================================
-- Phase 6 / 0014 — live procurement status
--
-- ONE SOURCE OF TRUTH. Phase 5 already keeps the authoritative operational
-- state in booking_operations.state. Phase 6 does NOT add a competing status
-- column that code must keep in step. Instead:
--
--   * app.farmer_status() maps (booking status, operational state) onto the
--     farmer-facing vocabulary (SLOT_BOOKED … COMPLETED). The same mapping
--     exists in packages/shared/src/procurementStatus.ts.
--   * bookings.procurement_status is a PROJECTION of that mapping, written only
--     by a trigger in the same transaction as the change that caused it. It
--     exists for fast reads and as the realtime signal; it is never supplied by
--     application code.
--   * procurement_status_history gets a row for every transition, written by
--     trigger in the same transaction as the transition, so current status and
--     history cannot disagree (§12).
--
-- The operational transition rules, previously only in TypeScript, are now
-- also enforced here, so no code path can skip a step (§4).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The farmer-facing vocabulary (§4, §5)
-- ---------------------------------------------------------------------------

create or replace function app.farmer_status(
  p_booking_status public.booking_status,
  p_state public.operation_state
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_booking_status = 'CANCELLED' then 'CANCELLED'
    when p_booking_status = 'NO_SHOW'   then 'MISSED'
    when p_state is null or p_state = 'BOOKED'      then 'SLOT_BOOKED'
    when p_state in ('ARRIVED', 'CHECKED_IN')       then 'ARRIVED'
    when p_state = 'WAITING'                        then 'IN_QUEUE'
    when p_state = 'QUALITY_CHECK'                  then 'QUALITY_CHECK'
    when p_state in ('WEIGHING', 'PROCUREMENT')     then 'PROCUREMENT'
    when p_state = 'PAYMENT_PENDING'                then 'PAYMENT'
    when p_state = 'COMPLETED'                      then 'COMPLETED'
    when p_state = 'ON_HOLD'                        then 'ON_HOLD'
    when p_state = 'REJECTED'                       then 'NOT_ACCEPTED'
    when p_state = 'CANCELLED'                      then 'CANCELLED'
  end;
$$;

comment on function app.farmer_status(public.booking_status, public.operation_state) is
  'Maps the authoritative booking status + operational state onto the farmer-facing status. Mirrors farmerStatusOf() in packages/shared — change both together.';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists procurement_status text not null default 'SLOT_BOOKED',
  -- Monotonic. Bumped on every farmer-visible change so a client can discard a
  -- duplicate or out-of-order realtime event (§17).
  add column if not exists status_version bigint not null default 1,
  add column if not exists status_updated_at timestamptz not null default now();

do $$ begin
  alter table public.bookings
    add constraint bookings_procurement_status_known check (procurement_status in (
      'SLOT_BOOKED', 'ARRIVED', 'IN_QUEUE', 'QUALITY_CHECK', 'PROCUREMENT', 'PAYMENT',
      'COMPLETED', 'ON_HOLD', 'NOT_ACCEPTED', 'CANCELLED', 'MISSED'
    ));
exception when duplicate_object then null; end $$;

-- Phase 7 queue contract (§20). Phase 5's queue_position is an arrival token
-- that never decreases, so it is NOT shown to farmers as a position. Queue
-- figures become farmer-visible only once the queue module stamps
-- queue_updated_at — until then the API returns null rather than a guess.
alter table public.booking_operations
  add column if not exists estimated_wait_minutes integer,
  add column if not exists queue_updated_at timestamptz;

do $$ begin
  alter table public.booking_operations
    add constraint booking_operations_wait_sane
      check (estimated_wait_minutes is null or estimated_wait_minutes between 0 and 1440);
exception when duplicate_object then null; end $$;

alter table public.procurements
  add column if not exists completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Backfill the projection for bookings that already exist.
-- updated_at is left untouched: it is a real timestamp, not ours to rewrite.
-- ---------------------------------------------------------------------------

alter table public.bookings disable trigger bookings_touch_updated_at;

update public.bookings b
set procurement_status = app.farmer_status(b.status, o.state),
    status_updated_at  = greatest(b.updated_at, coalesce(o.updated_at, b.updated_at))
from public.bookings b2
left join public.booking_operations o on o.booking_id = b2.id
where b2.id = b.id;

alter table public.bookings enable trigger bookings_touch_updated_at;

update public.procurements p
set completed_at = pay.completed_at
from public.booking_operations o, public.payments pay
where o.id = p.operation_id
  and o.state = 'COMPLETED'
  and pay.procurement_id = p.id
  and p.completed_at is null;

-- ---------------------------------------------------------------------------
-- Status history (§7) — append-only
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_status_history (
  id                  bigint generated always as identity primary key,
  booking_id          uuid not null references public.bookings (id) on delete restrict,
  -- Denormalised for RLS, so a policy never needs a join.
  centre_id           uuid not null references public.procurement_centres (id) on delete restrict,
  farmer_user_id      uuid not null references public.farmer_profiles (user_id) on delete restrict,
  operation_id        uuid references public.booking_operations (id) on delete restrict,
  procurement_id      uuid references public.procurements (id) on delete restrict,

  from_status         text,
  to_status           text not null,
  -- The operational detail behind the farmer-facing step, for staff,
  -- debugging and time-in-stage reporting.
  from_state          public.operation_state,
  to_state            public.operation_state,

  -- No FK: this is a historical fact that must survive the account.
  changed_by_user_id  uuid,
  changed_by_role     text not null,
  reason              text,
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists procurement_status_history_booking_idx
  on public.procurement_status_history (booking_id, id);
create index if not exists procurement_status_history_centre_idx
  on public.procurement_status_history (centre_id, created_at desc);

comment on table public.procurement_status_history is
  'Every status transition of a booking, written by trigger in the same transaction as the transition. Append-only: updates and deletes are refused.';

create or replace function app.forbid_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'procurement_status_history is append-only'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger procurement_status_history_append_only
  before update or delete on public.procurement_status_history
  for each row execute function app.forbid_history_mutation();

alter table public.procurement_status_history enable row level security;
alter table public.procurement_status_history force row level security;

-- Reads only. Nobody — farmer, staff or browser — gets a write policy.
create policy procurement_status_history_select
  on public.procurement_status_history for select to authenticated
  using (
    farmer_user_id = (select auth.uid())
    or app.is_centre_staff_of(centre_id)
  );

-- ---------------------------------------------------------------------------
-- Who made the change
--
-- Transitions run under the service role, where auth.uid() is null. The actor
-- is passed as a TRANSACTION-LOCAL setting by public.transition_booking_operation,
-- so it can never leak into a later, unrelated change.
-- ---------------------------------------------------------------------------

create or replace function app.transition_actor()
returns uuid
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select nullif(current_setting('app.actor_id', true), '')::uuid;
$$;

create or replace function app.role_of(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select role::text from public.profiles where id = p_user_id), 'SYSTEM');
$$;

-- ---------------------------------------------------------------------------
-- Operational transition guard (§4)
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
    when 'CHECKED_IN'      then new.state in ('WAITING', 'ON_HOLD', 'REJECTED')
    when 'WAITING'         then new.state in ('QUALITY_CHECK', 'ON_HOLD', 'REJECTED')
    when 'QUALITY_CHECK'   then new.state in ('WEIGHING', 'REJECTED', 'ON_HOLD')
    when 'WEIGHING'        then new.state in ('PROCUREMENT', 'ON_HOLD', 'REJECTED')
    when 'PROCUREMENT'     then new.state in ('PAYMENT_PENDING', 'COMPLETED')
    when 'PAYMENT_PENDING' then new.state in ('COMPLETED')
    when 'ON_HOLD'         then new.state in ('WAITING', 'CHECKED_IN', 'REJECTED', 'CANCELLED')
    else false
  end;

  if not allowed then
    raise exception 'Invalid operation transition % -> %', old.state, new.state
      using errcode = 'check_violation';
  end if;

  -- A cancelled booking cannot start being processed. Locked, so a farmer's
  -- cancellation and a staff arrival racing each other cannot both win.
  if old.state = 'BOOKED' and new.state = 'ARRIVED' then
    select status into booking_state
    from public.bookings where id = new.booking_id
    for update;

    if booking_state is distinct from 'BOOKED' then
      raise exception 'Booking is %, it cannot be processed', booking_state
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function app.assert_operation_transition() is
  'Enforces the operational state machine in the database, so no code path can skip a step or move a terminal record.';

create trigger booking_operations_a_assert_transition
  before insert or update of state on public.booking_operations
  for each row execute function app.assert_operation_transition();

-- ---------------------------------------------------------------------------
-- The projection on bookings
-- ---------------------------------------------------------------------------

create or replace function app.project_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  op_state public.operation_state;
  next_status text;
begin
  select state into op_state
  from public.booking_operations
  where booking_id = new.id;

  -- Once the centre has started, the booking is no longer the farmer's to
  -- cancel. Checked here as well as in the API, under a lock, so the race with
  -- a staff "arrived" cannot slip between the two checks (§22).
  if tg_op = 'UPDATE'
     and new.status = 'CANCELLED' and old.status <> 'CANCELLED'
     and op_state is not null and op_state <> 'BOOKED' then
    raise exception 'Booking is already being processed and cannot be cancelled'
      using errcode = 'check_violation';
  end if;

  next_status := app.farmer_status(new.status, op_state);

  if tg_op = 'INSERT' then
    new.procurement_status := next_status;
    new.status_version     := 1;
    new.status_updated_at  := now();
    return new;
  end if;

  -- A version bump requested by the operations trigger, or a real change of
  -- farmer-facing status, advances the version. Anything else leaves all
  -- three columns exactly as they were: they are derived, never supplied.
  if next_status is distinct from old.procurement_status
     or new.status_version <> old.status_version then
    new.procurement_status := next_status;
    new.status_version     := old.status_version + 1;
    new.status_updated_at  := now();
  else
    new.procurement_status := old.procurement_status;
    new.status_version     := old.status_version;
    new.status_updated_at  := old.status_updated_at;
  end if;

  return new;
end;
$$;

comment on function app.project_booking_status() is
  'Derives bookings.procurement_status from the authoritative booking + operation state and advances status_version on every farmer-visible change.';

-- Named to sort after bookings_protect_fields: same-timing triggers fire in
-- name order, and the guard must pin client writes before this derives.
create trigger bookings_z_project_status
  before insert or update on public.bookings
  for each row execute function app.project_booking_status();

-- Pin the projection for non-service-role writers, alongside the Phase 4 guard.
create or replace function app.protect_booking_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.booking_reference  := old.booking_reference;
    new.farmer_user_id     := old.farmer_user_id;
    new.slot_id            := old.slot_id;
    new.centre_id          := old.centre_id;
    new.crop_id            := old.crop_id;
    new.status             := old.status;
    new.idempotency_key    := old.idempotency_key;
    new.procurement_status := old.procurement_status;
    new.status_version     := old.status_version;
    new.status_updated_at  := old.status_updated_at;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- History writers
-- ---------------------------------------------------------------------------

/** Booking created, cancelled or marked no-show. */
create or replace function app.record_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.procurement_status_history (
      booking_id, centre_id, farmer_user_id, from_status, to_status, to_state,
      changed_by_user_id, changed_by_role
    ) values (
      new.id, new.centre_id, new.farmer_user_id, null, new.procurement_status, 'BOOKED',
      new.farmer_user_id, app.role_of(new.farmer_user_id)
    );
    return null;
  end if;

  -- Operational moves are recorded by the operations trigger; this records
  -- only changes that originate on the booking itself.
  if old.status is distinct from new.status
     and old.procurement_status is distinct from new.procurement_status then
    actor := coalesce(app.transition_actor(), new.cancelled_by);

    insert into public.procurement_status_history (
      booking_id, centre_id, farmer_user_id, from_status, to_status,
      changed_by_user_id, changed_by_role, reason
    ) values (
      new.id, new.centre_id, new.farmer_user_id, old.procurement_status, new.procurement_status,
      actor, app.role_of(actor),
      case when new.status = 'CANCELLED' then new.cancellation_reason end
    );
  end if;

  return null;
end;
$$;

create trigger bookings_record_status
  after insert or update of status on public.bookings
  for each row execute function app.record_booking_status();

/** Every operational transition, and queue updates that farmers can see. */
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
      changed_by_user_id, changed_by_role, reason
    ) values (
      new.booking_id, b.centre_id, b.farmer_user_id, new.id, procurement,
      app.farmer_status(b.status, old.state), app.farmer_status(b.status, new.state),
      old.state, new.state,
      actor, app.role_of(actor),
      nullif(current_setting('app.transition_reason', true), '')
    );

    if new.state = 'COMPLETED' then
      update public.procurements
      set completed_at = coalesce(completed_at, now())
      where booking_id = new.booking_id;
    end if;
  end if;

  -- Signal the farmer on any change they can see: a new step, or new queue
  -- figures from the queue module (§20). The projection trigger does the rest.
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

create trigger booking_operations_record_transition
  after update on public.booking_operations
  for each row execute function app.record_operation_transition();

-- ---------------------------------------------------------------------------
-- The one way application code moves an operation (§11, §12)
--
-- Validate, update, record history — one transaction. The expected-from state
-- is the concurrency control: a losing race updates nothing and returns no
-- row, which the API reports as a conflict.
--
-- In `public` so PostgREST can reach it, but executable by the service role
-- ONLY. A browser holding the anon key cannot call it.
-- ---------------------------------------------------------------------------

create or replace function public.transition_booking_operation(
  p_operation_id uuid,
  p_expected_from public.operation_state,
  p_to public.operation_state,
  p_actor uuid,
  p_reason text default null,
  p_patch jsonb default '{}'::jsonb
)
returns setof public.booking_operations
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.transition_reason', coalesce(p_reason, ''), true);

  return query
  update public.booking_operations o
  set state         = p_to,
      session_id    = case when p_patch ? 'session_id'    then (p_patch->>'session_id')::uuid           else o.session_id end,
      arrived_at    = case when p_patch ? 'arrived_at'    then (p_patch->>'arrived_at')::timestamptz    else o.arrived_at end,
      arrived_by    = case when p_patch ? 'arrived_by'    then (p_patch->>'arrived_by')::uuid           else o.arrived_by end,
      checked_in_at = case when p_patch ? 'checked_in_at' then (p_patch->>'checked_in_at')::timestamptz else o.checked_in_at end,
      queue_position = case when p_patch ? 'queue_position' then (p_patch->>'queue_position')::integer else o.queue_position end,
      crop_verified = case when p_patch ? 'crop_verified' then (p_patch->>'crop_verified')::boolean     else o.crop_verified end,
      crop_issue    = case when p_patch ? 'crop_issue'    then p_patch->>'crop_issue'                   else o.crop_issue end,
      hold_reason   = case when p_patch ? 'hold_reason'   then p_patch->>'hold_reason'                  else o.hold_reason end
  where o.id = p_operation_id
    and o.state = p_expected_from
  returning o.*;
end;
$$;

comment on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb) is
  'Service-role only. Moves one operation from an expected state, attributing the change to p_actor; the history row is written by trigger in the same transaction.';

revoke all on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb) from public;
revoke all on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb) from anon, authenticated;
grant execute on function public.transition_booking_operation(uuid, public.operation_state, public.operation_state, uuid, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill history for bookings that predate this migration.
--
-- Only real, recorded timestamps are used, and every row says it was
-- backfilled — nothing here pretends to have been observed live (§26).
-- ---------------------------------------------------------------------------

insert into public.procurement_status_history (
  booking_id, centre_id, farmer_user_id, from_status, to_status, to_state,
  changed_by_user_id, changed_by_role, metadata, created_at
)
select b.id, b.centre_id, b.farmer_user_id, null, 'SLOT_BOOKED', 'BOOKED',
       b.farmer_user_id, app.role_of(b.farmer_user_id),
       jsonb_build_object('backfilled', true), b.created_at
from public.bookings b
where not exists (
  select 1 from public.procurement_status_history h where h.booking_id = b.id
);

insert into public.procurement_status_history (
  booking_id, centre_id, farmer_user_id, operation_id, from_status, to_status, to_state,
  changed_by_role, metadata, created_at
)
select b.id, b.centre_id, b.farmer_user_id, o.id, 'SLOT_BOOKED', b.procurement_status, o.state,
       'SYSTEM', jsonb_build_object('backfilled', true),
       coalesce(o.updated_at, b.updated_at)
from public.bookings b
join public.booking_operations o on o.booking_id = b.id
where b.procurement_status <> 'SLOT_BOOKED'
  and b.status <> 'CANCELLED';

insert into public.procurement_status_history (
  booking_id, centre_id, farmer_user_id, from_status, to_status,
  changed_by_user_id, changed_by_role, reason, metadata, created_at
)
select b.id, b.centre_id, b.farmer_user_id, 'SLOT_BOOKED', 'CANCELLED',
       b.cancelled_by, app.role_of(b.cancelled_by), b.cancellation_reason,
       jsonb_build_object('backfilled', true), coalesce(b.cancelled_at, b.updated_at)
from public.bookings b
where b.status = 'CANCELLED';

-- ---------------------------------------------------------------------------
-- Realtime (§9, §10)
--
-- Only `bookings` is published. Supabase Realtime evaluates the table's RLS
-- for each subscriber, and bookings_select limits a farmer to their own rows —
-- there is no global stream of everyone's bookings.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
     ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;
