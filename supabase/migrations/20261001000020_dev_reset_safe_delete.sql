-- ===========================================================================
-- Phase 13 / 0020 — fix `public.dev_reset_all_data()` for hosted Supabase's
-- safe-update guard.
--
-- Hosted Supabase runs pg-safeupdate on the connection PostgREST uses (which
-- an RPC call to a SECURITY DEFINER function goes through), so an unqualified
-- `DELETE FROM x` fails with "DELETE requires a WHERE clause" even inside a
-- function body. Every DELETE below is unconditional by design — the whole
-- point is emptying the table — so `where true` satisfies the guard without
-- changing what is deleted.
-- ===========================================================================

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

  update public.queue_workstations
  set status = 'AVAILABLE', current_booking_id = null, busy_since = null
  where status = 'BUSY' or current_booking_id is not null;

  delete from public.queue_decisions             where true;
  delete from public.queue_rankings               where true;
  delete from public.queue_centre_state           where true;
  delete from public.queue_snapshots              where true;
  delete from public.queue_entries                where true;
  delete from public.processing_estimates         where true;
  delete from public.quality_predictions          where true;

  delete from public.notifications                where true;
  delete from public.payment_status_history       where true;
  delete from public.payment_attempts             where true;
  delete from public.payments                     where true;

  delete from public.procurement_status_history   where true;
  delete from public.procurements                 where true;
  delete from public.weighing_records             where true;
  delete from public.quality_assessments          where true;
  delete from public.booking_operations           where true;
  delete from public.bookings                     where true;
  delete from public.procurement_sessions         where true;
  delete from public.procurement_slots            where true;
  delete from public.centre_activity_signals      where true;

  delete from public.farmer_verification_checks   where true;
  delete from public.farmer_documents             where true;
  delete from public.farmer_land_holdings         where true;
  delete from public.farmer_profiles              where true;

  delete from public.staff_profiles               where true;
  delete from public.district_admin_profiles      where true;
  delete from public.state_admin_profiles         where true;

  delete from public.audit_logs                   where true;
  delete from public.profiles                     where true;

  delete from auth.users where true;
  get diagnostics removed_users = row_count;

  alter table public.queue_workstations          enable trigger user;
  alter table public.queue_decisions             enable trigger user;
  alter table public.queue_rankings              enable trigger user;
  alter table public.queue_centre_state          enable trigger user;
  alter table public.queue_snapshots              enable trigger user;
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
