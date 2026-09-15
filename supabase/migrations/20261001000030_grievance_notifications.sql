-- ===========================================================================
-- Phase: Feedback/Helpline/Schemes §15 — the rest of the grievance lifecycle
-- notifications. GRIEVANCE_RESPONSE_ADDED already exists (20261001000028); this
-- is a SEPARATE, ADDITIVE trigger on `grievances` itself, never touching the
-- existing `app.record_grievance_status_change()` history trigger — the same
-- "new sibling trigger" pattern used throughout this codebase for notification
-- sources.
-- ===========================================================================

create or replace function app.notify_grievance_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event text;
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, category, event_type, title_key, body_key, params)
    values (
      new.farmer_user_id, 'SYSTEM', 'GRIEVANCE_SUBMITTED',
      'notification.GRIEVANCE_SUBMITTED.title', 'notification.GRIEVANCE_SUBMITTED.body',
      jsonb_build_object('reference', new.reference)
    );
    return null;
  end if;

  if old.status is distinct from new.status then
    event := case new.status
      when 'ACKNOWLEDGED'   then 'GRIEVANCE_ACKNOWLEDGED'
      when 'ACTION_REQUIRED' then 'GRIEVANCE_ACTION_REQUIRED'
      when 'RESOLVED'        then 'GRIEVANCE_RESOLVED'
      else 'GRIEVANCE_STATUS_CHANGED'
    end;

    insert into public.notifications (user_id, category, event_type, title_key, body_key, params)
    values (
      new.farmer_user_id, 'SYSTEM', event,
      'notification.' || event || '.title', 'notification.' || event || '.body',
      jsonb_build_object('reference', new.reference, 'status', new.status)
    );
  end if;

  return null;
end;
$$;

create trigger grievances_notify_lifecycle
  after insert or update on public.grievances
  for each row execute function app.notify_grievance_lifecycle();

comment on trigger grievances_notify_lifecycle on public.grievances is
  'Phase: Feedback/Helpline/Schemes §15 — submission + every status change worth telling the farmer about.';
