-- ===========================================================================
-- Phase 5 / 0012 — RLS for procurement operations (§42)
--
-- Two audiences, two shapes:
--   staff   -> everything at THEIR centre, derived from their staff profile
--   farmer  -> their own bookings and procurements, nothing else
--
-- Staff get SELECT only here. Every state transition — session, slot, arrival,
-- quality, weighing, procurement, payment — goes through a dedicated
-- server-side operation using the service role, so there is no generic write
-- path from a browser (§42).
-- ===========================================================================

alter table public.procurement_slots     enable row level security;
alter table public.bookings              enable row level security;
alter table public.procurement_sessions  enable row level security;
alter table public.booking_operations    enable row level security;
alter table public.quality_assessments   enable row level security;
alter table public.weighing_records      enable row level security;
alter table public.procurements          enable row level security;
alter table public.payments              enable row level security;
alter table public.procurement_rates     enable row level security;

alter table public.bookings           force row level security;
alter table public.procurements       force row level security;
alter table public.payments           force row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

/**
 * The centre this staff member operates. Null for everyone else.
 *
 * app.staff_centre_id() already exists from Phase 0 and does exactly this, so
 * it is reused rather than duplicated — one definition of "my centre".
 */
create or replace function app.is_centre_staff_of(p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.user_role() = 'CENTRE_STAFF' and p_centre_id = app.staff_centre_id();
$$;

comment on function app.is_centre_staff_of(uuid) is
  'SECURITY DEFINER. True when the caller is active CENTRE_STAFF assigned to the given centre. The centre comes from their staff profile, never from a request parameter.';

/** Whether the caller is the farmer a booking belongs to. */
create or replace function app.owns_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.farmer_user_id = (select auth.uid())
  );
$$;

comment on function app.owns_booking(uuid) is
  'SECURITY DEFINER. True when the calling farmer owns the given booking.';

revoke all on function app.is_centre_staff_of(uuid) from public;
revoke all on function app.owns_booking(uuid) from public;
grant execute on function app.is_centre_staff_of(uuid) to authenticated;
grant execute on function app.owns_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Slots
--
-- Readable by the centre's staff, and by farmers — a farmer must be able to
-- see what windows exist in order to book one in Phase 4. A slot carries no
-- personal data.
-- ---------------------------------------------------------------------------

create policy procurement_slots_select
  on public.procurement_slots for select to authenticated
  using (
    app.is_centre_staff_of(centre_id)
    or (app.user_role() = 'FARMER' and status in ('OPEN', 'FULL'))
  );

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------

create policy bookings_select
  on public.bookings for select to authenticated
  using (
    farmer_user_id = (select auth.uid())
    or app.is_centre_staff_of(centre_id)
  );

-- ---------------------------------------------------------------------------
-- Sessions, operations, assessments, weighing — staff only, own centre.
--
-- A farmer has no business reading the centre's internal operational records;
-- what they need to see about their own procurement comes through the
-- procurement and payment rows below.
-- ---------------------------------------------------------------------------

create policy procurement_sessions_select_staff
  on public.procurement_sessions for select to authenticated
  using (app.is_centre_staff_of(centre_id));

create policy booking_operations_select
  on public.booking_operations for select to authenticated
  using (
    app.is_centre_staff_of(centre_id)
    -- The farmer may follow their own progress through the centre (§31).
    or app.owns_booking(booking_id)
  );

create policy quality_assessments_select
  on public.quality_assessments for select to authenticated
  using (app.owns_booking(booking_id) or exists (
    select 1 from public.booking_operations o
    where o.id = quality_assessments.operation_id
      and app.is_centre_staff_of(o.centre_id)
  ));

create policy weighing_records_select
  on public.weighing_records for select to authenticated
  using (app.owns_booking(booking_id) or exists (
    select 1 from public.booking_operations o
    where o.id = weighing_records.operation_id
      and app.is_centre_staff_of(o.centre_id)
  ));

-- ---------------------------------------------------------------------------
-- Procurements and payments
--
-- A farmer must be able to see what was bought from them and whether they
-- have been paid. That is their record as much as the centre's.
-- ---------------------------------------------------------------------------

create policy procurements_select
  on public.procurements for select to authenticated
  using (
    farmer_user_id = (select auth.uid())
    or app.is_centre_staff_of(centre_id)
  );

create policy payments_select
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.procurements p
    where p.id = payments.procurement_id
      and (p.farmer_user_id = (select auth.uid()) or app.is_centre_staff_of(p.centre_id))
  ));

-- ---------------------------------------------------------------------------
-- Rates — reference data any signed-in user may read, so a farmer can see the
-- rate applied to their own procurement.
-- ---------------------------------------------------------------------------

create policy procurement_rates_select
  on public.procurement_rates for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Column guards
--
-- Even though there are no client-facing INSERT/UPDATE policies, these pin the
-- money and the identifiers for any non-service-role writer. Belt and braces:
-- a policy added carelessly later still cannot let a client set its own price.
-- ---------------------------------------------------------------------------

create or replace function app.protect_procurement_values()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.procurement_reference := old.procurement_reference;
    new.quantity_kg  := old.quantity_kg;
    new.rate_per_kg  := old.rate_per_kg;
    new.total_value  := old.total_value;
    new.confirmed_by := old.confirmed_by;
    new.confirmed_at := old.confirmed_at;
  end if;

  return new;
end;
$$;

comment on function app.protect_procurement_values() is
  'Pins the reference, quantity, rate and value of a procurement for non-service-role writers. What was bought and for how much is settled at confirmation.';

create trigger procurements_protect_values
  before update on public.procurements
  for each row execute function app.protect_procurement_values();

create or replace function app.protect_payment_values()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    new.amount := old.amount;
    new.status := old.status;
    new.provider := old.provider;
    new.provider_reference := old.provider_reference;
  end if;

  return new;
end;
$$;

comment on function app.protect_payment_values() is
  'Pins payment amount and status for non-service-role writers. A payment moves only through the server-side payment operations.';

create trigger payments_protect_values
  before update on public.payments
  for each row execute function app.protect_payment_values();

-- ---------------------------------------------------------------------------
-- Seed rates for the crops the demo data uses.
--
-- CONFIGURED, not a government feed. The UI shows this provenance.
-- ---------------------------------------------------------------------------

insert into public.procurement_rates (crop, rate_per_kg, effective_from, source)
values
  ('Paddy (Samba)',   23.20, date '2026-01-01', 'CONFIGURED'),
  ('Paddy (Kuruvai)', 23.20, date '2026-01-01', 'CONFIGURED'),
  ('Paddy (Thaladi)', 23.20, date '2026-01-01', 'CONFIGURED'),
  ('Paddy',           23.20, date '2026-01-01', 'CONFIGURED')
on conflict do nothing;
