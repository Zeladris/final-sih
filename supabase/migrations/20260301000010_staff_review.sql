-- ===========================================================================
-- Phase 5 / 0010 — centre staff verification review
--
-- Closes the handoff Phase 1 deliberately left open: a submitted registration
-- becomes reviewable by centre staff, who approve it, send it back for
-- correction, or reject it.
--
-- SCOPE DECISION. Nothing currently links a farmer to a procurement centre —
-- farmers record a district, and the booking table that would tie them to a
-- centre belongs to Phase 4. So a staff member's review scope is their
-- CENTRE'S DISTRICT: staff at any Thanjavur centre review Thanjavur farmers.
-- Claiming (below) is what stops two centres reviewing the same submission.
-- When Phase 4 lands, this can narrow to the booked centre by changing one
-- helper function.
--
-- WRITE MODEL. Staff get SELECT only. Every status change goes through a
-- dedicated server-side operation using the service role, so there is no
-- generic "PATCH status" path from a client (§38).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Review ownership (§19, §39)
-- ---------------------------------------------------------------------------

alter table public.farmer_profiles
  add column if not exists review_started_at timestamptz,
  add column if not exists review_started_by uuid references public.profiles (id) on delete set null;

comment on column public.farmer_profiles.review_started_by is
  'Staff member who claimed this submission. Set when SUBMITTED -> UNDER_REVIEW so a second reviewer can be told it is already taken.';

-- The queue reads by status; a submitted registration is the hot path.
create index if not exists farmer_profiles_review_queue_idx
  on public.farmer_profiles (registration_status, submitted_at)
  where registration_status in ('SUBMITTED', 'UNDER_REVIEW');

-- ---------------------------------------------------------------------------
-- Staff scope helpers
-- ---------------------------------------------------------------------------

create or replace function app.staff_district_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.district_id
  from public.staff_profiles s
  join public.procurement_centres c on c.id = s.centre_id
  join public.profiles p on p.id = s.user_id
  where s.user_id = (select auth.uid())
    and s.is_active
    and p.status = 'ACTIVE'
    and p.role = 'CENTRE_STAFF';
$$;

comment on function app.staff_district_id() is
  'SECURITY DEFINER. District of the calling staff member''s assigned centre, else null. Takes no arguments, so it cannot be used to probe another staff member''s scope.';

/**
 * Whether the calling staff member may review a given farmer.
 *
 * Two conditions, both necessary:
 *   - the farmer is in this staff member's district, and
 *   - the registration has actually been submitted.
 *
 * The second matters as much as the first: a DRAFT is a farmer's private
 * work-in-progress. Staff have no business reading a half-filled form, and
 * excluding it here means no query anywhere can return one.
 */
create or replace function app.staff_can_review_farmer(p_farmer_user_id uuid)
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
      and f.district_id = app.staff_district_id()
      and f.registration_status <> 'DRAFT'
  ) and app.user_role() = 'CENTRE_STAFF';
$$;

comment on function app.staff_can_review_farmer(uuid) is
  'SECURITY DEFINER. True when the calling CENTRE_STAFF user may review the given farmer: same district, and the registration has left DRAFT. A farmer''s unsubmitted draft is never visible to staff.';

revoke all on function app.staff_district_id() from public;
revoke all on function app.staff_can_review_farmer(uuid) from public;
grant execute on function app.staff_district_id() to authenticated;
grant execute on function app.staff_can_review_farmer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff read access to submitted farmer records
--
-- These are ADDITIVE policies. The existing self-access policies are
-- untouched, so a farmer still sees exactly their own data and these grant
-- staff a second, narrower path to the same rows.
-- ---------------------------------------------------------------------------

create policy farmer_profiles_select_reviewing_staff
  on public.farmer_profiles for select to authenticated
  using (app.staff_can_review_farmer(user_id));

create policy farmer_land_holdings_select_reviewing_staff
  on public.farmer_land_holdings for select to authenticated
  using (app.staff_can_review_farmer(farmer_user_id));

create policy farmer_documents_select_reviewing_staff
  on public.farmer_documents for select to authenticated
  using (app.staff_can_review_farmer(farmer_user_id));

create policy farmer_verification_checks_select_reviewing_staff
  on public.farmer_verification_checks for select to authenticated
  using (app.staff_can_review_farmer(farmer_user_id));

-- Staff also need the profile row for the farmer's name and phone.
create policy profiles_select_reviewing_staff
  on public.profiles for select to authenticated
  using (app.staff_can_review_farmer(id));

-- ---------------------------------------------------------------------------
-- Document viewing (§13)
--
-- Staff can read the objects of a farmer they may review. The path's first
-- segment is the owning farmer's id, which is what this matches on — the same
-- shape the farmer's own policy uses.
-- ---------------------------------------------------------------------------

create policy farmer_documents_objects_select_reviewing_staff
  on storage.objects for select to authenticated
  using (
    bucket_id = 'farmer-documents'
    and app.staff_can_review_farmer(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- Transition rules for the review outcomes
--
-- The Phase 1 state machine already allows
--   UNDER_REVIEW -> VERIFIED | REJECTED | RESUBMISSION_REQUIRED
-- so no change is needed there. What IS added is stamping the reviewer and
-- clearing the claim when a decision lands.
-- ---------------------------------------------------------------------------

create or replace function app.stamp_review_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.registration_status = new.registration_status then
    return new;
  end if;

  -- Claiming a submission records who holds it.
  if new.registration_status = 'UNDER_REVIEW' then
    new.review_started_at := coalesce(new.review_started_at, now());
  end if;

  -- A decision releases the claim; the reviewer is kept in reviewed_by.
  if new.registration_status in ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED') then
    new.review_started_at := null;
    new.review_started_by := null;
  end if;

  -- Going back to DRAFT is the farmer resuming work: clear the whole review.
  if new.registration_status = 'DRAFT' then
    new.review_started_at := null;
    new.review_started_by := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
  end if;

  return new;
end;
$$;

comment on function app.stamp_review_transition() is
  'Maintains review ownership alongside the registration state machine: records a claim, releases it on a decision, and clears it when a farmer reopens their registration.';

-- Runs after the transition check (b_) so it only sees legal transitions.
create trigger farmer_profiles_c_stamp_review
  before update on public.farmer_profiles
  for each row execute function app.stamp_review_transition();

-- The Phase 1 guard pins review columns for non-service-role writers. Extend
-- it to the two new ones so a farmer cannot claim or release their own review.
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
    new.review_started_at   := null;
    new.review_started_by   := null;
    new.verified_at         := null;
    new.farmer_reference_id :=
      'KS-' || to_char(nextval('public.farmer_reference_seq'), 'FM000000');
    return new;
  end if;

  new.registration_status := old.registration_status;
  new.submitted_at        := old.submitted_at;
  new.reviewed_at         := old.reviewed_at;
  new.reviewed_by         := old.reviewed_by;
  new.review_notes        := old.review_notes;
  new.review_started_at   := old.review_started_at;
  new.review_started_by   := old.review_started_by;
  new.verified_at         := old.verified_at;
  new.farmer_reference_id := old.farmer_reference_id;

  new.last_saved_at := now();
  return new;
end;
$$;
