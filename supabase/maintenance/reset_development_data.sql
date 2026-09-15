-- ===========================================================================
-- KisanSetu — RESET DEVELOPMENT DATA
--
-- DESTRUCTIVE. For a development / demo database only. NEVER production.
--
-- Deletes every account (Supabase Auth users, profiles, staff/district/state
-- admin assignments, farmer profiles/land/documents/checks) and everything
-- accounts produced (bookings, sessions, operations, quality, weighing,
-- procurements, payments, queue records, notifications, status history,
-- audit logs). Keeps reference/configuration data: states, districts,
-- procurement_centres, crops, centre_crops, queue_workstations (reset to
-- AVAILABLE), procurement_rates, msp_rates, document_requirements, storage
-- buckets.
--
-- The actual work is `public.dev_reset_all_data()`
-- (supabase/migrations/20261001000019_dev_data_reset.sql) — a SECURITY
-- DEFINER function that:
--   * refuses to run unless `app.environment_flags.allow_data_reset = true`
--     (off by default; set only on a development/demo database, never
--     reachable through the API since the app schema is not exposed to
--     PostgREST);
--   * is executable only by service_role, so no signed-in user can call it;
--   * disables user triggers only for its own transaction, so append-only
--     history tables and projection triggers are not touched permanently.
--
-- Uploaded FILES are not rows here — empty storage with
-- `npm run reset:storage -w @kisansetu/api` (see README).
--
-- HOW TO RUN (Supabase dashboard -> SQL Editor, or psql as the postgres role):
--   1. One-time per database: allow the reset.
--        update app.environment_flags set allow_data_reset = true;
--   2. Run the reset.
--        select public.dev_reset_all_data();
--   3. (Optional) turn it back off between uses, so nothing can trigger it by
--      accident from a stray script:
--        update app.environment_flags set allow_data_reset = false;
--
-- After a reset, load the demo dataset:
--   npm run seed:demo -w @kisansetu/api
-- ===========================================================================

-- update app.environment_flags set allow_data_reset = true;
-- select public.dev_reset_all_data();
-- update app.environment_flags set allow_data_reset = false;

-- What is left afterwards: accounts should be 0, reference data untouched.
select
  (select count(*) from auth.users)                  as auth_users,
  (select count(*) from public.profiles)             as profiles,
  (select count(*) from public.bookings)             as bookings,
  (select count(*) from public.states)               as states,
  (select count(*) from public.districts)            as districts,
  (select count(*) from public.procurement_centres)  as centres,
  (select count(*) from public.crops)                as crops,
  (select count(*) from public.msp_rates)            as msp_rates;
