-- Route semantic compiler uncertainty to the Knowledge Center review queue.

create or replace function public.enqueue_knowledge_relation_review_v3()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_confidence numeric;
  v_review_required boolean;
begin
  if coalesce(new.metadata->>'inferredFrom','') <> 'semantic_compiler' then
    return new;
  end if;

  begin
    v_confidence := nullif(new.metadata->>'confidence','')::numeric;
  exception when others then
    v_confidence := null;
  end;
  v_review_required := coalesce((new.metadata->>'reviewRequired')::boolean,false);

  if v_review_required then
    insert into public.knowledge_review_items_v3(
      knowledge_space_id,
      source_version_id,
      review_type,
      canonical_key,
      related_canonical_key,
      confidence,
      payload
    ) values (
      new.knowledge_space_id,
      new.source_version_id,
      'low_confidence_relation',
      new.source_canonical_key,
      new.target_canonical_key,
      v_confidence,
      jsonb_build_object(
        'relationType',new.relation_type,
        'evidence',new.evidence,
        'relationId',new.id,
        'compilerVersion',new.metadata->>'compilerVersion'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_knowledge_relation_review_v3 on public.knowledge_relations_v2;
create trigger trg_knowledge_relation_review_v3
after insert on public.knowledge_relations_v2
for each row execute function public.enqueue_knowledge_relation_review_v3();

-- Surface already-existing dangling relations as review items before the v3 trigger
-- prevents new ones. This migration is idempotent by relation id in payload.
insert into public.knowledge_review_items_v3(
  knowledge_space_id,source_version_id,review_type,canonical_key,related_canonical_key,confidence,payload
)
select
  r.knowledge_space_id,
  r.source_version_id,
  'synthetic_endpoint',
  r.source_canonical_key,
  r.target_canonical_key,
  1,
  jsonb_build_object('legacyDanglingRelationId',r.id,'relationType',r.relation_type)
from public.knowledge_relations_v2 r
where r.active
  and (r.source_object_id is null or r.target_object_id is null)
  and not exists (
    select 1 from public.knowledge_review_items_v3 q
    where q.payload->>'legacyDanglingRelationId'=r.id::text
  );
