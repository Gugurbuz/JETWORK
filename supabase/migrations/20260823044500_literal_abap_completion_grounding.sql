create or replace function public.complete_assistant_turn(p_turn_id uuid, p_conversation_id uuid, p_lease_token uuid, p_expected_revision bigint, p_state_items jsonb, p_response_text text, p_source_refs jsonb, p_usage jsonb, p_response_model text)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  conversation_record public.assistant_conversations%rowtype;
  turn_record public.assistant_turns%rowtype;
  enterprise_grounding_required boolean := false;
  has_verified_enterprise_source boolean := false;
  grounding_fail_closed boolean := false;
  grounding_fail_closed_marker numeric := 0;
  discarded_provider_text_marker numeric := 0;
  clean_state_items jsonb := '[]'::jsonb;
  code_match text[];
  normalized_code text;
  literal_code_supported boolean;
  current_user_text text := '';
  previous_user_text text := '';
  literal_source_requested boolean := false;
begin
  if jsonb_typeof(p_state_items) <> 'array' or jsonb_typeof(p_source_refs) <> 'array' or jsonb_typeof(p_usage) <> 'object' then
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
  where id = p_turn_id and conversation_id = p_conversation_id and lease_token = p_lease_token and status = 'running'
  for update;

  if turn_record.id is null then raise exception 'Assistant turn lock is no longer valid'; end if;

  select coalesce(m.text, '') into current_user_text
  from public.messages m
  where m.id = turn_record.message_id and m.workspace_id = turn_record.workspace_id and m.role = 'user'
  limit 1;

  if coalesce(current_user_text, '') ~* '(abap|source[[:space:]]*code|kaynak[[:space:]]*kod|implementasyon|implementation|kodunu|kodu)' then
    literal_source_requested := true;
  elsif coalesce(current_user_text, '') ~ '^\s*[0-9]{2,4}(\s|$)' then
    select coalesce(m.text, '') into previous_user_text
    from public.messages m
    where m.workspace_id = turn_record.workspace_id
      and m.role = 'user'
      and m.created_at < coalesce((select created_at from public.messages where id = turn_record.message_id limit 1), now())
    order by m.created_at desc
    limit 1;
    literal_source_requested := coalesce(previous_user_text, '') ~* '(abap|source[[:space:]]*code|kaynak[[:space:]]*kod|implementasyon|implementation|kodunu|kodu)';
  end if;

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
      and coalesce(nullif(trim(source_ref ->> 'canonicalKey'), ''), nullif(trim(source_ref ->> 'sourceId'), '')) is not null
  ) into has_verified_enterprise_source;

  if enterprise_grounding_required and not has_verified_enterprise_source and not grounding_fail_closed then
    raise exception 'ENTERPRISE_GROUNDING_REQUIRED_NO_VERIFIED_SOURCE';
  end if;

  for code_match in
    select m
    from regexp_matches(coalesce(p_response_text, ''), '```([A-Za-z0-9_+.-]*)[[:space:]]+([^`]{20,})```', 'gi') as m
  loop
    if not literal_source_requested and lower(coalesce(code_match[1], '')) <> 'abap' then
      continue;
    end if;

    normalized_code := regexp_replace(lower(coalesce(code_match[2], '')), '[[:space:]]+', '', 'g');
    if length(normalized_code) < 20 then continue; end if;

    select exists (
      select 1
      from jsonb_array_elements(p_source_refs) source_ref
      join public.knowledge_objects_v2 o
        on o.publication_status = 'published'
       and (o.canonical_key = source_ref ->> 'canonicalKey' or o.primary_source_id::text = source_ref ->> 'sourceId')
      join public.knowledge_object_versions_v2 v
        on v.id = o.published_version_id and v.is_current = true
      where coalesce(source_ref ->> 'sourceType', 'knowledge') <> 'web'
        and position(normalized_code in regexp_replace(lower(coalesce(v.content, '')), '[[:space:]]+', '', 'g')) > 0
    ) into literal_code_supported;

    if not coalesce(literal_code_supported, false) then
      raise exception 'UNVERIFIED_LITERAL_SOURCE_CODE';
    end if;
  end loop;

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
  set model = left(p_response_model, 80), state_items = clean_state_items, revision = revision + 1,
      locked_turn_id = null, lock_expires_at = null, updated_at = now()
  where id = p_conversation_id;

  update public.assistant_turns
  set status = 'completed', response_text = p_response_text, source_refs = p_source_refs, usage = p_usage,
      response_model = left(p_response_model, 80), error_message = null, completed_at = now(), updated_at = now()
  where id = p_turn_id;
end;
$function$;
