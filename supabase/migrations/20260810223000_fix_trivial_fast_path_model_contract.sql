-- Keep the context-free trivial assistant fast path aligned with the runtime's
-- execution-model contract. The browser may request `auto`, but the gateway
-- claims trivial turns with the concrete low-latency execution model.
--
-- Trivial turns deliberately reuse the active conversation regardless of its
-- substantive model. A greeting must not archive/swap conversation state or
-- fall back to semantic orchestration merely because the execution model used
-- for the greeting differs from the conversation's substantive model.

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

  -- p_model is an execution model, never the UI's `auto` sentinel. Keep this
  -- allowlist synchronized with executionModelForTrivialFastPathModel().
  if p_model not in (
    'gpt-5.6-sol',
    'gpt-5.6',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite'
  ) then
    raise exception using errcode = '22023', message = 'unsupported_fast_path_model';
  end if;

  if nullif(trim(coalesce(p_message_id, '')), '') is null
     or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_fast_path_request';
  end if;

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

  -- Preserve the existing turn -> conversation lock-order contract. This read
  -- intentionally does not lock the conversation before claim_assistant_turn().
  select conversation.*
    into v_conversation
    from public.assistant_conversations conversation
   where conversation.workspace_id = p_workspace_id
     and conversation.status = 'active';

  -- A context-free trivial turn may use a different execution model than the
  -- substantive conversation. Only a prompt-version change invalidates reuse.
  if v_conversation.id is not null
     and v_conversation.prompt_version_id <> v_prompt_id then
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
      select conversation.*
        into v_conversation
        from public.assistant_conversations conversation
       where conversation.workspace_id = p_workspace_id
         and conversation.status = 'active';

      if v_conversation.id is null
         or v_conversation.prompt_version_id <> v_prompt_id then
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
      'trivial-fast-path-v4-deterministic-greetings',
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
      jsonb_build_object('fastPath', true, 'executionModel', p_model),
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
    on conflict on constraint assistant_reasoning_runs_turn_id_key do update
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
