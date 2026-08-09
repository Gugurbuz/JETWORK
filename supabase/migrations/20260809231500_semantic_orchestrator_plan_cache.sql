create table if not exists public.assistant_semantic_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null,
  request_hash text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  attempt_count integer not null default 0,
  lease_token uuid,
  plan jsonb,
  provider text,
  model text,
  usage jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, owner_id, message_id, request_hash)
);

create index if not exists assistant_semantic_plans_owner_created_idx
  on public.assistant_semantic_plans(owner_id, created_at desc);

create index if not exists assistant_semantic_plans_workspace_created_idx
  on public.assistant_semantic_plans(workspace_id, created_at desc);

alter table public.assistant_semantic_plans enable row level security;

-- Semantic plans are internal orchestration metadata. Browser clients do not
-- read/write this table directly; authenticated Edge Functions use the RPCs
-- below so membership, ownership, leases and rate limits stay centralized.
revoke all on table public.assistant_semantic_plans from anon, authenticated;

create or replace function public.claim_assistant_semantic_plan(
  p_workspace_id text,
  p_message_id text,
  p_request_hash text,
  p_user_limit_per_minute integer,
  p_workspace_limit_per_minute integer
)
returns table(
  outcome text,
  plan jsonb,
  provider text,
  model text,
  usage jsonb,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
  semantic_record public.assistant_semantic_plans%rowtype;
  user_request_count integer;
  workspace_request_count integer;
  safe_message_id text := left(coalesce(p_message_id, ''), 240);
  safe_request_hash text := left(coalesce(p_request_hash, ''), 128);
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;
  if safe_message_id = '' or safe_request_hash = '' then
    raise exception 'message id and request hash are required' using errcode = '22023';
  end if;

  select *
    into semantic_record
    from public.assistant_semantic_plans semantic_row
   where semantic_row.workspace_id = p_workspace_id
     and semantic_row.owner_id = caller_id
     and semantic_row.message_id = safe_message_id
     and semantic_row.request_hash = safe_request_hash
   for update;

  if semantic_record.id is not null and semantic_record.status = 'completed' then
    return query select
      'completed'::text,
      semantic_record.plan,
      semantic_record.provider,
      semantic_record.model,
      semantic_record.usage,
      null::uuid;
    return;
  end if;

  if semantic_record.id is not null
     and semantic_record.status = 'running'
     and semantic_record.updated_at >= now() - interval '90 seconds' then
    return query select
      'in_progress'::text,
      null::jsonb,
      null::text,
      null::text,
      '{}'::jsonb,
      null::uuid;
    return;
  end if;

  if semantic_record.id is null then
    select count(*)::integer
      into user_request_count
      from public.assistant_semantic_plans semantic_row
     where semantic_row.owner_id = caller_id
       and semantic_row.created_at >= now() - interval '1 minute';

    select count(*)::integer
      into workspace_request_count
      from public.assistant_semantic_plans semantic_row
     where semantic_row.workspace_id = p_workspace_id
       and semantic_row.created_at >= now() - interval '1 minute';

    if user_request_count >= greatest(1, least(p_user_limit_per_minute, 60))
       or workspace_request_count >= greatest(1, least(p_workspace_limit_per_minute, 240)) then
      return query select
        'rate_limited'::text,
        null::jsonb,
        null::text,
        null::text,
        '{}'::jsonb,
        null::uuid;
      return;
    end if;

    insert into public.assistant_semantic_plans (
      workspace_id,
      owner_id,
      message_id,
      request_hash,
      status,
      attempt_count,
      lease_token
    ) values (
      p_workspace_id,
      caller_id,
      safe_message_id,
      safe_request_hash,
      'running',
      1,
      gen_random_uuid()
    )
    on conflict (workspace_id, owner_id, message_id, request_hash) do nothing
    returning * into semantic_record;

    if semantic_record.id is null then
      select *
        into semantic_record
        from public.assistant_semantic_plans semantic_row
       where semantic_row.workspace_id = p_workspace_id
         and semantic_row.owner_id = caller_id
         and semantic_row.message_id = safe_message_id
         and semantic_row.request_hash = safe_request_hash
       for update;
    end if;
  else
    update public.assistant_semantic_plans
       set status = 'running',
           attempt_count = attempt_count + 1,
           lease_token = gen_random_uuid(),
           plan = null,
           provider = null,
           model = null,
           usage = '{}'::jsonb,
           error_message = null,
           completed_at = null,
           updated_at = now()
     where id = semantic_record.id
     returning * into semantic_record;
  end if;

  if semantic_record.id is null then
    raise exception 'semantic plan claim could not be created';
  end if;

  return query select
    'claimed'::text,
    null::jsonb,
    null::text,
    null::text,
    '{}'::jsonb,
    semantic_record.lease_token;
end;
$function$;

create or replace function public.complete_assistant_semantic_plan(
  p_workspace_id text,
  p_message_id text,
  p_request_hash text,
  p_lease_token uuid,
  p_plan jsonb,
  p_provider text,
  p_model text,
  p_usage jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  update public.assistant_semantic_plans
     set status = 'completed',
         plan = p_plan,
         provider = left(coalesce(p_provider, ''), 40),
         model = left(coalesce(p_model, ''), 120),
         usage = coalesce(p_usage, '{}'::jsonb),
         error_message = null,
         completed_at = now(),
         updated_at = now(),
         lease_token = null
   where workspace_id = p_workspace_id
     and owner_id = caller_id
     and message_id = left(coalesce(p_message_id, ''), 240)
     and request_hash = left(coalesce(p_request_hash, ''), 128)
     and status = 'running'
     and lease_token = p_lease_token;

  if not found then
    raise exception 'semantic plan lease is no longer valid' using errcode = '40001';
  end if;
end;
$function$;

create or replace function public.fail_assistant_semantic_plan(
  p_workspace_id text,
  p_message_id text,
  p_request_hash text,
  p_lease_token uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  update public.assistant_semantic_plans
     set status = 'failed',
         error_message = left(coalesce(p_error_message, ''), 2000),
         updated_at = now(),
         lease_token = null
   where workspace_id = p_workspace_id
     and owner_id = caller_id
     and message_id = left(coalesce(p_message_id, ''), 240)
     and request_hash = left(coalesce(p_request_hash, ''), 128)
     and status = 'running'
     and lease_token = p_lease_token;
end;
$function$;

revoke all on function public.claim_assistant_semantic_plan(text, text, text, integer, integer) from public;
revoke all on function public.complete_assistant_semantic_plan(text, text, text, uuid, jsonb, text, text, jsonb) from public;
revoke all on function public.fail_assistant_semantic_plan(text, text, text, uuid, text) from public;

grant execute on function public.claim_assistant_semantic_plan(text, text, text, integer, integer) to authenticated;
grant execute on function public.complete_assistant_semantic_plan(text, text, text, uuid, jsonb, text, text, jsonb) to authenticated;
grant execute on function public.fail_assistant_semantic_plan(text, text, text, uuid, text) to authenticated;
