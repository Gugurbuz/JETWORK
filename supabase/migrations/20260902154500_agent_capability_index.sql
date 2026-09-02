create table if not exists public.assistant_capability_index (
  id text primary key,
  registry_version text not null,
  capability_version text not null,
  kind text not null check (kind in ('skill','tool','provider_capability')),
  category text not null check (category in ('skill','knowledge','artifact','web','context')),
  title text not null,
  description text not null default '',
  semantic_text text not null,
  tool_name text,
  skill_key text,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  embedding vector(768),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_capability_index_category_idx
  on public.assistant_capability_index (category, active, updated_at desc);

create index if not exists assistant_capability_index_embedding_idx
  on public.assistant_capability_index using hnsw (embedding vector_cosine_ops)
  where embedding is not null and active;

alter table public.assistant_capability_index enable row level security;

revoke all on table public.assistant_capability_index from anon, authenticated;
grant select, insert, update, delete on table public.assistant_capability_index to service_role;

create or replace function public.match_assistant_capabilities(
  p_query_embedding vector(768),
  p_match_count integer default 10,
  p_exclude_ids text[] default '{}'::text[]
)
returns table (
  id text,
  registry_version text,
  capability_version text,
  kind text,
  category text,
  title text,
  description text,
  tool_name text,
  skill_key text,
  metadata jsonb,
  similarity double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    capability.id,
    capability.registry_version,
    capability.capability_version,
    capability.kind,
    capability.category,
    capability.title,
    capability.description,
    capability.tool_name,
    capability.skill_key,
    capability.metadata,
    1 - (capability.embedding <=> p_query_embedding) as similarity
  from public.assistant_capability_index capability
  where capability.active
    and capability.embedding is not null
    and not (capability.id = any(coalesce(p_exclude_ids, '{}'::text[])))
  order by capability.embedding <=> p_query_embedding, capability.id
  limit greatest(1, least(coalesce(p_match_count, 10), 12));
$$;

revoke all on function public.match_assistant_capabilities(vector, integer, text[]) from public, anon, authenticated;
grant execute on function public.match_assistant_capabilities(vector, integer, text[]) to service_role;

comment on table public.assistant_capability_index is
  'Semantic retrieval index for Agent Controller V2 candidate discovery. Rows are candidates only and never authorize execution.';
comment on function public.match_assistant_capabilities(vector, integer, text[]) is
  'Returns Top-K likely relevant capability candidates. The controller LLM remains the semantic selection authority.';
