-- Exact technical-reference runtime v4
-- - one RLS-preserving RPC for router + runtime lookup
-- - direct leaf-identifier matching across canonical paths
-- - graph-neighbor evidence in the same query
-- - published provenance/version materialization for synthetic endpoints

create or replace function public.lookup_knowledge_technical_reference_v4(
  p_workspace_id text,
  p_technical_reference text,
  p_object_types text[] default null,
  p_limit integer default 12
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with params as (
  select upper(trim(coalesce(p_technical_reference,''))) as ref,
         greatest(1, least(coalesce(p_limit,12),20)) as lim
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
ranked as (
  select * from object_rows order by score desc, object_type, canonical_key limit (select lim from params)
),
conflicts as (
  select count(*)::int as conflict_count
  from public.knowledge_review_items_v3 ri
  where ri.knowledge_space_id in (select id from spaces)
    and ri.status = 'open'
    and ri.review_type in ('possible_conflict','low_confidence_relation')
    and (
      ri.canonical_key in (select canonical_key from ranked)
      or ri.related_canonical_key in (select canonical_key from ranked)
    )
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
    ) order by score desc, object_type, canonical_key) from ranked), '[]'::jsonb),
  'directMatchCount', (select count(*) from ranked where match_mode='direct'),
  'crossReferenceCount', (select count(*) from ranked where match_mode='cross_reference'),
  'relationNeighborCount', (select count(*) from ranked where match_mode='relation'),
  'relationCount', (select count(*) from anchor_relations),
  'conflictCount', (select conflict_count from conflicts),
  'citationReady', exists(select 1 from ranked)
);
$$;

revoke all on function public.lookup_knowledge_technical_reference_v4(text,text,text[],integer) from public;
revoke all on function public.lookup_knowledge_technical_reference_v4(text,text,text[],integer) from anon;
grant execute on function public.lookup_knowledge_technical_reference_v4(text,text,text[],integer) to authenticated;

create or replace function public.ensure_knowledge_relation_endpoints_v3()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  src_type text; src_name text; tgt_type text; tgt_name text;
  src public.knowledge_objects_v2%rowtype; tgt public.knowledge_objects_v2%rowtype;
  v_publication_status text := 'draft';
  v_source_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_content text;
begin
  select coalesce(s.publication_status,'draft'), sv.source_id
    into v_publication_status, v_source_id
  from public.knowledge_source_versions_v2 sv
  join public.knowledge_sources_v2 s on s.id=sv.source_id
  where sv.id=new.source_version_id;
  v_publication_status := coalesce(v_publication_status,'draft');

  select object_type, object_name into src_type, src_name from public.knowledge_identity_from_canonical_key(new.source_canonical_key);
  select object_type, object_name into tgt_type, tgt_name from public.knowledge_identity_from_canonical_key(new.target_canonical_key);

  select * into src from public.knowledge_objects_v2 where knowledge_space_id=new.knowledge_space_id and canonical_key=new.source_canonical_key;
  if src.id is null then
    insert into public.knowledge_objects_v2(knowledge_space_id,canonical_key,object_type,name,normalized_name,publication_status,latest_version,metadata)
    values (new.knowledge_space_id,new.source_canonical_key,src_type,left(src_name,240),upper(left(src_name,240)),v_publication_status,0,
      jsonb_build_object('synthetic',true,'syntheticReason','relation_endpoint','firstSeenRelationType',new.relation_type,'firstSeenSourceVersionId',new.source_version_id))
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata=public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          publication_status=case when v_publication_status='published' then 'published' else public.knowledge_objects_v2.publication_status end,
          updated_at=now()
    returning * into src;
    insert into public.knowledge_review_items_v3(knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload)
    values (new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.source_canonical_key,1,jsonb_build_object('role','source','relationType',new.relation_type));
  elsif v_publication_status='published' and src.publication_status<>'published' and coalesce((src.metadata->>'synthetic')::boolean,false) then
    update public.knowledge_objects_v2 set publication_status='published', updated_at=now() where id=src.id returning * into src;
  end if;

  if v_publication_status='published' and coalesce((src.metadata->>'synthetic')::boolean,false) and src.published_version_id is null then
    v_version_number := greatest(coalesce(src.latest_version,0),0)+1;
    v_content := concat_ws(E'\n',
      'Structural knowledge endpoint: ' || src.canonical_key,
      'Verified relation: ' || new.source_canonical_key || ' --' || new.relation_type || '--> ' || new.target_canonical_key,
      case when coalesce(new.evidence,'')<>'' then 'Evidence: ' || new.evidence else null end
    );
    insert into public.knowledge_object_versions_v2(
      object_id,knowledge_space_id,source_version_id,version_number,content_hash,title,summary,content,is_current,metadata
    ) values (
      src.id,new.knowledge_space_id,new.source_version_id,v_version_number,encode(extensions.digest(v_content,'sha256'),'hex'),src.name,
      'Structural endpoint materialized from verified published relation provenance.',v_content,true,
      jsonb_build_object('synthetic',true,'structuralEndpoint',true,'relationType',new.relation_type,'provenanceSourceVersionId',new.source_version_id)
    ) returning id into v_version_id;
    update public.knowledge_objects_v2 set
      latest_version=v_version_number,
      primary_source_id=coalesce(primary_source_id,v_source_id),
      published_version_id=v_version_id,
      published_source_version_id=new.source_version_id,
      published_object_type=object_type,
      published_name=name,
      published_normalized_name=normalized_name,
      updated_at=now()
    where id=src.id returning * into src;
  end if;

  select * into tgt from public.knowledge_objects_v2 where knowledge_space_id=new.knowledge_space_id and canonical_key=new.target_canonical_key;
  if tgt.id is null then
    insert into public.knowledge_objects_v2(knowledge_space_id,canonical_key,object_type,name,normalized_name,publication_status,latest_version,metadata)
    values (new.knowledge_space_id,new.target_canonical_key,tgt_type,left(tgt_name,240),upper(left(tgt_name,240)),v_publication_status,0,
      jsonb_build_object('synthetic',true,'syntheticReason','relation_endpoint','firstSeenRelationType',new.relation_type,'firstSeenSourceVersionId',new.source_version_id))
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata=public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          publication_status=case when v_publication_status='published' then 'published' else public.knowledge_objects_v2.publication_status end,
          updated_at=now()
    returning * into tgt;
    insert into public.knowledge_review_items_v3(knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload)
    values (new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.target_canonical_key,1,jsonb_build_object('role','target','relationType',new.relation_type));
  elsif v_publication_status='published' and tgt.publication_status<>'published' and coalesce((tgt.metadata->>'synthetic')::boolean,false) then
    update public.knowledge_objects_v2 set publication_status='published', updated_at=now() where id=tgt.id returning * into tgt;
  end if;

  if v_publication_status='published' and coalesce((tgt.metadata->>'synthetic')::boolean,false) and tgt.published_version_id is null then
    v_version_number := greatest(coalesce(tgt.latest_version,0),0)+1;
    v_content := concat_ws(E'\n',
      'Structural knowledge endpoint: ' || tgt.canonical_key,
      'Verified relation: ' || new.source_canonical_key || ' --' || new.relation_type || '--> ' || new.target_canonical_key,
      case when coalesce(new.evidence,'')<>'' then 'Evidence: ' || new.evidence else null end
    );
    insert into public.knowledge_object_versions_v2(
      object_id,knowledge_space_id,source_version_id,version_number,content_hash,title,summary,content,is_current,metadata
    ) values (
      tgt.id,new.knowledge_space_id,new.source_version_id,v_version_number,encode(extensions.digest(v_content,'sha256'),'hex'),tgt.name,
      'Structural endpoint materialized from verified published relation provenance.',v_content,true,
      jsonb_build_object('synthetic',true,'structuralEndpoint',true,'relationType',new.relation_type,'provenanceSourceVersionId',new.source_version_id)
    ) returning id into v_version_id;
    update public.knowledge_objects_v2 set
      latest_version=v_version_number,
      primary_source_id=coalesce(primary_source_id,v_source_id),
      published_version_id=v_version_id,
      published_source_version_id=new.source_version_id,
      published_object_type=object_type,
      published_name=name,
      published_normalized_name=normalized_name,
      updated_at=now()
    where id=tgt.id returning * into tgt;
  end if;

  new.source_object_id:=src.id;
  new.target_object_id:=tgt.id;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'graphIntegrityVersion','v4',
    'sourceEndpointMaterialized',coalesce((src.metadata->>'synthetic')::boolean,false),
    'targetEndpointMaterialized',coalesce((tgt.metadata->>'synthetic')::boolean,false)
  );
  return new;
end;
$function$;

revoke all on function public.ensure_knowledge_relation_endpoints_v3() from public;
revoke all on function public.ensure_knowledge_relation_endpoints_v3() from anon;
revoke all on function public.ensure_knowledge_relation_endpoints_v3() from authenticated;

-- Backfill structural provenance versions for already-published synthetic endpoints.
update public.knowledge_relations_v2 r
set source_canonical_key=r.source_canonical_key
where r.active=true
  and exists (
    select 1 from public.knowledge_objects_v2 o
    where o.knowledge_space_id=r.knowledge_space_id
      and o.publication_status='published'
      and coalesce((o.metadata->>'synthetic')::boolean,false)
      and o.published_version_id is null
      and (o.id=r.source_object_id or o.id=r.target_object_id)
  );
