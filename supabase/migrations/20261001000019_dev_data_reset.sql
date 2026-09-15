-- ===========================================================================
-- Phase 13 / 0019 — development data reset
--
-- A demo/development project needs one reliable way to return to a known
-- state. Doing that from the outside is not possible: history tables are
-- append-only and several links are ON DELETE RESTRICT, both deliberately, so
-- even the service role cannot (and must not) wipe them row by row.
--
-- So the capability lives here, where it can be fenced in:
--
--   * OFF BY DEFAULT. app.environment_flags.allow_data_reset is false. A
--     production database simply never turns it on, and the function refuses.
--   * The flag lives in the `app` schema, which PostgREST does not expose, so
--     it cannot be flipped through the API by anyone — only in SQL, by an
--     operator with database access.
--   * EXECUTE is granted to service_role only; anon and authenticated are
--     revoked, so no signed-in user can call it.
--   * It deletes accounts and activity only. Reference/configuration data
--     (states, districts, centres, crops, workstations, rates, document
--     requirements) is left alone.
-- ===========================================================================

create table if not exists app.environment_flags (
  id                boolean primary key default true,
  allow_data_reset  boolean not null default false,
  note              text,
  updated_at        timestamptz not null default now(),
  constraint environment_flags_single_row check (id)
);

comment on table app.environment_flags is
  'Per-database switches an operator sets in SQL. Not reachable through PostgREST: the app schema is not exposed.';

insert into app.environment_flags (id, allow_data_reset, note)
values (true, false, 'Set allow_data_reset = true ONLY on a development or demo database.')
on conflict (id) do nothing;

/**
 * Toggles the reset flag from application code (the `reset:demo` script),
 * without needing direct SQL access each time. Still requires an operator to
 * have set up service-role credentials in the first place — this is not
 * reachable with the anon key.
 */
create or replace function public.dev_set_reset_flag(p_allowed boolean)
returns void
language sql
security definer
set search_path = app, pg_temp
as $$
  update app.environment_flags set allow_data_reset = p_allowed, updated_at = now() where id;
$$;

comment on function public.dev_set_reset_flag(boolean) is
  'DEVELOPMENT ONLY. Arms/disarms public.dev_reset_all_data(). Executable by service_role only.';

revoke all on function public.dev_set_reset_flag(boolean) from public;
revoke all on function public.dev_set_reset_flag(boolean) from anon;
revoke all on function public.dev_set_reset_flag(boolean) from authenticated;
grant execute on function public.dev_set_reset_flag(boolean) to service_role;

create or replace function public.dev_reset_all_data()
returns jsonb
language plpgsql
security definer
set search_path = public, app, auth, pg_temp
as $$
declare
  allowed boolean;
  removed_users integer;
begin
  select f.allow_data_reset into allowed from app.environment_flags f where f.id;

  if not coalesce(allowed, false) then
    raise exception
      'Data reset is disabled on this database. An operator must run: update app.environment_flags set allow_data_reset = true;'
      using errcode = 'insufficient_privilege';
  end if;

  -- Append-only history guards and projection triggers are correct in normal
  -- operation and would block or distort a wipe. Foreign keys are system
  -- triggers and stay enforced, so a missed dependency aborts the whole
  -- function rather than leaving orphans behind.
  alter table public.queue_workstations          disable trigger user;
  alter table public.queue_decisions             disable trigger user;
  alter table public.queue_rankings              disable trigger user;
  alter table public.queue_centre_state          disable trigger user;
  alter table public.queue_snapshots             disable trigger user;
  alter table public.queue_entries               disable trigger user;
  alter table public.processing_estimates        disable trigger user;
  alter table public.quality_predictions         disable trigger user;
  alter table public.notifications               disable trigger user;
  alter table public.payment_status_history      disable trigger user;
  alter table public.payment_attempts            disable trigger user;
  alter table public.payments                    disable trigger user;
  alter table public.procurement_status_history  disable trigger user;
  alter table public.procurements                disable trigger user;
  alter table public.weighing_records            disable trigger user;
  alter table public.quality_assessments         disable trigger user;
  alter table public.booking_operations          disable trigger user;
  alter table public.bookings                    disable trigger user;
  alter table public.procurement_sessions        disable trigger user;
  alter table public.procurement_slots           disable trigger user;
  alter table public.centre_activity_signals     disable trigger user;
  alter table public.farmer_verification_checks  disable trigger user;
  alter table public.farmer_documents            disable trigger user;
  alter table public.farmer_land_holdings        disable trigger user;
  alter table public.farmer_profiles             disable trigger user;
  alter table public.staff_profiles              disable trigger user;
  alter table public.district_admin_profiles     disable trigger user;
  alter table public.state_admin_profiles        disable trigger user;
  alter table public.audit_logs                  disable trigger user;
  alter table public.profiles                    disable trigger user;
  alter table public.msp_rates                   disable trigger user;

  -- A BUSY station holds a booking, and the check constraint ties the two
  -- together, so stations are freed before bookings go.
  update public.queue_workstations
  set status = 'AVAILABLE', current_booking_id = null, busy_since = null
  where status = 'BUSY' or current_booking_id is not null;

  delete from public.queue_decisions;
  delete from public.queue_rankings;
  delete from public.queue_centre_state;
  delete from public.queue_snapshots;
  delete from public.queue_entries;
  delete from public.processing_estimates;
  delete from public.quality_predictions;

  delete from public.notifications;
  delete from public.payment_status_history;
  delete from public.payment_attempts;
  delete from public.payments;

  delete from public.procurement_status_history;
  delete from public.procurements;
  delete from public.weighing_records;
  delete from public.quality_assessments;
  delete from public.booking_operations;
  delete from public.bookings;
  delete from public.procurement_sessions;
  delete from public.procurement_slots;
  delete from public.centre_activity_signals;

  delete from public.farmer_verification_checks;
  delete from public.farmer_documents;
  delete from public.farmer_land_holdings;
  delete from public.farmer_profiles;

  delete from public.staff_profiles;
  delete from public.district_admin_profiles;
  delete from public.state_admin_profiles;

  delete from public.audit_logs;
  delete from public.profiles;

  -- Identities, sessions and refresh tokens cascade from auth.users.
  with gone as (delete from auth.users returning 1)
  select count(*) into removed_users from gone;

  alter table public.queue_workstations          enable trigger user;
  alter table public.queue_decisions             enable trigger user;
  alter table public.queue_rankings              enable trigger user;
  alter table public.queue_centre_state          enable trigger user;
  alter table public.queue_snapshots             enable trigger user;
  alter table public.queue_entries               enable trigger user;
  alter table public.processing_estimates        enable trigger user;
  alter table public.quality_predictions         enable trigger user;
  alter table public.notifications               enable trigger user;
  alter table public.payment_status_history      enable trigger user;
  alter table public.payment_attempts            enable trigger user;
  alter table public.payments                    enable trigger user;
  alter table public.procurement_status_history  enable trigger user;
  alter table public.procurements                enable trigger user;
  alter table public.weighing_records            enable trigger user;
  alter table public.quality_assessments         enable trigger user;
  alter table public.booking_operations          enable trigger user;
  alter table public.bookings                    enable trigger user;
  alter table public.procurement_sessions        enable trigger user;
  alter table public.procurement_slots           enable trigger user;
  alter table public.centre_activity_signals     enable trigger user;
  alter table public.farmer_verification_checks  enable trigger user;
  alter table public.farmer_documents            enable trigger user;
  alter table public.farmer_land_holdings        enable trigger user;
  alter table public.farmer_profiles             enable trigger user;
  alter table public.staff_profiles              enable trigger user;
  alter table public.district_admin_profiles     enable trigger user;
  alter table public.state_admin_profiles        enable trigger user;
  alter table public.audit_logs                  enable trigger user;
  alter table public.profiles                    enable trigger user;
  alter table public.msp_rates                   enable trigger user;

  return jsonb_build_object(
    'authUsersDeleted', removed_users,
    'profiles', (select count(*) from public.profiles),
    'bookings', (select count(*) from public.bookings),
    'centresKept', (select count(*) from public.procurement_centres),
    'cropsKept', (select count(*) from public.crops)
  );
end;
$$;

comment on function public.dev_reset_all_data() is
  'DEVELOPMENT ONLY. Deletes every account and all activity, keeping reference data. Refuses unless app.environment_flags.allow_data_reset is true; executable by service_role only.';

revoke all on function public.dev_reset_all_data() from public;
revoke all on function public.dev_reset_all_data() from anon;
revoke all on function public.dev_reset_all_data() from authenticated;
grant execute on function public.dev_reset_all_data() to service_role;
