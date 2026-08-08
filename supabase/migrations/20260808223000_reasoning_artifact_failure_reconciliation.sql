-- Keep Artifact Runtime terminal state consistent with Reasoning Engine failures.
-- The browser already attempts this transition, but a client disconnect/timeout can
-- prevent that best-effort update from reaching Postgres. This trigger is the
-- durable server-side source of truth.

create schema if not exists private;

create or replace function private.reconcile_failed_reasoning_artifact_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id text;
begin
  if new.status <> 'failed' or old.status is not distinct from new.status then
    return new;
  end if;

  select turn.message_id
    into v_message_id
  from public.assistant_turns turn
  where turn.id = new.turn_id
    and turn.workspace_id = new.workspace_id
    and turn.owner_id = new.owner_id
  limit 1;

  if v_message_id is null then
    return new;
  end if;

  update public.artifact_tasks task
  set
    status = 'failed',
    error_message = left(
      coalesce(
        nullif(new.error_message, ''),
        'Reasoning run failed before artifact completion.'
      ),
      2000
    ),
    last_transition_at = now(),
    updated_at = now()
  where task.workspace_id = new.workspace_id
    and task.owner_id = new.owner_id
    and task.request_message_id = v_message_id
    and task.status in ('generating', 'validating', 'persisting');

  return new;
end;
$$;

revoke all on function private.reconcile_failed_reasoning_artifact_task()
from public, anon, authenticated;

-- Trigger functions do not need Data API execution privileges.
drop trigger if exists reconcile_failed_reasoning_artifact_task
on public.assistant_reasoning_runs;

create trigger reconcile_failed_reasoning_artifact_task
after update of status on public.assistant_reasoning_runs
for each row
when (new.status = 'failed' and old.status is distinct from new.status)
execute function private.reconcile_failed_reasoning_artifact_task();

-- Clean up historical interrupted tasks that already exceeded Artifact Runtime's
-- existing ten-minute stale threshold. Do not touch awaiting_input or recent work.
update public.artifact_tasks
set
  status = 'cancelled',
  error_message = coalesce(
    nullif(error_message, ''),
    'Artifact işlemi oturum tamamlanmadan kesildi. Yeni talep veya tekrar deneme ile devam edilebilir.'
  ),
  last_transition_at = now(),
  updated_at = now()
where status in ('generating', 'validating', 'persisting')
  and updated_at < now() - interval '10 minutes';

comment on function private.reconcile_failed_reasoning_artifact_task() is
  'Durably reconciles active Artifact Runtime tasks when their Reasoning Engine run reaches failed state.';
