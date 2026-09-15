-- ===========================================================================
-- Feedback, Grievances, Helpline & Government Schemes
--
-- Five sub-features, one migration, reusing everything already built:
-- the same role/scope model (app.staff_centre_id() etc.), the same
-- notification pattern (a sibling trigger, never editing an existing one),
-- the same private-storage-plus-signed-URL model, and the same "server
-- computes scope, never trusts the client" rule used everywhere else.
--
-- District/state on a grievance are stored directly (denormalized) rather
-- than joined through centre→district→state on every read — the same
-- precedent audit_logs already set — computed once in Node at creation from
-- real data (the related booking's centre, or the farmer's own district),
-- never accepted from the request body.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums for the closed, stable vocabularies. Categories stay `text` —
--    §24/§34 want those data-driven and open to grow without a migration.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.grievance_status as enum (
    'SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'ESCALATED',
    'ACTION_REQUIRED', 'RESOLVED', 'CLOSED', 'CLOSED_INVALID'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.grievance_priority as enum ('LOW', 'NORMAL', 'HIGH', 'URGENT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_scope_type as enum ('NATIONAL', 'STATE', 'DISTRICT', 'CENTRE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.scheme_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.scheme_level as enum ('NATIONAL', 'STATE', 'DISTRICT');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Feedback (§4) — lightweight, optional rating, never mandatory anywhere
--    it is offered from.
-- ---------------------------------------------------------------------------

create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  farmer_user_id uuid references public.profiles (id) on delete set null,
  booking_id    uuid references public.bookings (id) on delete set null,
  procurement_id uuid references public.procurements (id) on delete set null,
  centre_id     uuid references public.procurement_centres (id) on delete set null,

  category      text not null,
  rating        integer,
  message       text,
  language_code text not null,

  created_at    timestamptz not null default now(),

  constraint feedback_rating_range check (rating is null or rating between 1 and 5),
  constraint feedback_has_content check (rating is not null or coalesce(trim(message), '') <> '')
);

create index if not exists feedback_centre_idx on public.feedback (centre_id, created_at desc);
create index if not exists feedback_farmer_idx on public.feedback (farmer_user_id, created_at desc);

alter table public.feedback enable row level security;

create policy feedback_select_own on public.feedback
  for select to authenticated using (farmer_user_id = (select auth.uid()));

create policy feedback_insert_own on public.feedback
  for insert to authenticated with check (farmer_user_id = (select auth.uid()));

-- Staff/admin analytics reads: scoped exactly like every other operational
-- table, via the same helpers centre/district/state screens already use.
create policy feedback_select_staff on public.feedback
  for select to authenticated using (
    centre_id is not null and app.can_read_centre(centre_id)
  );

-- Append-only from the farmer's side: feedback is a snapshot of the moment,
-- never edited afterward.
create trigger feedback_forbid_update_delete
  before update or delete on public.feedback
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. Grievances (§6, §7) — the case-management workflow.
-- ---------------------------------------------------------------------------

create sequence if not exists public.grievance_reference_seq start with 100001;
grant usage, select on sequence public.grievance_reference_seq to authenticated, service_role;

create table if not exists public.grievances (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique
                   default ('GRV-' || to_char(nextval('public.grievance_reference_seq'), 'FM000000')),

  farmer_user_id uuid not null references public.profiles (id) on delete restrict,

  booking_id     uuid references public.bookings (id) on delete set null,
  procurement_id uuid references public.procurements (id) on delete set null,
  centre_id      uuid references public.procurement_centres (id) on delete set null,
  -- Denormalized at creation from real data (the centre's hierarchy, or the
  -- farmer's own district/state when there is no centre yet) — never
  -- accepted from the request body (§39).
  district_id    uuid references public.districts (id) on delete restrict,
  state_id       uuid references public.states (id) on delete restrict,

  category       text not null,
  sub_category   text,
  subject        text not null,
  description    text not null,

  priority       public.grievance_priority not null default 'NORMAL',
  status         public.grievance_status not null default 'SUBMITTED',

  language_code  text not null,

  assigned_user_id uuid references public.profiles (id) on delete set null,
  -- Which tier currently owns it — lets the workspace query "my queue"
  -- without re-deriving it from assigned_user_id's profile every time.
  assigned_role    public.app_role,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  closed_at      timestamptz,

  constraint grievances_subject_not_blank check (length(trim(subject)) > 0),
  constraint grievances_description_not_blank check (length(trim(description)) > 0)
);

create index if not exists grievances_farmer_idx on public.grievances (farmer_user_id, created_at desc);
create index if not exists grievances_centre_idx on public.grievances (centre_id, status);
create index if not exists grievances_district_idx on public.grievances (district_id, status);
create index if not exists grievances_state_idx on public.grievances (state_id, status);
create index if not exists grievances_status_idx on public.grievances (status);

comment on table public.grievances is
  'One row per farmer complaint. Priority is a workflow property only — it must never feed the queue fairness score (§6).';

create trigger grievances_touch_updated_at
  before update on public.grievances
  for each row execute function app.touch_updated_at();

alter table public.grievances enable row level security;

create policy grievances_select_own on public.grievances
  for select to authenticated using (farmer_user_id = (select auth.uid()));

create policy grievances_select_staff on public.grievances
  for select to authenticated using (
    app.user_role() = 'CENTRE_STAFF' and centre_id = app.staff_centre_id()
  );

create policy grievances_select_district on public.grievances
  for select to authenticated using (
    app.user_role() = 'DISTRICT_ADMIN' and district_id = app.admin_district_id()
  );

create policy grievances_select_state on public.grievances
  for select to authenticated using (
    app.user_role() = 'STATE_ADMIN' and state_id = app.admin_state_id()
  );

-- The farmer's own client performs the insert; the district_id/state_id/
-- centre_id values are computed by grievanceService.ts from real bookings/
-- profile rows before this ever runs — this check only re-confirms ownership.
create policy grievances_insert_own on public.grievances
  for insert to authenticated with check (farmer_user_id = (select auth.uid()));

-- Status/assignment changes go through the service-role client from
-- validated backend transitions (grievanceService.ts) — matching how
-- notifications and farmer-messages already write. RLS's job here is read
-- isolation; the state machine itself is enforced in one place, in code.

-- ---------------------------------------------------------------------------
-- 4. Status history (§8) — append-only, trigger-populated.
-- ---------------------------------------------------------------------------

create table if not exists public.grievance_status_history (
  id             uuid primary key default gen_random_uuid(),
  grievance_id   uuid not null references public.grievances (id) on delete cascade,
  from_status    public.grievance_status,
  to_status      public.grievance_status not null,
  changed_by     uuid references public.profiles (id) on delete set null,
  changed_by_role public.app_role,
  change_reason  text,
  created_at     timestamptz not null default now()
);

create index if not exists grievance_status_history_grievance_idx
  on public.grievance_status_history (grievance_id, created_at);

alter table public.grievance_status_history enable row level security;

create policy grievance_status_history_select on public.grievance_status_history
  for select to authenticated using (
    exists (
      select 1 from public.grievances g
      where g.id = grievance_id
        and (
          g.farmer_user_id = (select auth.uid())
          or (app.user_role() = 'CENTRE_STAFF' and g.centre_id = app.staff_centre_id())
          or (app.user_role() = 'DISTRICT_ADMIN' and g.district_id = app.admin_district_id())
          or (app.user_role() = 'STATE_ADMIN' and g.state_id = app.admin_state_id())
        )
    )
  );

create trigger grievance_status_history_forbid_mutation
  before update or delete on public.grievance_status_history
  for each row execute function app.forbid_mutation();

create or replace function app.record_grievance_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.grievance_status_history (grievance_id, from_status, to_status, changed_by, changed_by_role)
    values (new.id, null, new.status, app.transition_actor(), app.role_of(app.transition_actor()));
    return null;
  end if;

  if old.status is distinct from new.status then
    insert into public.grievance_status_history (
      grievance_id, from_status, to_status, changed_by, changed_by_role, change_reason
    ) values (
      new.id, old.status, new.status, app.transition_actor(), app.role_of(app.transition_actor()),
      nullif(current_setting('app.transition_reason', true), '')
    );
  end if;
  return null;
end;
$$;

create trigger grievances_record_status_change
  after insert or update on public.grievances
  for each row execute function app.record_grievance_status_change();

-- ---------------------------------------------------------------------------
-- 5. Internal notes vs farmer-visible responses (§9) — two tables so the
--    boundary is structural, not a flag a bug could flip.
-- ---------------------------------------------------------------------------

create table if not exists public.grievance_notes (
  id           uuid primary key default gen_random_uuid(),
  grievance_id uuid not null references public.grievances (id) on delete cascade,
  author_id    uuid not null references public.profiles (id) on delete restrict,
  note         text not null,
  created_at   timestamptz not null default now(),
  constraint grievance_notes_not_blank check (length(trim(note)) > 0)
);

create index if not exists grievance_notes_grievance_idx on public.grievance_notes (grievance_id, created_at);
alter table public.grievance_notes enable row level security;

-- Staff/district/state only — a farmer has no policy on this table at all,
-- so "never exposed to farmers" is enforced by the database, not the UI.
create policy grievance_notes_select_staff on public.grievance_notes
  for select to authenticated using (
    exists (
      select 1 from public.grievances g
      where g.id = grievance_id
        and (
          (app.user_role() = 'CENTRE_STAFF' and g.centre_id = app.staff_centre_id())
          or (app.user_role() = 'DISTRICT_ADMIN' and g.district_id = app.admin_district_id())
          or (app.user_role() = 'STATE_ADMIN' and g.state_id = app.admin_state_id())
        )
    )
  );

create trigger grievance_notes_forbid_update_delete
  before update or delete on public.grievance_notes
  for each row execute function app.forbid_mutation();

create table if not exists public.grievance_responses (
  id             uuid primary key default gen_random_uuid(),
  grievance_id   uuid not null references public.grievances (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete restrict,
  message        text not null,
  language_code  text not null,
  created_at     timestamptz not null default now(),
  constraint grievance_responses_not_blank check (length(trim(message)) > 0)
);

create index if not exists grievance_responses_grievance_idx on public.grievance_responses (grievance_id, created_at);
alter table public.grievance_responses enable row level security;

create policy grievance_responses_select on public.grievance_responses
  for select to authenticated using (
    exists (
      select 1 from public.grievances g
      where g.id = grievance_id
        and (
          g.farmer_user_id = (select auth.uid())
          or (app.user_role() = 'CENTRE_STAFF' and g.centre_id = app.staff_centre_id())
          or (app.user_role() = 'DISTRICT_ADMIN' and g.district_id = app.admin_district_id())
          or (app.user_role() = 'STATE_ADMIN' and g.state_id = app.admin_state_id())
        )
    )
  );

create trigger grievance_responses_forbid_update_delete
  before update or delete on public.grievance_responses
  for each row execute function app.forbid_mutation();

-- A farmer-visible response is itself a status-relevant event a farmer
-- should be told about.
create or replace function app.notify_grievance_response()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  farmer uuid;
begin
  select farmer_user_id into farmer from public.grievances where id = new.grievance_id;
  if farmer is null then return null; end if;

  insert into public.notifications (user_id, category, event_type, title_key, body_key, params)
  values (
    farmer, 'SYSTEM', 'GRIEVANCE_RESPONSE_ADDED',
    'notification.GRIEVANCE_RESPONSE_ADDED.title', 'notification.GRIEVANCE_RESPONSE_ADDED.body',
    '{}'::jsonb
  );
  return null;
end;
$$;

create trigger grievance_responses_notify
  after insert on public.grievance_responses
  for each row execute function app.notify_grievance_response();

-- ---------------------------------------------------------------------------
-- 6. Attachments (§10) — private bucket, signed URLs only, same model as
--    farmer documents and produce photos.
-- ---------------------------------------------------------------------------

create table if not exists public.grievance_attachments (
  id            uuid primary key default gen_random_uuid(),
  grievance_id  uuid not null references public.grievances (id) on delete cascade,
  uploaded_by   uuid not null references public.profiles (id) on delete restrict,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  file_size     integer not null,
  created_at    timestamptz not null default now(),

  constraint grievance_attachments_size_positive check (file_size > 0)
);

create index if not exists grievance_attachments_grievance_idx on public.grievance_attachments (grievance_id);
alter table public.grievance_attachments enable row level security;

create policy grievance_attachments_select on public.grievance_attachments
  for select to authenticated using (
    exists (
      select 1 from public.grievances g
      where g.id = grievance_id
        and (
          g.farmer_user_id = (select auth.uid())
          or (app.user_role() = 'CENTRE_STAFF' and g.centre_id = app.staff_centre_id())
          or (app.user_role() = 'DISTRICT_ADMIN' and g.district_id = app.admin_district_id())
          or (app.user_role() = 'STATE_ADMIN' and g.state_id = app.admin_state_id())
        )
    )
  );

create policy grievance_attachments_insert_own on public.grievance_attachments
  for insert to authenticated with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.grievances g
      where g.id = grievance_id and g.farmer_user_id = (select auth.uid())
    )
  );

create trigger grievance_attachments_forbid_update_delete
  before update or delete on public.grievance_attachments
  for each row execute function app.forbid_mutation();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'grievance-attachments', 'grievance-attachments', false, 10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path: <grievance_id>/<attachment_id>/<file>. Access follows the same rule
-- as the row above it — reused here directly rather than re-derived, since
-- the first path segment IS the grievance id.
create policy grievance_attachments_objects_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'grievance-attachments'
    and exists (
      select 1 from public.grievances g
      where g.id::text = (storage.foldername(name))[1]
        and g.farmer_user_id = (select auth.uid())
    )
  );

create policy grievance_attachments_objects_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'grievance-attachments'
    and exists (
      select 1 from public.grievances g
      where g.id::text = (storage.foldername(name))[1]
        and (
          g.farmer_user_id = (select auth.uid())
          or (app.user_role() = 'CENTRE_STAFF' and g.centre_id = app.staff_centre_id())
          or (app.user_role() = 'DISTRICT_ADMIN' and g.district_id = app.admin_district_id())
          or (app.user_role() = 'STATE_ADMIN' and g.state_id = app.admin_state_id())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Helpline (§18) — curated, sourced, never fabricated.
-- ---------------------------------------------------------------------------

create table if not exists public.helpline_entries (
  id                uuid primary key default gen_random_uuid(),

  title_en          text not null,
  title_ta          text,
  title_kn          text,
  title_hi          text,
  title_ml          text,

  description_en    text,
  description_ta    text,
  description_kn    text,
  description_hi    text,
  description_ml    text,

  phone_number      text,
  email             text,

  office_name       text,
  address           text,

  scope_type        public.support_scope_type not null,
  state_id          uuid references public.states (id) on delete restrict,
  district_id       uuid references public.districts (id) on delete restrict,
  centre_id         uuid references public.procurement_centres (id) on delete restrict,

  category          text not null,

  official_url      text,
  source_reference  text,

  is_active         boolean not null default true,
  last_verified_at  timestamptz,

  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint helpline_title_not_blank check (length(trim(title_en)) > 0),
  constraint helpline_has_contact check (phone_number is not null or email is not null or official_url is not null),
  -- Mirrors the audience-consistency pattern from farmer_messages: a scope
  -- claims exactly the fields that describe it, nothing extra.
  constraint helpline_scope_consistency check (
    (scope_type = 'NATIONAL' and state_id is null and district_id is null and centre_id is null)
    or (scope_type = 'STATE' and state_id is not null and district_id is null and centre_id is null)
    or (scope_type = 'DISTRICT' and district_id is not null and centre_id is null)
    or (scope_type = 'CENTRE' and centre_id is not null)
  )
);

create index if not exists helpline_scope_idx on public.helpline_entries (scope_type, state_id, district_id, centre_id);

create trigger helpline_entries_touch_updated_at
  before update on public.helpline_entries
  for each row execute function app.touch_updated_at();

alter table public.helpline_entries enable row level security;

-- Any authenticated user reads active entries — a helpline is useless if it
-- is harder to reach than the problem it solves (§17).
create policy helpline_select_active on public.helpline_entries
  for select to authenticated using (is_active = true);

-- A sender/manager also sees their own inactive drafts.
create policy helpline_select_own_inactive on public.helpline_entries
  for select to authenticated using (created_by = (select auth.uid()));

create policy helpline_insert_scoped on public.helpline_entries
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (app.user_role() = 'DISTRICT_ADMIN' and scope_type = 'DISTRICT' and district_id = app.admin_district_id())
      or (app.user_role() = 'STATE_ADMIN' and scope_type in ('STATE', 'NATIONAL') and
          (state_id is null or state_id = app.admin_state_id()))
    )
  );

create policy helpline_update_scoped on public.helpline_entries
  for update to authenticated
  using (
    (app.user_role() = 'DISTRICT_ADMIN' and scope_type = 'DISTRICT' and district_id = app.admin_district_id())
    or (app.user_role() = 'STATE_ADMIN' and scope_type in ('STATE', 'NATIONAL') and
        (state_id is null or state_id = app.admin_state_id()))
  );

-- ---------------------------------------------------------------------------
-- 8. Government schemes (§23) — curated catalogue, informational relevance
--    only, never an eligibility decision.
-- ---------------------------------------------------------------------------

create table if not exists public.government_schemes (
  id                          uuid primary key default gen_random_uuid(),
  scheme_code                 text unique,

  name_en                     text not null,
  name_ta                     text,
  name_kn                     text,
  name_hi                     text,
  name_ml                     text,

  short_description_en        text,
  short_description_ta        text,
  short_description_kn        text,
  short_description_hi        text,
  short_description_ml        text,

  description_en              text,
  description_ta              text,
  description_kn               text,
  description_hi               text,
  description_ml               text,

  authority_name               text not null,
  department_name              text,

  level                        public.scheme_level not null,
  state_id                     uuid references public.states (id) on delete restrict,
  district_id                  uuid references public.districts (id) on delete restrict,

  category                     text not null,

  benefit_summary_en           text,
  benefit_summary_ta           text,
  benefit_summary_kn           text,
  benefit_summary_hi           text,
  benefit_summary_ml           text,

  eligibility_summary_en       text,
  eligibility_summary_ta       text,
  eligibility_summary_kn       text,
  eligibility_summary_hi       text,
  eligibility_summary_ml       text,

  documents_summary_en         text,
  documents_summary_ta         text,
  documents_summary_kn         text,
  documents_summary_hi         text,
  documents_summary_ml         text,

  application_method_en        text,
  application_method_ta        text,
  application_method_kn        text,
  application_method_hi        text,
  application_method_ml        text,

  -- Deterministic relevance inputs (§28, §29) — plain data, never inferred.
  relevant_crop_codes           text[] not null default '{}',

  official_url                  text,
  source_reference               text not null,

  last_verified_at               timestamptz,
  valid_from                     date,
  valid_until                    date,

  status                         public.scheme_status not null default 'DRAFT',

  created_by                     uuid references public.profiles (id) on delete set null,
  updated_by                     uuid references public.profiles (id) on delete set null,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),

  constraint schemes_name_not_blank check (length(trim(name_en)) > 0),
  constraint schemes_level_consistency check (
    (level = 'NATIONAL' and state_id is null and district_id is null)
    or (level = 'STATE' and state_id is not null and district_id is null)
    or (level = 'DISTRICT' and district_id is not null)
  ),
  constraint schemes_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index if not exists schemes_status_idx on public.government_schemes (status, level, state_id, district_id);
create index if not exists schemes_category_idx on public.government_schemes (category) where status = 'PUBLISHED';

create trigger government_schemes_touch_updated_at
  before update on public.government_schemes
  for each row execute function app.touch_updated_at();

alter table public.government_schemes enable row level security;

create policy schemes_select_published on public.government_schemes
  for select to authenticated using (status = 'PUBLISHED');

create policy schemes_select_own_draft on public.government_schemes
  for select to authenticated using (created_by = (select auth.uid()));

create policy schemes_insert_scoped on public.government_schemes
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (app.user_role() = 'DISTRICT_ADMIN' and level = 'DISTRICT' and district_id = app.admin_district_id())
      or (app.user_role() = 'STATE_ADMIN' and level in ('STATE', 'NATIONAL') and
          (state_id is null or state_id = app.admin_state_id()))
    )
  );

create policy schemes_update_scoped on public.government_schemes
  for update to authenticated
  using (
    (app.user_role() = 'DISTRICT_ADMIN' and level = 'DISTRICT' and district_id = app.admin_district_id())
    or (app.user_role() = 'STATE_ADMIN' and level in ('STATE', 'NATIONAL') and
        (state_id is null or state_id = app.admin_state_id()))
  );

create table if not exists public.government_scheme_history (
  id            uuid primary key default gen_random_uuid(),
  scheme_id     uuid not null references public.government_schemes (id) on delete cascade,
  changed_by    uuid references public.profiles (id) on delete set null,
  change_type   text not null,
  previous_data jsonb,
  new_data      jsonb,
  created_at    timestamptz not null default now()
);

alter table public.government_scheme_history enable row level security;
-- Service-role only for now (§32) — no dedicated browsing UI in this pass;
-- the row exists so the audit trail is real when that UI is built.

create trigger government_scheme_history_forbid_mutation
  before update or delete on public.government_scheme_history
  for each row execute function app.forbid_mutation();

create or replace function app.record_scheme_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.government_scheme_history (scheme_id, changed_by, change_type, previous_data, new_data)
    values (new.id, app.transition_actor(), 'CREATED', null, to_jsonb(new));
    return null;
  end if;

  insert into public.government_scheme_history (scheme_id, changed_by, change_type, previous_data, new_data)
  values (
    new.id, app.transition_actor(),
    case when old.status is distinct from new.status then 'STATUS_' || new.status::text else 'UPDATED' end,
    to_jsonb(old), to_jsonb(new)
  );
  return null;
end;
$$;

create trigger government_schemes_record_change
  after insert or update on public.government_schemes
  for each row execute function app.record_scheme_change();

-- ---------------------------------------------------------------------------
-- 9. Saved schemes (§30)
-- ---------------------------------------------------------------------------

create table if not exists public.farmer_saved_schemes (
  farmer_user_id uuid not null references public.profiles (id) on delete cascade,
  scheme_id      uuid not null references public.government_schemes (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (farmer_user_id, scheme_id)
);

alter table public.farmer_saved_schemes enable row level security;

create policy farmer_saved_schemes_own on public.farmer_saved_schemes
  for all to authenticated
  using (farmer_user_id = (select auth.uid()))
  with check (farmer_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 10. FAQs (§34)
-- ---------------------------------------------------------------------------

create table if not exists public.support_faqs (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,

  question_en       text not null,
  question_ta       text,
  question_kn       text,
  question_hi       text,
  question_ml       text,

  answer_en         text not null,
  answer_ta         text,
  answer_kn         text,
  answer_hi         text,
  answer_ml         text,

  scope_type        public.support_scope_type not null default 'NATIONAL',
  state_id          uuid references public.states (id) on delete restrict,
  district_id       uuid references public.districts (id) on delete restrict,

  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  last_verified_at  timestamptz,

  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint faqs_question_not_blank check (length(trim(question_en)) > 0),
  constraint faqs_answer_not_blank check (length(trim(answer_en)) > 0),
  constraint faqs_scope_consistency check (
    (scope_type = 'NATIONAL' and state_id is null and district_id is null)
    or (scope_type = 'STATE' and state_id is not null and district_id is null)
    or (scope_type = 'DISTRICT' and district_id is not null)
    or (scope_type = 'CENTRE')
  )
);

create index if not exists faqs_scope_idx on public.support_faqs (scope_type, state_id, district_id) where is_active;

create trigger support_faqs_touch_updated_at
  before update on public.support_faqs
  for each row execute function app.touch_updated_at();

alter table public.support_faqs enable row level security;

create policy faqs_select_active on public.support_faqs
  for select to authenticated using (is_active = true);

create policy faqs_write_scoped on public.support_faqs
  for all to authenticated
  using (
    (app.user_role() = 'DISTRICT_ADMIN' and (scope_type in ('DISTRICT') and district_id = app.admin_district_id()))
    or (app.user_role() = 'STATE_ADMIN' and scope_type in ('STATE', 'NATIONAL') and
        (state_id is null or state_id = app.admin_state_id()))
  )
  with check (
    created_by = (select auth.uid())
    and (
      (app.user_role() = 'DISTRICT_ADMIN' and scope_type = 'DISTRICT' and district_id = app.admin_district_id())
      or (app.user_role() = 'STATE_ADMIN' and scope_type in ('STATE', 'NATIONAL') and
          (state_id is null or state_id = app.admin_state_id()))
    )
  );

-- ---------------------------------------------------------------------------
-- 11. Notification titles for the events this migration's triggers raise.
--     GRIEVANCE_STATUS_CHANGED is emitted from the service layer (it needs
--     the human-readable "what changed" the SQL trigger doesn't have), not
--     from a trigger here.
-- ---------------------------------------------------------------------------

comment on trigger grievance_responses_notify on public.grievance_responses is
  'Phase: Feedback/Helpline/Schemes §15 — a farmer-visible reply is exactly the kind of change worth telling the farmer about.';
