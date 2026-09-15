-- ===========================================================================
-- Phase 4 / 0013 — farmer crop & slot booking
--
-- Phase 5 created `bookings` and `procurement_slots` so staff operations had
-- something to run on, but deliberately left farmer-side creation out. This
-- adds what booking actually needs:
--
--   * a data-driven crop catalogue (NOT three hard-coded crops, §9, §60)
--   * centre <-> crop compatibility, so a centre can refuse a crop (§19)
--   * produce storage location, separate from residence AND farm land (§14)
--   * harvest information for the later quality/risk workflow (§13)
--   * idempotency, so a retried Confirm cannot create two bookings (§51)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Crop catalogue (§9, §11)
-- ---------------------------------------------------------------------------

create table if not exists public.crops (
  id             uuid primary key default gen_random_uuid(),
  code           text not null,
  name_en        text not null,
  -- The crop's name in Tamil, so search and display work in either language
  -- without a translation service (§10, §38).
  name_ta        text not null,
  /** Unit the crop is procured in. Controlled, never free text (§12). */
  unit           text not null default 'kg',
  /** False for a crop that exists in the catalogue but is not being procured. */
  is_procurable  boolean not null default true,
  is_active      boolean not null default true,
  display_order  integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint crops_code_key unique (code),
  constraint crops_unit_supported check (unit in ('kg', 'quintal'))
);

create index if not exists crops_active_idx on public.crops (is_active, display_order);

create trigger crops_touch_updated_at
  before update on public.crops
  for each row execute function app.touch_updated_at();

comment on table public.crops is
  'Configurable crop catalogue. Adding a crop is a data change, not a deploy — the booking UI reads this table (§9).';

-- ---------------------------------------------------------------------------
-- Centre <-> crop compatibility (§18, §19)
--
-- A centre does not necessarily accept every crop. Without this the farmer
-- could book paddy at a centre that only takes groundnut and only find out on
-- arrival.
-- ---------------------------------------------------------------------------

create table if not exists public.centre_crops (
  centre_id   uuid not null references public.procurement_centres (id) on delete cascade,
  crop_id     uuid not null references public.crops (id) on delete cascade,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  primary key (centre_id, crop_id)
);

create index if not exists centre_crops_crop_idx on public.centre_crops (crop_id, is_active);

-- ---------------------------------------------------------------------------
-- bookings — the farmer-supplied half
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists crop_id uuid references public.crops (id) on delete restrict,
  add column if not exists quantity_unit text not null default 'kg',

  -- Harvest information, structured rather than buried in free text (§13).
  add column if not exists harvest_date date,

  -- WHERE THE PRODUCE IS, which is not the farmer's home and not their field
  -- (§14). Assuming otherwise is exactly the silent guess §60 forbids.
  add column if not exists storage_location_text text,
  add column if not exists storage_place_name text,
  add column if not exists storage_latitude numeric(9, 6),
  add column if not exists storage_longitude numeric(9, 6),

  add column if not exists produce_photo_path text,

  -- Idempotency for the final Confirm (§51).
  add column if not exists idempotency_key text,

  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancellation_reason text;

do $$ begin
  alter table public.bookings
    add constraint bookings_storage_coords_paired
      check ((storage_latitude is null) = (storage_longitude is null));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bookings
    add constraint bookings_harvest_plausible
      check (harvest_date is null or harvest_date > date '2000-01-01');
exception when duplicate_object then null; end $$;

/**
 * A retried Confirm must not create a second booking.
 *
 * The client sends a key it generated once when the review screen opened, so a
 * timeout-then-retry lands on the same key and this index makes the second
 * insert fail rather than double-book the farmer (§40, §51).
 */
create unique index if not exists bookings_idempotency_key_idx
  on public.bookings (farmer_user_id, idempotency_key)
  where idempotency_key is not null;

/**
 * One active booking per farmer per slot (§26).
 *
 * Partial on status so a cancelled booking does not block rebooking the same
 * slot — a farmer who cancels by mistake can book it again.
 */
create unique index if not exists bookings_one_active_per_slot_idx
  on public.bookings (farmer_user_id, slot_id)
  where status = 'BOOKED';

comment on column public.bookings.storage_location_text is
  'Where the produce is currently stored, as the farmer described it. Deliberately separate from the farmer''s residence and their land (§14).';

comment on column public.bookings.produce_photo_path is
  'Optional photo of the produce, for staff context only. This is NOT automated quality assessment (§17).';

-- Keep the denormalised crop NAME in step with crop_id, so Phase 5's rate
-- lookup and staff views keep working unchanged.
create or replace function app.sync_booking_crop_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.crop_id is null then
    return new;
  end if;

  select c.name_en, c.unit into new.crop, new.quantity_unit
  from public.crops c
  where c.id = new.crop_id;

  if new.crop is null then
    raise exception 'Crop % does not exist', new.crop_id using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

comment on function app.sync_booking_crop_name() is
  'SECURITY DEFINER (reads public.crops): derives bookings.crop and quantity_unit from crop_id, so the catalogue is the single source of truth for a crop''s name and unit.';

create trigger bookings_sync_crop_name
  before insert or update of crop_id on public.bookings
  for each row execute function app.sync_booking_crop_name();

-- ---------------------------------------------------------------------------
-- Rates keyed by crop (§27)
--
-- Phase 5 looked rates up by crop NAME. That breaks the moment a crop is
-- renamed, so the reference moves to crop_id with the name kept for display.
-- ---------------------------------------------------------------------------

alter table public.procurement_rates
  add column if not exists crop_id uuid references public.crops (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Seed the catalogue
--
-- More than the three crops a prototype would hard-code, and every one of
-- them is a row an operator can change (§9, §60).
-- ---------------------------------------------------------------------------

insert into public.crops (code, name_en, name_ta, unit, is_procurable, display_order)
values
  ('PADDY_SAMBA',   'Paddy (Samba)',   'நெல் (சம்பா)',    'kg', true, 10),
  ('PADDY_KURUVAI', 'Paddy (Kuruvai)', 'நெல் (குறுவை)',   'kg', true, 20),
  ('PADDY_THALADI', 'Paddy (Thaladi)', 'நெல் (தாளடி)',    'kg', true, 30),
  ('PADDY',         'Paddy',           'நெல்',            'kg', true, 40),
  ('WHEAT',         'Wheat',           'கோதுமை',          'kg', true, 50),
  ('MAIZE',         'Maize',           'மக்காச்சோளம்',      'kg', true, 60),
  ('GROUNDNUT',     'Groundnut',       'நிலக்கடலை',        'kg', true, 70),
  ('BLACK_GRAM',    'Black gram',      'உளுந்து',          'kg', true, 80),
  ('GREEN_GRAM',    'Green gram',      'பாசிப்பயறு',        'kg', true, 90),
  ('SUGARCANE',     'Sugarcane',       'கரும்பு',          'kg', false, 100),
  ('COTTON',        'Cotton',          'பருத்தி',          'kg', false, 110)
on conflict (code) do nothing;

-- Point the existing rates at their crops.
update public.procurement_rates r
set crop_id = c.id
from public.crops c
where r.crop_id is null and c.name_en = r.crop;

-- Every active centre accepts the procurable crops. A real deployment would
-- curate this per centre; seeding it keeps the compatibility check honest
-- rather than vacuous.
insert into public.centre_crops (centre_id, crop_id)
select pc.id, c.id
from public.procurement_centres pc
cross join public.crops c
where pc.is_active and c.is_procurable
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Reads only. Booking creation and cancellation go through server-side
-- operations that check eligibility, compatibility and capacity first — there
-- is no client INSERT path (§29, §48, §49).
-- ---------------------------------------------------------------------------

alter table public.crops        enable row level security;
alter table public.centre_crops enable row level security;

create policy crops_select_authenticated
  on public.crops for select to authenticated
  using (is_active);

create policy centre_crops_select_authenticated
  on public.centre_crops for select to authenticated
  using (is_active);

-- ---------------------------------------------------------------------------
-- Column guards
--
-- A farmer may cancel their own booking through the API, but must never be
-- able to move it to COMPLETED, change its slot, or rewrite its reference.
-- ---------------------------------------------------------------------------

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
    new.booking_reference := old.booking_reference;
    new.farmer_user_id    := old.farmer_user_id;
    new.slot_id           := old.slot_id;
    new.centre_id         := old.centre_id;
    new.crop_id           := old.crop_id;
    new.status            := old.status;
    new.idempotency_key   := old.idempotency_key;
  end if;

  return new;
end;
$$;

comment on function app.protect_booking_fields() is
  'Pins ownership, slot, crop and status of a booking for non-service-role writers. Every meaningful change goes through an authorized server operation.';

create trigger bookings_protect_fields
  before update on public.bookings
  for each row execute function app.protect_booking_fields();
