-- Verified fact memory stores provenance pointers from successful exact/detail
-- knowledge retrievals. Assistant prose and semantic search candidates never
-- enter this table, preventing conversational hallucinations from becoming facts.

create table if not exists public.assistant_verified_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  conversation_id uuid not null references public.assistant_conversations(id) on delete cascade,
  owner_id uuid not null,
  canonical_key text not null,
  object_type text,
  source_id text,
  source_name text not null default 'Kurumsal bilgi kaynağı',
  title text,
  last_turn_id uuid,
  verification_kind text not null default 'detail',
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (conversation_id, canonical_key)
);

create index if not exists assistant_verified_facts_workspace_owner_idx
  on public.assistant_verified_facts (workspace_id, owner_id, verified_at desc);

alter table public.assistant_verified_facts enable row level security;

revoke all on table public.assistant_verified_facts from anon;
revoke insert, update, delete on table public.assistant_verified_facts from authenticated;
grant select on table public.assistant_verified_facts to authenticated;
grant all on table public.assistant_verified_facts to service_role;

drop policy if exists assistant_verified_facts_select_own on public.assistant_verified_facts;
create policy assistant_verified_facts_select_own
  on public.assistant_verified_facts
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.capture_assistant_verified_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref jsonb;
  canonical text;
  source_name_value text;
begin
  if new.status <> 'completed'
     or new.tool_name not in ('get_message_detail','get_abap_source','get_document_content','get_knowledge_object') then
    return new;
  end if;

  if jsonb_typeof(coalesce(new.source_refs, '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  for ref in select value from jsonb_array_elements(coalesce(new.source_refs, '[]'::jsonb)) loop
    canonical := nullif(trim(coalesce(ref->>'canonicalKey', '')), '');
    if canonical is null then
      continue;
    end if;
    source_name_value := coalesce(nullif(trim(ref->>'sourceName'), ''), 'Kurumsal bilgi kaynağı');

    insert into public.assistant_verified_facts (
      workspace_id,
      conversation_id,
      owner_id,
      canonical_key,
      object_type,
      source_id,
      source_name,
      title,
      last_turn_id,
      verification_kind,
      verified_at
    ) values (
      new.workspace_id,
      new.conversation_id,
      new.owner_id,
      canonical,
      nullif(trim(coalesce(ref->>'objectType', '')), ''),
      nullif(trim(coalesce(ref->>'sourceId', '')), ''),
      source_name_value,
      nullif(trim(coalesce(ref->>'title', '')), ''),
      new.turn_id,
      new.tool_name,
      now()
    )
    on conflict (conversation_id, canonical_key) do update set
      object_type = excluded.object_type,
      source_id = excluded.source_id,
      source_name = excluded.source_name,
      title = excluded.title,
      last_turn_id = excluded.last_turn_id,
      verification_kind = excluded.verification_kind,
      verified_at = excluded.verified_at;
  end loop;

  return new;
end;
$$;

revoke all on function public.capture_assistant_verified_fact() from public, anon, authenticated;
grant execute on function public.capture_assistant_verified_fact() to service_role;

drop trigger if exists assistant_tool_runs_capture_verified_fact on public.assistant_tool_runs;
create trigger assistant_tool_runs_capture_verified_fact
after insert on public.assistant_tool_runs
for each row execute function public.capture_assistant_verified_fact();

create or replace function public.get_assistant_verified_fact_memory(
  p_workspace_id text,
  p_limit integer default 12
)
returns table (
  canonical_key text,
  object_type text,
  source_id text,
  source_name text,
  title text,
  verification_kind text,
  verified_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.canonical_key,
    f.object_type,
    f.source_id,
    f.source_name,
    f.title,
    f.verification_kind,
    f.verified_at
  from public.assistant_verified_facts f
  where f.workspace_id = p_workspace_id
    and f.owner_id = auth.uid()
  order by f.verified_at desc
  limit greatest(1, least(coalesce(p_limit, 12), 30));
$$;

revoke all on function public.get_assistant_verified_fact_memory(text, integer) from public, anon;
grant execute on function public.get_assistant_verified_fact_memory(text, integer) to authenticated;
grant execute on function public.get_assistant_verified_fact_memory(text, integer) to service_role;

comment on table public.assistant_verified_facts is
  'Conversation-scoped provenance memory populated only by successful exact/detail knowledge tool runs.';
