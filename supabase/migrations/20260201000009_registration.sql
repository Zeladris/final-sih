-- ===========================================================================
-- Phase 1 / 0009 — farmer registration & verification
--
-- This migration REPLACES the Phase 0 verification shape. Phase 0 kept three
-- status columns on farmer_profiles (identity/land/document) with an overall
-- status derived by trigger. Phase 1 §18 rejects exactly that: component
-- verification must be modelled explicitly as verification *checks*, and the
-- farmer-facing state is a registration state machine (§33).
--
-- What changes:
--   * farmer_profiles gains registration_status + current_step + save/resume
--   * the three verification columns move to farmer_verification_checks
--   * land moves out of farmer_profiles into farmer_land_holdings (§12, §13)
--   * farmer_documents gets the §17 status vocabulary and replacement chains
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

-- §17 document lifecycle. Deliberately distinct from verification_status:
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

-- §18: component verification modelled explicitly rather than as flags.
do $$ begin
  create type public.verification_check_type as enum (
    'IDENTITY',
    'ADDRESS',
    'LAND',
    'DOCUMENTS',
    'PHOTO'
  );
exception when duplicate_object then null; end $$;

-- A superset of the Phase 0 document_type, adding FARMER_PHOTO (§15).
-- Built as a NEW type rather than `alter type … add value` so this migration
-- stays safe inside a single transaction — adding an enum value and using it
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
-- farmer_profiles — registration state, save/resume, residence only
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
  'The §33 state machine. Written only by the backend — app.protect_farmer_registration() discards it for every other writer.';

comment on column public.farmer_profiles.current_step is
  'Resume position (§21). Farmer-writable: it is navigation state, not a business outcome.';

comment on column public.farmer_profiles.full_name_local is
  'Optional name in the farmer''s own script (e.g. Tamil). Never a translation of full_name — farmer-entered data is never machine-translated (§4).';

-- Land moves to farmer_land_holdings; residence stays here (§12).
alter table public.farmer_profiles
  drop column if exists land_size_acres,
  drop column if exists primary_crop;

-- The Phase 0 verification shape, replaced by farmer_verification_checks (§18).
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
-- farmer_land_holdings (§13)
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
  -- pretend to validate against a land-records system that we cannot reach (§13).
  survey_number       text,

  village             text,
  district_id         uuid references public.districts (id) on delete restrict,
  state_id            uuid references public.states (id) on delete restrict,
  pincode             text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),

  primary_crop        text,

  -- §14: submitting a document is NOT land verification. This column only
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
  'Agricultural land declared by a farmer. Its verification_status is independent of any document status (§14): DOCUMENT_SUBMITTED is not LAND_VERIFIED.';

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
-- farmer_verification_checks (§18)
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
  'Component verification outcomes (§18). Written only by authorised review workflows; a farmer can read their own rows and change none of them.';

create trigger farmer_verification_checks_touch_updated_at
  before update on public.farmer_verification_checks
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- document_requirements (§14, §15)
--
-- Which documents are required, and whether a photograph is required, is
-- configuration — not something hard-coded into the client. Labels live in the
-- i18n bundles under `translation_key` so §4 (no hard-coded UI strings) holds.
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
  'Configurable registration document policy. Changing a row changes what registration demands, with no code deploy. No claim is made here that any document is officially sufficient (§14).';

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
-- farmer_documents — §17 vocabulary, photo support, replacement chains
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

-- Replace the Phase 0 verification_status with the §17 document lifecycle.
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
-- Registration state machine (§33)
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
  'Enforces the §33 registration state machine and stamps submitted_at / reviewed_at / verified_at. Applies to every writer including the service role.';

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
  -- not move their own registration through the state machine (§33).
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
  'Pins land verification fields for non-service-role writers. Declaring land is not verifying it (§14).';

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
  'Pins document review fields for non-service-role writers (§17).';

create trigger farmer_documents_protect_status
  before insert or update on public.farmer_documents
  for each row execute function app.protect_document_status();

-- ---------------------------------------------------------------------------
-- Editability helper (§19: no unauthorised edits while under review)
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
-- RLS for the new tables (§28)
-- ---------------------------------------------------------------------------

alter table public.farmer_land_holdings       enable row level security;
alter table public.farmer_verification_checks enable row level security;
alter table public.document_requirements      enable row level security;

alter table public.farmer_land_holdings       force row level security;
alter table public.farmer_verification_checks force row level security;

-- Land: a farmer manages their own holdings, and only while the registration
-- is still editable. Once submitted, edits go through resubmission (§19).
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
