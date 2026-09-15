-- ===========================================================================
-- Phase 14 / 0023 — fix audit_logs.actor_user_id's foreign key
--
-- BUG (pre-existing, found live on the hosted project): the column referenced
-- public.profiles(id), but recordSignIn() legitimately audits OTP_VERIFIED for
-- every authenticated session, including a brand-new farmer's very first
-- sign-in — before any profiles row exists for them (onboarding has not run
-- yet; getSessionState's whole point is to tell such a caller `onboarded:
-- false`). Every one of those inserts violated the FK and was silently
-- swallowed by recordAudit's own try/catch, which is how this went unnoticed
-- until a real login surfaced it in the server log.
--
-- FIX: reference auth.users(id) instead. Every session.userId that reaches
-- recordAudit already comes from a token Supabase Auth just verified, so the
-- row always exists there — profiles existing is not the actual invariant
-- this column needs.
-- ===========================================================================

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;

alter table public.audit_logs
  add constraint audit_logs_actor_user_id_fkey
    foreign key (actor_user_id) references auth.users (id) on delete set null;
