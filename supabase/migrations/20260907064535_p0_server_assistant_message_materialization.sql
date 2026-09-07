-- P0 durability invariant: once an assistant turn reaches completed, a visible
-- model message must already exist in public.messages even if the browser/SSE
-- disconnects before client-side persistence runs.
--
-- Client and server share the deterministic normal-turn identity
-- `assistant:<userMessageId>`. For legacy failed retries that already persisted a
-- random assistant id, preserve that existing row by resolving retry_payload.

create or replace function public.materialize_completed_assistant_turn_message()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  base_user_message_id text;
  assistant_message_id text;
  retry_message_id text;
  knowledge_sources jsonb := '[]'::jsonb;
  grounding_urls jsonb := '[]'::jsonb;
  provider_name text;
begin
  if new.status <> 'completed' or coalesce(trim(new.response_text), '') = '' then
    return new;
  end if;

  base_user_message_id := new.message_id;

  -- claim_assistant_turn may suffix a colliding idempotency key with
  -- `:<sha256 request hash>`. The visible message remains attached to the
  -- original user message id when that row exists.
  if not exists (
    select 1
    from public.messages m
    where m.id = base_user_message_id
      and m.workspace_id = new.workspace_id
      and m.owner_id = new.owner_id
      and m.role = 'user'
  ) then
    base_user_message_id := regexp_replace(new.message_id, ':[0-9a-fA-F]{64}$', '');
  end if;

  -- A failed pre-migration retry may already own a random assistant message id.
  -- Reuse it rather than creating a second bubble for the same user turn.
  select m.id
    into retry_message_id
    from public.messages m
   where m.workspace_id = new.workspace_id
     and m.owner_id = new.owner_id
     and m.role = 'model'
     and m.retry_payload ->> 'messageId' = base_user_message_id
   order by m.created_at desc
   limit 1;

  assistant_message_id := coalesce(
    nullif(retry_message_id, ''),
    'assistant:' || base_user_message_id
  );

  select coalesce(jsonb_agg(source_ref), '[]'::jsonb)
    into knowledge_sources
    from jsonb_array_elements(coalesce(new.source_refs, '[]'::jsonb)) source_ref
   where coalesce(source_ref ->> 'sourceType', 'knowledge') <> 'web';

  select coalesce(jsonb_agg(jsonb_build_object(
    'uri', source_ref ->> 'url',
    'title', coalesce(
      nullif(source_ref ->> 'title', ''),
      nullif(source_ref ->> 'sourceName', ''),
      source_ref ->> 'url'
    )
  )), '[]'::jsonb)
    into grounding_urls
    from jsonb_array_elements(coalesce(new.source_refs, '[]'::jsonb)) source_ref
   where source_ref ->> 'sourceType' = 'web'
     and coalesce(source_ref ->> 'url', '') ~* '^https?://';

  provider_name := case
    when coalesce(new.response_model, '') ilike 'gemini%' then 'gemini'
    when coalesce(new.response_model, '') <> '' then 'openai'
    else null
  end;

  insert into public.messages (
    id,
    workspace_id,
    owner_id,
    sender_name,
    sender_role,
    text,
    is_ai,
    role,
    knowledge_sources,
    grounding_urls,
    created_at,
    is_error,
    provider,
    response_model,
    fallback_used
  ) values (
    assistant_message_id,
    new.workspace_id,
    new.owner_id,
    'JetWork AI',
    'Sistem Asistanı',
    new.response_text,
    true,
    'model',
    knowledge_sources,
    grounding_urls,
    coalesce(new.completed_at, now()),
    false,
    provider_name,
    left(new.response_model, 80),
    false
  )
  on conflict (id) do update
    set workspace_id = excluded.workspace_id,
        owner_id = excluded.owner_id,
        sender_name = coalesce(public.messages.sender_name, excluded.sender_name),
        sender_role = coalesce(public.messages.sender_role, excluded.sender_role),
        text = excluded.text,
        is_ai = true,
        role = 'model',
        knowledge_sources = case
          when jsonb_array_length(excluded.knowledge_sources) > 0 then excluded.knowledge_sources
          else public.messages.knowledge_sources
        end,
        grounding_urls = case
          when jsonb_array_length(excluded.grounding_urls) > 0 then excluded.grounding_urls
          else public.messages.grounding_urls
        end,
        is_error = false,
        provider = coalesce(excluded.provider, public.messages.provider),
        response_model = coalesce(excluded.response_model, public.messages.response_model),
        fallback_used = public.messages.fallback_used;

  return new;
end;
$function$;

revoke all on function public.materialize_completed_assistant_turn_message()
  from public, anon, authenticated;
grant execute on function public.materialize_completed_assistant_turn_message()
  to service_role;

drop trigger if exists materialize_completed_assistant_turn_message_after_update
  on public.assistant_turns;
create trigger materialize_completed_assistant_turn_message_after_update
after update of status on public.assistant_turns
for each row
when (new.status = 'completed' and old.status is distinct from new.status)
execute function public.materialize_completed_assistant_turn_message();
