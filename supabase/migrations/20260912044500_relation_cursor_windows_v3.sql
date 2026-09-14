-- Cursor-windowed relation reader. p_limit is one-window transfer size (+1 lookahead),
-- while p_offset enables unlimited continuation across windows.
create or replace function public.get_related_knowledge_objects_v3(
  p_workspace_id text,
  p_canonical_key text,
  p_relation_types text[] default null::text[],
  p_direction text default 'both'::text,
  p_limit integer default 13,
  p_offset integer default 0
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
offset greatest(0, coalesce(p_offset, 0))
limit greatest(1, least(coalesce(p_limit, 13), 21));
$function$;

revoke all on function public.get_related_knowledge_objects_v3(text,text,text[],text,integer,integer) from public;
revoke all on function public.get_related_knowledge_objects_v3(text,text,text[],text,integer,integer) from anon;
grant execute on function public.get_related_knowledge_objects_v3(text,text,text[],text,integer,integer) to authenticated;
