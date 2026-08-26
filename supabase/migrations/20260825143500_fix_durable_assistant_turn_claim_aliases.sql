-- Qualify assistant_turns columns inside claim_assistant_turn. The function
-- returns TABLE columns named response_text/usage/response_model, so unqualified
-- references in UPDATE expressions are ambiguous in PL/pgSQL.

create or replace function public.claim_assistant_turn(
  p_conversation_id uuid,
  p_workspace_id text,
  p_owner_id uuid,
  p_prompt_version_id uuid,
  p_message_id text,
  p_request_hash text,
  p_user_limit_per_minute integer,
  p_workspace_limit_per_minute integer
)
returns table(
  outcome text,
  turn_id uuid,
  response_text text,
  source_refs jsonb,
  usage jsonb,
  response_model text,
  lease_token uuid
)
language plpgsql
set search_path to ''
as $function$
declare
  turn_record public.assistant_turns%rowtype;
  conversation_snapshot public.assistant_conversations%rowtype;
  conversation_record public.assistant_conversations%rowtype;
  locked_turn public.assistant_turns%rowtype;
  user_turn_count integer;
  workspace_turn_count integer;
  effective_message_id text := left(coalesce(p_message_id, ''), 240);
  incoming_message_at timestamptz;
  locked_message_at timestamptz;
  snapshot_locked_turn_id uuid;
  locked_turn_has_artifact boolean := false;
  turn_has_artifact boolean := false;
begin
  if effective_message_id = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'Assistant message id and request hash are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id || ':' || p_owner_id::text, 0));

  select * into conversation_snapshot
  from public.assistant_conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.workspace_id = p_workspace_id
    and conversation_row.status = 'active';

  if conversation_snapshot.id is null or conversation_snapshot.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  snapshot_locked_turn_id := conversation_snapshot.locked_turn_id;

  if snapshot_locked_turn_id is not null then
    select * into locked_turn
    from public.assistant_turns turn_row
    where turn_row.id = snapshot_locked_turn_id
    for update;

    select exists(
      select 1
      from public.assistant_turn_artifacts artifact
      where artifact.turn_id = locked_turn.id
    ) into locked_turn_has_artifact;
  end if;

  select * into conversation_record
  from public.assistant_conversations conversation_row
  where conversation_row.id = p_conversation_id
    and conversation_row.workspace_id = p_workspace_id
    and conversation_row.status = 'active'
  for update;

  if conversation_record.id is null or conversation_record.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  if conversation_record.locked_turn_id is distinct from snapshot_locked_turn_id
     and conversation_record.locked_turn_id is not null then
    return query select 'busy'::text, null::uuid, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
    return;
  end if;

  if conversation_record.locked_turn_id is not null
     and locked_turn.id is not null
     and locked_turn.id <> (
       select candidate.id
       from public.assistant_turns candidate
       where candidate.workspace_id = p_workspace_id
         and candidate.owner_id = p_owner_id
         and candidate.message_id = effective_message_id
       limit 1
     ) then

    if conversation_record.lock_expires_at <= now() or locked_turn.status <> 'running' then
      if locked_turn.status = 'running' then
        if locked_turn_has_artifact then
          update public.assistant_turns as recovered_turn
             set status = 'completed',
                 response_text = coalesce(nullif(recovered_turn.response_text, ''), 'Dosya oluşturuldu ve hazır.'),
                 usage = coalesce(recovered_turn.usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
                 response_model = coalesce(recovered_turn.response_model, conversation_record.model),
                 error_message = null,
                 completed_at = coalesce(recovered_turn.completed_at, now()),
                 updated_at = now()
           where recovered_turn.id = locked_turn.id;
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'completed',
                 error_message = null,
                 completed_at = coalesce(reasoning_run.completed_at, now()),
                 updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        else
          update public.assistant_turns as stale_turn
             set status = 'failed',
                 error_message = 'stale_lock_reclaimed',
                 completed_at = now(),
                 updated_at = now()
           where stale_turn.id = locked_turn.id;
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'failed',
                 error_message = 'stale_lock_reclaimed',
                 completed_at = coalesce(reasoning_run.completed_at, now()),
                 updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        end if;
      end if;
      update public.assistant_conversations as conversation_to_unlock
         set locked_turn_id = null, lock_expires_at = null, updated_at = now()
       where conversation_to_unlock.id = p_conversation_id and conversation_to_unlock.locked_turn_id = locked_turn.id;
      conversation_record.locked_turn_id := null;
      conversation_record.lock_expires_at := null;
    else
      select message_row.created_at into incoming_message_at
      from public.messages message_row
      where message_row.workspace_id = p_workspace_id and message_row.id = p_message_id
      limit 1;

      select message_row.created_at into locked_message_at
      from public.messages message_row
      where message_row.workspace_id = p_workspace_id
        and (message_row.id = locked_turn.message_id or locked_turn.message_id like message_row.id || ':%')
      order by case when message_row.id = locked_turn.message_id then 0 else 1 end, message_row.created_at desc
      limit 1;

      if incoming_message_at is not null and locked_message_at is not null and incoming_message_at > locked_message_at then
        if locked_turn_has_artifact then
          update public.assistant_turns as recovered_turn
             set status = 'completed',
                 response_text = coalesce(nullif(recovered_turn.response_text, ''), 'Dosya oluşturuldu ve hazır.'),
                 usage = coalesce(recovered_turn.usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
                 response_model = coalesce(recovered_turn.response_model, conversation_record.model),
                 error_message = null,
                 completed_at = coalesce(recovered_turn.completed_at, now()),
                 updated_at = now()
           where recovered_turn.id = locked_turn.id and recovered_turn.status = 'running';
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'completed', error_message = null,
                 completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        else
          update public.assistant_turns as superseded_turn
             set status = 'failed',
                 error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
                 completed_at = now(), updated_at = now()
           where superseded_turn.id = locked_turn.id and superseded_turn.status = 'running';
          update public.assistant_reasoning_runs as reasoning_run
             set status = 'failed',
                 error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
                 completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
           where reasoning_run.turn_id = locked_turn.id and reasoning_run.status = 'running';
        end if;

        update public.assistant_conversations as conversation_to_unlock
           set locked_turn_id = null, lock_expires_at = null, updated_at = now()
         where conversation_to_unlock.id = p_conversation_id and conversation_to_unlock.locked_turn_id = locked_turn.id;
        conversation_record.locked_turn_id := null;
        conversation_record.lock_expires_at := null;
      else
        return query select 'busy'::text, locked_turn.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
        return;
      end if;
    end if;
  end if;

  select * into turn_record
  from public.assistant_turns turn_row
  where turn_row.workspace_id = p_workspace_id
    and turn_row.owner_id = p_owner_id
    and turn_row.message_id = effective_message_id
  for update;

  if turn_record.id is not null and turn_record.request_hash <> p_request_hash then
    effective_message_id := left(p_message_id, 175) || ':' || p_request_hash;
    select * into turn_record
    from public.assistant_turns turn_row
    where turn_row.workspace_id = p_workspace_id
      and turn_row.owner_id = p_owner_id
      and turn_row.message_id = effective_message_id
    for update;
  end if;

  if turn_record.id is null then
    select count(*)::integer into user_turn_count
    from public.assistant_turns turn_row
    where turn_row.owner_id = p_owner_id and turn_row.created_at >= now() - interval '1 minute';

    select count(*)::integer into workspace_turn_count
    from public.assistant_turns turn_row
    where turn_row.workspace_id = p_workspace_id and turn_row.created_at >= now() - interval '1 minute';

    if user_turn_count >= greatest(1, least(p_user_limit_per_minute, 60))
       or workspace_turn_count >= greatest(1, least(p_workspace_limit_per_minute, 240)) then
      return query select 'rate_limited'::text, null::uuid, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
      return;
    end if;

    insert into public.assistant_turns (
      conversation_id, workspace_id, owner_id, prompt_version_id, message_id, request_hash
    ) values (
      p_conversation_id, p_workspace_id, p_owner_id, p_prompt_version_id, effective_message_id, p_request_hash
    )
    on conflict (workspace_id, owner_id, message_id) do nothing
    returning * into turn_record;

    if turn_record.id is null then
      select * into turn_record
      from public.assistant_turns turn_row
      where turn_row.workspace_id = p_workspace_id
        and turn_row.owner_id = p_owner_id
        and turn_row.message_id = effective_message_id
      for update;
    end if;
  end if;

  if turn_record.id is null then raise exception 'Assistant turn could not be created'; end if;
  if turn_record.request_hash <> p_request_hash then raise exception 'Assistant idempotency key conflict'; end if;

  if turn_record.status = 'completed' then
    return query select 'completed'::text, turn_record.id, turn_record.response_text,
      turn_record.source_refs, turn_record.usage, turn_record.response_model, null::uuid;
    return;
  end if;

  select exists(
    select 1
    from public.assistant_turn_artifacts artifact
    where artifact.turn_id = turn_record.id
  ) into turn_has_artifact;

  if turn_has_artifact then
    update public.assistant_turns as recovered_turn
       set status = 'completed',
           response_text = coalesce(nullif(recovered_turn.response_text, ''), 'Dosya oluşturuldu ve hazır.'),
           usage = coalesce(recovered_turn.usage, '{}'::jsonb) || jsonb_build_object('artifact_recovered_without_reexecution', 1),
           response_model = coalesce(recovered_turn.response_model, conversation_record.model),
           error_message = null,
           completed_at = coalesce(recovered_turn.completed_at, now()),
           updated_at = now()
     where recovered_turn.id = turn_record.id
     returning recovered_turn.* into turn_record;

    update public.assistant_reasoning_runs as reasoning_run
       set status = 'completed', error_message = null,
           completed_at = coalesce(reasoning_run.completed_at, now()), updated_at = now()
     where reasoning_run.turn_id = turn_record.id and reasoning_run.status = 'running';

    update public.assistant_conversations as recovered_conversation
       set locked_turn_id = null,
           lock_expires_at = null,
           revision = recovered_conversation.revision + 1,
           updated_at = now()
     where recovered_conversation.id = p_conversation_id
       and (recovered_conversation.locked_turn_id = turn_record.id or recovered_conversation.locked_turn_id is null);

    return query select 'completed'::text, turn_record.id, turn_record.response_text,
      turn_record.source_refs, turn_record.usage, turn_record.response_model, null::uuid;
    return;
  end if;

  if turn_record.status = 'running' and turn_record.updated_at >= now() - interval '3 minutes' then
    return query select 'in_progress'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
    return;
  end if;

  update public.assistant_turns as claimed_turn
     set status = 'running', attempt_count = claimed_turn.attempt_count + 1,
         lease_token = gen_random_uuid(), error_message = null,
         completed_at = null, updated_at = now()
   where claimed_turn.id = turn_record.id
   returning claimed_turn.* into turn_record;

  update public.assistant_conversations as claimed_conversation
     set locked_turn_id = turn_record.id,
         lock_expires_at = now() + interval '3 minutes', updated_at = now()
   where claimed_conversation.id = p_conversation_id;

  return query select 'claimed'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, turn_record.lease_token;
end;
$function$;
