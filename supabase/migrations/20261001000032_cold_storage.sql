-- ===========================================================================
-- Cold storage (demo addition).
--
-- When a centre cannot procure a farmer's full expected quantity — recorded
-- the same way any shortfall already is, as receivedQuantityKg/acceptedQuantityKg
-- below expectedQuantityKg at the existing weighing step — the farmer may
-- reserve the leftover produce at a cold-storage facility. This is additive:
-- it does not touch bookings, procurement_slots, booking_operations, queue,
-- payments, or the farmer status state machine. A cold-storage reservation is
-- a sibling fact about a booking, not a new step in it.
-- ===========================================================================

create table if not exists public.cold_storage_facilities (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null,
  name                   text not null,
  location               text not null,
  capacity_kg            numeric(12, 3) not null,
  available_capacity_kg  numeric(12, 3) not null,
  is_active              boolean not null default true,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint cold_storage_facilities_code_key unique (code),
  constraint cold_storage_facilities_capacity_positive check (capacity_kg > 0),
  constraint cold_storage_facilities_available_sane
    check (available_capacity_kg >= 0 and available_capacity_kg <= capacity_kg)
);

create index if not exists cold_storage_facilities_active_idx
  on public.cold_storage_facilities (is_active);

create trigger cold_storage_facilities_touch_updated_at
  before update on public.cold_storage_facilities
  for each row execute function app.touch_updated_at();

alter table public.cold_storage_facilities enable row level security;

-- Any signed-in farmer is entitled to see where they could store produce,
-- same reasoning as msp_rates being world-readable to the authenticated app.
create policy cold_storage_facilities_select on public.cold_storage_facilities
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------

create sequence if not exists public.cold_storage_booking_reference_seq start with 1;

create table if not exists public.cold_storage_bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_reference   text not null default (
    'CSB-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
    to_char(nextval('public.cold_storage_booking_reference_seq'), 'FM000000')
  ),

  -- The original procurement booking this leftover crop belongs to — never a
  -- standalone entity, so a farmer's cold-storage reservation is always
  -- traceable back to one real booking.
  booking_id          uuid not null references public.bookings (id) on delete restrict,
  farmer_user_id      uuid not null references public.farmer_profiles (user_id) on delete restrict,
  facility_id         uuid not null references public.cold_storage_facilities (id) on delete restrict,

  crop                text not null,
  crop_id             uuid references public.crops (id) on delete set null,
  quantity_kg         numeric(12, 3) not null,

  status              text not null default 'RESERVED',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint cold_storage_bookings_reference_key unique (booking_reference),
  -- One reservation per booking: the remaining-crop figure is computed once,
  -- from that one booking's own shortfall, never re-offered after it's taken.
  constraint cold_storage_bookings_one_per_booking unique (booking_id),
  constraint cold_storage_bookings_quantity_positive check (quantity_kg > 0),
  constraint cold_storage_bookings_status_valid check (status in ('RESERVED', 'CANCELLED'))
);

create index if not exists cold_storage_bookings_farmer_idx
  on public.cold_storage_bookings (farmer_user_id);

create trigger cold_storage_bookings_touch_updated_at
  before update on public.cold_storage_bookings
  for each row execute function app.touch_updated_at();

alter table public.cold_storage_bookings enable row level security;
alter table public.cold_storage_bookings force row level security;

-- A farmer sees only their own reservations — never another farmer's crop,
-- quantity, or which facility they chose.
create policy cold_storage_bookings_select_own on public.cold_storage_bookings
  for select to authenticated using (farmer_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------

-- Atomically checks and decrements available capacity in one statement, so
-- two farmers reserving the last of a facility's space at the same instant
-- cannot both succeed — the same reasoning app.assert_slot_capacity() uses
-- for slot bookings, just expressed as a plain guarded UPDATE rather than a
-- trigger, since this is a resource pool rather than a row-count limit.
-- Called only from the server's service-role client, never by a farmer's own
-- session, so it deliberately does not check who is calling.
create or replace function public.reserve_cold_storage_capacity(
  p_facility_id uuid,
  p_quantity_kg numeric
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.cold_storage_facilities
  set available_capacity_kg = available_capacity_kg - p_quantity_kg
  where id = p_facility_id
    and is_active = true
    and available_capacity_kg >= p_quantity_kg
  returning true;
$$;

revoke all on function public.reserve_cold_storage_capacity(uuid, numeric) from public;
revoke all on function public.reserve_cold_storage_capacity(uuid, numeric) from anon, authenticated;
