-- Artifact generation is selected before the assistant runtime starts.
-- Preserve that structural intent so wording inside the artifact request (for example
-- "error test scenarios") cannot be reinterpreted as a SAP diagnosis by the semantic model.

create or replace function public.claim_assistant_semantic_plan(
  p_workspace_id text,
  p_message_id text,
  p_request_hash text,
  p_user_limit_per_minute integer,
  p_workspace_limit_per_minute integer
)
returns table(outcome text, plan jsonb, provider text, model text, usage jsonb, lease_token uuid)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller_id uuid := (select auth.uid());
  semantic_record public.assistant_semantic_plans%rowtype;
  artifact_record public.artifact_tasks%rowtype;
  user_request_count integer;
  workspace_request_count integer;
  safe_message_id text := left(coalesce(p_message_id, ''), 240);
  safe_request_hash text := left(coalesce(p_request_hash, ''), 128);
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'workspace access denied' using errcode = '42501'; end if;
  if safe_message_id = '' or safe_request_hash = '' then raise exception 'message id and request hash are required' using errcode = '22023'; end if;

  select * into artifact_record
  from public.artifact_tasks artifact_row
  where artifact_row.workspace_id = p_workspace_id
    and artifact_row.owner_id = caller_id
    and artifact_row.request_message_id = safe_message_id
  order by artifact_row.created_at desc
  limit 1;

  if artifact_record.id is not null then
    return query select
      'completed'::text,
      jsonb_build_object(
        'intent', 'document',
        'complexity', 'high',
        'executionMode', 'artifact',
        'goal', 'Create or revise the artifact task that JetWork already created for this user message. Preserve the user-provided source facts and artifact contract; do not reinterpret the request as a technical diagnosis.',
        'knowledgeRequired', false,
        'webMode', 'none',
        'verificationRequired', false,
        'creativeMode', false,
        'evidenceQueries', '[]'::jsonb,
        'steps', jsonb_build_array(jsonb_build_object(
          'id', 'synthesize-artifact',
          'label', 'Produce the requested artifact from the supplied request and artifact contract',
          'toolHint', 'synthesis',
          'successCriteria', 'The artifact is produced without changing the known artifact intent.'
        )),
        'conversationState', jsonb_build_object(
          'continuation', artifact_record.operation = 'revise',
          'topic', coalesce(artifact_record.artifact_type, 'artifact'),
          'userMove', case when artifact_record.operation = 'revise' then 'follow_up' else 'new_request' end,
          'priorIntent', case when artifact_record.operation = 'revise' then 'document' else 'none' end,
          'rejectedHypotheses', '[]'::jsonb,
          'retainedContext', '[]'::jsonb,
          'openQuestions', '[]'::jsonb
        ),
        'orchestratorVersion', 'semantic-orchestrator-v3.1-resilient-agent-loop'
      ),
      'openai'::text,
      'gpt-5.6-sol'::text,
      '{}'::jsonb,
      null::uuid;
    return;
  end if;

  select * into semantic_record
  from public.assistant_semantic_plans semantic_row
  where semantic_row.workspace_id = p_workspace_id
    and semantic_row.owner_id = caller_id
    and semantic_row.message_id = safe_message_id
    and semantic_row.request_hash = safe_request_hash
  for update;

  if semantic_record.id is not null and semantic_record.status = 'completed' then
    return query select 'completed'::text, semantic_record.plan, semantic_record.provider, semantic_record.model, semantic_record.usage, null::uuid; return;
  end if;

  if semantic_record.id is not null and semantic_record.status = 'running' and semantic_record.updated_at >= now() - interval '90 seconds' then
    return query select 'in_progress'::text, null::jsonb, null::text, null::text, '{}'::jsonb, null::uuid; return;
  end if;

  if semantic_record.id is null then
    select count(*)::integer into user_request_count from public.assistant_semantic_plans semantic_row
    where semantic_row.owner_id = caller_id and semantic_row.created_at >= now() - interval '1 minute';
    select count(*)::integer into workspace_request_count from public.assistant_semantic_plans semantic_row
    where semantic_row.workspace_id = p_workspace_id and semantic_row.created_at >= now() - interval '1 minute';

    if user_request_count >= greatest(1, least(p_user_limit_per_minute, 60))
       or workspace_request_count >= greatest(1, least(p_workspace_limit_per_minute, 240)) then
      return query select 'rate_limited'::text, null::jsonb, null::text, null::text, '{}'::jsonb, null::uuid; return;
    end if;

    insert into public.assistant_semantic_plans (workspace_id, owner_id, message_id, request_hash, status, attempt_count, lease_token)
    values (p_workspace_id, caller_id, safe_message_id, safe_request_hash, 'running', 1, gen_random_uuid())
    on conflict (workspace_id, owner_id, message_id, request_hash) do nothing
    returning * into semantic_record;

    if semantic_record.id is null then
      select * into semantic_record from public.assistant_semantic_plans semantic_row
      where semantic_row.workspace_id = p_workspace_id
        and semantic_row.owner_id = caller_id
        and semantic_row.message_id = safe_message_id
        and semantic_row.request_hash = safe_request_hash
      for update;
      if semantic_record.id is null then raise exception 'semantic plan claim could not be created'; end if;
      if semantic_record.status = 'completed' then
        return query select 'completed'::text, semantic_record.plan, semantic_record.provider, semantic_record.model, semantic_record.usage, null::uuid; return;
      end if;
      if semantic_record.status = 'running' and semantic_record.updated_at >= now() - interval '90 seconds' then
        return query select 'in_progress'::text, null::jsonb, null::text, null::text, '{}'::jsonb, null::uuid; return;
      end if;
      update public.assistant_semantic_plans
      set status='running', attempt_count=attempt_count+1, lease_token=gen_random_uuid(), plan=null, provider=null, model=null,
          usage='{}'::jsonb, error_message=null, completed_at=null, updated_at=now()
      where id=semantic_record.id returning * into semantic_record;
    end if;
  else
    update public.assistant_semantic_plans
    set status='running', attempt_count=attempt_count+1, lease_token=gen_random_uuid(), plan=null, provider=null, model=null,
        usage='{}'::jsonb, error_message=null, completed_at=null, updated_at=now()
    where id=semantic_record.id returning * into semantic_record;
  end if;

  if semantic_record.id is null or semantic_record.lease_token is null then raise exception 'semantic plan lease could not be acquired'; end if;
  return query select 'claimed'::text, null::jsonb, null::text, null::text, '{}'::jsonb, semantic_record.lease_token;
end;
$function$;
