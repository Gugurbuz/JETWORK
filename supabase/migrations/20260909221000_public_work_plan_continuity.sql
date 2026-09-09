-- Public work-plan continuity for Agent Controller V4.
-- The model-authored report_progress(start/plan_change) snapshot is already persisted
-- in assistant_tool_runs. Prefer its resolvedGoal over the advisory reasoning-plan
-- fallback so short follow-ups continue the actual task the model was working on.

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
    'resolvedRequest', coalesce(
      nullif(work.arguments ->> 'resolvedGoal', ''),
      nullif(run.plan #>> '{conversationState,resolvedRequest}', ''),
      nullif(run.plan ->> 'goal', '')
    ),
    'workPlan', case
      when jsonb_typeof(work.arguments -> 'planSteps') = 'array'
      then work.arguments -> 'planSteps'
      else null
    end,
    'evidenceGaps', case
      when jsonb_typeof(work.arguments -> 'evidenceGaps') = 'array'
      then work.arguments -> 'evidenceGaps'
      else null
    end,
    'activeEntities', coalesce(run.plan #> '{conversationState,activeEntities}', '[]'::jsonb),
    'requestedEvidence', coalesce(run.plan #> '{conversationState,requestedEvidence}', '[]'::jsonb),
    'verifiedFactRefs', coalesce((
      select jsonb_agg(f.canonical_key order by f.verified_at desc)
      from (
        select vf.canonical_key, vf.verified_at
        from public.assistant_verified_facts vf
        where vf.workspace_id = run.workspace_id
          and vf.conversation_id = run.conversation_id
          and vf.owner_id = run.owner_id
          and vf.verified_at < p_before
        order by vf.verified_at desc
        limit 12
      ) f
    ), coalesce(run.plan #> '{conversationState,verifiedFactRefs}', '[]'::jsonb)),
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
  left join lateral (
    select tool.arguments
    from public.assistant_tool_runs tool
    where tool.workspace_id = run.workspace_id
      and tool.owner_id = run.owner_id
      and tool.turn_id = run.turn_id
      and tool.tool_name = 'report_progress'
      and tool.status = 'completed'
      and tool.arguments ->> 'kind' in ('start', 'plan_change')
      and nullif(tool.arguments ->> 'resolvedGoal', '') is not null
    order by tool.created_at desc
    limit 1
  ) work on true
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
