-- ===========================================================================
-- Grievance status transitions with a recorded reason.
--
-- The existing `app.transition_reason` session-variable convention (used by
-- older triggers) is never actually SET anywhere in the application code —
-- there was no callable entry point that set it before the write reached the
-- trigger. This RPC is that entry point: `set_config(..., true)` inside it
-- is scoped to the current transaction, which — because a PostgREST RPC call
-- runs as one transaction — is exactly the transaction the UPDATE and its
-- trigger fire in. Service-role only: the actual transition-graph
-- validation (canTransitionGrievance) happens in grievanceService.ts before
-- this is ever called.
-- ===========================================================================

create or replace function public.change_grievance_status(
  p_grievance_id uuid,
  p_new_status public.grievance_status,
  p_reason text default null,
  p_assigned_user_id uuid default null,
  p_assigned_role public.app_role default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.transition_reason', coalesce(p_reason, ''), true);

  update public.grievances
  set status = p_new_status,
      resolved_at = case when p_new_status = 'RESOLVED' then now() else resolved_at end,
      closed_at = case when p_new_status in ('CLOSED', 'CLOSED_INVALID') then now() else closed_at end,
      assigned_user_id = coalesce(p_assigned_user_id, assigned_user_id),
      assigned_role = coalesce(p_assigned_role, assigned_role)
  where id = p_grievance_id;
end;
$$;

revoke all on function public.change_grievance_status(uuid, public.grievance_status, text, uuid, public.app_role)
  from public, authenticated;
grant execute on function public.change_grievance_status(uuid, public.grievance_status, text, uuid, public.app_role)
  to service_role;
