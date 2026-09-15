-- ===========================================================================
-- Phase 0 / 0003 — application profiles (§9, §12, §13, §14)
--
-- Supabase Auth owns identity in auth.users. This file owns *application*
-- identity. Passwords/OTP secrets are never duplicated here.
-- ===========================================================================

create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  role                public.app_role not null,
  full_name           text,
  -- Mirrored from the authenticated Supabase identity (auth.users.phone) by a
  -- trigger below. Clients cannot substitute an arbitrary number (§9.1).
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
  'SECURITY DEFINER (reads auth.users): forces profiles.phone to the verified phone on the auth identity. Narrow by design — it reads exactly one column for exactly the row being written.';

create trigger profiles_sync_phone
  before insert or update on public.profiles
  for each row execute function app.sync_profile_phone();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Role-specific profiles. Each carries exactly one organizational scope (§7).
-- Security scope is read from these rows — never from a request parameter.
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
  'SECURITY DEFINER (reads public.profiles): asserts a role-specific scope row is attached to a profile of the matching role. Narrow by design — single row, single column, no authorization decision.';

create trigger staff_profiles_assert_role
  before insert or update of user_id on public.staff_profiles
  for each row execute function app.assert_profile_role('CENTRE_STAFF');

create trigger district_admin_profiles_assert_role
  before insert or update of user_id on public.district_admin_profiles
  for each row execute function app.assert_profile_role('DISTRICT_ADMIN');

create trigger state_admin_profiles_assert_role
  before insert or update of user_id on public.state_admin_profiles
  for each row execute function app.assert_profile_role('STATE_ADMIN');
