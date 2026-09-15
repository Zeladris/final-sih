-- ===========================================================================
-- Phase 8 / 0017 — payment & MSP settlement
--
-- EXTENDS what Phases 5–7 built rather than standing up a parallel system:
--   * procurements  gains the received / accepted / rejected split and a link
--                   to the MSP rate actually applied
--   * payments      (one per procurement, from Phase 5) gains a reference,
--                   a full amount breakdown, retry bookkeeping and a
--                   database-enforced state machine
--   * msp_rates     REPLACES procurement_rates, so there is one rate source
--
-- The procurement lifecycle stays where Phase 6 put it. A payment reaching
-- SUCCESS is the ONLY thing that moves an operation PAYMENT_PENDING → COMPLETED,
-- and that happens in the same transaction as the payment update.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. MSP rates (§8, §9)
-- ---------------------------------------------------------------------------

create table if not exists public.msp_rates (
  id                uuid primary key default gen_random_uuid(),
  crop_id           uuid not null references public.crops (id) on delete restrict,
  season            text,
  marketing_year    text,

  -- Entered per quintal, as MSP is notified; used per kg. One authoritative
  -- unit internally, derived exactly (numeric, not float).
  rate_per_quintal  numeric(12, 2) not null,
  rate_per_kg       numeric(12, 4) generated always as (rate_per_quintal / 100) stored,

  effective_from    date not null,
  effective_to      date,

  -- Geographic scope: a centre-specific rate beats a state rate beats a
  -- national (both null) one.
  state_id          uuid references public.states (id) on delete restrict,
  centre_id         uuid references public.procurement_centres (id) on delete restrict,

  -- CONFIGURED: entered by an operator. GOVERNMENT_NOTIFICATION: transcribed
  -- from a cited notification. Neither is a live government feed.
  source_type       text not null default 'CONFIGURED',
  source_reference  text,
  is_active         boolean not null default true,

  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint msp_rates_positive check (rate_per_quintal > 0),
  constraint msp_rates_range check (effective_to is null or effective_to >= effective_from),
  constraint msp_rates_source_known check (source_type in ('CONFIGURED', 'GOVERNMENT_NOTIFICATION'))
);

create index if not exists msp_rates_lookup_idx
  on public.msp_rates (crop_id, is_active, effective_from desc);

create trigger msp_rates_touch_updated_at
  before update on public.msp_rates
  for each row execute function app.touch_updated_at();

comment on table public.msp_rates is
  'Applicable MSP rates. Resolved by the server by crop, date, scope and activity; never supplied by a client. Values are configuration, not a live government feed.';

-- Carry the Phase 5 configured rates across, stated for what they are.
insert into public.msp_rates (crop_id, rate_per_quintal, effective_from, effective_to, source_type, source_reference)
select r.crop_id, r.rate_per_kg * 100, r.effective_from, r.effective_to, 'CONFIGURED',
       'Migrated from Phase 5 procurement_rates. Operator-entered — verify against the official MSP notification before real use.'
from public.procurement_rates r
where r.crop_id is not null
  and not exists (
    select 1 from public.msp_rates m
    where m.crop_id = r.crop_id and m.effective_from = r.effective_from
  );

alter table public.msp_rates enable row level security;

-- Anyone signed in may see the rates: a farmer is entitled to know the price.
create policy msp_rates_select on public.msp_rates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Procurement quantities (§2, §11)
-- ---------------------------------------------------------------------------

alter table public.weighing_records
  add column if not exists rejected_quantity_kg numeric(12, 3) not null default 0,
  add column if not exists rejection_reason text;

do $$ begin
  alter table public.weighing_records
    add constraint weighing_records_rejected_range
      check (rejected_quantity_kg >= 0 and rejected_quantity_kg < actual_quantity_kg);
  alter table public.weighing_records
    add constraint weighing_records_rejection_explained
      check (rejected_quantity_kg = 0 or (rejection_reason is not null and char_length(trim(rejection_reason)) >= 5));
exception when duplicate_object then null; end $$;

alter table public.procurements
  add column if not exists crop_id uuid references public.crops (id) on delete restrict,
  add column if not exists booked_quantity_kg numeric(12, 3),
  add column if not exists received_quantity_kg numeric(12, 3),
  add column if not exists accepted_quantity_kg numeric(12, 3),
  add column if not exists rejected_quantity_kg numeric(12, 3),
  add column if not exists msp_rate_id uuid references public.msp_rates (id) on delete restrict;

-- Before this phase every weighed kilogram was bought.
update public.procurements p
set received_quantity_kg = coalesce(p.received_quantity_kg, p.quantity_kg),
    accepted_quantity_kg = coalesce(p.accepted_quantity_kg, p.quantity_kg),
    rejected_quantity_kg = coalesce(p.rejected_quantity_kg, 0),
    booked_quantity_kg   = coalesce(p.booked_quantity_kg, b.expected_quantity_kg),
    crop_id              = coalesce(p.crop_id, b.crop_id)
from public.bookings b
where b.id = p.booking_id;

do $$ begin
  -- quantity_kg (Phase 5) IS the accepted quantity; value is accepted × rate.
  -- NOT VALID: enforced on new rows; legacy rows were computed before
  -- decimal-exact arithmetic existed.
  alter table public.procurements
    add constraint procurements_quantities_consistent
      check (accepted_quantity_kg is null
             or (accepted_quantity_kg = received_quantity_kg - rejected_quantity_kg
                 and quantity_kg = accepted_quantity_kg)) not valid;
  alter table public.procurements
    add constraint procurements_value_exact
      check (total_value = round(quantity_kg * rate_per_kg, 2)) not valid;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Payments (§5, §7, §29, §30)
-- ---------------------------------------------------------------------------

create sequence if not exists public.payment_reference_seq start with 1;

alter table public.payments
  add column if not exists payment_reference text default (
    'PAY-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
    to_char(nextval('public.payment_reference_seq'), 'FM000000')
  ),
  add column if not exists booking_id uuid references public.bookings (id) on delete restrict,
  add column if not exists farmer_user_id uuid references public.farmer_profiles (user_id) on delete restrict,
  add column if not exists centre_id uuid references public.procurement_centres (id) on delete restrict,
  add column if not exists accepted_quantity_kg numeric(12, 3),
  add column if not exists rate_per_kg numeric(12, 4),
  add column if not exists gross_amount numeric(14, 2),
  add column if not exists deductions_amount numeric(14, 2) not null default 0,
  add column if not exists net_amount numeric(14, 2),
  add column if not exists currency text not null default 'INR',
  add column if not exists payment_method text not null default 'BANK_TRANSFER',
  -- True when the provider moves no money. Shown on every screen (§13).
  add column if not exists is_demo boolean not null default true,
  add column if not exists provider_transaction_id text,
  add column if not exists processed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_retry_at timestamptz;

-- Backfill every existing payment from its procurement.
update public.payments pay
set booking_id           = coalesce(pay.booking_id, p.booking_id),
    farmer_user_id       = coalesce(pay.farmer_user_id, p.farmer_user_id),
    centre_id            = coalesce(pay.centre_id, p.centre_id),
    accepted_quantity_kg = coalesce(pay.accepted_quantity_kg, p.quantity_kg),
    rate_per_kg          = coalesce(pay.rate_per_kg, p.rate_per_kg),
    gross_amount         = coalesce(pay.gross_amount, p.total_value),
    net_amount           = coalesce(pay.net_amount, p.total_value),
    is_demo              = pay.provider in ('SIMULATED', 'DEMO'),
    provider             = case when pay.provider = 'SIMULATED' then 'DEMO' else pay.provider end
from public.procurements p
where p.id = pay.procurement_id;

update public.payments
set payment_reference = 'PAY-' || to_char(created_at at time zone 'Asia/Kolkata', 'YYYY') || '-' ||
                        to_char(nextval('public.payment_reference_seq'), 'FM000000')
where payment_reference is null;

alter table public.payments
  alter column payment_reference set not null,
  alter column booking_id set not null,
  alter column farmer_user_id set not null,
  alter column centre_id set not null,
  alter column accepted_quantity_kg set not null,
  alter column rate_per_kg set not null,
  alter column gross_amount set not null,
  alter column net_amount set not null;

do $$ begin
  alter table public.payments add constraint payments_reference_key unique (payment_reference);
  alter table public.payments add constraint payments_currency_inr check (currency = 'INR');
  alter table public.payments add constraint payments_deductions_nonnegative check (deductions_amount >= 0);
  -- The money adds up, exactly, in the database — whatever computed it (§7, §29).
  alter table public.payments add constraint payments_net_is_gross_less_deductions
    check (net_amount = gross_amount - deductions_amount and amount = net_amount);
  alter table public.payments add constraint payments_gross_exact
    check (gross_amount = round(accepted_quantity_kg * rate_per_kg, 2)) not valid;
exception when duplicate_object then null; end $$;

create index if not exists payments_centre_idx on public.payments (centre_id, created_at desc);
create index if not exists payments_farmer_idx on public.payments (farmer_user_id, created_at desc);

/**
 * What was bought, at what rate, for how much, is fixed the moment the
 * payment exists — for EVERY writer, service role included (§28). A genuine
 * correction is a separate, audited adjustment, never an edit.
 */
create or replace function app.freeze_payment_amounts()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.payment_reference    is distinct from old.payment_reference
     or new.procurement_id    is distinct from old.procurement_id
     or new.booking_id        is distinct from old.booking_id
     or new.farmer_user_id    is distinct from old.farmer_user_id
     or new.centre_id         is distinct from old.centre_id
     or new.accepted_quantity_kg is distinct from old.accepted_quantity_kg
     or new.rate_per_kg       is distinct from old.rate_per_kg
     or new.gross_amount      is distinct from old.gross_amount
     or new.deductions_amount is distinct from old.deductions_amount
     or new.net_amount        is distinct from old.net_amount
     or new.amount            is distinct from old.amount
     or new.currency          is distinct from old.currency
     or new.is_demo           is distinct from old.is_demo then
    raise exception 'Payment amounts and identity are immutable once created'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger payments_a_freeze_amounts
  before update on public.payments
  for each row execute function app.freeze_payment_amounts();

-- A rate that has been used for a procurement can be retired, never rewritten.
create or replace function app.protect_used_msp_rate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (new.rate_per_quintal is distinct from old.rate_per_quintal
      or new.crop_id is distinct from old.crop_id
      or new.effective_from is distinct from old.effective_from)
     and exists (select 1 from public.procurements where msp_rate_id = old.id) then
    raise exception 'This MSP rate has been applied to procurements; add a new rate instead of editing it'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger msp_rates_protect_used
  before update on public.msp_rates
  for each row execute function app.protect_used_msp_rate();

-- ---------------------------------------------------------------------------
-- 4. Payment state machine (§3, §36)
-- ---------------------------------------------------------------------------

create or replace function app.assert_payment_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  allowed boolean;
begin
  if old.status = new.status then
    return new;
  end if;

  -- Mirrors PAYMENT_TRANSITIONS in packages/shared/src/payments.ts.
  allowed := case old.status::text
    when 'PENDING'       then new.status::text in ('INITIATED')
    when 'INITIATED'     then new.status::text in ('PROCESSING', 'FAILED', 'SUCCESS')
    when 'PROCESSING'    then new.status::text in ('SUCCESS', 'FAILED')
    when 'FAILED'        then new.status::text in ('RETRY_PENDING')
    when 'RETRY_PENDING' then new.status::text in ('INITIATED')
    else false  -- SUCCESS is terminal
  end;

  if not allowed then
    raise exception 'Invalid payment transition % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  case new.status::text
    when 'INITIATED' then
      new.initiated_at := now();
      -- A new attempt starts clean; the previous failure lives on in
      -- payment_attempts and payment_status_history.
      new.failure_code := null;
      new.failure_reason := null;
      new.failed_at := null;
    when 'PROCESSING' then
      new.processed_at := coalesce(new.processed_at, now());
    when 'SUCCESS' then
      new.completed_at := now();
    when 'FAILED' then
      new.failed_at := now();
      new.failure_reason := coalesce(new.failure_reason, 'Payment could not be completed');
    when 'RETRY_PENDING' then
      new.retry_count := old.retry_count + 1;
      new.last_retry_at := now();
    else
      null;
  end case;

  return new;
end;
$$;

create trigger payments_b_assert_transition
  before update of status on public.payments
  for each row execute function app.assert_payment_transition();

-- ---------------------------------------------------------------------------
-- 5. Payment history (§6) — append-only
-- ---------------------------------------------------------------------------

create table if not exists public.payment_status_history (
  id                  bigint generated always as identity primary key,
  payment_id          uuid not null references public.payments (id) on delete restrict,
  booking_id          uuid not null references public.bookings (id) on delete restrict,
  farmer_user_id      uuid not null references public.farmer_profiles (user_id) on delete restrict,
  centre_id           uuid not null references public.procurement_centres (id) on delete restrict,
  from_status         text,
  to_status           text not null,
  reason              text,
  metadata            jsonb,
  -- No FK: history outlives accounts.
  changed_by_user_id  uuid,
  changed_by_role     text not null,
  created_at          timestamptz not null default now()
);

create index if not exists payment_status_history_payment_idx
  on public.payment_status_history (payment_id, id);

create trigger payment_status_history_append_only
  before update or delete on public.payment_status_history
  for each row execute function app.forbid_mutation();

alter table public.payment_status_history enable row level security;
alter table public.payment_status_history force row level security;

create policy payment_status_history_select on public.payment_status_history
  for select to authenticated
  using (farmer_user_id = (select auth.uid()) or app.is_centre_staff_of(centre_id));

-- ---------------------------------------------------------------------------
-- 6. Provider attempts (§17) — every call to a provider, kept
-- ---------------------------------------------------------------------------

create table if not exists public.payment_attempts (
  id                       uuid primary key default gen_random_uuid(),
  payment_id               uuid not null references public.payments (id) on delete restrict,
  centre_id                uuid not null references public.procurement_centres (id) on delete restrict,
  attempt_number           integer not null,
  -- The reference sent to the provider for THIS attempt. Our own
  -- payment_reference never changes; attempts get suffixes.
  attempt_reference        text not null,
  idempotency_key          text not null,
  provider_name            text not null,
  is_demo                  boolean not null,
  demo_scenario            text,
  provider_reference       text,
  provider_transaction_id  text,
  status                   text not null default 'INITIATED',
  failure_code             text,
  failure_reason           text,
  requested_by             uuid references public.profiles (id) on delete set null,
  requested_at             timestamptz not null default now(),
  completed_at             timestamptz,

  constraint payment_attempts_number_key unique (payment_id, attempt_number),
  constraint payment_attempts_idempotency_key unique (payment_id, idempotency_key),
  constraint payment_attempts_reference_key unique (attempt_reference),
  constraint payment_attempts_status_known check (status in ('INITIATED', 'PROCESSING', 'SUCCESS', 'FAILED'))
);

create index if not exists payment_attempts_open_idx
  on public.payment_attempts (status, requested_at)
  where status in ('INITIATED', 'PROCESSING');

-- An attempt's outcome, once known, is history.
create or replace function app.freeze_finished_attempt()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.status in ('SUCCESS', 'FAILED') then
    raise exception 'A finished payment attempt cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;
  if new.attempt_reference is distinct from old.attempt_reference
     or new.idempotency_key is distinct from old.idempotency_key
     or new.payment_id is distinct from old.payment_id then
    raise exception 'Payment attempt identity is immutable' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger payment_attempts_freeze_finished
  before update on public.payment_attempts
  for each row execute function app.freeze_finished_attempt();

create trigger payment_attempts_no_delete
  before delete on public.payment_attempts
  for each row execute function app.forbid_mutation();

alter table public.payment_attempts enable row level security;

-- Provider references are operational detail: staff of the centre only.
create policy payment_attempts_select_staff on public.payment_attempts
  for select to authenticated using (app.is_centre_staff_of(centre_id));

-- ---------------------------------------------------------------------------
-- 7. In-app notifications (§24) — the Phase 11 store, started here
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  category     text not null,
  event_type   text not null,
  -- Localised on the client; the row stores keys and parameters, not prose.
  title_key    text not null,
  body_key     text,
  params       jsonb not null default '{}'::jsonb,
  booking_id   uuid references public.bookings (id) on delete set null,
  payment_id   uuid references public.payments (id) on delete set null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. What a payment transition causes
--
-- One trigger, one transaction: history, the farmer's notification, the
-- farmer's realtime signal, and — on SUCCESS only — Phase 6 completion.
-- ---------------------------------------------------------------------------

create or replace function app.on_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid;
  event text;
  proc_ref text;
  from_status text;
begin
  actor := app.transition_actor();

  if tg_op = 'UPDATE' then
    from_status := old.status::text;
  end if;

  insert into public.payment_status_history (
    payment_id, booking_id, farmer_user_id, centre_id, from_status, to_status,
    reason, metadata, changed_by_user_id, changed_by_role
  ) values (
    new.id, new.booking_id, new.farmer_user_id, new.centre_id,
    from_status, new.status::text,
    nullif(current_setting('app.transition_reason', true), ''),
    nullif(current_setting('app.payment_metadata', true), '')::jsonb,
    actor, app.role_of(actor)
  );

  if tg_op = 'INSERT' then
    return null;
  end if;

  select procurement_reference into proc_ref from public.procurements where id = new.procurement_id;

  event := case new.status::text
    when 'PROCESSING'    then 'PAYMENT_PROCESSING'
    when 'SUCCESS'       then 'PAYMENT_SUCCESS'
    when 'FAILED'        then 'PAYMENT_FAILED'
    when 'RETRY_PENDING' then 'PAYMENT_RETRY'
  end;

  if event is not null then
    insert into public.notifications (
      user_id, category, event_type, title_key, body_key, params, booking_id, payment_id
    ) values (
      new.farmer_user_id, 'PAYMENT', event,
      'notification.' || event || '.title', 'notification.' || event || '.body',
      jsonb_build_object(
        'paymentReference', new.payment_reference,
        'procurementReference', proc_ref,
        'amount', new.net_amount::text,
        'currency', new.currency,
        'demo', new.is_demo
      ),
      new.booking_id, new.id
    );
  end if;

  -- Only a confirmed success completes the procurement (§21, §22).
  if new.status::text = 'SUCCESS' then
    perform set_config(
      'app.transition_metadata',
      jsonb_build_object('paymentReference', new.payment_reference, 'paymentStatus', 'SUCCESS')::text,
      true
    );
    update public.booking_operations
    set state = 'COMPLETED'
    where booking_id = new.booking_id and state = 'PAYMENT_PENDING';
  end if;

  -- The farmer's live page follows their booking row (Phase 6 realtime).
  update public.bookings set status_version = status_version + 1 where id = new.booking_id;

  return null;
end;
$$;

create trigger payments_c_on_status_change
  after insert or update of status on public.payments
  for each row execute function app.on_payment_status_change();

-- The operational machine: COMPLETED now requires a successful payment.
create or replace function app.assert_operation_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed boolean;
  booking_state public.booking_status;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'BOOKED' then
      raise exception 'An operation must start at BOOKED, not %', new.state
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.state = new.state then
    return new;
  end if;

  allowed := case old.state
    when 'BOOKED'          then new.state in ('ARRIVED', 'CANCELLED')
    when 'ARRIVED'         then new.state in ('CHECKED_IN', 'ON_HOLD', 'CANCELLED')
    when 'CHECKED_IN'      then new.state in ('QUALITY_CHECK', 'ON_HOLD', 'REJECTED')
    when 'QUALITY_CHECK'   then new.state in ('WAITING', 'REJECTED', 'ON_HOLD')
    when 'WAITING'         then new.state in ('WEIGHING', 'ON_HOLD', 'REJECTED')
    when 'WEIGHING'        then new.state in ('PROCUREMENT', 'ON_HOLD', 'REJECTED')
    when 'PROCUREMENT'     then new.state in ('PAYMENT_PENDING')
    when 'PAYMENT_PENDING' then new.state in ('COMPLETED')
    when 'ON_HOLD'         then new.state in ('WAITING', 'CHECKED_IN', 'QUALITY_CHECK', 'REJECTED', 'CANCELLED')
    else false
  end;

  if not allowed then
    raise exception 'Invalid operation transition % -> %', old.state, new.state
      using errcode = 'check_violation';
  end if;

  if old.state = 'BOOKED' and new.state = 'ARRIVED' then
    select status into booking_state from public.bookings where id = new.booking_id for update;
    if booking_state is distinct from 'BOOKED' then
      raise exception 'Booking is %, it cannot be processed', booking_state
        using errcode = 'check_violation';
    end if;
  end if;

  -- Phase 8: nothing completes without money confirmed received (§21).
  if new.state = 'COMPLETED' and not exists (
    select 1 from public.payments where booking_id = new.booking_id and status = 'SUCCESS'
  ) then
    raise exception 'A procurement completes only when its payment has succeeded'
      using errcode = 'check_violation';
  end if;

  if old.state = 'WAITING' then
    new.queue_position := null;
    new.estimated_wait_minutes := null;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Server-side operations (service role only)
-- ---------------------------------------------------------------------------

/**
 * Confirms a procurement: the procurement record, its PENDING payment and the
 * PROCUREMENT → PAYMENT_PENDING move, in one transaction (§10, §15). If any
 * part fails, none of it happened.
 */
create or replace function public.confirm_procurement(p jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  proc_id uuid;
  proc_ref text;
  pay_id uuid;
  pay_ref text;
  moved integer;
begin
  perform set_config('app.actor_id', p->>'actorId', true);

  insert into public.procurements (
    booking_id, operation_id, session_id, centre_id, farmer_user_id,
    crop, crop_id, booked_quantity_kg, received_quantity_kg, accepted_quantity_kg, rejected_quantity_kg,
    quantity_kg, rate_per_kg, total_value, rate_source, msp_rate_id,
    quality_assessment_id, weighing_record_id, confirmed_by
  ) values (
    (p->>'bookingId')::uuid, (p->>'operationId')::uuid, (p->>'sessionId')::uuid,
    (p->>'centreId')::uuid, (p->>'farmerUserId')::uuid,
    p->>'crop', nullif(p->>'cropId', '')::uuid,
    (p->>'bookedQuantityKg')::numeric, (p->>'receivedQuantityKg')::numeric,
    (p->>'acceptedQuantityKg')::numeric, (p->>'rejectedQuantityKg')::numeric,
    (p->>'acceptedQuantityKg')::numeric, (p->>'ratePerKg')::numeric, (p->>'grossAmount')::numeric,
    p->>'rateSource', nullif(p->>'mspRateId', '')::uuid,
    nullif(p->>'qualityAssessmentId', '')::uuid, nullif(p->>'weighingRecordId', '')::uuid,
    (p->>'actorId')::uuid
  )
  returning id, procurement_reference into proc_id, proc_ref;

  insert into public.payments (
    procurement_id, booking_id, farmer_user_id, centre_id,
    accepted_quantity_kg, rate_per_kg, gross_amount, deductions_amount, net_amount, amount,
    currency, provider, is_demo
  ) values (
    proc_id, (p->>'bookingId')::uuid, (p->>'farmerUserId')::uuid, (p->>'centreId')::uuid,
    (p->>'acceptedQuantityKg')::numeric, (p->>'ratePerKg')::numeric, (p->>'grossAmount')::numeric,
    0, (p->>'grossAmount')::numeric, (p->>'grossAmount')::numeric,
    'INR', p->>'providerName', (p->>'isDemo')::boolean
  )
  returning id, payment_reference into pay_id, pay_ref;

  -- The PROCUREMENT → PAYMENT history row names what was created.
  perform set_config(
    'app.transition_metadata',
    jsonb_build_object('procurementReference', proc_ref, 'paymentReference', pay_ref, 'paymentStatus', 'PENDING')::text,
    true
  );

  update public.booking_operations
  set state = 'PAYMENT_PENDING'
  where id = (p->>'operationId')::uuid and state = 'PROCUREMENT';
  get diagnostics moved = row_count;

  if moved = 0 then
    raise exception 'This booking is no longer ready to be procured' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'procurementId', proc_id, 'procurementReference', proc_ref,
    'paymentId', pay_id, 'paymentReference', pay_ref
  );
end;
$$;

/** Moves a payment from an expected status; history is written by trigger. */
create or replace function public.transition_payment(
  p_payment_id uuid,
  p_expected_from public.payment_status,
  p_to public.payment_status,
  p_actor uuid,
  p_reason text default null,
  p_patch jsonb default '{}'::jsonb,
  p_metadata jsonb default null
)
returns setof public.payments
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.actor_id', coalesce(p_actor::text, ''), true);
  perform set_config('app.transition_reason', coalesce(p_reason, ''), true);
  perform set_config('app.payment_metadata', coalesce(p_metadata::text, ''), true);

  return query
  update public.payments pay
  set status                  = p_to,
      provider                = case when p_patch ? 'provider'                then p_patch->>'provider'                else pay.provider end,
      provider_reference      = case when p_patch ? 'provider_reference'      then p_patch->>'provider_reference'      else pay.provider_reference end,
      provider_transaction_id = case when p_patch ? 'provider_transaction_id' then p_patch->>'provider_transaction_id' else pay.provider_transaction_id end,
      failure_code            = case when p_patch ? 'failure_code'            then p_patch->>'failure_code'            else pay.failure_code end,
      failure_reason          = case when p_patch ? 'failure_reason'          then p_patch->>'failure_reason'          else pay.failure_reason end,
      initiated_by            = case when p_patch ? 'initiated_by'            then (p_patch->>'initiated_by')::uuid     else pay.initiated_by end
  where pay.id = p_payment_id
    and pay.status = p_expected_from
  returning pay.*;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.confirm_procurement(jsonb)',
    'public.transition_payment(uuid, public.payment_status, public.payment_status, uuid, text, jsonb, jsonb)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. One rate source
--
-- procurement_rates is replaced by msp_rates (migrated above). Keeping both
-- would give two answers to "what is the price of paddy today".
-- ---------------------------------------------------------------------------

drop table if exists public.procurement_rates;

-- ---------------------------------------------------------------------------
-- 11. Realtime — staff follow a payment's row; farmers follow their booking
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
     ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;
