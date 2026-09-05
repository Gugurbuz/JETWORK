-- Exact identifier execution precedence.
-- Once the LLM has chosen the knowledge capability, an exact class/method
-- identifier should not be diluted by cross-reference search noise.

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
with raw as (
  select *
  from public.hybrid_search_knowledge_catalog_v2_raw(
    p_workspace_id, p_query, p_query_embedding, p_object_types, greatest(1, least(p_limit * 3, 20))
  )
), annotated as (
  select r.*, o.knowledge_space_id,
         case when r.object_type = 'method' then regexp_replace(r.canonical_key, '^.*?/', '') else null end as method_leaf,
         case when r.object_type = 'class' then regexp_replace(r.canonical_key, '^class:', '') else null end as class_leaf
  from raw r
  join public.knowledge_objects_v2 o on o.id = r.object_id
), exact_flags as (
  select
    exists(select 1 from annotated a where a.object_type='method' and upper(a.method_leaf)=upper(trim(p_query))) as exact_method,
    exists(select 1 from annotated a where a.object_type='class' and upper(a.class_leaf)=upper(trim(p_query))) as exact_class
), filtered as (
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
limit greatest(1, least(p_limit, 20));
$function$;

revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from public;
revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from anon;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to authenticated;
