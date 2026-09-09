-- Jetbase literal identifier recall v1.
-- The Controller's model-authored query is preserved exactly. This only adds a
-- mechanical literal canonical/name retrieval path beside the existing hybrid
-- lexical/vector engine so numeric and technical identifiers are not lost to
-- tokenization or embedding behavior.

create or replace function public.hybrid_search_knowledge_catalog_v2(
  p_workspace_id text,
  p_query text,
  p_query_embedding public.vector default null::public.vector,
  p_object_types text[] default null::text[],
  p_limit integer default 8
)
returns table(
  object_id uuid,
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  chunk_id uuid,
  chunk_index integer,
  chunk_content text,
  citation jsonb,
  source_id uuid,
  source_name text,
  scope_type text,
  score double precision,
  lexical_score double precision,
  vector_score double precision
)
language sql
security definer
set search_path to ''
as $function$
with ctx as (
  select * from public.resolve_knowledge_context(p_workspace_id)
),
spaces as (
  select global_space_id as id, 'global'::text as scope_type, 1 as scope_rank from ctx
  union all
  select project_space_id as id, 'project'::text as scope_type, 0 as scope_rank from ctx where project_space_id is not null
),
args as (
  select lower(trim(coalesce(p_query, ''))) as q
),
literal_ranked as (
  select
    o.id as object_id,
    o.canonical_key,
    o.published_object_type as object_type,
    o.published_name as object_name,
    v.title,
    v.summary,
    v.content,
    null::uuid as chunk_id,
    null::integer as chunk_index,
    null::text as chunk_content,
    null::jsonb as citation,
    s.id as source_id,
    s.name as source_name,
    sp.scope_type,
    (
      10.0 + case
        when lower(o.canonical_key) = a.q or lower(coalesce(o.published_name, '')) = a.q then 1.0
        when regexp_replace(lower(o.canonical_key), '^.*[-_/:]', '') = a.q then 0.99
        when right(lower(o.canonical_key), length(a.q) + 1) in ('-' || a.q, '/' || a.q, '_' || a.q, ':' || a.q) then 0.98
        when position(a.q in lower(o.canonical_key)) > 0 then 0.90
        else 0.85
      end
    )::double precision as score,
    1.0::double precision as lexical_score,
    0.0::double precision as vector_score,
    o.knowledge_space_id,
    row_number() over (
      partition by o.canonical_key
      order by sp.scope_rank asc, o.updated_at desc
    ) as override_rank
  from spaces sp
  cross join args a
  join public.knowledge_objects_v2 o on o.knowledge_space_id = sp.id
  join public.knowledge_object_versions_v2 v on v.id = o.published_version_id
  join public.knowledge_source_versions_v2 sv on sv.id = o.published_source_version_id
  join public.knowledge_sources_v2 s on s.id = sv.source_id
  where length(a.q) >= 2
    and o.publication_status = 'published'
    and s.publication_status = 'published'
    and s.published_version_id = sv.id
    and (p_object_types is null or o.published_object_type = any(p_object_types))
    and (
      position(a.q in lower(o.canonical_key)) > 0
      or position(a.q in lower(coalesce(o.published_name, ''))) > 0
    )
),
literal as (
  select
    object_id, canonical_key, object_type, object_name, title, summary, content,
    chunk_id, chunk_index, chunk_content, citation, source_id, source_name, scope_type,
    score, lexical_score, vector_score
  from literal_ranked
  where override_rank = 1
  order by score desc, canonical_key
  limit greatest(1, least(coalesce(p_limit, 8) * 2, 20))
),
raw as (
  select *
  from public.hybrid_search_knowledge_catalog_v2_raw(
    p_workspace_id,
    p_query,
    p_query_embedding,
    p_object_types,
    greatest(1, least(coalesce(p_limit, 8) * 3, 20))
  )
),
combined as (
  select * from literal
  union all
  select * from raw
),
deduped as (
  select c.*
  from (
    select combined.*,
      row_number() over (
        partition by combined.canonical_key
        order by combined.score desc, combined.chunk_index nulls first
      ) as candidate_rank
    from combined
  ) c
  where c.candidate_rank = 1
),
annotated as (
  select d.*, o.knowledge_space_id,
         case when d.object_type = 'method' then regexp_replace(d.canonical_key, '^.*?/', '') else null end as method_leaf,
         case when d.object_type = 'class' then regexp_replace(d.canonical_key, '^class:', '') else null end as class_leaf
  from deduped d
  join public.knowledge_objects_v2 o on o.id = d.object_id
),
exact_flags as (
  select
    exists(select 1 from annotated a where a.object_type='method' and upper(a.method_leaf)=upper(trim(p_query))) as exact_method,
    exists(select 1 from annotated a where a.object_type='class' and upper(a.class_leaf)=upper(trim(p_query))) as exact_class
),
filtered as (
  select a.*
  from annotated a cross join exact_flags f
  where not (
    a.canonical_key like 'method:unscoped_class/%'
    and exists (
      select 1
      from public.knowledge_objects_v2 scoped
      where scoped.knowledge_space_id = a.knowledge_space_id
        and scoped.publication_status = 'published'
        and scoped.canonical_key like 'method:%/' || a.method_leaf
        and scoped.canonical_key not like 'method:unscoped_class/%'
        and coalesce((scoped.metadata->>'synthetic')::boolean, false) = true
        and public.resolve_knowledge_canonical_alias_v1(a.knowledge_space_id, scoped.canonical_key) = a.canonical_key
    )
  )
  and case
    when f.exact_method then a.object_type='method' and upper(a.method_leaf)=upper(trim(p_query))
    when f.exact_class then a.object_type='class' and upper(a.class_leaf)=upper(trim(p_query))
    else true
  end
)
select
  object_id, canonical_key, object_type, object_name, title, summary, content,
  chunk_id, chunk_index, chunk_content, citation, source_id, source_name, scope_type,
  score, lexical_score, vector_score
from filtered
order by score desc, canonical_key, chunk_index nulls last
limit greatest(1, least(coalesce(p_limit, 8), 20));
$function$;

revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from public;
revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from anon;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to authenticated;
