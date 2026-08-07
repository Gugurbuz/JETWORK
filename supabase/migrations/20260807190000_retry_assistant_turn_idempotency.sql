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
  conversation_record public.assistant_conversations%rowtype;
  user_turn_count integer;
  workspace_turn_count integer;
  effective_message_id text := left(p_message_id, 240);
begin
  select *
    into turn_record
    from public.assistant_turns turn_row
   where turn_row.workspace_id = p_workspace_id
     and turn_row.owner_id = p_owner_id
     and turn_row.message_id = effective_message_id
   for update;

  -- A visible chat message can legitimately be retried after the selected model,
  -- transformed prompt, attachment set, or runtime version has changed. In that
  -- case the same UI message id represents a new assistant request, not the same
  -- idempotent operation. Keep exact retries on the original key, but derive a
  -- deterministic secondary key for changed request content.
  if turn_record.id is not null
     and turn_record.request_hash <> p_request_hash then
    effective_message_id := left(p_message_id, 175) || ':' || p_request_hash;

    select *
      into turn_record
      from public.assistant_turns turn_row
     where turn_row.workspace_id = p_workspace_id
       and turn_row.owner_id = p_owner_id
       and turn_row.message_id = effective_message_id
     for update;
  end if;

  if turn_record.id is null then
    select count(*)::integer
      into user_turn_count
      from public.assistant_turns turn_row
     where turn_row.owner_id = p_owner_id
       and turn_row.created_at >= now() - interval '1 minute';

    select count(*)::integer
      into workspace_turn_count
      from public.assistant_turns turn_row
     where turn_row.workspace_id = p_workspace_id
       and turn_row.created_at >= now() - interval '1 minute';

    if user_turn_count >= greatest(1, least(p_user_limit_per_minute, 60))
       or workspace_turn_count >= greatest(1, least(p_workspace_limit_per_minute, 240)) then
      return query select
        'rate_limited'::text,
        null::uuid,
        null::text,
        '[]'::jsonb,
        '{}'::jsonb,
        null::text,
        null::uuid;
      return;
    end if;

    insert into public.assistant_turns (
      conversation_id,
      workspace_id,
      owner_id,
      prompt_version_id,
      message_id,
      request_hash
    )
    values (
      p_conversation_id,
      p_workspace_id,
      p_owner_id,
      p_prompt_version_id,
      effective_message_id,
      p_request_hash
    )
    on conflict (workspace_id, owner_id, message_id) do nothing
    returning * into turn_record;

    -- A concurrent request may have inserted the same idempotency key while
    -- this transaction was checking the rate limit. Re-read and lock it.
    if turn_record.id is null then
      select *
        into turn_record
        from public.assistant_turns turn_row
       where turn_row.workspace_id = p_workspace_id
         and turn_row.owner_id = p_owner_id
         and turn_row.message_id = effective_message_id
       for update;
    end if;
  end if;

  if turn_record.id is null then
    raise exception 'Assistant turn could not be created';
  end if;
  if turn_record.request_hash <> p_request_hash then
    raise exception 'Assistant idempotency key conflict';
  end if;
  if turn_record.status = 'completed' then
    return query select
      'completed'::text,
      turn_record.id,
      turn_record.response_text,
      turn_record.source_refs,
      turn_record.usage,
      turn_record.response_model,
      null::uuid;
    return;
  end if;

  select *
    into conversation_record
    from public.assistant_conversations conversation_row
   where conversation_row.id = p_conversation_id
     and conversation_row.workspace_id = p_workspace_id
     and conversation_row.status = 'active'
   for update;

  if conversation_record.id is null
     or conversation_record.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  if turn_record.status = 'running'
     and turn_record.updated_at >= now() - interval '3 minutes' then
    return query select
      'in_progress'::text,
      turn_record.id,
      null::text,
      '[]'::jsonb,
      '{}'::jsonb,
      null::text,
      null::uuid;
    return;
  end if;

  if conversation_record.locked_turn_id is not null
     and conversation_record.locked_turn_id <> turn_record.id
     and conversation_record.lock_expires_at > now() then
    return query select
      'busy'::text,
      turn_record.id,
      null::text,
      '[]'::jsonb,
      '{}'::jsonb,
      null::text,
      null::uuid;
    return;
  end if;

  update public.assistant_turns
     set status = 'running',
         attempt_count = attempt_count + 1,
         lease_token = gen_random_uuid(),
         error_message = null,
         completed_at = null
   where id = turn_record.id
   returning * into turn_record;

  update public.assistant_conversations
     set locked_turn_id = turn_record.id,
         lock_expires_at = now() + interval '3 minutes',
         updated_at = now()
   where id = p_conversation_id;

  return query select
    'claimed'::text,
    turn_record.id,
    null::text,
    '[]'::jsonb,
    '{}'::jsonb,
    null::text,
    turn_record.lease_token;
end;
$function$;