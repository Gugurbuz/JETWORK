create extension if not exists vector with schema public;

create table if not exists public.workspace_knowledge (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 4 and 8000),
  keywords text[] not null default '{}',
  importance smallint not null default 5 check (importance between 1 and 10),
  source_type text not null default 'user_message'
    check (source_type in ('user_message', 'conversation_summary', 'uploaded_source', 'manual')),
  source_message_id text,
  embedding public.vector(768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_knowledge_workspace_created_idx
  on public.workspace_knowledge (workspace_id, created_at desc);

create index if not exists workspace_knowledge_owner_idx
  on public.workspace_knowledge (owner_id);

create index if not exists workspace_knowledge_embedding_idx
  on public.workspace_knowledge
  using hnsw (embedding public.vector_cosine_ops);

drop trigger if exists set_workspace_knowledge_updated_at on public.workspace_knowledge;
create trigger set_workspace_knowledge_updated_at
before update on public.workspace_knowledge
for each row execute function public.set_jetwork_updated_at();

alter table public.workspace_knowledge enable row level security;

revoke all on public.workspace_knowledge from anon;
grant select, insert, update, delete on public.workspace_knowledge to authenticated;
grant all on public.workspace_knowledge to service_role;

create policy "Workspace members can read workspace knowledge"
on public.workspace_knowledge
for select
to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Workspace members can create workspace knowledge"
on public.workspace_knowledge
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Knowledge owners can update workspace knowledge"
on public.workspace_knowledge
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Knowledge owners can delete workspace knowledge"
on public.workspace_knowledge
for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);

create or replace function public.match_workspace_knowledge(
  query_workspace_id text,
  query_embedding public.vector(768),
  match_count integer default 6,
  similarity_threshold double precision default 0.52
)
returns table (
  id uuid,
  workspace_id text,
  content text,
  keywords text[],
  importance smallint,
  source_type text,
  source_message_id text,
  created_at timestamptz,
  similarity double precision
)
language sql
security invoker
set search_path = public
stable
as $$
  select
    wk.id,
    wk.workspace_id,
    wk.content,
    wk.keywords,
    wk.importance,
    wk.source_type,
    wk.source_message_id,
    wk.created_at,
    (1 - (wk.embedding <=> query_embedding))::double precision as similarity
  from public.workspace_knowledge wk
  where wk.workspace_id = query_workspace_id
    and wk.embedding is not null
    and (1 - (wk.embedding <=> query_embedding)) >= similarity_threshold
  order by wk.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

revoke all on function public.match_workspace_knowledge(text, public.vector, integer, double precision) from public, anon;
grant execute on function public.match_workspace_knowledge(text, public.vector, integer, double precision) to authenticated;

alter table public.project_memory_entries
  add column if not exists source_type text not null default 'legacy_unknown'
    check (source_type in ('user_message', 'manual', 'legacy_unknown')),
  add column if not exists confirmation_state text not null default 'unverified'
    check (confirmation_state in ('confirmed', 'inferred_from_user', 'unverified')),
  add column if not exists confidence numeric(4,3) not null default 0.500
    check (confidence between 0 and 1),
  add column if not exists memory_version integer not null default 1
    check (memory_version > 0);

create index if not exists project_memory_entries_provenance_idx
  on public.project_memory_entries (workspace_id, confirmation_state, updated_at desc);
