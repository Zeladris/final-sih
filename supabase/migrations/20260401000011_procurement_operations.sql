-- ===========================================================================
-- Phase 5 / 0011 — procurement centre operations
--
-- The operational core of a procurement centre: slots, bookings, daily
-- sessions, and the lifecycle that turns a booking into a paid procurement.
--
-- FOUR DISTINCT CONCEPTS (§9). They are separate tables because they have
-- separate lifetimes and separate owners:
--   slot                 a published appointment window        (staff)
--   booking              a farmer's reservation for a slot     (farmer)
--   procurement_session  one day's operations at a centre      (staff)
--   procurement          the completed purchase                (staff)
--
-- PHASE 4 NOTE. Farmer-side booking creation belongs to Phase 4 and is NOT
-- implemented here. The bookings table exists so staff operations have
-- something real to operate on; nothing in this phase creates a booking on a
-- farmer's behalf.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.slot_status as enum (
    'DRAFT', 'OPEN', 'FULL', 'CLOSED', 'CANCELLED', 'COMPLETED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_status as enum (
    'BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.session_status as enum (
    'SCHEDULED', 'OPEN', 'PROCESSING', 'CLOSING', 'CLOSED'
  );
exception when duplicate_object then null; end $$;

-- The single source of truth for where a booking is in the centre workflow
-- (§23). Deliberately ONE field: competing status columns contradict.
do $$ begin
  create type public.operation_state as enum (
    'BOOKED',
    'ARRIVED',
    'CHECKED_IN',
    'WAITING',
    'QUALITY_CHECK',
    'WEIGHING',
    'PROCUREMENT',
    'PAYMENT_PENDING',
    'COMPLETED',
    'ON_HOLD',
    'REJECTED',
    'CANCELLED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.quality_result as enum ('PENDING', 'PASSED', 'FAILED', 'CONDITIONAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum (
    'PENDING', 'INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- procurement_slots (§12, §13, §14)
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_slots (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.procurement_centres (id) on delete restrict,

  -- A calendar date in the business timezone, never an instant (§46 of Phase 0).
  slot_date    date not null,
  start_time   time not null,
  end_time     time not null,

  capacity     integer not null,
  status       public.slot_status not null default 'OPEN',

  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint procurement_slots_unique_window unique (centre_id, slot_date, start_time),
  constraint procurement_slots_time_ordered check (start_time < end_time),
  constraint procurement_slots_capacity_positive check (capacity > 0),
  constraint procurement_slots_capacity_sane check (capacity <= 500)
);

create index if not exists procurement_slots_centre_date_idx
  on public.procurement_slots (centre_id, slot_date);

create trigger procurement_slots_touch_updated_at
  before update on public.procurement_slots
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- bookings — created by the farmer in Phase 4; consumed here
-- ---------------------------------------------------------------------------

create sequence if not exists public.booking_reference_seq start with 1;

create table if not exists public.bookings (
  id                  uuid primary key default gen_random_uuid(),
  booking_reference   text not null default (
    'BKG-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
    to_char(nextval('public.booking_reference_seq'), 'FM000000')
  ),

  farmer_user_id      uuid not null references public.farmer_profiles (user_id) on delete restrict,
  slot_id             uuid not null references public.procurement_slots (id) on delete restrict,
  -- Denormalised from the slot so every centre-scoped query has one predicate
  -- rather than a join; kept honest by a trigger below.
  centre_id           uuid not null references public.procurement_centres (id) on delete restrict,

  crop                text not null,
  expected_quantity_kg numeric(12, 3) not null,

  status              public.booking_status not null default 'BOOKED',

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint bookings_reference_key unique (booking_reference),
  constraint bookings_quantity_positive check (expected_quantity_kg > 0)
);

create index if not exists bookings_slot_idx on public.bookings (slot_id);
create index if not exists bookings_centre_idx on public.bookings (centre_id, status);
create index if not exists bookings_farmer_idx on public.bookings (farmer_user_id);

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function app.touch_updated_at();

-- A booking's centre always equals its slot's centre. Derived, not trusted.
create or replace function app.sync_booking_centre()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select s.centre_id into new.centre_id
  from public.procurement_slots s
  where s.id = new.slot_id;

  if new.centre_id is null then
    raise exception 'Slot % does not exist', new.slot_id using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

comment on function app.sync_booking_centre() is
  'SECURITY DEFINER (reads procurement_slots): forces bookings.centre_id to the slot''s centre, so a booking can never be filed against the wrong centre.';

create trigger bookings_sync_centre
  before insert or update of slot_id on public.bookings
  for each row execute function app.sync_booking_centre();

-- Capacity is enforced here rather than in application code, so it holds
-- regardless of which path creates a booking (§13).
create or replace function app.assert_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  slot_capacity integer;
  booked integer;
begin
  if new.status <> 'BOOKED' then
    return new;
  end if;

  select capacity into slot_capacity from public.procurement_slots where id = new.slot_id;

  select count(*) into booked
  from public.bookings
  where slot_id = new.slot_id
    and status = 'BOOKED'
    and id <> new.id;

  if booked >= slot_capacity then
    raise exception 'Slot % has reached its booking capacity of %', new.slot_id, slot_capacity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_slot_capacity() is
  'SECURITY DEFINER. Refuses a booking that would exceed its slot capacity. Enforced in the database so no code path can oversubscribe a slot.';

create trigger bookings_assert_capacity
  before insert or update of slot_id, status on public.bookings
  for each row execute function app.assert_slot_capacity();

-- A slot's capacity may never drop below what is already booked (§13).
create or replace function app.assert_capacity_not_below_bookings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  booked integer;
begin
  if new.capacity >= old.capacity then
    return new;
  end if;

  select count(*) into booked
  from public.bookings
  where slot_id = new.id and status = 'BOOKED';

  if new.capacity < booked then
    raise exception 'Cannot reduce capacity to %; % farmers are already booked', new.capacity, booked
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_capacity_not_below_bookings() is
  'Blocks a capacity reduction that would invalidate confirmed bookings. Freeing those bookings is a deliberate operational act, not a side effect of an edit.';

create trigger procurement_slots_assert_capacity
  before update of capacity on public.procurement_slots
  for each row execute function app.assert_capacity_not_below_bookings();

-- ---------------------------------------------------------------------------
-- procurement_sessions (§9, §10)
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_sessions (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.procurement_centres (id) on delete restrict,
  session_date  date not null,

  status        public.session_status not null default 'SCHEDULED',

  opened_by     uuid references public.profiles (id) on delete set null,
  opened_at     timestamptz,
  closed_by     uuid references public.profiles (id) on delete set null,
  closed_at     timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One session per centre per day. The operational day is a real thing.
  constraint procurement_sessions_unique_day unique (centre_id, session_date)
);

create index if not exists procurement_sessions_centre_idx
  on public.procurement_sessions (centre_id, session_date desc);

create trigger procurement_sessions_touch_updated_at
  before update on public.procurement_sessions
  for each row execute function app.touch_updated_at();

create or replace function app.assert_session_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  allowed := case old.status
    when 'SCHEDULED'  then new.status in ('OPEN', 'CLOSED')
    when 'OPEN'       then new.status in ('PROCESSING', 'CLOSING')
    when 'PROCESSING' then new.status in ('CLOSING')
    when 'CLOSING'    then new.status in ('CLOSED', 'PROCESSING')
    when 'CLOSED'     then false
    else false
  end;

  if not allowed then
    raise exception 'Invalid session transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'OPEN' then
    new.opened_at := coalesce(new.opened_at, now());
  end if;

  if new.status = 'CLOSED' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

comment on function app.assert_session_transition() is
  'Enforces the §10 session lifecycle. CLOSED is terminal: reopening a closed day would let procurement be backdated.';

create trigger procurement_sessions_assert_transition
  before update on public.procurement_sessions
  for each row execute function app.assert_session_transition();

-- ---------------------------------------------------------------------------
-- booking_operations — the operational state of one booking (§16, §23)
-- ---------------------------------------------------------------------------

create table if not exists public.booking_operations (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  session_id    uuid not null references public.procurement_sessions (id) on delete restrict,
  centre_id     uuid not null references public.procurement_centres (id) on delete restrict,

  state         public.operation_state not null default 'BOOKED',

  arrived_at    timestamptz,
  arrived_by    uuid references public.profiles (id) on delete set null,
  checked_in_at timestamptz,

  -- Claim semantics, so two operators cannot process one farmer (§41).
  claimed_by    uuid references public.profiles (id) on delete set null,
  claimed_at    timestamptz,

  crop_verified boolean,
  crop_issue    text,

  hold_reason   text,

  queue_position integer,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One operational record per booking, ever.
  constraint booking_operations_booking_key unique (booking_id)
);

create index if not exists booking_operations_session_idx
  on public.booking_operations (session_id, state);
create index if not exists booking_operations_centre_idx
  on public.booking_operations (centre_id, state);

create trigger booking_operations_touch_updated_at
  before update on public.booking_operations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- quality_assessments (§20)
-- ---------------------------------------------------------------------------

create table if not exists public.quality_assessments (
  id             uuid primary key default gen_random_uuid(),
  operation_id   uuid not null references public.booking_operations (id) on delete cascade,
  booking_id     uuid not null references public.bookings (id) on delete cascade,

  result         public.quality_result not null,
  observed_crop  text,
  remarks        text,

  assessed_by    uuid not null references public.profiles (id) on delete restrict,
  assessed_at    timestamptz not null default now(),

  -- A failure or a conditional pass must say why (§21).
  constraint quality_assessments_reason_present
    check (result = 'PASSED' or (remarks is not null and char_length(trim(remarks)) >= 5))
);

create index if not exists quality_assessments_operation_idx
  on public.quality_assessments (operation_id, assessed_at desc);

-- ---------------------------------------------------------------------------
-- weighing_records (§24, §25)
-- ---------------------------------------------------------------------------

create table if not exists public.weighing_records (
  id                 uuid primary key default gen_random_uuid(),
  operation_id       uuid not null references public.booking_operations (id) on delete cascade,
  booking_id         uuid not null references public.bookings (id) on delete cascade,

  actual_quantity_kg numeric(12, 3) not null,

  weighed_by         uuid not null references public.profiles (id) on delete restrict,
  weighed_at         timestamptz not null default now(),

  constraint weighing_records_quantity_positive check (actual_quantity_kg > 0),
  constraint weighing_records_quantity_sane check (actual_quantity_kg <= 1000000)
);

create index if not exists weighing_records_operation_idx
  on public.weighing_records (operation_id, weighed_at desc);

-- ---------------------------------------------------------------------------
-- procurement_rates (§27, §48)
--
-- The applicable rate is business data, not a constant in a component. No
-- claim is made that these come from a live government MSP feed.
-- ---------------------------------------------------------------------------

create table if not exists public.procurement_rates (
  id              uuid primary key default gen_random_uuid(),
  crop            text not null,
  rate_per_kg     numeric(12, 4) not null,
  effective_from  date not null,
  effective_to    date,
  -- Where the figure came from. Honest provenance, shown in the UI.
  source          text not null default 'CONFIGURED',
  created_at      timestamptz not null default now(),

  constraint procurement_rates_positive check (rate_per_kg > 0),
  constraint procurement_rates_range check (effective_to is null or effective_to >= effective_from)
);

create index if not exists procurement_rates_lookup_idx
  on public.procurement_rates (crop, effective_from desc);

comment on table public.procurement_rates is
  'Configured procurement rates. source=CONFIGURED means an operator entered this figure; it is NOT a live government MSP integration (§27).';

-- ---------------------------------------------------------------------------
-- procurements (§26, §32)
-- ---------------------------------------------------------------------------

create sequence if not exists public.procurement_reference_seq start with 1;

create table if not exists public.procurements (
  id                    uuid primary key default gen_random_uuid(),
  -- Stable for the life of the record: generated once, on insert (§32).
  procurement_reference text not null default (
    'PROC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
    to_char(nextval('public.procurement_reference_seq'), 'FM000000')
  ),

  booking_id            uuid not null references public.bookings (id) on delete restrict,
  operation_id          uuid not null references public.booking_operations (id) on delete restrict,
  session_id            uuid not null references public.procurement_sessions (id) on delete restrict,
  centre_id             uuid not null references public.procurement_centres (id) on delete restrict,
  farmer_user_id        uuid not null references public.farmer_profiles (user_id) on delete restrict,

  crop                  text not null,
  quantity_kg           numeric(12, 3) not null,
  rate_per_kg           numeric(12, 4) not null,
  -- Persisted, not recomputed on read: the rate may change afterwards and the
  -- record must keep what was actually paid.
  total_value           numeric(14, 2) not null,
  rate_source           text not null,

  quality_assessment_id uuid references public.quality_assessments (id) on delete set null,
  weighing_record_id    uuid references public.weighing_records (id) on delete set null,

  confirmed_by          uuid not null references public.profiles (id) on delete restrict,
  confirmed_at          timestamptz not null default now(),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint procurements_reference_key unique (procurement_reference),
  -- One procurement per booking. A second purchase needs a second booking.
  constraint procurements_booking_key unique (booking_id),
  constraint procurements_quantity_positive check (quantity_kg > 0),
  constraint procurements_value_positive check (total_value >= 0)
);

create index if not exists procurements_centre_idx
  on public.procurements (centre_id, confirmed_at desc);
create index if not exists procurements_farmer_idx
  on public.procurements (farmer_user_id, confirmed_at desc);
create index if not exists procurements_session_idx on public.procurements (session_id);

create trigger procurements_touch_updated_at
  before update on public.procurements
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- payments (§29, §30)
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  procurement_id    uuid not null references public.procurements (id) on delete cascade,

  amount            numeric(14, 2) not null,
  status            public.payment_status not null default 'PENDING',

  -- Which adapter handled it. 'SIMULATED' is never presented as a bank (§30).
  provider          text not null default 'SIMULATED',
  provider_reference text,

  initiated_by      uuid references public.profiles (id) on delete set null,
  initiated_at      timestamptz,
  completed_at      timestamptz,
  failure_reason    text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint payments_procurement_key unique (procurement_id),
  constraint payments_amount_positive check (amount >= 0),
  constraint payments_failure_reason_present
    check (status <> 'FAILED' or failure_reason is not null)
);

create index if not exists payments_status_idx on public.payments (status, created_at desc);

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function app.touch_updated_at();

comment on column public.payments.provider is
  'Adapter that handled this payment. SIMULATED means no money moved — it must never be presented as a banking integration (§30, §47).';
