-- ===========================================================================
-- Phase 15 / 0025 — AI pre-arrival quality: booking-time assessment
--
-- Phase 7 ran the model at the COUNTER: staff uploaded a photo during the
-- quality check. The rework moves it to BOOKING time (§3), so the centre
-- knows something about the produce before the farmer travels, and the queue
-- has a quality signal the moment the farmer is queued.
--
-- This does NOT create a second quality system (§44). The same
-- quality_predictions table holds both — it simply has to tolerate a
-- prediction that exists BEFORE its booking does (§4 makes bookingId
-- optional), and gains the storage/weather context that shaped it (§5, §17).
--
-- Also here: the §28/§33 lifecycle vocabulary. The farmer-facing step between
-- ARRIVED and IN_QUEUE is the staff PRE_PROCUREMENT_CHECK, not "quality
-- check" — staff verify the produce and review the AI's pre-arrival
-- assessment there; the name now says so. The authoritative operational
-- state (booking_operations.state) is untouched: this is the projection's
-- vocabulary only.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Booking-time storage context (§6, §34)
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists storage_duration_band text,
  add column if not exists storage_type text,
  -- The pre-arrival assessment this booking was confirmed with, if any.
  add column if not exists quality_prediction_id uuid;

do $$ begin
  alter table public.bookings
    add constraint bookings_storage_duration_band_known
      check (storage_duration_band is null or storage_duration_band in
        ('DAYS_0_3', 'DAYS_4_7', 'DAYS_8_14', 'DAYS_15_30', 'DAYS_30_PLUS'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bookings
    add constraint bookings_storage_type_known
      check (storage_type is null or storage_type in ('OPEN', 'COVERED', 'WAREHOUSE', 'OTHER'));
exception when duplicate_object then null; end $$;

comment on column public.bookings.storage_duration_band is
  'How long the produce has been in storage, as the farmer reported it (§6). Context for the pre-arrival assessment — never a quality claim in itself.';

-- ---------------------------------------------------------------------------
-- 2. quality_predictions: a prediction can precede its booking (§4)
-- ---------------------------------------------------------------------------

alter table public.quality_predictions
  alter column booking_id drop not null,
  alter column centre_id  drop not null;

alter table public.quality_predictions
  -- Who the assessment belongs to before a booking exists. Also what the
  -- farmer's own RLS policy matches on.
  add column if not exists farmer_user_id uuid references public.farmer_profiles (user_id) on delete restrict,
  add column if not exists storage_duration_days integer,
  add column if not exists storage_type text,
  -- The context sent to the model and what it made of it (§4, §5).
  add column if not exists weather_context jsonb,
  -- AI | AI_WITH_WEATHER_CONTEXT | MANUAL_FALLBACK (§13).
  add column if not exists assessment_source text,
  -- When the prediction was attached to a booking. Set once, never changed.
  add column if not exists linked_at timestamptz;

do $$ begin
  alter table public.quality_predictions
    add constraint quality_predictions_source_known
      check (assessment_source is null
             or assessment_source in ('AI', 'AI_WITH_WEATHER_CONTEXT', 'MANUAL_FALLBACK'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.quality_predictions
    add constraint quality_predictions_storage_type_known
      check (storage_type is null or storage_type in ('OPEN', 'COVERED', 'WAREHOUSE', 'OTHER'));
exception when duplicate_object then null; end $$;

-- An assessment belongs to somebody: either a farmer (booking time) or a
-- booking at a centre (arrival time). Never to nobody.
do $$ begin
  alter table public.quality_predictions
    add constraint quality_predictions_has_owner
      check (farmer_user_id is not null or booking_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists quality_predictions_farmer_idx
  on public.quality_predictions (farmer_user_id, created_at desc);

-- Now that booking_id is nullable, the booking's own link needs its FK.
do $$ begin
  alter table public.bookings
    add constraint bookings_quality_prediction_fkey
      foreign key (quality_prediction_id)
      references public.quality_predictions (id) on delete set null;
exception when duplicate_object then null; end $$;

/**
 * Append-only, with ONE exception: attaching a pre-booking assessment to the
 * booking it was made for.
 *
 * Everything the model said stays immutable — score, risk, confidence,
 * reasons, model version, context, timestamps. The only writable move is
 * null → value on booking_id/centre_id/linked_at, exactly once. So §4's
 * "historical predictions must not be overwritten" holds, and a farmer's
 * assessment can still become their booking's assessment at confirm time.
 */
create or replace function app.protect_quality_prediction()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'quality_predictions is append-only' using errcode = 'insufficient_privilege';
  end if;

  if old.booking_id is not null or old.centre_id is not null or old.linked_at is not null then
    raise exception 'This assessment is already linked to a booking'
      using errcode = 'insufficient_privilege';
  end if;

  if new.booking_id is null or new.centre_id is null then
    raise exception 'Linking an assessment requires both a booking and its centre'
      using errcode = 'check_violation';
  end if;

  -- Every other column must be exactly what it was.
  if (new.id, new.farmer_user_id, new.crop_id, new.assessment_status, new.quality_score,
      new.quality_risk, new.confidence, new.manual_inspection_required,
      new.estimated_processing_minutes, new.model_name, new.model_version, new.training_data,
      new.reason_codes, new.failure_reason, new.image_bucket, new.image_path,
      new.storage_duration_days, new.storage_type, new.weather_context, new.assessment_source,
      new.requested_by, new.inference_at, new.created_at)
     is distinct from
     (old.id, old.farmer_user_id, old.crop_id, old.assessment_status, old.quality_score,
      old.quality_risk, old.confidence, old.manual_inspection_required,
      old.estimated_processing_minutes, old.model_name, old.model_version, old.training_data,
      old.reason_codes, old.failure_reason, old.image_bucket, old.image_path,
      old.storage_duration_days, old.storage_type, old.weather_context, old.assessment_source,
      old.requested_by, old.inference_at, old.created_at) then
    raise exception 'A recorded assessment cannot be changed' using errcode = 'insufficient_privilege';
  end if;

  new.linked_at := coalesce(new.linked_at, now());
  return new;
end;
$$;

comment on function app.protect_quality_prediction() is
  'Keeps quality_predictions append-only while allowing exactly one transition: attaching a pre-booking assessment to its booking (null -> value on booking_id/centre_id/linked_at).';

drop trigger if exists quality_predictions_append_only on public.quality_predictions;
create trigger quality_predictions_append_only
  before update or delete on public.quality_predictions
  for each row execute function app.protect_quality_prediction();

-- ---------------------------------------------------------------------------
-- 3. RLS — a farmer sees their own assessment (§15)
-- ---------------------------------------------------------------------------

-- Staff keep their centre-scoped policy; this adds the farmer's own path to
-- the same rows. Writes stay service-role only: there is no client INSERT.
create policy quality_predictions_select_own_farmer on public.quality_predictions
  for select to authenticated
  using (farmer_user_id = (select auth.uid()));

-- Their produce photo, under their own prefix: <farmer_user_id>/<file>.
create policy produce_photos_select_own_farmer
  on storage.objects for select to authenticated
  using (
    bucket_id = 'produce-photos'
    and ((storage.foldername(name))[1])::uuid = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. Lifecycle vocabulary: QUALITY_CHECK -> PRE_PROCUREMENT_CHECK (§28, §33)
--
-- The farmer-facing projection only. booking_operations.state, its state
-- machine and its history are unchanged — the operational step is still
-- QUALITY_CHECK; what the farmer is shown is the pre-procurement check the
-- staff member is actually performing.
-- ---------------------------------------------------------------------------

alter table public.bookings drop constraint if exists bookings_procurement_status_known;

create or replace function app.farmer_status(
  p_booking_status public.booking_status,
  p_state public.operation_state
)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case
    when p_booking_status = 'CANCELLED' then 'CANCELLED'
    when p_booking_status = 'NO_SHOW'   then 'MISSED'
    when p_state is null or p_state = 'BOOKED'      then 'SLOT_BOOKED'
    when p_state in ('ARRIVED', 'CHECKED_IN')       then 'ARRIVED'
    when p_state = 'WAITING'                        then 'IN_QUEUE'
    when p_state = 'QUALITY_CHECK'                  then 'PRE_PROCUREMENT_CHECK'
    when p_state in ('WEIGHING', 'PROCUREMENT')     then 'PROCUREMENT'
    when p_state = 'PAYMENT_PENDING'                then 'PAYMENT'
    when p_state = 'COMPLETED'                      then 'COMPLETED'
    when p_state = 'ON_HOLD'                        then 'ON_HOLD'
    when p_state = 'REJECTED'                       then 'NOT_ACCEPTED'
    when p_state = 'CANCELLED'                      then 'CANCELLED'
  end;
$$;

comment on function app.farmer_status(public.booking_status, public.operation_state) is
  'Maps the authoritative booking status + operational state onto the farmer-facing status. Mirrors farmerStatusOf() in packages/shared — change both together.';

-- Existing rows and recorded history carry the old word; rewrite it so the
-- vocabulary is consistent. History rows keep their identity and timestamps —
-- only the label changes, and the operational from_state/to_state columns
-- (the authoritative record of what happened) are untouched.
alter table public.bookings disable trigger bookings_z_project_status;
alter table public.bookings disable trigger bookings_record_status;
update public.bookings set procurement_status = 'PRE_PROCUREMENT_CHECK'
where procurement_status = 'QUALITY_CHECK';
alter table public.bookings enable trigger bookings_z_project_status;
alter table public.bookings enable trigger bookings_record_status;

alter table public.procurement_status_history disable trigger procurement_status_history_append_only;
update public.procurement_status_history set from_status = 'PRE_PROCUREMENT_CHECK'
where from_status = 'QUALITY_CHECK';
update public.procurement_status_history set to_status = 'PRE_PROCUREMENT_CHECK'
where to_status = 'QUALITY_CHECK';
alter table public.procurement_status_history enable trigger procurement_status_history_append_only;

alter table public.bookings
  add constraint bookings_procurement_status_known check (procurement_status in (
    'SLOT_BOOKED', 'ARRIVED', 'IN_QUEUE', 'PRE_PROCUREMENT_CHECK', 'PROCUREMENT', 'PAYMENT',
    'COMPLETED', 'ON_HOLD', 'NOT_ACCEPTED', 'CANCELLED', 'MISSED'
  ));
