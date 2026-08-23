-- Technical-reference lookup v5
-- Treat p_limit as page size, expose totalCount/nextCursor, and allow runtime
-- enumeration to fetch every page without increasing the per-query result cap.

create or replace function public.lookup_knowledge_technical_reference_v5(
  p_workspace_id text,
  p_technical_reference text,
  p_object_types text[] default null,
  p_limit integer default 12,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select upper(trim(coalesce(p_technical_reference,''))) as ref,
         greatest(1, least(coalesce(p_limit,12),20)) as lim,
         greatest(0, least(coalesce(p_offset,0),500)) as off
),
workspace_project as (
  select w.project_id
  from public.workspaces w
  where w.id = p_workspace_id
  limit 1
),
spaces as (
  select ks.id
  from public.knowledge_spaces ks
  where public.can_read_knowledge_space(ks.id)
    and (
      ks.scope_type = 'global'
      or ks.project_id = (select project_id from workspace_project)
    )
),
direct_objects as (
  select o.id
  from public.knowledge_objects_v2 o, params p
  where o.publication_status = 'published'
    and o.knowledge_space_id in (select id from spaces)
    and (
      upper(o.name) = p.ref
      or upper(regexp_replace(o.name, '^.*/', '')) = p.ref
      or upper(regexp_replace(o.name, '^.*->', '')) = p.ref
      or upper(regexp_replace(o.canonical_key, '^.*[:/]', '')) = p.ref
    )
    and (
      coalesce(array_length(p_object_types,1),0) = 0
      or o.object_type = any(p_object_types)
    )
  limit 60
),
reference_versions as (
  select v.object_id
  from public.knowledge_object_versions_v2 v, params p
  where v.knowledge_space_id in (select id from spaces)
    and v.is_current = true
    and v.search_document @@ plainto_tsquery('simple', p.ref)
    and v.content ilike ('%' || p.ref || '%')
  limit 160
),
anchor_relations as (
  select r.*
  from public.knowledge_relations_v2 r, params p
  where r.knowledge_space_id in (select id from spaces)
    and r.active = true
    and (
      r.source_object_id in (select id from direct_objects)
      or r.target_object_id in (select id from direct_objects)
      or upper(regexp_replace(r.source_canonical_key, '^.*[:/]', '')) = p.ref
      or upper(regexp_replace(r.target_canonical_key, '^.*[:/]', '')) = p.ref
    )
  limit 160
),
relation_neighbors as (
  select source_object_id as id from anchor_relations where source_object_id is not null
  union
  select target_object_id as id from anchor_relations where target_object_id is not null
),
candidate_ids as (
  select id, 1.00::numeric as score, 'direct'::text as match_mode from direct_objects
  union all
  select id, 0.95::numeric, 'relation'::text from relation_neighbors where id not in (select id from direct_objects)
  union all
  select object_id, 0.80::numeric, 'cross_reference'::text from reference_versions
    where object_id not in (select id from direct_objects)
      and object_id not in (select id from relation_neighbors)
),
dedup_candidates as (
  select id, max(score) as score,
         (array_agg(match_mode order by score desc))[1] as match_mode
  from candidate_ids
  group by id
),
object_rows as (
  select o.*, c.score, c.match_mode,
         v.title, v.summary, v.content,
         coalesce(o.primary_source_id, prov.source_id) as resolved_source_id,
         coalesce(s.name, prov.source_name, 'Kurumsal bilgi kaynağı') as resolved_source_name,
         coalesce(relj.relations, '[]'::jsonb) as relations,
         coalesce(relj.relation_evidence, '') as relation_evidence
  from dedup_candidates c
  join public.knowledge_objects_v2 o on o.id = c.id and o.publication_status = 'published'
  left join public.knowledge_object_versions_v2 v on v.id = o.published_version_id
  left join public.knowledge_sources_v2 s on s.id = o.primary_source_id
  left join lateral (
    select sv.source_id, ks.name as source_name
    from public.knowledge_relations_v2 r
    join public.knowledge_source_versions_v2 sv on sv.id = r.source_version_id
    join public.knowledge_sources_v2 ks on ks.id = sv.source_id
    where r.active = true
      and (r.source_object_id = o.id or r.target_object_id = o.id)
    order by r.created_at asc
    limit 1
  ) prov on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'relationType', r.relation_type,
             'sourceCanonicalKey', r.source_canonical_key,
             'targetCanonicalKey', r.target_canonical_key,
             'evidence', coalesce(r.evidence,'')
           ) order by r.created_at asc) as relations,
           string_agg(coalesce(r.evidence,''), E'\n' order by r.created_at asc) as relation_evidence
    from public.knowledge_relations_v2 r
    where r.active = true
      and (r.source_object_id = o.id or r.target_object_id = o.id)
  ) relj on true
),
ranked_all as (
  select * from object_rows order by score desc, object_type, canonical_key
),
paged as (
  select *
  from ranked_all
  limit (select lim from params)
  offset (select off from params)
),
conflicts as (
  select count(*)::int as conflict_count
  from public.knowledge_review_items_v3 ri
  where ri.knowledge_space_id in (select id from spaces)
    and ri.status = 'open'
    and ri.review_type in ('possible_conflict','low_confidence_relation')
    and (
      ri.canonical_key in (select canonical_key from paged)
      or ri.related_canonical_key in (select canonical_key from paged)
    )
),
counts as (
  select count(*)::int as total_count,
         count(*) filter (where match_mode='direct')::int as direct_count,
         count(*) filter (where match_mode='cross_reference')::int as cross_reference_count,
         count(*) filter (where match_mode='relation')::int as relation_neighbor_count
  from ranked_all
)
select jsonb_build_object(
  'technicalReference', (select ref from params),
  'records', coalesce((select jsonb_agg(jsonb_build_object(
      'score', score,
      'matchMode', match_mode,
      'canonicalKey', canonical_key,
      'objectType', object_type,
      'name', name,
      'title', coalesce(title,name),
      'summary', coalesce(summary,''),
      'evidence', case when coalesce(content,'') <> '' then left(content,3000) else left(relation_evidence,3000) end,
      'sourceId', resolved_source_id,
      'sourceName', resolved_source_name,
      'synthetic', coalesce((metadata->>'synthetic')::boolean,false),
      'hasPublishedVersion', published_version_id is not null,
      'relations', relations
    ) order by score desc, object_type, canonical_key) from paged), '[]'::jsonb),
  'totalCount', (select total_count from counts),
  'pageSize', (select lim from params),
  'offset', (select off from params),
  'nextCursor', case
    when (select off + lim from params) < (select total_count from counts)
      then ((select off + lim from params))::text
    else null
  end,
  'directMatchCount', (select direct_count from counts),
  'crossReferenceCount', (select cross_reference_count from counts),
  'relationNeighborCount', (select relation_neighbor_count from counts),
  'relationCount', (select count(*) from anchor_relations),
  'conflictCount', (select conflict_count from conflicts),
  'citationReady', exists(select 1 from paged)
);
$$;

revoke all on function public.lookup_knowledge_technical_reference_v5(text,text,text[],integer,integer) from public;
revoke all on function public.lookup_knowledge_technical_reference_v5(text,text,text[],integer,integer) from anon;
grant execute on function public.lookup_knowledge_technical_reference_v5(text,text,text[],integer,integer) to authenticated;
