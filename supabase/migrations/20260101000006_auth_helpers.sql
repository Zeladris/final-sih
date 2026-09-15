-- ===========================================================================
-- Phase 0 / 0006 — authorization helper functions (§28)
--
-- WHY SECURITY DEFINER: a policy on public.profiles that reads
-- public.profiles re-enters that table's own policies and recurses. These
-- helpers read the scope tables with the definer's rights, breaking the cycle.
--
-- RULES FOLLOWED HERE:
--   * Each function answers ONE narrow question about the CURRENT user.
--   * None of them takes a caller-supplied identity — they all key off
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

-- The one centre a CENTRE_STAFF user is assigned to (§12). Null for everyone else.
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

-- The one district a DISTRICT_ADMIN user governs (§13). Null for everyone else.
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

-- The one state a STATE_ADMIN user governs (§14). Null for everyone else.
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
