-- Collapse the durable setup for exact conversational greetings into one DB
-- round trip. The RPCs remain fail-closed: permanent auth user + workspace
-- membership are validated before any assistant state is touched.
--
-- Lock-order invariant: existing assistant runtime code locks turn -> conversation.
-- This fast path never locks or archives an existing conversation before calling
-- claim_assistant_turn, so it cannot introduce the reverse conversation -> turn
-- order. If the active conversation belongs to another model/prompt, the caller
-- falls back to the normal core, which owns that lifecycle transition.

create or replace function public.claim_trivial_assistant_turn(
  p_workspace_id text,
  p_message_id text,
  p_request_hash text,
  p_model text,
  p_user_limit_per_minute integer default 6,
  p_workspace_limit_per_minute integer default 30
)
returns table(
  outcome text,
  turn_id uuid,
  conversation_id uuid,
  prompt_version_id uuid,
  lease_token uuid,
  response_text text,
  usage jsonb,
  response_model text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_prompt_id uuid;
  v_conversation public.assistant_conversations%rowtype;
  v_claim record;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if not exists (
    select 1
    from auth.users account
    where account.id = v_owner_id
      and coalesce(account.is_anonymous, false) is false
  ) then
    raise exception using errcode = '42501', message = 'permanent_user_required';
  end if;

  if not coalesce(public.is_workspace_member(p_workspace_id), false) then
    raise exception using errcode = '42501', message = 'workspace_access_denied';
  end if;

  if p_model not in (
    'gpt-5.6-sol',
    'gpt-5.6',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite-preview'
  ) then
    raise exception using errcode = '22023', message = 'unsupported_fast_path_model';
  end if;

  if nullif(trim(coalesce(p_message_id, '')), '') is null
     or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_fast_path_request';
  end if;

  -- Mirror the existing get_active_assistant_prompt contract exactly. Prompt
  -- selection semantics are deliberately not changed by this latency feature.
  select prompt.id
    into v_prompt_id
    from public.assistant_prompt_versions prompt
   where prompt.is_active
     and (prompt.workspace_id = p_workspace_id or prompt.workspace_id is null)
   order by (prompt.workspace_id = p_workspace_id) desc, prompt.version desc
   limit 1;

  if v_prompt_id is null then
    raise exception using errcode = '55000', message = 'active_assistant_prompt_missing';
  end if;

  -- Read only. Do not acquire the conversation row lock before the turn lock.
  select conversation.*
    into v_conversation
    from public.assistant_conversations conversation
   where conversation.workspace_id = p_workspace_id
     and conversation.status = 'active';

  if v_conversation.id is not null
     and (v_conversation.prompt_version_id <> v_prompt_id or v_conversation.model <> p_model) then
    return query select
      'fallback'::text,
      null::uuid,
      v_conversation.id,
      v_prompt_id,
      null::uuid,
      null::text,
      '{}'::jsonb,
      null::text;
    return;
  end if;

  if v_conversation.id is null then
    insert into public.assistant_conversations (
      workspace_id,
      owner_id,
      prompt_version_id,
      model,
      status
    ) values (
      p_workspace_id,
      v_owner_id,
      v_prompt_id,
      p_model,
      'active'
    )
    on conflict do nothing
    returning * into v_conversation;

    if v_conversation.id is null then
      -- A concurrent request won the active-conversation race. Read the winner
      -- without locking; claim_assistant_turn will enforce the canonical lock
      -- order if it is compatible with this fast path.
      select conversation.*
        into v_conversation
        from public.assistant_conversations conversation
       where conversation.workspace_id = p_workspace_id
         and conversation.status = 'active';

      if v_conversation.id is null
         or v_conversation.prompt_version_id <> v_prompt_id
         or v_conversation.model <> p_model then
        return query select
          'fallback'::text,
          null::uuid,
          v_conversation.id,
          v_prompt_id,
          null::uuid,
          null::text,
          '{}'::jsonb,
          null::text;
        return;
      end if;
    end if;
  end if;

  -- Existing durable runtime owns idempotency, rate limiting, turn lease and the
  -- canonical turn -> conversation lock order.
  select *
    into v_claim
    from public.claim_assistant_turn(
      v_conversation.id,
      p_workspace_id,
      v_owner_id,
      v_prompt_id,
      left(p_message_id, 240),
      p_request_hash,
      greatest(1, least(p_user_limit_per_minute, 60)),
      greatest(1, least(p_workspace_limit_per_minute, 240))
    );

  if v_claim.outcome = 'claimed' then
    insert into public.assistant_reasoning_runs (
      turn_id,
      conversation_id,
      workspace_id,
      owner_id,
      prompt_version_id,
      engine_version,
      intent,
      complexity,
      plan,
      verification,
      execution_trace,
      evidence_summary,
      knowledge_used,
      web_used,
      tool_call_count,
      fallback_used,
      status,
      error_message,
      started_at,
      completed_at,
      updated_at
    ) values (
      v_claim.turn_id,
      v_conversation.id,
      p_workspace_id,
      v_owner_id,
      v_prompt_id,
      'trivial-fast-path-v1',
      'simple_answer',
      'low',
      jsonb_build_object(
        'intent', 'simple_answer',
        'complexity', 'low',
        'goal', 'Conversational response',
        'steps', jsonb_build_array(jsonb_build_object(
          'id', 'synthesize',
          'label', 'Direct conversational synthesis',
          'toolHint', 'none',
          'successCriteria', 'Short natural response without tools'
        )),
        'knowledgeRequired', false,
        'verificationRequired', false,
        'webMode', 'none',
        'creativeMode', false,
        'evidenceQueries', '[]'::jsonb
      ),
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'stage', 'routing',
        'label', 'Doğrudan kısa yanıt yolu',
        'at', now()
      )),
      jsonb_build_object('fastPath', true),
      false,
      false,
      0,
      false,
      'running',
      null,
      now(),
      null,
      now()
    )
    on conflict (turn_id) do update
      set engine_version = excluded.engine_version,
          intent = excluded.intent,
          complexity = excluded.complexity,
          plan = excluded.plan,
          verification = excluded.verification,
          execution_trace = excluded.execution_trace,
          evidence_summary = excluded.evidence_summary,
          knowledge_used = false,
          web_used = false,
          tool_call_count = 0,
          fallback_used = false,
          status = 'running',
          error_message = null,
          started_at = now(),
          completed_at = null,
          updated_at = now();
  end if;

  return query select
    v_claim.outcome::text,
    v_claim.turn_id::uuid,
    v_conversation.id,
    v_prompt_id,
    v_claim.lease_token::uuid,
    v_claim.response_text::text,
    coalesce(v_claim.usage, '{}'::jsonb),
    v_claim.response_model::text;
end;
$$;

revoke all on function public.claim_trivial_assistant_turn(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.claim_trivial_assistant_turn(text, text, text, text, integer, integer) to authenticated;

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
       'gemini-3.1-flash-lite-preview'
     )
     or jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_fast_path_completion';
  end if;

  -- Same lock order as complete_assistant_turn: turn first, conversation second.
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

  -- Trivial turns deliberately do not append to durable state_items. A greeting
  -- must not pollute substantive BA context. The visible message is persisted by
  -- the normal messages flow, while conversation revision/idempotency stay intact.
  update public.assistant_conversations
     set model = p_response_model,
         revision = revision + 1,
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
         evidence_summary = jsonb_build_object('fastPath', true, 'provider', p_provider),
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
