-- Structured prior-execution context for natural conversation continuation.
-- The runtime reads authoritative operation state from reasoning metadata instead of parsing assistant prose.

create or replace function public.get_prior_assistant_execution_context(
  p_workspace_id text,
  p_before timestamptz,
  p_exclude_message_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'messageId', turn.message_id,
    'intent', run.intent,
    'complexity', run.complexity,
    'knowledgeUsed', run.knowledge_used,
    'webUsed', run.web_used,
    'toolCallCount', run.tool_call_count,
    'fallbackUsed', run.fallback_used,
    'responseModel', turn.response_model,
    'provider', case
      when lower(coalesce(turn.response_model, '')) like 'gemini%' then 'gemini'
      when turn.response_model is not null then 'openai'
      else null
    end,
    'artifactStatus', artifact.status,
    'artifactOperation', artifact.operation,
    'resolvedRequest', nullif(run.plan #>> '{conversationState,resolvedRequest}', ''),
    'activeEntities', coalesce(run.plan #> '{conversationState,activeEntities}', '[]'::jsonb),
    'requestedEvidence', coalesce(run.plan #> '{conversationState,requestedEvidence}', '[]'::jsonb),
    'verifiedFactRefs', coalesce(run.plan #> '{conversationState,verifiedFactRefs}', '[]'::jsonb),
    'startedAt', run.started_at,
    'activeOperation', case
      when run.status = 'completed'
        and (run.evidence_summary #>> '{deterministicEnumeration,complete}') = 'false'
        and nullif(run.evidence_summary #>> '{deterministicEnumeration,nextCursor}', '') is not null
        and (run.plan #>> '{enumerationTarget,tool}') in ('list_knowledge_catalog', 'list_class_inventory')
      then jsonb_strip_nulls(jsonb_build_object(
        'kind', 'knowledge_inventory',
        'tool', run.plan #>> '{enumerationTarget,tool}',
        'objectType', nullif(run.plan #>> '{enumerationTarget,objectType}', ''),
        'prefix', case
          when coalesce(run.plan #>> '{enumerationTarget,prefix}', '') = '__jetwork_message_methods__'
            or coalesce(run.plan #>> '{enumerationTarget,prefix}', '') like '__jetwork_message_methods__|cursor=%'
            then '__jetwork_message_methods__'
          when coalesce(run.plan #>> '{enumerationTarget,prefix}', '') = '__jetwork_resume__'
            or coalesce(run.plan #>> '{enumerationTarget,prefix}', '') like '__jetwork_resume__|cursor=%'
            then null
          else nullif(run.plan #>> '{enumerationTarget,prefix}', '')
        end,
        'nextCursor', run.evidence_summary #>> '{deterministicEnumeration,nextCursor}',
        'complete', false,
        'totalCount', run.evidence_summary #> '{deterministicEnumeration,totalCount}',
        'collectedCount', run.evidence_summary #> '{deterministicEnumeration,collectedCount}',
        'pageCount', run.evidence_summary #> '{deterministicEnumeration,pageCount}',
        'sourceTurnId', run.turn_id,
        'sourceMessageId', turn.message_id
      ))
      else null
    end
  ))
  from public.assistant_reasoning_runs run
  join public.assistant_turns turn on turn.id = run.turn_id
  left join lateral (
    select task.status, task.operation
    from public.artifact_tasks task
    where task.workspace_id = run.workspace_id
      and task.owner_id = (select auth.uid())
      and task.request_message_id = turn.message_id
    order by task.updated_at desc
    limit 1
  ) artifact on true
  where (select auth.uid()) is not null
    and run.owner_id = (select auth.uid())
    and run.workspace_id = p_workspace_id
    and public.is_workspace_member(run.workspace_id)
    and run.status = 'completed'
    and coalesce(run.completed_at, run.started_at) < p_before
    and (p_exclude_message_id is null or turn.message_id <> p_exclude_message_id)
  order by run.started_at desc
  limit 1;
$function$;

revoke execute on function public.get_prior_assistant_execution_context(text, timestamptz, text) from public;
revoke execute on function public.get_prior_assistant_execution_context(text, timestamptz, text) from anon;
grant execute on function public.get_prior_assistant_execution_context(text, timestamptz, text) to authenticated;
grant execute on function public.get_prior_assistant_execution_context(text, timestamptz, text) to service_role;
