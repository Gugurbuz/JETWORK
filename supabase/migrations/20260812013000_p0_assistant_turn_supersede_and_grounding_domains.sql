-- P0: recover cleanly from disconnected assistant streams and keep public web
-- evidence separate from enterprise/project grounding.

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
set search_path = ''
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
begin
  if effective_message_id = '' or coalesce(p_request_hash, '') = '' then
    raise exception 'Assistant message id and request hash are required';
  end if;

  -- Serialize competing claims in one workspace/user without changing the
  -- canonical turn -> conversation row-lock order used by completion.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id || ':' || p_owner_id::text, 0));

  select *
    into conversation_snapshot
    from public.assistant_conversations conversation_row
   where conversation_row.id = p_conversation_id
     and conversation_row.workspace_id = p_workspace_id
     and conversation_row.status = 'active';

  if conversation_snapshot.id is null
     or conversation_snapshot.prompt_version_id <> p_prompt_version_id then
    raise exception 'Assistant conversation is not available for this prompt version';
  end if;

  snapshot_locked_turn_id := conversation_snapshot.locked_turn_id;

  if snapshot_locked_turn_id is not null then
    select *
      into locked_turn
      from public.assistant_turns turn_row
     where turn_row.id = snapshot_locked_turn_id
     for update;
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

  -- A concurrent completion/claim changed the owner. Never guess which turn is
  -- newer; a retry will see stable state.
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
        update public.assistant_turns
           set status = 'failed',
               error_message = 'stale_lock_reclaimed',
               completed_at = now(),
               updated_at = now()
         where id = locked_turn.id;

        update public.assistant_reasoning_runs as reasoning_run
           set status = 'failed',
               error_message = 'stale_lock_reclaimed',
               completed_at = coalesce(reasoning_run.completed_at, now()),
               updated_at = now()
         where reasoning_run.turn_id = locked_turn.id
           and reasoning_run.status = 'running';
      end if;

      update public.assistant_conversations
         set locked_turn_id = null,
             lock_expires_at = null,
             updated_at = now()
       where id = p_conversation_id
         and locked_turn_id = locked_turn.id;
      conversation_record.locked_turn_id := null;
      conversation_record.lock_expires_at := null;
    else
      select message_row.created_at
        into incoming_message_at
        from public.messages message_row
       where message_row.workspace_id = p_workspace_id
         and message_row.id = p_message_id
       limit 1;

      select message_row.created_at
        into locked_message_at
        from public.messages message_row
       where message_row.workspace_id = p_workspace_id
         and (
           message_row.id = locked_turn.message_id
           or locked_turn.message_id like message_row.id || ':%'
         )
       order by case when message_row.id = locked_turn.message_id then 0 else 1 end,
                message_row.created_at desc
       limit 1;

      if incoming_message_at is not null
         and locked_message_at is not null
         and incoming_message_at > locked_message_at then
        update public.assistant_turns
           set status = 'failed',
               error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
               completed_at = now(),
               updated_at = now()
         where id = locked_turn.id
           and status = 'running';

        update public.assistant_reasoning_runs as reasoning_run
           set status = 'failed',
               error_message = 'superseded_by_newer_message:' || left(p_message_id, 240),
               completed_at = coalesce(reasoning_run.completed_at, now()),
               updated_at = now()
         where reasoning_run.turn_id = locked_turn.id
           and reasoning_run.status = 'running';

        update public.assistant_conversations
           set locked_turn_id = null,
               lock_expires_at = null,
               updated_at = now()
         where id = p_conversation_id
           and locked_turn_id = locked_turn.id;
        conversation_record.locked_turn_id := null;
        conversation_record.lock_expires_at := null;
      else
        -- Older/out-of-order work can never kill a newer turn.
        return query select 'busy'::text, locked_turn.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
        return;
      end if;
    end if;
  end if;

  select *
    into turn_record
    from public.assistant_turns turn_row
   where turn_row.workspace_id = p_workspace_id
     and turn_row.owner_id = p_owner_id
     and turn_row.message_id = effective_message_id
   for update;

  if turn_record.id is not null and turn_record.request_hash <> p_request_hash then
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
    select count(*)::integer into user_turn_count
      from public.assistant_turns turn_row
     where turn_row.owner_id = p_owner_id
       and turn_row.created_at >= now() - interval '1 minute';

    select count(*)::integer into workspace_turn_count
      from public.assistant_turns turn_row
     where turn_row.workspace_id = p_workspace_id
       and turn_row.created_at >= now() - interval '1 minute';

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

  if turn_record.status = 'running'
     and turn_record.updated_at >= now() - interval '3 minutes' then
    return query select 'in_progress'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, null::uuid;
    return;
  end if;

  update public.assistant_turns
     set status = 'running',
         attempt_count = attempt_count + 1,
         lease_token = gen_random_uuid(),
         error_message = null,
         completed_at = null,
         updated_at = now()
   where id = turn_record.id
   returning * into turn_record;

  update public.assistant_conversations
     set locked_turn_id = turn_record.id,
         lock_expires_at = now() + interval '3 minutes',
         updated_at = now()
   where id = p_conversation_id;

  return query select 'claimed'::text, turn_record.id, null::text, '[]'::jsonb, '{}'::jsonb, null::text, turn_record.lease_token;
end;
$function$;

create or replace function public.complete_assistant_turn(
  p_turn_id uuid,
  p_conversation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_state_items jsonb,
  p_response_text text,
  p_source_refs jsonb,
  p_usage jsonb,
  p_response_model text
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  conversation_record public.assistant_conversations%rowtype;
  turn_record public.assistant_turns%rowtype;
  enterprise_grounding_required boolean := false;
  has_verified_enterprise_source boolean := false;
  grounding_fail_closed boolean := false;
  grounding_fail_closed_marker numeric := 0;
  discarded_provider_text_marker numeric := 0;
begin
  if jsonb_typeof(p_state_items) <> 'array'
     or jsonb_typeof(p_source_refs) <> 'array'
     or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'Assistant completion payload is invalid';
  end if;

  if coalesce(p_usage ->> 'grounding_fail_closed', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    grounding_fail_closed_marker := (p_usage ->> 'grounding_fail_closed')::numeric;
  end if;
  if coalesce(p_usage ->> 'grounding_unverified_provider_text_discarded', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    discarded_provider_text_marker := (p_usage ->> 'grounding_unverified_provider_text_discarded')::numeric;
  end if;

  grounding_fail_closed :=
    coalesce(p_response_text, '') like 'Bu teknik yanıtı güvenli biçimde tamamlayamadım:%'
    and grounding_fail_closed_marker > 0
    and discarded_provider_text_marker > 0;

  select * into turn_record
  from public.assistant_turns
  where id = p_turn_id
    and conversation_id = p_conversation_id
    and lease_token = p_lease_token
    and status = 'running'
  for update;

  if turn_record.id is null then raise exception 'Assistant turn lock is no longer valid'; end if;

  select coalesce(
    case
      when r.plan ? 'enterpriseGroundingRequired'
        then (r.plan ->> 'enterpriseGroundingRequired')::boolean
      else (r.plan ->> 'knowledgeRequired')::boolean
        and coalesce(r.plan ->> 'executionMode', 'knowledge') in ('knowledge', 'research')
    end,
    false
  )
  into enterprise_grounding_required
  from public.assistant_reasoning_runs r
  where r.turn_id = p_turn_id
  order by r.started_at desc
  limit 1;

  enterprise_grounding_required := coalesce(enterprise_grounding_required, false);

  select exists (
    select 1
    from jsonb_array_elements(p_source_refs) source_ref
    where coalesce(source_ref ->> 'sourceType', 'knowledge') <> 'web'
      and coalesce(
        nullif(trim(source_ref ->> 'canonicalKey'), ''),
        nullif(trim(source_ref ->> 'sourceId'), '')
      ) is not null
  ) into has_verified_enterprise_source;

  if enterprise_grounding_required
     and not has_verified_enterprise_source
     and not grounding_fail_closed then
    raise exception 'ENTERPRISE_GROUNDING_REQUIRED_NO_VERIFIED_SOURCE';
  end if;

  select * into conversation_record
  from public.assistant_conversations
  where id = p_conversation_id
  for update;

  if conversation_record.id is null or conversation_record.locked_turn_id <> p_turn_id then
    raise exception 'Assistant turn lock is no longer valid';
  end if;
  if conversation_record.revision <> p_expected_revision then
    raise exception 'Assistant conversation revision conflict';
  end if;

  update public.assistant_conversations
  set model = left(p_response_model, 80),
      state_items = p_state_items,
      revision = revision + 1,
      locked_turn_id = null,
      lock_expires_at = null,
      updated_at = now()
  where id = p_conversation_id;

  update public.assistant_turns
  set status = 'completed',
      response_text = p_response_text,
      source_refs = p_source_refs,
      usage = p_usage,
      response_model = left(p_response_model, 80),
      error_message = null,
      completed_at = now(),
      updated_at = now()
  where id = p_turn_id;
end;
$function$;

revoke all on function public.complete_assistant_turn(
  uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb, text
) from public, anon, authenticated;

grant execute on function public.complete_assistant_turn(
  uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb, text
) to service_role;
