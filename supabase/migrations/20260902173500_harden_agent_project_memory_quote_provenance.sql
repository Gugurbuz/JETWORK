-- Harden Agent Controller V2 durable Project Memory writes with DB-verified
-- provenance. The controller may propose key/value/category + an exact quote,
-- but workspace/owner/source message identity is supplied by trusted runtime.

create or replace function public.persist_agent_project_memory_from_user_quote_v2(
  p_workspace_id text,
  p_owner_id uuid,
  p_source_message_id text,
  p_source_quote text,
  p_memory_key text,
  p_value text,
  p_category text,
  p_valid_from timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_id uuid;
  v_previous_version integer;
  v_new_id uuid;
  v_message_text text;
  v_key text := trim(coalesce(p_memory_key, ''));
  v_value text := trim(coalesce(p_value, ''));
  v_quote text := trim(coalesce(p_source_quote, ''));
  v_category text := lower(trim(coalesce(p_category, '')));
begin
  if p_workspace_id is null or trim(p_workspace_id) = '' then
    raise exception 'workspace_id is required';
  end if;
  if p_owner_id is null then
    raise exception 'owner_id is required';
  end if;
  if p_source_message_id is null or trim(p_source_message_id) = '' then
    raise exception 'source_message_id is required';
  end if;
  if char_length(v_quote) < 2 or char_length(v_quote) > 1200 then
    raise exception 'source_quote must contain 2-1200 characters';
  end if;
  if char_length(v_key) < 1 or char_length(v_key) > 240 then
    raise exception 'memory_key must contain 1-240 characters';
  end if;
  if char_length(v_value) < 1 or char_length(v_value) > 2000 then
    raise exception 'value must contain 1-2000 characters';
  end if;
  if v_category not in ('fact', 'decision') then
    raise exception 'Agent V2 durable category must be fact or decision';
  end if;

  select message_row.text
    into v_message_text
  from public.messages message_row
  where message_row.id::text = trim(p_source_message_id)
    and message_row.workspace_id = p_workspace_id
    and message_row.role = 'user'
  limit 1;

  if v_message_text is null then
    raise exception 'trusted user source message was not found';
  end if;

  -- Exact source quote validation prevents the model from persisting an AI
  -- inference while merely pointing at a real user message id.
  if pg_catalog.position(v_quote in v_message_text) = 0 then
    raise exception 'source_quote is not present in the trusted user message';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id || '|' || p_owner_id::text || '|' || v_key,
      0
    )
  );

  select memory.id, memory.memory_version
    into v_previous_id, v_previous_version
  from public.project_memory_entries memory
  where memory.workspace_id = p_workspace_id
    and memory.owner_id = p_owner_id
    and memory.memory_key = v_key
  order by memory.valid_from desc, memory.memory_version desc, memory.id desc
  limit 1;

  insert into public.project_memory_entries (
    workspace_id,
    owner_id,
    memory_key,
    value,
    category,
    source_message_id,
    source_type,
    confirmation_state,
    confidence,
    memory_version,
    supersedes_id,
    valid_from
  ) values (
    p_workspace_id,
    p_owner_id,
    v_key,
    v_value,
    v_category,
    trim(p_source_message_id),
    'user_message',
    'confirmed',
    1,
    coalesce(v_previous_version, 0) + 1,
    v_previous_id,
    coalesce(p_valid_from, now())
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.persist_agent_project_memory_from_user_quote_v2(
  text, uuid, text, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.persist_agent_project_memory_from_user_quote_v2(
  text, uuid, text, text, text, text, text, timestamptz
) to service_role;

comment on function public.persist_agent_project_memory_from_user_quote_v2(
  text, uuid, text, text, text, text, text, timestamptz
) is
  'Versions user-owned Agent Controller V2 Project Memory only when the exact controller-supplied quote is present in the trusted user source message.';
