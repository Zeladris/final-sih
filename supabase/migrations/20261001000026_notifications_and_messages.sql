-- ===========================================================================
-- Phase: Notifications & Farmer Messages
--
-- Extends the notification store started in 20260801000017 (payments) rather
-- than replacing it: that table already stores i18n KEYS + params, not
-- prose, which is the right call — one wording lives in the translation
-- bundles, not duplicated into every row. Government messages are the one
-- genuine exception (a human types free text in each language), so this
-- migration adds nullable prose columns used ONLY by that category.
--
-- New notification sources, each a SEPARATE, ADDITIVE trigger alongside the
-- existing history-writing ones (never editing them) — no risk to tested
-- behaviour, easy to audit, easy to remove independently.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. farmer_messages — the authored record (§7)
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.message_audience_type as enum ('FARMER', 'CENTRE', 'DISTRICT', 'STATE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_priority as enum ('LOW', 'NORMAL', 'HIGH', 'URGENT');
exception when duplicate_object then null; end $$;

create table if not exists public.farmer_messages (
  id                     uuid primary key default gen_random_uuid(),

  sender_user_id         uuid not null references public.profiles (id) on delete restrict,
  -- Snapshot at send time — display without a join, and stable even if the
  -- sender's role or assignment later changes.
  sender_role            public.app_role not null,

  audience_type          public.message_audience_type not null,
  audience_state_id      uuid references public.states (id) on delete restrict,
  audience_district_id   uuid references public.districts (id) on delete restrict,
  audience_centre_id     uuid references public.procurement_centres (id) on delete restrict,
  audience_farmer_id     uuid references public.profiles (id) on delete restrict,

  title_en               text not null,
  body_en                text not null,
  title_ta               text,
  body_ta                text,

  priority               public.notification_priority not null default 'NORMAL',

  -- Immediate publish only (§23) — no draft/schedule lifecycle in this phase.
  status                 text not null default 'PUBLISHED' check (status in ('PUBLISHED', 'EXPIRED')),
  published_at           timestamptz not null default now(),
  expires_at             timestamptz,

  -- Set once, at publish, from the real recipient rows created alongside it —
  -- a display convenience, never the source of truth for the count itself.
  recipient_count        integer not null default 0,

  created_at             timestamptz not null default now(),

  constraint farmer_messages_title_not_blank check (length(trim(title_en)) > 0),
  constraint farmer_messages_body_not_blank check (length(trim(body_en)) > 0),
  constraint farmer_messages_expires_after_publish
    check (expires_at is null or expires_at > published_at),
  constraint farmer_messages_recipient_count_non_negative check (recipient_count >= 0),

  -- §7: exactly the fields for the declared audience, nothing else — a
  -- DISTRICT message with a stray centre_id is rejected at the database,
  -- not just by application code that could be bypassed or buggy.
  constraint farmer_messages_audience_consistency check (
    (audience_type = 'FARMER'
      and audience_farmer_id is not null
      and audience_centre_id is null and audience_district_id is null and audience_state_id is null)
    or (audience_type = 'CENTRE'
      and audience_centre_id is not null
      and audience_farmer_id is null and audience_district_id is null and audience_state_id is null)
    or (audience_type = 'DISTRICT'
      and audience_district_id is not null
      and audience_farmer_id is null and audience_centre_id is null and audience_state_id is null)
    or (audience_type = 'STATE'
      and audience_state_id is not null
      and audience_farmer_id is null and audience_centre_id is null and audience_district_id is null)
  )
);

create index if not exists farmer_messages_sender_idx
  on public.farmer_messages (sender_user_id, created_at desc);

comment on table public.farmer_messages is
  'Authored government-to-farmer messages (one-way). The recipient list and read state live in notifications.message_id — see §9 in the phase doc for why a separate message_recipients table was not added: it would only duplicate notifications.read_at for the one channel this phase implements.';

alter table public.farmer_messages enable row level security;

-- A sender reads their own sent messages (history/stats view, §43). Nobody
-- else has a policy here — recipients read via their own notifications row,
-- never this table directly, so a farmer can never see another farmer's
-- targeting or a message not meant for them.
create policy farmer_messages_select_own_sent on public.farmer_messages
  for select to authenticated using (sender_user_id = (select auth.uid()));

-- RLS as defense-in-depth (§26) alongside backend validation in
-- farmerMessageService.ts, which performs the same checks before ever
-- reaching this insert. Neither layer trusts the other to have run.
create policy farmer_messages_insert_scoped on public.farmer_messages
  for insert to authenticated
  with check (
    sender_user_id = (select auth.uid())
    and sender_role = app.user_role()
    and (
      (app.user_role() = 'DISTRICT_ADMIN' and (
        (audience_type = 'DISTRICT' and audience_district_id = app.admin_district_id())
        or (audience_type = 'CENTRE' and app.district_of_centre(audience_centre_id) = app.admin_district_id())
        or (audience_type = 'FARMER' and exists (
          select 1 from public.farmer_profiles fp
          where fp.user_id = audience_farmer_id and fp.district_id = app.admin_district_id()
        ))
      ))
      or
      (app.user_role() = 'STATE_ADMIN' and (
        (audience_type = 'STATE' and audience_state_id = app.admin_state_id())
        or (audience_type = 'DISTRICT' and app.state_of_district(audience_district_id) = app.admin_state_id())
        or (audience_type = 'CENTRE'
          and app.state_of_district(app.district_of_centre(audience_centre_id)) = app.admin_state_id())
        or (audience_type = 'FARMER' and exists (
          select 1 from public.farmer_profiles fp
          where fp.user_id = audience_farmer_id and fp.state_id = app.admin_state_id()
        ))
      ))
    )
  );

-- Authored messages are never edited or silently deleted (§24) — history and
-- audit both depend on the row standing exactly as published.
create trigger farmer_messages_forbid_mutation
  before update or delete on public.farmer_messages
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 2. notifications — extended for priority and free-text government messages
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column if not exists priority public.notification_priority not null default 'NORMAL',
  add column if not exists message_id uuid references public.farmer_messages (id) on delete cascade,
  add column if not exists title_en text,
  add column if not exists title_ta text,
  add column if not exists body_en text,
  add column if not exists body_ta text;

comment on column public.notifications.title_en is
  'Free-text prose. Populated ONLY for category = GOVERNMENT_MESSAGE; every other category keeps using title_key/params, resolved client-side (§16).';

create index if not exists notifications_message_idx
  on public.notifications (message_id) where message_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Verification notifications (§38.1)
-- ---------------------------------------------------------------------------

create or replace function app.notify_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event text;
begin
  if old.registration_status is not distinct from new.registration_status then
    return null;
  end if;

  event := case new.registration_status
    when 'VERIFIED'                then 'VERIFICATION_APPROVED'
    when 'REJECTED'                then 'VERIFICATION_REJECTED'
    when 'RESUBMISSION_REQUIRED'   then 'VERIFICATION_ACTION_REQUIRED'
  end;

  if event is not null then
    insert into public.notifications (user_id, category, event_type, title_key, body_key, params)
    values (
      new.user_id, 'VERIFICATION', event,
      'notification.' || event || '.title', 'notification.' || event || '.body', '{}'::jsonb
    );
  end if;

  return null;
end;
$$;

create trigger farmer_profiles_notify_verification
  after update of registration_status on public.farmer_profiles
  for each row execute function app.notify_verification_change();

-- ---------------------------------------------------------------------------
-- 4. Booking notifications (§38.2)
-- ---------------------------------------------------------------------------

create or replace function app.notify_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event text;
begin
  if tg_op = 'INSERT' then
    event := 'BOOKING_CONFIRMED';
  elsif old.status is distinct from new.status and new.status = 'CANCELLED' then
    event := 'BOOKING_CANCELLED';
  else
    return null;
  end if;

  insert into public.notifications (user_id, category, event_type, title_key, body_key, params, booking_id)
  values (
    new.farmer_user_id, 'BOOKING', event,
    'notification.' || event || '.title', 'notification.' || event || '.body', '{}'::jsonb,
    new.id
  );

  return null;
end;
$$;

create trigger bookings_notify_change
  after insert or update of status on public.bookings
  for each row execute function app.notify_booking_change();

-- ---------------------------------------------------------------------------
-- 5. Queue / procurement notifications (§38.3, §38.4)
--
-- Reuses app.farmer_status() — the SAME projection the live-status page
-- shows — so a notification only ever fires for a change a farmer can
-- already see reflected there (§14: live status remains authoritative).
-- ---------------------------------------------------------------------------

create or replace function app.notify_operation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b record;
  old_status text;
  new_status text;
  event text;
  position_delta int;
begin
  select status, farmer_user_id into b from public.bookings where id = new.booking_id;
  if not found then
    return null;
  end if;

  old_status := app.farmer_status(b.status, old.state);
  new_status := app.farmer_status(b.status, new.state);

  if old_status is distinct from new_status then
    event := case
      when new_status = 'ARRIVED'      and old_status is distinct from 'ARRIVED'      then 'ARRIVAL_RECORDED'
      when new_status = 'IN_QUEUE'     and old_status is distinct from 'IN_QUEUE'     then 'QUEUE_JOINED'
      when new_status = 'PROCUREMENT'  and old_status is distinct from 'PROCUREMENT'  then 'PROCUREMENT_STARTED'
      when new_status = 'COMPLETED'    and old_status is distinct from 'COMPLETED'    then 'PROCUREMENT_COMPLETED'
      else null
    end;

    if event is not null then
      insert into public.notifications (user_id, category, event_type, title_key, body_key, params, booking_id)
      values (
        b.farmer_user_id,
        case when event in ('ARRIVAL_RECORDED', 'QUEUE_JOINED') then 'QUEUE' else 'PROCUREMENT' end,
        event, 'notification.' || event || '.title', 'notification.' || event || '.body', '{}'::jsonb,
        new.booking_id
      );
    end if;
  end if;

  -- §13: only a MATERIAL queue-position change notifies — not every
  -- recalculation. Threshold matches QUEUE_POSITION_NOTIFY_DELTA in the
  -- phase doc; kept here rather than read from application config because
  -- the trigger IS the event source for this one signal.
  if new.queue_position is not null
     and (
       old.queue_position is null
       or new.queue_position = 1
       or abs(new.queue_position - old.queue_position) >= 2
     )
     and old.queue_position is distinct from new.queue_position then
    insert into public.notifications (user_id, category, event_type, title_key, body_key, params, booking_id)
    values (
      b.farmer_user_id, 'QUEUE', 'QUEUE_POSITION_CHANGED',
      'notification.QUEUE_POSITION_CHANGED.title', 'notification.QUEUE_POSITION_CHANGED.body',
      jsonb_build_object('queuePosition', new.queue_position),
      new.booking_id
    );
  end if;

  return null;
end;
$$;

create trigger booking_operations_notify_change
  after update on public.booking_operations
  for each row execute function app.notify_operation_change();
