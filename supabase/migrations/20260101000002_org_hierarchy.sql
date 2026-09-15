-- ===========================================================================
-- Phase 0 / 0002 — organizational hierarchy: state > district > centre (§7, §8)
-- ===========================================================================

create table if not exists public.states (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint states_code_key unique (code),
  constraint states_name_key unique (name),
  constraint states_code_format check (code ~ '^[A-Z]{2,4}$')
);

create table if not exists public.districts (
  id          uuid primary key default gen_random_uuid(),
  state_id    uuid not null references public.states (id) on delete restrict,
  code        text not null,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint districts_state_code_key unique (state_id, code),
  constraint districts_state_name_key unique (state_id, name)
);

create index if not exists districts_state_id_idx on public.districts (state_id);

create table if not exists public.procurement_centres (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  name                text not null,
  district_id         uuid not null references public.districts (id) on delete restrict,

  address_line1       text,
  address_line2       text,
  village             text,
  pincode             text,

  latitude            numeric(9, 6),
  longitude           numeric(9, 6),

  -- Local wall-clock opening hours in the business timezone (§46).
  -- Deliberately `time`, not `timestamptz`.
  open_time           time,
  close_time          time,

  daily_capacity_qtl  numeric(12, 3),
  is_active           boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint procurement_centres_code_key unique (code),
  constraint procurement_centres_pincode_format
    check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  constraint procurement_centres_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint procurement_centres_longitude_range
    check (longitude is null or longitude between -180 and 180),
  constraint procurement_centres_capacity_positive
    check (daily_capacity_qtl is null or daily_capacity_qtl >= 0),
  constraint procurement_centres_hours_ordered
    check (open_time is null or close_time is null or open_time < close_time)
);

create index if not exists procurement_centres_district_id_idx
  on public.procurement_centres (district_id);

create index if not exists procurement_centres_active_idx
  on public.procurement_centres (is_active) where is_active;

-- District and state are never duplicated as free text on a centre (§8.3);
-- the state is derived through centre -> district -> state.
comment on table public.procurement_centres is
  'Procurement centres. State is derived via district_id -> districts.state_id; never denormalised onto this row.';

create trigger states_touch_updated_at
  before update on public.states
  for each row execute function app.touch_updated_at();

create trigger districts_touch_updated_at
  before update on public.districts
  for each row execute function app.touch_updated_at();

create trigger procurement_centres_touch_updated_at
  before update on public.procurement_centres
  for each row execute function app.touch_updated_at();
