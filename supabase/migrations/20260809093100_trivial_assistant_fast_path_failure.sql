-- Release a claimed trivial fast-path turn when the direct provider call or
-- asynchronous completion fails. Keep the public surface authenticated-only and
-- validate ownership before delegating to the existing durable failure routine.

create or replace function public.fail_trivial_assistant_turn(
  p_turn_id uuid,
  p_conversation_id uuid,
  p_lease_token uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if not exists (
    select 1
    from public.assistant_turns turn_row
    where turn_row.id = p_turn_id
      and turn_row.conversation_id = p_conversation_id
      and turn_row.owner_id = v_owner_id
      and turn_row.lease_token = p_lease_token
      and turn_row.status = 'running'
  ) then
    return;
  end if;

  perform public.fail_assistant_turn(
    p_turn_id,
    p_conversation_id,
    p_lease_token,
    left(coalesce(p_error_message, 'trivial_fast_path_failed'), 2000)
  );

  update public.assistant_reasoning_runs
     set status = 'failed',
         error_message = left(coalesce(p_error_message, 'trivial_fast_path_failed'), 2000),
         fallback_used = false,
         completed_at = now(),
         updated_at = now()
   where turn_id = p_turn_id;
end;
$$;

revoke all on function public.fail_trivial_assistant_turn(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.fail_trivial_assistant_turn(uuid, uuid, uuid, text) to authenticated;
