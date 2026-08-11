-- Keep the trivial fast-path completion RPC aligned with the runtime model set.
-- Auto, Gemini Pro, and retired Flash Lite preview greetings execute on stable
-- Flash Lite for latency, so the completion guard must accept that response
-- model as well as the newer Gemini 3.5 fast-path models.

create or replace function public.complete_trivial_assistant_turn(
  p_turn_id uuid,
  p_conversation_id uuid,
  p_lease_token uuid,
  p_response_text text,
  p_usage jsonb,
  p_response_model text,
  p_provider text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_turn public.assistant_turns%rowtype;
  v_conversation public.assistant_conversations%rowtype;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if p_provider not in ('openai', 'gemini')
     or p_response_model not in (
       'gpt-5.6-sol',
       'gpt-5.6',
       'gemini-3-flash-preview',
       'gemini-3.1-pro-preview',
       'gemini-3.1-flash-lite',
       'gemini-3.1-flash-lite-preview',
       'gemini-3.5-flash',
       'gemini-3.5-flash-lite'
     )
     or jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_fast_path_completion';
  end if;

  -- Keep the canonical lock order: turn first, conversation second.
  select turn_row.*
    into v_turn
    from public.assistant_turns turn_row
   where turn_row.id = p_turn_id
     and turn_row.conversation_id = p_conversation_id
     and turn_row.owner_id = v_owner_id
     and turn_row.lease_token = p_lease_token
     and turn_row.status = 'running'
   for update;

  if v_turn.id is null then
    return;
  end if;

  select conversation.*
    into v_conversation
    from public.assistant_conversations conversation
   where conversation.id = p_conversation_id
   for update;

  if v_conversation.id is null
     or v_conversation.locked_turn_id <> p_turn_id then
    raise exception using errcode = '55000', message = 'assistant_turn_lock_invalid';
  end if;

  -- IMPORTANT: do not set assistant_conversations.model = p_response_model.
  -- conversation.model is the user's requested model (for example Gemini Pro).
  -- p_response_model is the execution/response model (for example Flash Lite).
  -- Keeping them separate allows repeated trivial Pro turns to remain eligible
  -- for the fast path while preserving truthful response attribution per turn.
  update public.assistant_conversations
     set revision = revision + 1,
         locked_turn_id = null,
         lock_expires_at = null,
         updated_at = now()
   where id = p_conversation_id;

  update public.assistant_turns
     set status = 'completed',
         response_text = left(coalesce(p_response_text, ''), 200000),
         source_refs = '[]'::jsonb,
         usage = coalesce(p_usage, '{}'::jsonb),
         response_model = p_response_model,
         error_message = null,
         completed_at = now(),
         updated_at = now()
   where id = p_turn_id;

  update public.assistant_reasoning_runs
     set plan = coalesce(plan, '{}'::jsonb),
         verification = '{}'::jsonb,
         execution_trace = coalesce(execution_trace, '[]'::jsonb)
           || jsonb_build_array(
             jsonb_build_object('stage', 'synthesizing', 'label', 'Doğrudan model yanıtı', 'at', now()),
             jsonb_build_object('stage', 'answering', 'label', 'Yanıt hazırlandı', 'at', now())
           ),
         evidence_summary = jsonb_build_object(
           'fastPath', true,
           'provider', p_provider,
           'requestedModel', v_conversation.model,
           'responseModel', p_response_model
         ),
         knowledge_used = false,
         web_used = false,
         tool_call_count = 0,
         fallback_used = false,
         status = 'completed',
         error_message = null,
         completed_at = now(),
         updated_at = now()
   where turn_id = p_turn_id;
end;
$$;

revoke all on function public.complete_trivial_assistant_turn(uuid, uuid, uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.complete_trivial_assistant_turn(uuid, uuid, uuid, text, jsonb, text, text) to authenticated;