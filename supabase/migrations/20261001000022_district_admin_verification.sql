-- ===========================================================================
-- Phase 14 / 0022 — farmer verification moves to the DISTRICT ADMIN
--
-- Phase 5 gave a submitted registration to centre staff, scoped to their
-- centre's district (nothing tied a farmer to a specific centre at the time).
-- That was always a placeholder scope, and administrative verification does
-- not belong in an operational, procurement-facing role. It moves to the
-- District Admin, who already governs exactly one district
-- (district_admin_profiles.district_id, via app.admin_district_id() —
-- Phase 0 §13), which is the farmer's own administrative district
-- (farmer_profiles.district_id). No new relationship is needed.
--
-- What does NOT change: the registration state machine (Phase 1), the
-- review-ownership columns and their triggers (Phase 5's
-- review_started_at/by, app.stamp_review_transition,
-- app.protect_farmer_registration), or the write model — every status
-- change still goes through the service-role-only guarded transition, never
-- a generic client PATCH.
--
-- Centre staff lose all read access to farmer_profiles/land/documents/checks
-- gained in Phase 5. They keep everything about procurement operations,
-- which never depended on this.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Drop the staff scope helpers and the policies built on them
-- ---------------------------------------------------------------------------

drop policy if exists farmer_profiles_select_reviewing_staff on public.farmer_profiles;
drop policy if exists farmer_land_holdings_select_reviewing_staff on public.farmer_land_holdings;
drop policy if exists farmer_documents_select_reviewing_staff on public.farmer_documents;
drop policy if exists farmer_verification_checks_select_reviewing_staff on public.farmer_verification_checks;
drop policy if exists profiles_select_reviewing_staff on public.profiles;
drop policy if exists farmer_documents_objects_select_reviewing_staff on storage.objects;

drop function if exists app.staff_can_review_farmer(uuid);
drop function if exists app.staff_district_id();

-- ---------------------------------------------------------------------------
-- District admin scope helper
--
-- Mirrors the retired app.staff_can_review_farmer(), keyed to the admin's own
-- district (app.admin_district_id(), Phase 0 §13) rather than a centre's.
-- Same second condition: a DRAFT registration is the farmer's private
-- work-in-progress and is never visible to a reviewer.
-- ---------------------------------------------------------------------------

create or replace function app.district_admin_can_review_farmer(p_farmer_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.farmer_profiles f
    where f.user_id = p_farmer_user_id
      and f.district_id = app.admin_district_id()
      and f.registration_status <> 'DRAFT'
  ) and app.user_role() = 'DISTRICT_ADMIN';
$$;

comment on function app.district_admin_can_review_farmer(uuid) is
  'SECURITY DEFINER. True when the calling DISTRICT_ADMIN user may review the given farmer: same district, and the registration has left DRAFT. A farmer''s unsubmitted draft is never visible to a reviewer.';

revoke all on function app.district_admin_can_review_farmer(uuid) from public;
grant execute on function app.district_admin_can_review_farmer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- District admin read access to submitted farmer records
--
-- Additive, same shape as the retired staff policies: a farmer's own-access
-- policy is untouched, and every state/district admin analytics policy from
-- Phase 12 is untouched — this grants only the district admin a second,
-- narrower read path to a farmer inside their own district.
-- ---------------------------------------------------------------------------

create policy farmer_profiles_select_reviewing_district_admin
  on public.farmer_profiles for select to authenticated
  using (app.district_admin_can_review_farmer(user_id));

create policy farmer_land_holdings_select_reviewing_district_admin
  on public.farmer_land_holdings for select to authenticated
  using (app.district_admin_can_review_farmer(farmer_user_id));

create policy farmer_documents_select_reviewing_district_admin
  on public.farmer_documents for select to authenticated
  using (app.district_admin_can_review_farmer(farmer_user_id));

create policy farmer_verification_checks_select_reviewing_district_admin
  on public.farmer_verification_checks for select to authenticated
  using (app.district_admin_can_review_farmer(farmer_user_id));

-- The district admin needs the profile row for the farmer's name and phone.
create policy profiles_select_reviewing_district_admin
  on public.profiles for select to authenticated
  using (app.district_admin_can_review_farmer(id));

-- ---------------------------------------------------------------------------
-- Document viewing
--
-- Same shape as the retired staff policy: the path's first segment is the
-- owning farmer's id, matched the same way the farmer's own policy matches it.
-- ---------------------------------------------------------------------------

create policy farmer_documents_objects_select_reviewing_district_admin
  on storage.objects for select to authenticated
  using (
    bucket_id = 'farmer-documents'
    and app.district_admin_can_review_farmer(((storage.foldername(name))[1])::uuid)
  );
