-- ===========================================================================
-- Phase 0 / 0001 — extensions, enums, shared trigger functions
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums (§8). Kept in sync with packages/shared/src/{roles,status}.ts.
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
-- updated_at maintenance (§54 "updated_at behavior is implemented").
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
