-- Agent Controller V2 Project Memory persistence.
--
-- Project Memory is deliberately user-owned durable context. Verified technical
-- evidence remains in assistant_verified_facts and assistant/AI hypotheses never
-- reach this function. Runtime callers must pass only candidates that survived
-- the stateReducer trust boundary.

create or replace function public.persist_agent_project_memory_v2(
  p_workspace_id text,
  p_owner_id uuid,
  p_memory_key text,
  p_value text,
  p_category text,
  p_source_message_id text default null,
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
  v_key text := trim(coalesce(p_memory_key, ''));
  v_value text := trim(coalesce(p_value, ''));
  v_category text := lower(trim(coalesce(p_category, '')));
begin
  if p_workspace_id is null or trim(p_workspace_id) = '' then
    raise exception 'workspace_id is required';
  end if;
  if p_owner_id is null then
    raise exception 'owner_id is required';
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

  -- Serialize writes for the same owner/workspace/key, including the first
  -- version where no row exists yet. This prevents sibling versions under
  -- concurrent assistant turns.
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
    nullif(trim(coalesce(p_source_message_id, '')), ''),
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

revoke all on function public.persist_agent_project_memory_v2(
  text, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.persist_agent_project_memory_v2(
  text, uuid, text, text, text, text, timestamptz
) to service_role;

comment on function public.persist_agent_project_memory_v2(
  text, uuid, text, text, text, text, timestamptz
) is
  'Atomically versions user-owned Agent Controller V2 Project Memory. Semantic extraction and AI hypotheses are intentionally outside this RPC.';
