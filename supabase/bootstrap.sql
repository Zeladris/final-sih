-- =============================================================================
-- KisanSetu / Procuremintra — schema bootstrap
--
-- CONVENIENCE FILE ONLY. The source of truth is supabase/migrations/*.sql;
-- this is those files concatenated in order so the whole schema can be applied
-- in one paste through the Supabase dashboard SQL editor when the CLI is not
-- available.
--
-- Apply with:  Dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Safe to run once on an empty project. To re-apply after a change, prefer
-- `supabase db reset` (local) or `supabase db push` (hosted) instead.
-- =============================================================================

-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000001_foundation.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0001 â€” extensions, enums, shared trigger functions
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (Â§8). Kept in sync with packages/shared/src/{roles,status}.ts.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum (
    'FARMER',
    'CENTRE_STAFF',
    'DISTRICT_ADMIN',
    'STATE_ADMIN'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.profile_status as enum (
    'ACTIVE',
    'SUSPENDED',
    'DISABLED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_status as enum (
    'PENDING',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_type as enum (
    'LAND_RECORD',
    'BANK_PASSBOOK',
    'IDENTITY_PROOF',
    'ADDRESS_PROOF',
    'CROP_PHOTO',
    'OTHER'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- `app` schema holds authorization helpers used by RLS policies.
-- It is NOT exposed through PostgREST (only `public` and `storage` are), so
-- these functions cannot be called directly by a browser client.
-- ---------------------------------------------------------------------------

create schema if not exists app;

comment on schema app is
  'Internal authorization helpers for RLS. Not exposed via the API schema.';

grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance (Â§54 "updated_at behavior is implemented").
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at = now() on every row update.';


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000002_org_hierarchy.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0002 â€” organizational hierarchy: state > district > centre (Â§7, Â§8)
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

  -- Local wall-clock opening hours in the business timezone (Â§46).
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

-- District and state are never duplicated as free text on a centre (Â§8.3);
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


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000003_profiles.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0003 â€” application profiles (Â§9, Â§12, Â§13, Â§14)
--
-- Supabase Auth owns identity in auth.users. This file owns *application*
-- identity. Passwords/OTP secrets are never duplicated here.
-- ===========================================================================

create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  role                public.app_role not null,
  full_name           text,
  -- Mirrored from the authenticated Supabase identity (auth.users.phone) by a
  -- trigger below. Clients cannot substitute an arbitrary number (Â§9.1).
  phone               text,
  preferred_language  text not null default 'en',
  status              public.profile_status not null default 'ACTIVE',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) between 1 and 120),
  constraint profiles_language_supported check (preferred_language in ('en', 'ta', 'hi'))
);

create index if not exists profiles_role_idx on public.profiles (role);

comment on column public.profiles.phone is
  'Authoritative copy of auth.users.phone, maintained by app.sync_profile_phone(). Not client-writable.';

-- Phone always comes from the verified Supabase identity, never the request body.
create or replace function app.sync_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  select u.phone into new.phone from auth.users u where u.id = new.id;
  return new;
end;
$$;

comment on function app.sync_profile_phone() is
  'SECURITY DEFINER (reads auth.users): forces profiles.phone to the verified phone on the auth identity. Narrow by design â€” it reads exactly one column for exactly the row being written.';

create trigger profiles_sync_phone
  before insert or update on public.profiles
  for each row execute function app.sync_profile_phone();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Role-specific profiles. Each carries exactly one organizational scope (Â§7).
-- Security scope is read from these rows â€” never from a request parameter.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_profiles (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  employee_reference_id  text not null,
  centre_id              uuid not null references public.procurement_centres (id) on delete restrict,
  designation            text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint staff_profiles_employee_reference_id_key unique (employee_reference_id)
);

create index if not exists staff_profiles_centre_id_idx on public.staff_profiles (centre_id);

create table if not exists public.district_admin_profiles (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  employee_reference_id  text not null,
  district_id            uuid not null references public.districts (id) on delete restrict,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint district_admin_profiles_employee_reference_id_key unique (employee_reference_id)
);

create index if not exists district_admin_profiles_district_id_idx
  on public.district_admin_profiles (district_id);

create table if not exists public.state_admin_profiles (
  user_id                uuid primary key references public.profiles (id) on delete cascade,
  employee_reference_id  text not null,
  state_id               uuid not null references public.states (id) on delete restrict,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint state_admin_profiles_employee_reference_id_key unique (employee_reference_id)
);

create index if not exists state_admin_profiles_state_id_idx
  on public.state_admin_profiles (state_id);

create trigger staff_profiles_touch_updated_at
  before update on public.staff_profiles
  for each row execute function app.touch_updated_at();

create trigger district_admin_profiles_touch_updated_at
  before update on public.district_admin_profiles
  for each row execute function app.touch_updated_at();

create trigger state_admin_profiles_touch_updated_at
  before update on public.state_admin_profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A role-specific profile must match profiles.role. This stops a FARMER row
-- from acquiring a staff scope even if some later code path is careless.
-- ---------------------------------------------------------------------------

create or replace function app.assert_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actual public.app_role;
  expected public.app_role := tg_argv[0]::public.app_role;
begin
  select p.role into actual from public.profiles p where p.id = new.user_id;

  if actual is null then
    raise exception 'No profile exists for user %', new.user_id
      using errcode = 'foreign_key_violation';
  end if;

  if actual <> expected then
    raise exception 'Profile % has role %, which cannot own a % scope row', new.user_id, actual, expected
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_profile_role() is
  'SECURITY DEFINER (reads public.profiles): asserts a role-specific scope row is attached to a profile of the matching role. Narrow by design â€” single row, single column, no authorization decision.';

create trigger staff_profiles_assert_role
  before insert or update of user_id on public.staff_profiles
  for each row execute function app.assert_profile_role('CENTRE_STAFF');

create trigger district_admin_profiles_assert_role
  before insert or update of user_id on public.district_admin_profiles
  for each row execute function app.assert_profile_role('DISTRICT_ADMIN');

create trigger state_admin_profiles_assert_role
  before insert or update of user_id on public.state_admin_profiles
  for each row execute function app.assert_profile_role('STATE_ADMIN');


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000004_farmers.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0004 â€” farmer profile, verification model, documents (Â§10, Â§11, Â§15)
-- ===========================================================================

create sequence if not exists public.farmer_reference_seq start with 100001;

-- Needed both by the column default and by app.protect_farmer_verification(),
-- which regenerates the reference id on insert and is not SECURITY DEFINER.
grant usage, select on sequence public.farmer_reference_seq to authenticated, service_role;

create table if not exists public.farmer_profiles (
  user_id              uuid primary key references public.profiles (id) on delete cascade,

  -- The application's farmer business key. Deliberately NOT an Aadhaar
  -- number (Â§10, Â§48): identity credentials are not business keys.
  farmer_reference_id  text not null default ('KS-' || to_char(nextval('public.farmer_reference_seq'), 'FM000000')),

  date_of_birth        date,
  land_size_acres      numeric(12, 3),
  primary_crop         text,

  village              text,
  address_line1        text,
  address_line2        text,
  pincode              text,

  -- Optional. Geolocation permission is never mandatory (Â§50, Â§60.13).
  latitude             numeric(9, 6),
  longitude            numeric(9, 6),

  state_id             uuid references public.states (id) on delete restrict,
  district_id          uuid references public.districts (id) on delete restrict,

  -- Overall status is DERIVED from the three parts by a trigger below.
  -- Do not write it directly; write the parts.
  verification_status              public.verification_status not null default 'PENDING',
  identity_verification_status     public.verification_status not null default 'PENDING',
  land_verification_status         public.verification_status not null default 'PENDING',
  document_verification_status     public.verification_status not null default 'PENDING',

  verified_at          timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint farmer_profiles_farmer_reference_id_key unique (farmer_reference_id),
  constraint farmer_profiles_land_size_positive
    check (land_size_acres is null or land_size_acres >= 0),
  constraint farmer_profiles_pincode_format
    check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  constraint farmer_profiles_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint farmer_profiles_longitude_range
    check (longitude is null or longitude between -180 and 180),
  -- A fixed lower bound, not `date_of_birth < current_date`: CHECK constraints
  -- must be IMMUTABLE and CURRENT_DATE is only STABLE. The "not in the future"
  -- rule belongs in validation, where it lives (schemas/farmer.ts).
  constraint farmer_profiles_dob_plausible
    check (date_of_birth is null or date_of_birth > date '1900-01-01')
);

create index if not exists farmer_profiles_district_id_idx on public.farmer_profiles (district_id);
create index if not exists farmer_profiles_state_id_idx on public.farmer_profiles (state_id);
create index if not exists farmer_profiles_verification_status_idx
  on public.farmer_profiles (verification_status);

comment on table public.farmer_profiles is
  'Farmer application profile. Authentication (mobile OTP) and verification are separate concepts (Â§15): an authenticated farmer is not a verified farmer.';

create trigger farmer_profiles_assert_role
  before insert or update of user_id on public.farmer_profiles
  for each row execute function app.assert_profile_role('FARMER');

create trigger farmer_profiles_touch_updated_at
  before update on public.farmer_profiles
  for each row execute function app.touch_updated_at();

-- The district must actually belong to the declared state.
create or replace function app.assert_farmer_location_consistent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owning_state uuid;
begin
  if new.district_id is null then
    return new;
  end if;

  select d.state_id into owning_state from public.districts d where d.id = new.district_id;

  if new.state_id is null then
    new.state_id := owning_state;
  elsif new.state_id <> owning_state then
    raise exception 'District % does not belong to state %', new.district_id, new.state_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_farmer_location_consistent() is
  'SECURITY DEFINER (reads public.districts): keeps farmer_profiles.state_id consistent with the chosen district. Reference-data lookup only; makes no authorization decision.';

create trigger farmer_profiles_assert_location
  before insert or update of state_id, district_id on public.farmer_profiles
  for each row execute function app.assert_farmer_location_consistent();

-- ---------------------------------------------------------------------------
-- Derived overall verification status (Â§15.1).
-- VERIFIED only when identity AND land AND document are all VERIFIED.
-- Mirrors deriveOverallVerificationStatus() in packages/shared.
-- ---------------------------------------------------------------------------

create or replace function app.derive_verification_status()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  parts public.verification_status[] := array[
    new.identity_verification_status,
    new.land_verification_status,
    new.document_verification_status
  ];
  derived public.verification_status;
begin
  if parts <@ array['VERIFIED']::public.verification_status[] then
    derived := 'VERIFIED';
  elsif 'REJECTED' = any (parts) then
    derived := 'REJECTED';
  elsif 'UNDER_REVIEW' = any (parts) then
    derived := 'UNDER_REVIEW';
  else
    derived := 'PENDING';
  end if;

  new.verification_status := derived;

  if derived = 'VERIFIED' then
    new.verified_at := coalesce(new.verified_at, now());
  else
    new.verified_at := null;
  end if;

  return new;
end;
$$;

comment on function app.derive_verification_status() is
  'Recomputes farmer_profiles.verification_status from its three parts so the overall status can never be set independently of the evidence.';

create trigger farmer_profiles_derive_verification
  before insert or update on public.farmer_profiles
  for each row execute function app.derive_verification_status();

-- ---------------------------------------------------------------------------
-- Farmer documents (Â§11). The bucket is private; storage paths are never
-- returned to clients â€” the API mints short-lived signed URLs instead (Â§29).
-- ---------------------------------------------------------------------------

create table if not exists public.farmer_documents (
  id                   uuid primary key default gen_random_uuid(),
  farmer_user_id       uuid not null references public.farmer_profiles (user_id) on delete cascade,

  document_type        public.document_type not null,

  storage_bucket       text not null default 'farmer-documents',
  storage_path         text not null,

  original_filename    text,
  mime_type            text,
  file_size_bytes      bigint,

  verification_status  public.verification_status not null default 'PENDING',

  reviewed_by          uuid references public.profiles (id) on delete set null,
  reviewed_at          timestamptz,
  rejection_reason     text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint farmer_documents_storage_path_key unique (storage_bucket, storage_path),
  constraint farmer_documents_mime_allowed
    check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  constraint farmer_documents_size_positive
    check (file_size_bytes is null or file_size_bytes > 0),
  constraint farmer_documents_rejection_reason_present
    check (verification_status <> 'REJECTED' or rejection_reason is not null),
  constraint farmer_documents_review_fields_paired
    check ((reviewed_by is null) = (reviewed_at is null))
);

create index if not exists farmer_documents_farmer_user_id_idx
  on public.farmer_documents (farmer_user_id);

create index if not exists farmer_documents_status_idx
  on public.farmer_documents (verification_status);

comment on column public.farmer_documents.storage_path is
  'Private object key, shaped <farmer-user-id>/<document-id>/<filename>. Never contains an identity number and is never exposed to clients.';

create trigger farmer_documents_touch_updated_at
  before update on public.farmer_documents
  for each row execute function app.touch_updated_at();


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000005_audit_logs.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0005 â€” audit logging (Â§31)
--
-- Written by the API through the service-role client only. No client-facing
-- policy is granted (see 0007): RLS is enabled with zero policies, so any
-- anon/authenticated read or write is denied.
-- ===========================================================================

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),

  actor_user_id  uuid references public.profiles (id) on delete set null,

  action         text not null,

  entity_type    text,
  entity_id      uuid,

  centre_id      uuid references public.procurement_centres (id) on delete set null,
  district_id    uuid references public.districts (id) on delete set null,
  state_id       uuid references public.states (id) on delete set null,

  metadata       jsonb not null default '{}'::jsonb,

  ip_address     inet,
  user_agent     text,
  request_id     text,

  created_at     timestamptz not null default now(),

  constraint audit_logs_action_not_blank check (char_length(trim(action)) > 0)
);

create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

comment on table public.audit_logs is
  'Security and verification event log. Never stores OTP values, access tokens, service-role keys, passwords or identity numbers (Â§31).';

comment on column public.audit_logs.metadata is
  'Non-sensitive contextual detail only. The API redacts a denylist of keys before insert.';


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000006_auth_helpers.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0006 â€” authorization helper functions (Â§28)
--
-- WHY SECURITY DEFINER: a policy on public.profiles that reads
-- public.profiles re-enters that table's own policies and recurses. These
-- helpers read the scope tables with the definer's rights, breaking the cycle.
--
-- RULES FOLLOWED HERE:
--   * Each function answers ONE narrow question about the CURRENT user.
--   * None of them takes a caller-supplied identity â€” they all key off
--     auth.uid(), so a client cannot ask "what is user X's scope?".
--   * None of them returns rows or grants access; they return a single id or
--     enum that a policy predicate then compares.
--   * search_path is pinned on every one of them.
--   * There is deliberately no can_access_everything()-style helper.
-- ===========================================================================

-- The current user's application role, or null if they have no profile yet
-- (authenticated but not yet onboarded).
create or replace function app.user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.status = 'ACTIVE';
$$;

comment on function app.user_role() is
  'SECURITY DEFINER. Returns the ACTIVE application role of auth.uid(), else null. Reads one column of one row of public.profiles. Takes no arguments so it cannot be used to probe another user.';

-- The one centre a CENTRE_STAFF user is assigned to (Â§12). Null for everyone else.
create or replace function app.staff_centre_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.centre_id
  from public.staff_profiles s
  join public.profiles p on p.id = s.user_id
  where s.user_id = (select auth.uid())
    and s.is_active
    and p.status = 'ACTIVE'
    and p.role = 'CENTRE_STAFF';
$$;

comment on function app.staff_centre_id() is
  'SECURITY DEFINER. Returns the single centre_id assigned to the calling CENTRE_STAFF user, else null.';

-- The one district a DISTRICT_ADMIN user governs (Â§13). Null for everyone else.
create or replace function app.admin_district_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.district_id
  from public.district_admin_profiles a
  join public.profiles p on p.id = a.user_id
  where a.user_id = (select auth.uid())
    and a.is_active
    and p.status = 'ACTIVE'
    and p.role = 'DISTRICT_ADMIN';
$$;

comment on function app.admin_district_id() is
  'SECURITY DEFINER. Returns the single district_id governed by the calling DISTRICT_ADMIN user, else null.';

-- The one state a STATE_ADMIN user governs (Â§14). Null for everyone else.
create or replace function app.admin_state_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.state_id
  from public.state_admin_profiles a
  join public.profiles p on p.id = a.user_id
  where a.user_id = (select auth.uid())
    and a.is_active
    and p.status = 'ACTIVE'
    and p.role = 'STATE_ADMIN';
$$;

comment on function app.admin_state_id() is
  'SECURITY DEFINER. Returns the single state_id governed by the calling STATE_ADMIN user, else null.';

-- Reference-data lookups. These resolve hierarchy edges so policies do not
-- have to sub-select protected tables. They leak nothing a signed-in user
-- cannot already read from districts/procurement_centres.
create or replace function app.state_of_district(p_district_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.state_id from public.districts d where d.id = p_district_id;
$$;

comment on function app.state_of_district(uuid) is
  'SECURITY DEFINER. Maps a district to its state. Hierarchy edge lookup only.';

create or replace function app.district_of_centre(p_centre_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.district_id from public.procurement_centres c where c.id = p_centre_id;
$$;

comment on function app.district_of_centre(uuid) is
  'SECURITY DEFINER. Maps a procurement centre to its district. Hierarchy edge lookup only.';

-- Composite predicates used by several policies. Still narrow: each answers
-- "may the CURRENT user reach this one centre/district?".
create or replace function app.can_read_centre(p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case app.user_role()
    when 'CENTRE_STAFF'  then p_centre_id = app.staff_centre_id()
    when 'DISTRICT_ADMIN' then app.district_of_centre(p_centre_id) = app.admin_district_id()
    when 'STATE_ADMIN'    then app.state_of_district(app.district_of_centre(p_centre_id)) = app.admin_state_id()
    -- Centre locations and opening hours are public-facing information a
    -- farmer needs in order to choose where to sell. Farmer-visible centre
    -- data carries no other party's personal data.
    when 'FARMER'         then true
    else false
  end;
$$;

comment on function app.can_read_centre(uuid) is
  'SECURITY DEFINER. True when the calling user''s role and scope reach the given centre. Staff: own centre. District admin: centres in own district. State admin: centres in own state. Farmer: any active centre (public-facing location data).';

create or replace function app.can_read_district(p_district_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case app.user_role()
    when 'CENTRE_STAFF'   then p_district_id = app.district_of_centre(app.staff_centre_id())
    when 'DISTRICT_ADMIN' then p_district_id = app.admin_district_id()
    when 'STATE_ADMIN'    then app.state_of_district(p_district_id) = app.admin_state_id()
    when 'FARMER'         then true
    else false
  end;
$$;

comment on function app.can_read_district(uuid) is
  'SECURITY DEFINER. True when the calling user''s role and scope reach the given district.';

revoke all on function app.user_role() from public;
revoke all on function app.staff_centre_id() from public;
revoke all on function app.admin_district_id() from public;
revoke all on function app.admin_state_id() from public;
revoke all on function app.state_of_district(uuid) from public;
revoke all on function app.district_of_centre(uuid) from public;
revoke all on function app.can_read_centre(uuid) from public;
revoke all on function app.can_read_district(uuid) from public;

grant execute on function app.user_role() to authenticated;
grant execute on function app.staff_centre_id() to authenticated;
grant execute on function app.admin_district_id() to authenticated;
grant execute on function app.admin_state_id() to authenticated;
grant execute on function app.state_of_district(uuid) to authenticated;
grant execute on function app.district_of_centre(uuid) to authenticated;
grant execute on function app.can_read_centre(uuid) to authenticated;
grant execute on function app.can_read_district(uuid) to authenticated;


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000007_rls.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0007 â€” Row Level Security (Â§27, Â§28)
--
-- This is the second of the two required security layers. The Express
-- middleware is the first; neither is allowed to be the only one.
-- Every policy below is scoped `to authenticated`, so the `anon` role has no
-- path to any application row.
-- ===========================================================================

alter table public.states                  enable row level security;
alter table public.districts               enable row level security;
alter table public.procurement_centres     enable row level security;
alter table public.profiles                enable row level security;
alter table public.farmer_profiles         enable row level security;
alter table public.farmer_documents        enable row level security;
alter table public.staff_profiles          enable row level security;
alter table public.district_admin_profiles enable row level security;
alter table public.state_admin_profiles    enable row level security;
alter table public.audit_logs              enable row level security;

-- Force RLS even for the tables' owner, so a future definer-context mistake
-- cannot quietly bypass the policies. (service_role still bypasses via BYPASSRLS.)
alter table public.farmer_profiles  force row level security;
alter table public.farmer_documents force row level security;

-- ---------------------------------------------------------------------------
-- Column guards. RLS decides which ROWS you touch; these decide which COLUMNS
-- you may change. Both are needed: an UPDATE policy that lets a farmer edit
-- their own row would otherwise let them edit their own verification status.
-- ---------------------------------------------------------------------------

create or replace function app.is_service_role()
returns boolean
language plpgsql
stable
set search_path = pg_catalog, auth, pg_temp
as $$
declare
  jwt_role text;
begin
  -- Direct superuser connections: migrations and the psql seed path.
  if current_user in ('postgres', 'supabase_admin') then
    return true;
  end if;

  -- PostgREST connections carry the key's role in the JWT.
  begin
    jwt_role := auth.role();
  exception when others then
    jwt_role := null;
  end;

  return jwt_role = 'service_role';
end;
$$;

comment on function app.is_service_role() is
  'True only for trusted server-side connections (service-role key, or direct superuser during migrations/seed).';

-- Role and account status are assigned by provisioning, never by the account
-- holder. This is what stops "change the role in the request and retry" (Â§60.5).
create or replace function app.protect_profile_privileges()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  new.role := old.role;
  new.status := old.status;
  return new;
end;
$$;

comment on function app.protect_profile_privileges() is
  'Silently pins profiles.role and profiles.status to their stored values for non-service-role writers. Role escalation by self-update is therefore impossible regardless of API behaviour.';

create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function app.protect_profile_privileges();

-- Verification outcomes are evidence-based server decisions, not self-declared.
--
-- INSERT is covered as well as UPDATE, and that is not incidental. The RLS
-- INSERT policy on farmer_profiles only constrains WHICH row you create, not
-- which columns you set â€” so without the INSERT branch a farmer could create
-- their own profile with identity/land/document already 'VERIFIED' and the
-- derive trigger would faithfully compute an overall VERIFIED from it.
create or replace function app.protect_farmer_verification()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A new profile always starts from zero evidence.
    new.identity_verification_status := 'PENDING';
    new.land_verification_status     := 'PENDING';
    new.document_verification_status := 'PENDING';
    new.verification_status          := 'PENDING';
    new.verified_at                  := null;
    -- Column defaults are applied before BEFORE-triggers run, so by now this
    -- holds either the sequence value or whatever the client sent â€” and the
    -- two are indistinguishable. Regenerating unconditionally is the only way
    -- to guarantee the client did not choose its own business key. The gap
    -- this leaves in the sequence is harmless.
    new.farmer_reference_id :=
      'KS-' || to_char(nextval('public.farmer_reference_seq'), 'FM000000');
    return new;
  end if;

  new.identity_verification_status := old.identity_verification_status;
  new.land_verification_status     := old.land_verification_status;
  new.document_verification_status := old.document_verification_status;
  new.verification_status          := old.verification_status;
  new.verified_at                  := old.verified_at;
  new.farmer_reference_id          := old.farmer_reference_id;
  return new;
end;
$$;

comment on function app.protect_farmer_verification() is
  'Pins verification columns and the farmer business key for non-service-role writers, on INSERT as well as UPDATE. A farmer may edit their details; they may not mark themselves VERIFIED, at creation time or later.';

-- PostgreSQL fires same-event triggers in name order. The "_a_" infix is load
-- bearing: this trigger must reset or restore the verification columns BEFORE
-- farmer_profiles_derive_verification recomputes the overall status from them.
-- ("farmer_profiles_a_..." < "farmer_profiles_derive_...")
create trigger farmer_profiles_a_protect_verification
  before insert or update on public.farmer_profiles
  for each row execute function app.protect_farmer_verification();

-- ---------------------------------------------------------------------------
-- states â€” reference data for any signed-in user.
-- Contains no personal data; the farmer onboarding form needs it.
-- ---------------------------------------------------------------------------

create policy states_select_authenticated
  on public.states for select to authenticated
  using (is_active);

-- ---------------------------------------------------------------------------
-- districts â€” scoped by the caller's place in the hierarchy (Â§27).
-- ---------------------------------------------------------------------------

create policy districts_select_in_scope
  on public.districts for select to authenticated
  using (app.can_read_district(id));

-- ---------------------------------------------------------------------------
-- procurement_centres â€” the core scope-isolation table.
--   staff          -> exactly their own centre
--   district admin -> centres in their district
--   state admin    -> centres in their state
--   farmer         -> active centres only
-- ---------------------------------------------------------------------------

create policy procurement_centres_select_in_scope
  on public.procurement_centres for select to authenticated
  using (
    app.can_read_centre(id)
    and (is_active or app.user_role() <> 'FARMER')
  );

-- ---------------------------------------------------------------------------
-- profiles â€” self only.
-- INSERT is restricted to role FARMER: this is the database-level half of
-- "no public self-registration for government roles" (Â§40, Â§60.12).
-- Staff/admin profiles are created by the service-role provisioning path,
-- which bypasses RLS.
-- ---------------------------------------------------------------------------

create policy profiles_select_self
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert_self_farmer_only
  on public.profiles for insert to authenticated
  with check (
    id = (select auth.uid())
    and role = 'FARMER'
    and status = 'ACTIVE'
  );

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- farmer_profiles â€” self only.
--
-- Deliberately NOT readable by staff or district/state admins in Phase 0.
-- Admin dashboards in later phases need aggregates, not farmer PII; when a
-- concrete business rule requires row access it gets its own narrow policy
-- rather than a blanket grant now.
-- ---------------------------------------------------------------------------

create policy farmer_profiles_select_self
  on public.farmer_profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy farmer_profiles_insert_self
  on public.farmer_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy farmer_profiles_update_self
  on public.farmer_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- farmer_documents â€” self only, and only unreviewed documents may be removed.
-- ---------------------------------------------------------------------------

create policy farmer_documents_select_own
  on public.farmer_documents for select to authenticated
  using (farmer_user_id = (select auth.uid()));

create policy farmer_documents_insert_own
  on public.farmer_documents for insert to authenticated
  with check (
    farmer_user_id = (select auth.uid())
    and verification_status = 'PENDING'
    and reviewed_by is null
    and reviewed_at is null
  );

create policy farmer_documents_delete_own_unreviewed
  on public.farmer_documents for delete to authenticated
  using (
    farmer_user_id = (select auth.uid())
    and verification_status = 'PENDING'
    and reviewed_at is null
  );

-- No UPDATE policy: review outcomes are written by the server, not the owner.

-- ---------------------------------------------------------------------------
-- Scope profiles â€” self, plus the admin above them in the hierarchy.
-- ---------------------------------------------------------------------------

create policy staff_profiles_select_self_or_supervising_admin
  on public.staff_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      app.user_role() in ('DISTRICT_ADMIN', 'STATE_ADMIN')
      and app.can_read_centre(centre_id)
    )
  );

create policy district_admin_profiles_select_self_or_state_admin
  on public.district_admin_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      app.user_role() = 'STATE_ADMIN'
      and app.state_of_district(district_id) = app.admin_state_id()
    )
  );

create policy state_admin_profiles_select_self
  on public.state_admin_profiles for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_logs â€” no client-facing policy at all.
-- RLS is enabled with zero policies, which denies every anon/authenticated
-- read and write. Only the service-role API path writes here.
-- ---------------------------------------------------------------------------

revoke all on public.audit_logs from anon, authenticated;


-- ###########################################################################
-- SOURCE: supabase/migrations/20260101000008_storage.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 0 / 0008 â€” private document storage (Â§29, Â§30)
--
-- Path shape: farmer-documents/<farmer-user-id>/<document-id>/<filename>
-- The first path segment is the owning user's id, which is what the policies
-- below key off. Identity numbers never appear in a path or a filename.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'farmer-documents',
  'farmer-documents',
  false,                                              -- PRIVATE. Never flip this.
  10485760,                                           -- 10 MB, mirrors MAX_UPLOAD_BYTES
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are reachable only through short-lived signed URLs minted by the
-- API after it has checked role and scope. These policies are what make the
-- signing call itself safe: the API signs using the *caller's* token, so a
-- request for someone else's object fails in the database, not just in code.

create policy farmer_documents_objects_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy farmer_documents_objects_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy farmer_documents_objects_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'farmer-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No UPDATE policy: documents are immutable once uploaded. Replacing one
-- means deleting the unreviewed original and uploading again, which leaves
-- an audit trail of both events.


-- ###########################################################################
-- SOURCE: supabase/migrations/20260201000009_registration.sql
-- ###########################################################################

-- ===========================================================================
-- Phase 1 / 0009 â€” farmer registration & verification
--
-- This migration REPLACES the Phase 0 verification shape. Phase 0 kept three
-- status columns on farmer_profiles (identity/land/document) with an overall
-- status derived by trigger. Phase 1 Â§18 rejects exactly that: component
-- verification must be modelled explicitly as verification *checks*, and the
-- farmer-facing state is a registration state machine (Â§33).
--
-- What changes:
--   * farmer_profiles gains registration_status + current_step + save/resume
--   * the three verification columns move to farmer_verification_checks
--   * land moves out of farmer_profiles into farmer_land_holdings (Â§12, Â§13)
--   * farmer_documents gets the Â§17 status vocabulary and replacement chains
--   * document_requirements makes required documents / photo configurable
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.registration_status as enum (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'RESUBMISSION_REQUIRED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.registration_step as enum (
    'PERSONAL_DETAILS',
    'ADDRESS',
    'LAND_DETAILS',
    'DOCUMENTS',
    'PHOTO',
    'REVIEW'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.land_ownership_type as enum (
    'OWNED',
    'LEASED',
    'SHARECROPPED',
    'TENANT',
    'FAMILY_OWNED',
    'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.land_area_unit as enum ('ACRE', 'HECTARE', 'CENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gender as enum ('FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY');
exception when duplicate_object then null; end $$;

-- Â§17 document lifecycle. Deliberately distinct from verification_status:
-- a document being ACCEPTED is not the same as a check passing.
do $$ begin
  create type public.document_status as enum (
    'UPLOADED',
    'UNDER_REVIEW',
    'ACCEPTED',
    'REJECTED',
    'REPLACEMENT_REQUIRED'
  );
exception when duplicate_object then null; end $$;

-- Â§18: component verification modelled explicitly rather than as flags.
do $$ begin
  create type public.verification_check_type as enum (
    'IDENTITY',
    'ADDRESS',
    'LAND',
    'DOCUMENTS',
    'PHOTO'
  );
exception when duplicate_object then null; end $$;

-- A superset of the Phase 0 document_type, adding FARMER_PHOTO (Â§15).
-- Built as a NEW type rather than `alter type â€¦ add value` so this migration
-- stays safe inside a single transaction â€” adding an enum value and using it
-- in the same transaction is not allowed.
do $$ begin
  create type public.document_kind as enum (
    'LAND_RECORD',
    'BANK_PASSBOOK',
    'IDENTITY_PROOF',
    'ADDRESS_PROOF',
    'CROP_PHOTO',
    'FARMER_PHOTO',
    'OTHER'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- farmer_profiles â€” registration state, save/resume, residence only
-- ---------------------------------------------------------------------------

alter table public.farmer_profiles
  add column if not exists registration_status public.registration_status not null default 'DRAFT',
  add column if not exists current_step public.registration_step not null default 'PERSONAL_DETAILS',
  add column if not exists last_saved_at timestamptz not null default now(),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists review_notes text,
  add column if not exists gender public.gender,
  add column if not exists full_name_local text;

comment on column public.farmer_profiles.registration_status is
  'The Â§33 state machine. Written only by the backend â€” app.protect_farmer_registration() discards it for every other writer.';

comment on column public.farmer_profiles.current_step is
  'Resume position (Â§21). Farmer-writable: it is navigation state, not a business outcome.';

comment on column public.farmer_profiles.full_name_local is
  'Optional name in the farmer''s own script (e.g. Tamil). Never a translation of full_name â€” farmer-entered data is never machine-translated (Â§4).';

-- Land moves to farmer_land_holdings; residence stays here (Â§12).
alter table public.farmer_profiles
  drop column if exists land_size_acres,
  drop column if exists primary_crop;

-- The Phase 0 verification shape, replaced by farmer_verification_checks (Â§18).
drop trigger if exists farmer_profiles_derive_verification on public.farmer_profiles;
drop function if exists app.derive_verification_status();

alter table public.farmer_profiles
  drop column if exists verification_status,
  drop column if exists identity_verification_status,
  drop column if exists land_verification_status,
  drop column if exists document_verification_status;

create index if not exists farmer_profiles_registration_status_idx
  on public.farmer_profiles (registration_status);

-- ---------------------------------------------------------------------------
-- farmer_land_holdings (Â§13)
--
-- Separate from residence, and 1..n from the start: farmers commonly work
-- several parcels under different ownership arrangements.
-- ---------------------------------------------------------------------------

create table if not exists public.farmer_land_holdings (
  id                  uuid primary key default gen_random_uuid(),
  farmer_user_id      uuid not null references public.farmer_profiles (user_id) on delete cascade,

  ownership_type      public.land_ownership_type not null,
  area                numeric(12, 3) not null,
  area_unit           public.land_area_unit not null default 'ACRE',

  -- Survey / patta number. Free text: formats differ by state and we do not
  -- pretend to validate against a land-records system that we cannot reach (Â§13).
  survey_number       text,

  village             text,
  district_id         uuid references public.districts (id) on delete restrict,
  state_id            uuid references public.states (id) on delete restrict,
  pincode             text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),

  primary_crop        text,

  -- Â§14: submitting a document is NOT land verification. This column only
  -- moves to VERIFIED when an authorised reviewer says so.
  verification_status public.verification_status not null default 'PENDING',
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  rejection_reason    text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint farmer_land_holdings_area_positive check (area > 0),
  constraint farmer_land_holdings_area_sane check (area <= 100000),
  constraint farmer_land_holdings_pincode_format
    check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  constraint farmer_land_holdings_latitude_range
    check (latitude is null or latitude between -90 and 90),
  constraint farmer_land_holdings_longitude_range
    check (longitude is null or longitude between -180 and 180),
  constraint farmer_land_holdings_review_paired
    check ((reviewed_by is null) = (reviewed_at is null))
);

create index if not exists farmer_land_holdings_farmer_idx
  on public.farmer_land_holdings (farmer_user_id);

comment on table public.farmer_land_holdings is
  'Agricultural land declared by a farmer. Its verification_status is independent of any document status (Â§14): DOCUMENT_SUBMITTED is not LAND_VERIFIED.';

create trigger farmer_land_holdings_touch_updated_at
  before update on public.farmer_land_holdings
  for each row execute function app.touch_updated_at();

-- Land location must be internally consistent, same rule as residence.
create or replace function app.assert_land_location_consistent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owning_state uuid;
begin
  if new.district_id is null then
    return new;
  end if;

  select d.state_id into owning_state from public.districts d where d.id = new.district_id;

  if new.state_id is null then
    new.state_id := owning_state;
  elsif new.state_id <> owning_state then
    raise exception 'District % does not belong to state %', new.district_id, new.state_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.assert_land_location_consistent() is
  'SECURITY DEFINER (reads public.districts): keeps a land holding''s state consistent with its district. Reference lookup only.';

create trigger farmer_land_holdings_assert_location
  before insert or update of state_id, district_id on public.farmer_land_holdings
  for each row execute function app.assert_land_location_consistent();

-- ---------------------------------------------------------------------------
-- farmer_verification_checks (Â§18)
--
-- One row per component check. This is the explicit model Phase 1 asks for in
-- place of identityVerified / landVerified / documentsVerified booleans: each
-- check carries its own reviewer, timestamp and reason.
-- ---------------------------------------------------------------------------

create table if not exists public.farmer_verification_checks (
  farmer_user_id  uuid not null references public.farmer_profiles (user_id) on delete cascade,
  check_type      public.verification_check_type not null,

  status          public.verification_status not null default 'PENDING',
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (farmer_user_id, check_type),
  constraint farmer_verification_checks_review_paired
    check ((reviewed_by is null) = (reviewed_at is null))
);

comment on table public.farmer_verification_checks is
  'Component verification outcomes (Â§18). Written only by authorised review workflows; a farmer can read their own rows and change none of them.';

create trigger farmer_verification_checks_touch_updated_at
  before update on public.farmer_verification_checks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- document_requirements (Â§14, Â§15)
--
-- Which documents are required, and whether a photograph is required, is
-- configuration â€” not something hard-coded into the client. Labels live in the
-- i18n bundles under `translation_key` so Â§4 (no hard-coded UI strings) holds.
-- ---------------------------------------------------------------------------

create table if not exists public.document_requirements (
  document_kind    public.document_kind primary key,
  is_required      boolean not null default false,
  is_active        boolean not null default true,
  display_order    integer not null default 100,
  translation_key  text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.document_requirements is
  'Configurable registration document policy. Changing a row changes what registration demands, with no code deploy. No claim is made here that any document is officially sufficient (Â§14).';

create trigger document_requirements_touch_updated_at
  before update on public.document_requirements
  for each row execute function app.touch_updated_at();

insert into public.document_requirements (document_kind, is_required, display_order, translation_key)
values
  ('LAND_RECORD',    true,  10, 'document.kind.landRecord'),
  ('IDENTITY_PROOF', true,  20, 'document.kind.identityProof'),
  ('BANK_PASSBOOK',  true,  30, 'document.kind.bankPassbook'),
  ('ADDRESS_PROOF',  false, 40, 'document.kind.addressProof'),
  ('FARMER_PHOTO',   true,  50, 'document.kind.farmerPhoto'),
  ('CROP_PHOTO',     false, 60, 'document.kind.cropPhoto'),
  ('OTHER',          false, 90, 'document.kind.other')
on conflict (document_kind) do nothing;

-- ---------------------------------------------------------------------------
-- farmer_documents â€” Â§17 vocabulary, photo support, replacement chains
-- ---------------------------------------------------------------------------

-- The Phase 0 policies read verification_status, so they must go before the
-- column does. They are recreated against `status` further down.
drop policy if exists farmer_documents_insert_own on public.farmer_documents;
drop policy if exists farmer_documents_delete_own_unreviewed on public.farmer_documents;

alter table public.farmer_documents
  drop constraint if exists farmer_documents_rejection_reason_present;

-- Swap document_type onto the wider document_kind type.
alter table public.farmer_documents
  alter column document_type type public.document_kind
  using document_type::text::public.document_kind;

-- Replace the Phase 0 verification_status with the Â§17 document lifecycle.
alter table public.farmer_documents
  add column if not exists status public.document_status not null default 'UPLOADED',
  add column if not exists replaces_document_id uuid references public.farmer_documents (id) on delete set null,
  add column if not exists superseded_at timestamptz;

update public.farmer_documents
set status = case verification_status::text
  when 'VERIFIED' then 'ACCEPTED'::public.document_status
  when 'REJECTED' then 'REJECTED'::public.document_status
  when 'UNDER_REVIEW' then 'UNDER_REVIEW'::public.document_status
  else 'UPLOADED'::public.document_status
end
where true;

alter table public.farmer_documents drop column if exists verification_status;

alter table public.farmer_documents
  add constraint farmer_documents_rejection_reason_present
    check (status not in ('REJECTED', 'REPLACEMENT_REQUIRED') or rejection_reason is not null);

create index if not exists farmer_documents_status_v2_idx
  on public.farmer_documents (farmer_user_id, status);

-- At most one live document of each kind per farmer. Superseded rows are kept
-- for the audit trail but excluded from the constraint.
create unique index if not exists farmer_documents_one_live_per_kind
  on public.farmer_documents (farmer_user_id, document_type)
  where superseded_at is null;

comment on column public.farmer_documents.replaces_document_id is
  'Set when this upload replaces a rejected document, so the review history of a resubmission stays intact.';

-- ---------------------------------------------------------------------------
-- Registration state machine (Â§33)
--
-- Transitions are backend-only. app.protect_farmer_registration() discards a
-- status written by anyone but the service role, and this trigger additionally
-- refuses an invalid transition even from the backend.
-- ---------------------------------------------------------------------------

create or replace function app.assert_registration_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  allowed boolean;
begin
  if old.registration_status = new.registration_status then
    return new;
  end if;

  allowed := case old.registration_status
    when 'DRAFT'                 then new.registration_status in ('SUBMITTED')
    when 'SUBMITTED'             then new.registration_status in ('UNDER_REVIEW', 'DRAFT')
    when 'UNDER_REVIEW'          then new.registration_status in ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED')
    when 'RESUBMISSION_REQUIRED' then new.registration_status in ('DRAFT')
    when 'REJECTED'              then new.registration_status in ('DRAFT')
    -- VERIFIED is terminal. Re-opening a verified registration is a
    -- deliberate administrative act and gets its own path when one exists.
    when 'VERIFIED'              then false
    else false
  end;

  if not allowed then
    raise exception 'Invalid registration transition % -> %', old.registration_status, new.registration_status
      using errcode = 'check_violation';
  end if;

  -- Keep the timestamps honest rather than trusting the caller to set them.
  if new.registration_status = 'SUBMITTED' then
    new.submitted_at := now();
  end if;

  if new.registration_status in ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED') then
    new.reviewed_at := coalesce(new.reviewed_at, now());
  end if;

  new.verified_at := case when new.registration_status = 'VERIFIED' then now() else null end;

  return new;
end;
$$;

comment on function app.assert_registration_transition() is
  'Enforces the Â§33 registration state machine and stamps submitted_at / reviewed_at / verified_at. Applies to every writer including the service role.';

-- Replaces the Phase 0 verification-column guard, which referenced columns
-- that no longer exist.
create or replace function app.protect_farmer_registration()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.registration_status := 'DRAFT';
    new.submitted_at        := null;
    new.reviewed_at         := null;
    new.reviewed_by         := null;
    new.review_notes        := null;
    new.verified_at         := null;
    new.farmer_reference_id :=
      'KS-' || to_char(nextval('public.farmer_reference_seq'), 'FM000000');
    return new;
  end if;

  -- A farmer may edit their details and move their resume position. They may
  -- not move their own registration through the state machine (Â§33).
  new.registration_status := old.registration_status;
  new.submitted_at        := old.submitted_at;
  new.reviewed_at         := old.reviewed_at;
  new.reviewed_by         := old.reviewed_by;
  new.review_notes        := old.review_notes;
  new.verified_at         := old.verified_at;
  new.farmer_reference_id := old.farmer_reference_id;

  -- Any farmer-side edit refreshes the save/resume marker.
  new.last_saved_at := now();
  return new;
end;
$$;

comment on function app.protect_farmer_registration() is
  'Pins registration status, review fields and the business key for non-service-role writers, on INSERT and UPDATE. A farmer cannot submit {"status":"VERIFIED"} and cause verification.';

drop trigger if exists farmer_profiles_a_protect_verification on public.farmer_profiles;
drop function if exists app.protect_farmer_verification();

-- Name ordering matters: "_a_" runs the guard before the transition check, so
-- a farmer-supplied status is discarded before the machine ever sees it.
create trigger farmer_profiles_a_protect_registration
  before insert or update on public.farmer_profiles
  for each row execute function app.protect_farmer_registration();

create trigger farmer_profiles_b_assert_transition
  before update on public.farmer_profiles
  for each row execute function app.assert_registration_transition();

-- Land verification outcomes are reviewer decisions too.
create or replace function app.protect_land_verification()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status := 'PENDING';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
    return new;
  end if;

  new.verification_status := old.verification_status;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.rejection_reason := old.rejection_reason;
  return new;
end;
$$;

comment on function app.protect_land_verification() is
  'Pins land verification fields for non-service-role writers. Declaring land is not verifying it (Â§14).';

create trigger farmer_land_holdings_protect_verification
  before insert or update on public.farmer_land_holdings
  for each row execute function app.protect_land_verification();

-- Document review outcomes likewise.
create or replace function app.protect_document_status()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if app.is_service_role() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'UPLOADED';
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.rejection_reason := null;
    new.superseded_at := null;
    return new;
  end if;

  new.status := old.status;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.rejection_reason := old.rejection_reason;
  return new;
end;
$$;

comment on function app.protect_document_status() is
  'Pins document review fields for non-service-role writers (Â§17).';

create trigger farmer_documents_protect_status
  before insert or update on public.farmer_documents
  for each row execute function app.protect_document_status();

-- ---------------------------------------------------------------------------
-- Editability helper (Â§19: no unauthorised edits while under review)
--
-- Defined before the policies below, which call it.
-- ---------------------------------------------------------------------------

create or replace function app.registration_is_editable(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select f.registration_status in ('DRAFT', 'RESUBMISSION_REQUIRED', 'REJECTED')
     from public.farmer_profiles f
     where f.user_id = p_user_id),
    false
  );
$$;

comment on function app.registration_is_editable(uuid) is
  'SECURITY DEFINER. True while a farmer''s registration is in an editable state. Used by policies so "locked while under review" is enforced by the database, not only by the UI.';

revoke all on function app.registration_is_editable(uuid) from public;
grant execute on function app.registration_is_editable(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS for the new tables (Â§28)
-- ---------------------------------------------------------------------------

alter table public.farmer_land_holdings       enable row level security;
alter table public.farmer_verification_checks enable row level security;
alter table public.document_requirements      enable row level security;

alter table public.farmer_land_holdings       force row level security;
alter table public.farmer_verification_checks force row level security;

-- Land: a farmer manages their own holdings, and only while the registration
-- is still editable. Once submitted, edits go through resubmission (Â§19).
create policy farmer_land_holdings_select_own
  on public.farmer_land_holdings for select to authenticated
  using (farmer_user_id = (select auth.uid()));

create policy farmer_land_holdings_insert_own
  on public.farmer_land_holdings for insert to authenticated
  with check (
    farmer_user_id = (select auth.uid())
    and app.registration_is_editable((select auth.uid()))
  );

create policy farmer_land_holdings_update_own
  on public.farmer_land_holdings for update to authenticated
  using (
    farmer_user_id = (select auth.uid())
    and app.registration_is_editable((select auth.uid()))
  )
  with check (farmer_user_id = (select auth.uid()));

create policy farmer_land_holdings_delete_own
  on public.farmer_land_holdings for delete to authenticated
  using (
    farmer_user_id = (select auth.uid())
    and app.registration_is_editable((select auth.uid()))
  );

-- Verification checks: readable by the farmer they concern, writable by nobody
-- through the client. No INSERT/UPDATE/DELETE policy exists at all.
create policy farmer_verification_checks_select_own
  on public.farmer_verification_checks for select to authenticated
  using (farmer_user_id = (select auth.uid()));

-- Requirements are configuration every signed-in user may read.
create policy document_requirements_select_authenticated
  on public.document_requirements for select to authenticated
  using (is_active);

-- ---------------------------------------------------------------------------
-- Tighten the existing farmer-owned policies with the same editability rule
-- ---------------------------------------------------------------------------

drop policy if exists farmer_profiles_update_self on public.farmer_profiles;
create policy farmer_profiles_update_self
  on public.farmer_profiles for update to authenticated
  using (
    user_id = (select auth.uid())
    and app.registration_is_editable((select auth.uid()))
  )
  with check (user_id = (select auth.uid()));

drop policy if exists farmer_documents_insert_own on public.farmer_documents;
create policy farmer_documents_insert_own
  on public.farmer_documents for insert to authenticated
  with check (
    farmer_user_id = (select auth.uid())
    and status = 'UPLOADED'
    and reviewed_by is null
    and reviewed_at is null
    and app.registration_is_editable((select auth.uid()))
  );

drop policy if exists farmer_documents_delete_own_unreviewed on public.farmer_documents;
create policy farmer_documents_delete_own_unreviewed
  on public.farmer_documents for delete to authenticated
  using (
    farmer_user_id = (select auth.uid())
    and status = 'UPLOADED'
    and reviewed_at is null
    and app.registration_is_editable((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- The Phase 0 document_type enum is now unused.
-- ---------------------------------------------------------------------------

drop type if exists public.document_type;

