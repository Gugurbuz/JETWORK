-- Knowledge graph v3 integrity layer.
-- Guarantees relation endpoints exist, records provenance/review signals,
-- and exposes graph health for admin/quality workflows.

create table if not exists public.knowledge_review_items_v3 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid null references public.knowledge_source_versions_v2(id) on delete cascade,
  review_type text not null check (review_type in ('possible_duplicate','possible_conflict','low_confidence_relation','synthetic_endpoint','source_version_candidate')),
  canonical_key text null,
  related_canonical_key text null,
  confidence numeric(5,4) null check (confidence is null or (confidence >= 0 and confidence <= 1)),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open','accepted','rejected','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references auth.users(id)
);

create index if not exists knowledge_review_items_v3_space_status_idx
  on public.knowledge_review_items_v3(knowledge_space_id,status,created_at desc);

alter table public.knowledge_review_items_v3 enable row level security;

drop policy if exists knowledge_review_items_v3_read on public.knowledge_review_items_v3;
create policy knowledge_review_items_v3_read on public.knowledge_review_items_v3
for select to authenticated
using (public.can_write_knowledge_space(knowledge_space_id));

drop policy if exists knowledge_review_items_v3_write on public.knowledge_review_items_v3;
create policy knowledge_review_items_v3_write on public.knowledge_review_items_v3
for all to authenticated
using (public.can_write_knowledge_space(knowledge_space_id))
with check (public.can_write_knowledge_space(knowledge_space_id));

create or replace function public.knowledge_identity_from_canonical_key(p_key text)
returns table(object_type text, object_name text)
language sql
immutable
set search_path=''
as $$
  select
    case
      when position(':' in p_key) > 0 then lower(split_part(p_key, ':', 1))
      else 'unknown'
    end,
    case
      when position(':' in p_key) > 0 then upper(replace(substring(p_key from position(':' in p_key) + 1), '-', '-'))
      else upper(p_key)
    end;
$$;

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
begin
  select object_type, object_name into src_type, src_name
  from public.knowledge_identity_from_canonical_key(new.source_canonical_key);
  select object_type, object_name into tgt_type, tgt_name
  from public.knowledge_identity_from_canonical_key(new.target_canonical_key);

  select * into src from public.knowledge_objects_v2
  where knowledge_space_id = new.knowledge_space_id
    and canonical_key = new.source_canonical_key;

  if src.id is null then
    insert into public.knowledge_objects_v2(
      knowledge_space_id,canonical_key,object_type,name,normalized_name,
      publication_status,latest_version,metadata
    ) values (
      new.knowledge_space_id,new.source_canonical_key,src_type,left(src_name,240),upper(left(src_name,240)),
      'draft',0,jsonb_build_object(
        'synthetic',true,
        'syntheticReason','relation_endpoint',
        'firstSeenRelationType',new.relation_type,
        'firstSeenSourceVersionId',new.source_version_id
      )
    )
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata = public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          updated_at = now()
    returning * into src;

    insert into public.knowledge_review_items_v3(
      knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload
    ) values (
      new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.source_canonical_key,1,
      jsonb_build_object('role','source','relationType',new.relation_type)
    );
  end if;

  select * into tgt from public.knowledge_objects_v2
  where knowledge_space_id = new.knowledge_space_id
    and canonical_key = new.target_canonical_key;

  if tgt.id is null then
    insert into public.knowledge_objects_v2(
      knowledge_space_id,canonical_key,object_type,name,normalized_name,
      publication_status,latest_version,metadata
    ) values (
      new.knowledge_space_id,new.target_canonical_key,tgt_type,left(tgt_name,240),upper(left(tgt_name,240)),
      'draft',0,jsonb_build_object(
        'synthetic',true,
        'syntheticReason','relation_endpoint',
        'firstSeenRelationType',new.relation_type,
        'firstSeenSourceVersionId',new.source_version_id
      )
    )
    on conflict (knowledge_space_id,canonical_key) do update
      set metadata = public.knowledge_objects_v2.metadata || jsonb_build_object('referencedByRelation',true),
          updated_at = now()
    returning * into tgt;

    insert into public.knowledge_review_items_v3(
      knowledge_space_id,source_version_id,review_type,canonical_key,confidence,payload
    ) values (
      new.knowledge_space_id,new.source_version_id,'synthetic_endpoint',new.target_canonical_key,1,
      jsonb_build_object('role','target','relationType',new.relation_type)
    );
  end if;

  new.source_object_id := src.id;
  new.target_object_id := tgt.id;
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'graphIntegrityVersion','v3',
    'sourceEndpointMaterialized',coalesce((src.metadata->>'synthetic')::boolean,false),
    'targetEndpointMaterialized',coalesce((tgt.metadata->>'synthetic')::boolean,false)
  );
  return new;
end;
$$;

drop trigger if exists trg_knowledge_relations_integrity_v3 on public.knowledge_relations_v2;
create trigger trg_knowledge_relations_integrity_v3
before insert or update of source_canonical_key,target_canonical_key,knowledge_space_id
on public.knowledge_relations_v2
for each row execute function public.ensure_knowledge_relation_endpoints_v3();

create or replace view public.knowledge_graph_health_v3
with (security_invoker=true)
as
select
  s.id as knowledge_space_id,
  s.scope_type,
  count(distinct o.id) as object_count,
  count(distinct r.id) filter (where r.active) as active_relation_count,
  count(distinct o.id) filter (where coalesce((o.metadata->>'synthetic')::boolean,false)) as synthetic_object_count,
  count(distinct r.id) filter (where r.active and (r.source_object_id is null or r.target_object_id is null)) as dangling_relation_count,
  count(distinct q.id) filter (where q.status='open') as open_review_count
from public.knowledge_spaces s
left join public.knowledge_objects_v2 o on o.knowledge_space_id=s.id
left join public.knowledge_relations_v2 r on r.knowledge_space_id=s.id
left join public.knowledge_review_items_v3 q on q.knowledge_space_id=s.id
group by s.id,s.scope_type;

grant select on public.knowledge_graph_health_v3 to authenticated;

grant select,insert,update on public.knowledge_review_items_v3 to authenticated;
