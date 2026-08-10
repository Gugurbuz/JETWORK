create or replace function private.get_reasoning_usage_breakdown_internal(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with selected as (
    select
      run.id as run_id,
      run.workspace_id,
      run.owner_id,
      turn.message_id,
      coalesce(turn.usage, '{}'::jsonb) as runtime_usage,
      coalesce(semantic.usage, '{}'::jsonb) as semantic_usage
    from public.assistant_reasoning_runs run
    join public.assistant_turns turn on turn.id = run.turn_id
    left join lateral (
      select plan.usage
      from public.assistant_semantic_plans plan
      where plan.workspace_id = run.workspace_id
        and plan.owner_id = (select auth.uid())
        and plan.message_id = turn.message_id
      order by plan.updated_at desc
      limit 1
    ) semantic on true
    where (select auth.uid()) is not null
      and run.id = p_run_id
      and run.owner_id = (select auth.uid())
      and public.is_workspace_member(run.workspace_id)
    limit 1
  ), values as (
    select
      *,
      coalesce(nullif(runtime_usage->>'input_tokens', '')::numeric, 0) as runtime_input,
      coalesce(nullif(runtime_usage->>'output_tokens', '')::numeric, 0) as runtime_output,
      coalesce(nullif(runtime_usage->>'reasoning_tokens', '')::numeric, 0) as runtime_reasoning,
      coalesce(nullif(runtime_usage->>'total_tokens', '')::numeric,
        coalesce(nullif(runtime_usage->>'input_tokens', '')::numeric, 0)
        + coalesce(nullif(runtime_usage->>'output_tokens', '')::numeric, 0)
        + coalesce(nullif(runtime_usage->>'reasoning_tokens', '')::numeric, 0), 0) as runtime_total,
      coalesce(nullif(runtime_usage->>'estimated_cost_usd', '')::numeric, 0) as runtime_cost,
      coalesce(nullif(runtime_usage->>'cost_guard_agent_calls', '')::numeric, 0) as agent_calls,
      coalesce(nullif(runtime_usage->>'cost_guard_agent_input_tokens', '')::numeric, 0) as agent_input,
      coalesce(nullif(runtime_usage->>'cost_guard_agent_output_tokens', '')::numeric, 0) as agent_output,
      coalesce(nullif(runtime_usage->>'cost_guard_agent_reasoning_tokens', '')::numeric, 0) as agent_reasoning,
      coalesce(nullif(runtime_usage->>'cost_guard_agent_estimated_cost_usd', '')::numeric, 0) as agent_cost,
      coalesce(nullif(runtime_usage->>'cost_guard_final_calls', '')::numeric, 0) as final_calls,
      coalesce(nullif(runtime_usage->>'cost_guard_final_input_tokens', '')::numeric, 0) as final_input,
      coalesce(nullif(runtime_usage->>'cost_guard_final_output_tokens', '')::numeric, 0) as final_output,
      coalesce(nullif(runtime_usage->>'cost_guard_final_reasoning_tokens', '')::numeric, 0) as final_reasoning,
      coalesce(nullif(runtime_usage->>'cost_guard_final_estimated_cost_usd', '')::numeric, 0) as final_cost,
      coalesce(nullif(semantic_usage->>'input_tokens', '')::numeric, 0) as semantic_input,
      coalesce(nullif(semantic_usage->>'output_tokens', '')::numeric, 0) as semantic_output,
      coalesce(nullif(semantic_usage->>'reasoning_tokens', '')::numeric, 0) as semantic_reasoning,
      coalesce(nullif(semantic_usage->>'total_tokens', '')::numeric,
        coalesce(nullif(semantic_usage->>'input_tokens', '')::numeric, 0)
        + coalesce(nullif(semantic_usage->>'output_tokens', '')::numeric, 0)
        + coalesce(nullif(semantic_usage->>'reasoning_tokens', '')::numeric, 0), 0) as semantic_total,
      coalesce(nullif(semantic_usage->>'estimated_cost_usd', '')::numeric, 0) as semantic_cost
    from selected
  )
  select jsonb_build_object(
    'semanticPlanner', jsonb_build_object(
      'calls', case when semantic_total > 0 then 1 else 0 end,
      'inputTokens', semantic_input,
      'outputTokens', semantic_output,
      'reasoningTokens', semantic_reasoning,
      'totalTokens', semantic_total,
      'estimatedCostUsd', semantic_cost
    ),
    'agent', jsonb_build_object(
      'calls', agent_calls,
      'inputTokens', agent_input,
      'outputTokens', agent_output,
      'reasoningTokens', agent_reasoning,
      'totalTokens', agent_input + agent_output + agent_reasoning,
      'estimatedCostUsd', agent_cost
    ),
    'finalSynthesis', jsonb_build_object(
      'calls', final_calls,
      'inputTokens', final_input,
      'outputTokens', final_output,
      'reasoningTokens', final_reasoning,
      'totalTokens', final_input + final_output + final_reasoning,
      'estimatedCostUsd', final_cost
    ),
    'runtime', jsonb_build_object(
      'inputTokens', runtime_input,
      'outputTokens', runtime_output,
      'reasoningTokens', runtime_reasoning,
      'totalTokens', runtime_total,
      'estimatedCostUsd', runtime_cost,
      'deterministicKnowledgeDispatches', coalesce(nullif(runtime_usage->>'deterministic_knowledge_dispatch', '')::numeric, 0),
      'providerCallsAvoided', coalesce(nullif(runtime_usage->>'deterministic_provider_calls_avoided', '')::numeric, 0)
    ),
    'combined', jsonb_build_object(
      'totalTokens', runtime_total + semantic_total,
      'estimatedCostUsd', runtime_cost + semantic_cost
    )
  )
  from values;
$function$;

create or replace function public.get_reasoning_usage_breakdown(p_run_id uuid)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select private.get_reasoning_usage_breakdown_internal(p_run_id);
$function$;

revoke all on function private.get_reasoning_usage_breakdown_internal(uuid) from public, anon, authenticated;
revoke all on function public.get_reasoning_usage_breakdown(uuid) from public, anon;
grant execute on function public.get_reasoning_usage_breakdown(uuid) to authenticated;
