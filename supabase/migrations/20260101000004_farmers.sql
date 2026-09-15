-- ===========================================================================
-- Phase 0 / 0004 — farmer profile, verification model, documents (§10, §11, §15)
-- ===========================================================================

create sequence if not exists public.farmer_reference_seq start with 100001;

-- Needed both by the column default and by app.protect_farmer_verification(),
-- which regenerates the reference id on insert and is not SECURITY DEFINER.
grant usage, select on sequence public.farmer_reference_seq to authenticated, service_role;

create table if not exists public.farmer_profiles (
  user_id              uuid primary key references public.profiles (id) on delete cascade,

  -- The application's farmer business key. Deliberately NOT an Aadhaar
  -- number (§10, §48): identity credentials are not business keys.
  farmer_reference_id  text not null default ('KS-' || to_char(nextval('public.farmer_reference_seq'), 'FM000000')),

  date_of_birth        date,
  land_size_acres      numeric(12, 3),
  primary_crop         text,

  village              text,
  address_line1        text,
  address_line2        text,
  pincode              text,

  -- Optional. Geolocation permission is never mandatory (§50, §60.13).
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
  'Farmer application profile. Authentication (mobile OTP) and verification are separate concepts (§15): an authenticated farmer is not a verified farmer.';

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
-- Derived overall verification status (§15.1).
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
-- Farmer documents (§11). The bucket is private; storage paths are never
-- returned to clients — the API mints short-lived signed URLs instead (§29).
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
