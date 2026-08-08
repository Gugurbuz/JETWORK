-- Secure browser read-model for Reasoning Engine observability.
-- The underlying runtime ledgers stay service-role only. Authenticated users can
-- inspect only their own turns inside workspaces they can already access.

create or replace function public.get_reasoning_debug_runs(
  p_workspace_id text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  run_id uuid,
  turn_id uuid,
  conversation_id uuid,
  workspace_id text,
  message_id text,
  intent text,
  complexity text,
  engine_version text,
  status text,
  knowledge_used boolean,
  web_used boolean,
  tool_call_count integer,
  fallback_used boolean,
  response_model text,
  provider text,
  usage jsonb,
  latency_ms bigint,
  artifact_status text,
  artifact_operation text,
  artifact_version_number integer,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    run.id as run_id,
    run.turn_id,
    run.conversation_id,
    run.workspace_id,
    turn.message_id,
    run.intent,
    run.complexity,
    run.engine_version,
    run.status,
    run.knowledge_used,
    run.web_used,
    run.tool_call_count,
    run.fallback_used,
    turn.response_model,
    case
      when lower(coalesce(turn.response_model, '')) like 'gemini%' then 'gemini'
      when turn.response_model is not null then 'openai'
      else null
    end as provider,
    coalesce(turn.usage, '{}'::jsonb) as usage,
    case
      when coalesce(run.completed_at, turn.completed_at) is null then null
      else greatest(
        0,
        round(extract(epoch from (coalesce(run.completed_at, turn.completed_at) - run.started_at)) * 1000)::bigint
      )
    end as latency_ms,
    artifact.status as artifact_status,
    artifact.operation as artifact_operation,
    artifact.document_version_number as artifact_version_number,
    coalesce(run.error_message, turn.error_message) as error_message,
    run.started_at,
    coalesce(run.completed_at, turn.completed_at) as completed_at
  from public.assistant_reasoning_runs run
  join public.assistant_turns turn on turn.id = run.turn_id
  left join lateral (
    select task.status, task.operation, task.document_version_number
    from public.artifact_tasks task
    where task.workspace_id = run.workspace_id
      and task.owner_id = (select auth.uid())
      and task.request_message_id = turn.message_id
    order by task.updated_at desc
    limit 1
  ) artifact on true
  where run.owner_id = (select auth.uid())
    and public.is_workspace_member(run.workspace_id)
    and (p_workspace_id is null or run.workspace_id = p_workspace_id)
  order by run.started_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

create or replace function public.get_reasoning_debug_run(
  p_run_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'runId', run.id,
    'turnId', run.turn_id,
    'conversationId', run.conversation_id,
    'workspaceId', run.workspace_id,
    'messageId', turn.message_id,
    'engineVersion', run.engine_version,
    'intent', run.intent,
    'complexity', run.complexity,
    'status', run.status,
    'knowledgeUsed', run.knowledge_used,
    'webUsed', run.web_used,
    'toolCallCount', run.tool_call_count,
    'fallbackUsed', run.fallback_used,
    'selectedModel', conversation.model,
    'responseModel', turn.response_model,
    'provider', case
      when lower(coalesce(turn.response_model, '')) like 'gemini%' then 'gemini'
      when turn.response_model is not null then 'openai'
      else null
    end,
    'usage', coalesce(turn.usage, '{}'::jsonb),
    'latencyMs', case
      when coalesce(run.completed_at, turn.completed_at) is null then null
      else greatest(
        0,
        round(extract(epoch from (coalesce(run.completed_at, turn.completed_at) - run.started_at)) * 1000)::bigint
      )
    end,
    'startedAt', run.started_at,
    'completedAt', coalesce(run.completed_at, turn.completed_at),
    'errorMessage', coalesce(run.error_message, turn.error_message),
    'plan', coalesce(run.plan, '{}'::jsonb),
    'verification', coalesce(run.verification, '{}'::jsonb),
    'executionTrace', coalesce(run.execution_trace, '[]'::jsonb),
    'evidenceSummary', coalesce(run.evidence_summary, '{}'::jsonb),
    'sourceRefs', coalesce(turn.source_refs, '[]'::jsonb),
    'artifact', case when artifact.id is null then null else jsonb_build_object(
      'id', artifact.id,
      'operation', artifact.operation,
      'status', artifact.status,
      'documentVersionId', artifact.document_version_id,
      'documentVersionNumber', artifact.document_version_number,
      'errorMessage', artifact.error_message,
      'lastTransitionAt', artifact.last_transition_at
    ) end,
    'toolRuns', coalesce(tools.items, '[]'::jsonb)
  )
  from public.assistant_reasoning_runs run
  join public.assistant_turns turn on turn.id = run.turn_id
  join public.assistant_conversations conversation on conversation.id = run.conversation_id
  left join lateral (
    select task.*
    from public.artifact_tasks task
    where task.workspace_id = run.workspace_id
      and task.owner_id = (select auth.uid())
      and task.request_message_id = turn.message_id
    order by task.updated_at desc
    limit 1
  ) artifact on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', tool.id,
        'toolName', tool.tool_name,
        'callId', tool.call_id,
        'status', tool.status,
        'durationMs', tool.duration_ms,
        'arguments', tool.arguments,
        'resultSummary', tool.result_summary,
        'sourceRefs', tool.source_refs,
        'errorMessage', tool.error_message,
        'createdAt', tool.created_at
      )
      order by tool.created_at asc
    ) as items
    from public.assistant_tool_runs tool
    where tool.turn_id = run.turn_id
      and tool.owner_id = (select auth.uid())
  ) tools on true
  where run.id = p_run_id
    and run.owner_id = (select auth.uid())
    and public.is_workspace_member(run.workspace_id)
  limit 1;
$$;

revoke all on function public.get_reasoning_debug_runs(text, integer, integer)
from public, anon;
grant execute on function public.get_reasoning_debug_runs(text, integer, integer)
to authenticated;

revoke all on function public.get_reasoning_debug_run(uuid)
from public, anon;
grant execute on function public.get_reasoning_debug_run(uuid)
to authenticated;

comment on function public.get_reasoning_debug_runs(text, integer, integer) is
  'Safe operational Reasoning Engine list view for the authenticated user. Does not expose prompt text or hidden chain-of-thought.';
comment on function public.get_reasoning_debug_run(uuid) is
  'Safe operational Reasoning Engine detail view for the authenticated user. Exposes system trace/evidence/tool metadata, never hidden chain-of-thought.';
