-- ===========================================================================
-- Phase 0 / 0005 — audit logging (§31)
--
-- Written by the API through the service-role client only. No client-facing
-- policy is granted (see 0007): RLS is enabled with zero policies, so any
-- anon/authenticated read or write is denied.
-- ===========================================================================

create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),

  actor_user_id  uuid references public.profiles (id) on delete set null,

  action         text not null,

  entity_type    text,
  entity_id      uuid,

  centre_id      uuid references public.procurement_centres (id) on delete set null,
  district_id    uuid references public.districts (id) on delete set null,
  state_id       uuid references public.states (id) on delete set null,

  metadata       jsonb not null default '{}'::jsonb,

  ip_address     inet,
  user_agent     text,
  request_id     text,

  created_at     timestamptz not null default now(),

  constraint audit_logs_action_not_blank check (char_length(trim(action)) > 0)
);

create index if not exists audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

comment on table public.audit_logs is
  'Security and verification event log. Never stores OTP values, access tokens, service-role keys, passwords or identity numbers (§31).';

comment on column public.audit_logs.metadata is
  'Non-sensitive contextual detail only. The API redacts a denylist of keys before insert.';
