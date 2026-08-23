-- Production follow-up for Knowledge Graph v3.
-- 1) Keep graph health aggregation linear.
-- 2) Materialize relation endpoints with the publication state of their source.
-- 3) Resolve legacy dangling-edge reviews after repair.

create or replace view public.knowledge_graph_health_v3
with (security_invoker=true)
as
select
  s.id as knowledge_space_id,
  s.scope_type,
  coalesce(o.object_count,0)::bigint as object_count,
  coalesce(r.active_relation_count,0)::bigint as active_relation_count,
  coalesce(o.synthetic_object_count,0)::bigint as synthetic_object_count,
  coalesce(r.dangling_relation_count,0)::bigint as dangling_relation_count,
  coalesce(q.open_review_count,0)::bigint as open_review_count
from public.knowledge_spaces s
left join lateral (
  select count(*) as object_count,
         count(*) filter (where coalesce((metadata->>'synthetic')::boolean,false)) as synthetic_object_count
  from public.knowledge_objects_v2 o
  where o.knowledge_space_id=s.id
) o on true
left join lateral (
  select count(*) filter (where active) as active_relation_count,
         count(*) filter (where active and (source_object_id is null or target_object_id is null)) as dangling_relation_count
  from public.knowledge_relations_v2 r
  where r.knowledge_space_id=s.id
) r on true
left join lateral (
  select count(*) filter (where status='open') as open_review_count
  from public.knowledge_review_items_v3 q
  where q.knowledge_space_id=s.id
) q on true;

grant select on public.knowledge_graph_health_v3 to authenticated;

create or replace function public.ensure_knowledge_relation_endpoints_v3()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  src_type text;
  src_name text;
  tgt_type text;
  tgt_name text;
  src public.knowledge_objects_v2%rowtype;
  tgt public.knowledge_objects_v2%rowtype;
  v_publication_status text := 'draft';
begin
  select coalesce(s.publication_status,'draft') into v_publication_status
  from public.knowledge_source_versions_v2 sv
  join public.knowledge_sources_v2 s on s.id=sv.source_id
  where sv.id=new.source_version_id;
  v_publication_status := coalesce(v_publication_status,'draft');

  select object_type, object_name into src_type, src_name
  from public.knowledge_identity_from_canonical_key(new.source_canonical_key);
  select object_type, object_name into tgt_type, tgt_name
  from public.knowledge_identity_from_canonical_key(new.target_canonical_key);

  select * into src from public.knowledge_objects_v2
  where knowledge_space_id=new.knowledge_space_id and canonical_key=new.source_canonical_key;

  if src.id is null then
    insert into public.knowledge_objects_v2(
      knowledge_space_id,canonical_key,object_type,name,normalized_name,publication_status,latest_version,metadata
    ) values (
      new.knowledge_space_id,new.source_canonical_key,src_type,left(src_name,240),upper(left(src_name,240)),
      v_publication_status,0,jsonb_build_object(
        'synthetic',true,'syntheticReason','relation_endpoint','firstSeenRelationType',new.relation_type,
        'firstSeenSourceVersionId',new.source_version_id
      )
    )
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata=public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          publication_status=case when v_publication_status='published' then 'published' else public.knowledge_objects_v2.publication_status end,
          updated_at=now()
    returning * into src;

    insert into public.knowledge_review_items_v3(
      knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload
    ) values (
      new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.source_canonical_key,1,
      jsonb_build_object('role','source','relationType',new.relation_type)
    );
  elsif v_publication_status='published'
    and src.publication_status<>'published'
    and coalesce((src.metadata->>'synthetic')::boolean,false) then
    update public.knowledge_objects_v2
    set publication_status='published',updated_at=now()
    where id=src.id returning * into src;
  end if;

  select * into tgt from public.knowledge_objects_v2
  where knowledge_space_id=new.knowledge_space_id and canonical_key=new.target_canonical_key;

  if tgt.id is null then
    insert into public.knowledge_objects_v2(
      knowledge_space_id,canonical_key,object_type,name,normalized_name,publication_status,latest_version,metadata
    ) values (
      new.knowledge_space_id,new.target_canonical_key,tgt_type,left(tgt_name,240),upper(left(tgt_name,240)),
      v_publication_status,0,jsonb_build_object(
        'synthetic',true,'syntheticReason','relation_endpoint','firstSeenRelationType',new.relation_type,
        'firstSeenSourceVersionId',new.source_version_id
      )
    )
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata=public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          publication_status=case when v_publication_status='published' then 'published' else public.knowledge_objects_v2.publication_status end,
          updated_at=now()
    returning * into tgt;

    insert into public.knowledge_review_items_v3(
      knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload
    ) values (
      new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.target_canonical_key,1,
      jsonb_build_object('role','target','relationType',new.relation_type)
    );
  elsif v_publication_status='published'
    and tgt.publication_status<>'published'
    and coalesce((tgt.metadata->>'synthetic')::boolean,false) then
    update public.knowledge_objects_v2
    set publication_status='published',updated_at=now()
    where id=tgt.id returning * into tgt;
  end if;

  new.source_object_id:=src.id;
  new.target_object_id:=tgt.id;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'graphIntegrityVersion','v3',
    'sourceEndpointMaterialized',coalesce((src.metadata->>'synthetic')::boolean,false),
    'targetEndpointMaterialized',coalesce((tgt.metadata->>'synthetic')::boolean,false)
  );
  return new;
end;
$$;

update public.knowledge_relations_v2
set source_canonical_key=source_canonical_key
where active;

update public.knowledge_objects_v2 o
set publication_status='published',updated_at=now()
where coalesce((o.metadata->>'synthetic')::boolean,false)
  and o.publication_status<>'published'
  and exists (
    select 1
    from public.knowledge_relations_v2 r
    join public.knowledge_source_versions_v2 sv on sv.id=r.source_version_id
    join public.knowledge_sources_v2 s on s.id=sv.source_id
    where r.knowledge_space_id=o.knowledge_space_id
      and r.active
      and s.publication_status='published'
      and (r.source_object_id=o.id or r.target_object_id=o.id)
  );

update public.knowledge_review_items_v3 q
set status='resolved',resolved_at=now()
where q.status='open'
  and q.payload ? 'legacyDanglingRelationId'
  and exists (
    select 1 from public.knowledge_relations_v2 r
    where r.id=(q.payload->>'legacyDanglingRelationId')::uuid
      and r.source_object_id is not null
      and r.target_object_id is not null
  );