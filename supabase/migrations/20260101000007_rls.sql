-- ===========================================================================
-- Phase 0 / 0007 — Row Level Security (§27, §28)
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
-- holder. This is what stops "change the role in the request and retry" (§60.5).
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
-- which columns you set — so without the INSERT branch a farmer could create
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
    -- holds either the sequence value or whatever the client sent — and the
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
-- states — reference data for any signed-in user.
-- Contains no personal data; the farmer onboarding form needs it.
-- ---------------------------------------------------------------------------

create policy states_select_authenticated
  on public.states for select to authenticated
  using (is_active);

-- ---------------------------------------------------------------------------
-- districts — scoped by the caller's place in the hierarchy (§27).
-- ---------------------------------------------------------------------------

create policy districts_select_in_scope
  on public.districts for select to authenticated
  using (app.can_read_district(id));

-- ---------------------------------------------------------------------------
-- procurement_centres — the core scope-isolation table.
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
-- profiles — self only.
-- INSERT is restricted to role FARMER: this is the database-level half of
-- "no public self-registration for government roles" (§40, §60.12).
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
-- farmer_profiles — self only.
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
-- farmer_documents — self only, and only unreviewed documents may be removed.
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
-- Scope profiles — self, plus the admin above them in the hierarchy.
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
-- audit_logs — no client-facing policy at all.
-- RLS is enabled with zero policies, which denies every anon/authenticated
-- read and write. Only the service-role API path writes here.
-- ---------------------------------------------------------------------------

revoke all on public.audit_logs from anon, authenticated;
