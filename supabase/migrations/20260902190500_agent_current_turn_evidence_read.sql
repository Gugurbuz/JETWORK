-- P4 Agentic Runtime: expose only the authenticated user's current running-turn
-- tool evidence to the observation-only evidence review capability.
-- This function intentionally returns bounded tool/source metadata only; it does
-- not expose prompts, raw tool output, other users, prior turns, or service keys.

create or replace function public.get_current_agent_evidence_sources_v2(
  p_workspace_id text
)
returns table (
  tool_name text,
  result_summary jsonb,
  source_refs jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  current_turn_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication is required';
  end if;

  select turn_row.id
    into current_turn_id
    from public.assistant_turns turn_row
   where turn_row.workspace_id = p_workspace_id
     and turn_row.owner_id = caller_id
     and turn_row.status = 'running'
     and turn_row.updated_at >= now() - interval '5 minutes'
   order by turn_row.updated_at desc
   limit 1;

  if current_turn_id is null then
    return;
  end if;

  return query
  select
    run.tool_name,
    coalesce(run.result_summary, '{}'::jsonb),
    coalesce(run.source_refs, '[]'::jsonb)
  from public.assistant_tool_runs run
  where run.turn_id = current_turn_id
    and run.workspace_id = p_workspace_id
    and run.owner_id = caller_id
    and run.status = 'completed'
    and jsonb_typeof(coalesce(run.source_refs, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(run.source_refs, '[]'::jsonb)) > 0
    and (
      coalesce((run.result_summary ->> 'citationReady')::boolean, false)
      or coalesce((run.result_summary ->> 'verifiedKnowledgeEvidence')::boolean, false)
      or run.tool_name in ('web_search', 'gemini_google_search')
    )
  order by run.created_at asc
  limit 64;
end;
$$;

revoke all on function public.get_current_agent_evidence_sources_v2(text)
from public, anon;
grant execute on function public.get_current_agent_evidence_sources_v2(text)
to authenticated;
