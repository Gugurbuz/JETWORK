-- Runtime identity reconciliation for scoped synthetic ABAP methods.
-- A scoped synthetic method is resolved to an authoritative unscoped source only
-- when both share at least one active outgoing relation target/type in the same
-- knowledge space. This is provenance-based identity resolution, not semantic routing.

create or replace function public.resolve_knowledge_canonical_alias_v1(
  p_knowledge_space_id uuid,
  p_canonical_key text
)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
with requested as (
  select o.*
  from public.knowledge_objects_v2 o
  where o.knowledge_space_id = p_knowledge_space_id
    and o.canonical_key = lower(trim(p_canonical_key))
    and o.publication_status = 'published'
  limit 1
), candidate as (
  select u.canonical_key
  from requested r
  join public.knowledge_objects_v2 u
    on u.knowledge_space_id = r.knowledge_space_id
   and u.canonical_key = 'method:unscoped_class/' || regexp_replace(r.canonical_key, '^.*?/', '')
   and u.publication_status = 'published'
   and u.published_version_id is not null
   and coalesce((u.metadata->>'synthetic')::boolean, false) = false
  where r.canonical_key like 'method:%/%'
    and r.canonical_key not like 'method:unscoped_class/%'
    and coalesce((r.metadata->>'synthetic')::boolean, false) = true
    and exists (
      select 1
      from public.knowledge_relations_v2 rr
      join public.knowledge_relations_v2 ur
        on ur.knowledge_space_id = rr.knowledge_space_id
       and ur.active = true
       and ur.source_canonical_key = u.canonical_key
       and ur.relation_type = rr.relation_type
       and ur.target_canonical_key = rr.target_canonical_key
      where rr.knowledge_space_id = r.knowledge_space_id
        and rr.active = true
        and rr.source_canonical_key = r.canonical_key
    )
  limit 1
)
select coalesce((select canonical_key from candidate), lower(trim(p_canonical_key)));
$function$;

revoke all on function public.resolve_knowledge_canonical_alias_v1(uuid,text) from public;
revoke all on function public.resolve_knowledge_canonical_alias_v1(uuid,text) from anon;
grant execute on function public.resolve_knowledge_canonical_alias_v1(uuid,text) to authenticated;

create or replace function public.get_knowledge_object_v2(
  p_workspace_id text,
  p_canonical_key text,
  p_object_types text[] default null::text[]
)
returns table(
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  version_number integer,
  source_id uuid,
  source_name text,
  scope_type text
)
language sql
security definer
set search_path to ''
as $function$
with ctx as (
  select * from public.resolve_knowledge_context(p_workspace_id)
), spaces as (
  select project_space_id id,'project'::text scope_type,0 priority from ctx where project_space_id is not null
  union all
  select global_space_id,'global'::text,1 from ctx
), requested as (
  select sp.*, o as requested_object,
         public.resolve_knowledge_canonical_alias_v1(sp.id, lower(trim(p_canonical_key))) as resolved_key
  from spaces sp
  join public.knowledge_objects_v2 o
    on o.knowledge_space_id = sp.id
   and o.canonical_key = lower(trim(p_canonical_key))
   and o.publication_status = 'published'
), resolved as (
  select r.*,
         ro.published_object_type as resolved_type,
         ro.published_name as resolved_name,
         rv.title as resolved_title,
         rv.summary as resolved_summary,
         rv.content as resolved_content,
         rv.version_number as resolved_version_number,
         rs.id as resolved_source_id,
         rs.name as resolved_source_name
  from requested r
  join public.knowledge_objects_v2 ro
    on ro.knowledge_space_id = r.id
   and ro.canonical_key = r.resolved_key
   and ro.publication_status = 'published'
  join public.knowledge_object_versions_v2 rv on rv.id = ro.published_version_id
  join public.knowledge_source_versions_v2 rsv on rsv.id = ro.published_source_version_id
  join public.knowledge_sources_v2 rs
    on rs.id = rsv.source_id
   and rs.published_version_id = rsv.id
   and rs.publication_status = 'published'
)
select
  lower(trim(p_canonical_key)) as canonical_key,
  coalesce((r.requested_object).published_object_type, r.resolved_type) as object_type,
  coalesce((r.requested_object).published_name, r.resolved_name) as object_name,
  case when r.resolved_key <> lower(trim(p_canonical_key))
       then coalesce((r.requested_object).published_name, r.resolved_title, r.resolved_name)
       else r.resolved_title end as title,
  r.resolved_summary as summary,
  r.resolved_content as content,
  r.resolved_version_number as version_number,
  r.resolved_source_id as source_id,
  r.resolved_source_name as source_name,
  r.scope_type
from resolved r
where p_object_types is null
   or coalesce((r.requested_object).published_object_type, r.resolved_type) = any(p_object_types)
order by r.priority
limit 1;
$function$;

create or replace function public.get_related_knowledge_objects_v2(
  p_workspace_id text,
  p_canonical_key text,
  p_relation_types text[] default null::text[],
  p_direction text default 'both'::text,
  p_limit integer default 12
)
returns table(
  relation_id uuid,
  source_canonical_key text,
  relation_type text,
  target_canonical_key text,
  evidence text,
  related_canonical_key text,
  related_object_type text,
  related_name text,
  related_title text,
  related_summary text,
  source_id uuid,
  source_name text,
  scope_type text
)
language sql
security definer
set search_path to ''
as $function$
with ctx as (
  select * from public.resolve_knowledge_context(p_workspace_id)
), spaces as (
  select project_space_id id,'project'::text scope_type,0 priority from ctx where project_space_id is not null
  union all
  select global_space_id,'global'::text,1 from ctx
), keys as (
  select sp.*,
         lower(trim(p_canonical_key)) as requested_key,
         public.resolve_knowledge_canonical_alias_v1(sp.id, lower(trim(p_canonical_key))) as resolved_key
  from spaces sp
), raw_rels as (
  select r.*, k.scope_type, k.priority, k.requested_key, k.resolved_key,
         case when r.source_canonical_key = k.resolved_key then k.requested_key else r.source_canonical_key end as mapped_source,
         case when r.target_canonical_key = k.resolved_key then k.requested_key else r.target_canonical_key end as mapped_target
  from keys k
  join public.knowledge_relations_v2 r
    on r.knowledge_space_id = k.id
   and r.active
  join public.knowledge_source_versions_v2 sv on sv.id = r.source_version_id
  join public.knowledge_sources_v2 src
    on src.id = sv.source_id
   and src.publication_status = 'published'
   and src.published_version_id = sv.id
  where (p_relation_types is null or r.relation_type = any(p_relation_types))
    and (
      (p_direction in ('outgoing','both') and r.source_canonical_key in (k.requested_key, k.resolved_key))
      or
      (p_direction in ('incoming','both') and r.target_canonical_key in (k.requested_key, k.resolved_key))
    )
), dedup as (
  select rr.*,
         case when rr.mapped_source = rr.requested_key then rr.mapped_target else rr.mapped_source end as related_key,
         row_number() over (
           partition by rr.knowledge_space_id, rr.mapped_source, rr.relation_type, rr.mapped_target
           order by rr.priority, rr.created_at asc
         ) as rn
  from raw_rels rr
)
select
  r.id,
  r.mapped_source,
  r.relation_type,
  r.mapped_target,
  r.evidence,
  o.canonical_key,
  o.published_object_type,
  o.published_name,
  v.title,
  v.summary,
  s.id,
  s.name,
  r.scope_type
from dedup r
left join public.knowledge_objects_v2 o
  on o.knowledge_space_id = r.knowledge_space_id
 and o.canonical_key = r.related_key
 and o.publication_status = 'published'
left join public.knowledge_object_versions_v2 v on v.id = o.published_version_id
left join public.knowledge_source_versions_v2 osv on osv.id = o.published_source_version_id
left join public.knowledge_sources_v2 s
  on s.id = osv.source_id
 and s.published_version_id = osv.id
 and s.publication_status = 'published'
where r.rn = 1
order by r.priority, r.relation_type, r.related_key
limit greatest(1, least(p_limit, 20));
$function$;

alter function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer)
  rename to hybrid_search_knowledge_catalog_v2_raw;

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
         case when r.object_type = 'method'
              then regexp_replace(r.canonical_key, '^.*?/', '')
              else null end as method_leaf
  from raw r
  join public.knowledge_objects_v2 o on o.id = r.object_id
), exact_method as (
  select exists(
    select 1 from annotated a
    where a.object_type = 'method'
      and upper(a.method_leaf) = upper(trim(p_query))
  ) as present
), filtered as (
  select a.*
  from annotated a, exact_method em
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
  and (
    not em.present
    or a.object_type <> 'method'
    or upper(a.method_leaf) = upper(trim(p_query))
  )
  and (
    not em.present
    or a.object_type = 'method'
  )
)
select
  object_id, canonical_key, object_type, object_name, title, summary, content,
  chunk_id, chunk_index, chunk_content, citation, source_id, source_name, scope_type,
  score, lexical_score, vector_score
from filtered
order by score desc, canonical_key, chunk_index nulls last
limit greatest(1, least(p_limit, 20));
$function$;

revoke all on function public.hybrid_search_knowledge_catalog_v2_raw(text,text,public.vector,text[],integer) from public;
revoke all on function public.hybrid_search_knowledge_catalog_v2_raw(text,text,public.vector,text[],integer) from anon;
revoke all on function public.hybrid_search_knowledge_catalog_v2_raw(text,text,public.vector,text[],integer) from authenticated;
revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from public;
revoke all on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from anon;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to authenticated;
