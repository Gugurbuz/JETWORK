-- Allow the runtime to complete an explicit fail-closed grounding refusal.
-- The hard grounding guard still blocks knowledge-required answers with no
-- verified source unless the server discarded unverified provider text and
-- replaced it with the fixed "do not hallucinate" response.
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
  grounding_required boolean := false;
  has_verified_source boolean := false;
  grounding_fail_closed boolean := false;
  grounding_fail_closed_marker numeric := 0;
  discarded_provider_text_marker numeric := 0;
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

  select coalesce(
    (r.plan ->> 'knowledgeRequired')::boolean
    and coalesce(r.plan ->> 'executionMode', 'knowledge') in ('knowledge', 'research'),
    false
  )
  into grounding_required
  from public.assistant_reasoning_runs r
  where r.turn_id = p_turn_id
  order by r.started_at desc
  limit 1;

  grounding_required := coalesce(grounding_required, false);

  select exists (
    select 1
    from jsonb_array_elements(p_source_refs) source_ref
    where coalesce(
      nullif(trim(source_ref ->> 'canonicalKey'), ''),
      nullif(trim(source_ref ->> 'url'), ''),
      nullif(trim(source_ref ->> 'sourceId'), '')
    ) is not null
  ) into has_verified_source;

  if grounding_required and not has_verified_source and not grounding_fail_closed then
    raise exception 'GROUNDING_REQUIRED_NO_VERIFIED_SOURCE';
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
  set model = left(p_response_model, 80), state_items = p_state_items, revision = revision + 1,
      locked_turn_id = null, lock_expires_at = null, updated_at = now()
  where id = p_conversation_id;

  update public.assistant_turns
  set status = 'completed', response_text = p_response_text, source_refs = p_source_refs, usage = p_usage,
      response_model = left(p_response_model, 80), error_message = null, completed_at = now()
  where id = p_turn_id;
end;
$function$;

revoke all on function public.complete_assistant_turn(
  uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.complete_assistant_turn(
  uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb, text
) to service_role;