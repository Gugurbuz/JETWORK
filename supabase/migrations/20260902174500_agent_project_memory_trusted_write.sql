-- Agent Controller V2 trusted Project Memory write path.
--
-- Semantic choice (what is worth remembering) belongs to the controller LLM.
-- Identity and provenance do not: owner_id is derived from auth.uid(), and the
-- source message is resolved by an exact quote from a real user message in the
-- active workspace. The model never supplies owner_id or source_message_id.

create or replace function public.record_agent_project_memory_v2(
  p_workspace_id text,
  p_memory_key text,
  p_value text,
  p_memory_class text,
  p_category text,
  p_source_quote text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_source_message_id text;
  v_source_created_at timestamptz;
  v_previous_id uuid;
  v_previous_version integer;
  v_new_id uuid;
  v_key text := trim(coalesce(p_memory_key, ''));
  v_value text := trim(coalesce(p_value, ''));
  v_memory_class text := upper(trim(coalesce(p_memory_class, '')));
  v_category text := lower(trim(coalesce(p_category, '')));
  v_quote text := trim(coalesce(p_source_quote, ''));
begin
  if v_owner_id is null then
    raise exception 'Authenticated user is required';
  end if;
  if p_workspace_id is null or trim(p_workspace_id) = '' then
    raise exception 'workspace_id is required';
  end if;
  if char_length(v_key) < 1 or char_length(v_key) > 240 then
    raise exception 'memory_key must contain 1-240 characters';
  end if;
  if char_length(v_value) < 1 or char_length(v_value) > 2000 then
    raise exception 'value must contain 1-2000 characters';
  end if;
  if v_memory_class not in ('DECISION', 'PROJECT_FACT', 'CORRECTION') then
    raise exception 'Durable memory_class must be DECISION, PROJECT_FACT or CORRECTION';
  end if;
  if v_category not in ('fact', 'decision') then
    raise exception 'Durable category must be fact or decision';
  end if;
  if v_memory_class = 'DECISION' and v_category <> 'decision' then
    raise exception 'DECISION memory must use decision category';
  end if;
  if v_memory_class = 'PROJECT_FACT' and v_category <> 'fact' then
    raise exception 'PROJECT_FACT memory must use fact category';
  end if;
  if char_length(v_quote) < 4 or char_length(v_quote) > 1000 then
    raise exception 'source_quote must contain 4-1000 exact characters from a user message';
  end if;

  if not exists (
    select 1
    from public.workspaces workspace
    where workspace.id = p_workspace_id
      and (
        workspace.owner_id = v_owner_id
        or workspace.collaborators @> pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('id', v_owner_id::text)
        )
      )
  ) then
    raise exception 'Workspace access denied';
  end if;

  select message.id, message.created_at
    into v_source_message_id, v_source_created_at
  from public.messages message
  where message.workspace_id = p_workspace_id
    and message.owner_id = v_owner_id
    and message.role = 'user'
    and pg_catalog.position(v_quote in coalesce(message.text, '')) > 0
  order by message.created_at desc, message.id desc
  limit 1;

  if v_source_message_id is null then
    raise exception 'source_quote was not found in an authenticated user message';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id || '|' || v_owner_id::text || '|' || v_key,
      0
    )
  );

  select memory.id, memory.memory_version
    into v_previous_id, v_previous_version
  from public.project_memory_entries memory
  where memory.workspace_id = p_workspace_id
    and memory.owner_id = v_owner_id
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
    v_owner_id,
    v_key,
    v_value,
    v_category,
    v_source_message_id,
    'user_message',
    'confirmed',
    1,
    coalesce(v_previous_version, 0) + 1,
    v_previous_id,
    coalesce(v_source_created_at, now())
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.record_agent_project_memory_v2(
  text, text, text, text, text, text
) from public, anon, service_role;

grant execute on function public.record_agent_project_memory_v2(
  text, text, text, text, text, text
) to authenticated;

comment on function public.record_agent_project_memory_v2(
  text, text, text, text, text, text
) is
  'Trusted Agent Controller V2 durable-memory write. Derives owner from auth.uid() and resolves source_message_id from an exact authenticated user-message quote before atomically versioning/superseding memory.';
