-- ===========================================================================
-- Phase 12 / 0018 — district & state admin analytics
--
-- The dashboards READ what Phases 1–8 persist; nothing here duplicates an
-- operational record. Two additions only:
--
--   1. A per-centre ACTIVITY SIGNAL — a counter bumped by material events
--      (arrival, queue movement, procurement, payment, session change). Admin
--      browsers subscribe to it through Realtime; RLS delivers only centres
--      inside the admin's own district/state. It carries no personal data and
--      no figures: it only says "something changed at centre X, refresh".
--   2. Indexes for the date-bounded aggregation queries.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Scope helper
-- ---------------------------------------------------------------------------

create or replace function app.admin_can_see_centre(p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case app.user_role()
    when 'DISTRICT_ADMIN' then app.district_of_centre(p_centre_id) = app.admin_district_id()
    when 'STATE_ADMIN'    then app.state_of_district(app.district_of_centre(p_centre_id)) = app.admin_state_id()
    else false
  end;
$$;

comment on function app.admin_can_see_centre(uuid) is
  'SECURITY DEFINER. True when the calling district admin''s district, or state admin''s state, contains the centre. Scope comes from the admin profile, never from a request.';

revoke all on function app.admin_can_see_centre(uuid) from public;
grant execute on function app.admin_can_see_centre(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Activity signal
-- ---------------------------------------------------------------------------

create table if not exists public.centre_activity_signals (
  centre_id   uuid primary key references public.procurement_centres (id) on delete cascade,
  version     bigint not null default 1,
  last_event  text not null,
  updated_at  timestamptz not null default now()
);

comment on table public.centre_activity_signals is
  'Realtime refresh signal for admin dashboards. A counter per centre, bumped by material operational events. Holds no personal data and no figures.';

create or replace function app.bump_centre_activity(p_centre_id uuid, p_event text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.centre_activity_signals (centre_id, version, last_event)
  values (p_centre_id, 1, p_event)
  on conflict (centre_id) do update
    set version = public.centre_activity_signals.version + 1,
        last_event = excluded.last_event,
        updated_at = now();
$$;

create or replace function app.signal_operation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.state is not distinct from new.state then
    return null;
  end if;
  perform app.bump_centre_activity(new.centre_id, 'OPERATION_' || new.state::text);
  return null;
end;
$$;

create trigger booking_operations_signal_activity
  after insert or update of state on public.booking_operations
  for each row execute function app.signal_operation_change();

create or replace function app.signal_payment_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  perform app.bump_centre_activity(new.centre_id, 'PAYMENT_' || new.status::text);
  return null;
end;
$$;

create trigger payments_signal_activity
  after insert or update of status on public.payments
  for each row execute function app.signal_payment_change();

create or replace function app.signal_session_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  perform app.bump_centre_activity(new.centre_id, 'SESSION_' || new.status::text);
  return null;
end;
$$;

create trigger procurement_sessions_signal_activity
  after insert or update of status on public.procurement_sessions
  for each row execute function app.signal_session_change();

alter table public.centre_activity_signals enable row level security;

create policy centre_activity_signals_select on public.centre_activity_signals
  for select to authenticated
  using (app.admin_can_see_centre(centre_id) or app.is_centre_staff_of(centre_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'centre_activity_signals'
     ) then
    alter publication supabase_realtime add table public.centre_activity_signals;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Indexes for date-bounded, centre-scoped aggregation
-- ---------------------------------------------------------------------------

create index if not exists booking_operations_centre_arrived_idx
  on public.booking_operations (centre_id, arrived_at);
create index if not exists quality_assessments_booking_idx
  on public.quality_assessments (booking_id);
create index if not exists farmer_profiles_district_status_idx
  on public.farmer_profiles (district_id, registration_status);
create index if not exists procurement_sessions_centre_date_idx
  on public.procurement_sessions (centre_id, session_date);
create index if not exists queue_decisions_centre_decided_idx
  on public.queue_decisions (centre_id, decided_at);
