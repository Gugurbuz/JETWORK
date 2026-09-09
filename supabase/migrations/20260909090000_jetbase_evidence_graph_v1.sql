-- Jetbase Evidence Graph v1
-- Adds typed relation provenance, relation-derived claims, literal evidence status,
-- and a bounded read-only evidence-pack RPC without changing controller authority.

alter table public.knowledge_relations_v2
  add column if not exists extraction_type text not null default 'EXTRACTED'
    check (extraction_type in ('EXTRACTED','INFERRED','AMBIGUOUS')),
  add column if not exists confidence numeric(5,4) not null default 1
    check (confidence >= 0 and confidence <= 1),
  add column if not exists source_location jsonb not null default '{}'::jsonb;

update public.knowledge_relations_v2
set extraction_type = case
      when upper(coalesce(metadata->>'extractionType','')) in ('EXTRACTED','INFERRED','AMBIGUOUS')
        then upper(metadata->>'extractionType')
      when coalesce(metadata->>'inferredFrom','') = 'semantic_compiler'
           and lower(coalesce(metadata->>'reviewRequired','false')) = 'true'
        then 'AMBIGUOUS'
      when coalesce(metadata->>'inferredFrom','') = 'semantic_compiler'
        then 'INFERRED'
      else 'EXTRACTED'
    end,
    confidence = case
      when coalesce(metadata->>'confidence','') ~ '^(0(\.\d+)?|1(\.0+)?)$'
        then (metadata->>'confidence')::numeric
      else 1
    end,
    source_location = case
      when jsonb_typeof(metadata->'sourceLocation') = 'object' then metadata->'sourceLocation'
      when jsonb_typeof(metadata->'location') = 'object' then metadata->'location'
      else '{}'::jsonb
    end,
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'evidenceModelVersion','v1',
      'extractionType',case
        when upper(coalesce(metadata->>'extractionType','')) in ('EXTRACTED','INFERRED','AMBIGUOUS')
          then upper(metadata->>'extractionType')
        when coalesce(metadata->>'inferredFrom','') = 'semantic_compiler'
             and lower(coalesce(metadata->>'reviewRequired','false')) = 'true'
          then 'AMBIGUOUS'
        when coalesce(metadata->>'inferredFrom','') = 'semantic_compiler'
          then 'INFERRED'
        else 'EXTRACTED'
      end
    );

create index if not exists knowledge_relations_v2_evidence_class_idx
  on public.knowledge_relations_v2(knowledge_space_id, extraction_type, confidence desc)
  where active;

create table if not exists public.knowledge_claims_v1 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  relation_id uuid not null unique references public.knowledge_relations_v2(id) on delete cascade,
  claim_type text not null default 'RELATION' check (claim_type in ('RELATION')),
  subject_canonical_key text not null,
  predicate text not null,
  object_canonical_key text not null,
  claim_text text not null,
  extraction_type text not null check (extraction_type in ('EXTRACTED','INFERRED','AMBIGUOUS')),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_claims_v1_subject_idx
  on public.knowledge_claims_v1(knowledge_space_id, subject_canonical_key, predicate)
  where active;
create index if not exists knowledge_claims_v1_object_idx
  on public.knowledge_claims_v1(knowledge_space_id, object_canonical_key, predicate)
  where active;

create table if not exists public.knowledge_claim_evidence_v1 (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.knowledge_claims_v1(id) on delete cascade,
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  relation_id uuid not null references public.knowledge_relations_v2(id) on delete cascade,
  evidence_kind text not null default 'SUPPORTS' check (evidence_kind in ('SUPPORTS','CONTRADICTS','MENTIONS')),
  verification_status text not null check (verification_status in ('LITERAL','NON_LITERAL','NO_EVIDENCE')),
  evidence_text text,
  source_location jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (claim_id, relation_id)
);

create index if not exists knowledge_claim_evidence_v1_claim_idx
  on public.knowledge_claim_evidence_v1(claim_id, verification_status);
create index if not exists knowledge_claim_evidence_v1_source_idx
  on public.knowledge_claim_evidence_v1(source_version_id, evidence_kind);

alter table public.knowledge_claims_v1 enable row level security;
alter table public.knowledge_claim_evidence_v1 enable row level security;

drop policy if exists knowledge_claims_v1_read on public.knowledge_claims_v1;
create policy knowledge_claims_v1_read on public.knowledge_claims_v1
for select to authenticated
using (public.can_read_knowledge_space(knowledge_space_id));

drop policy if exists knowledge_claim_evidence_v1_read on public.knowledge_claim_evidence_v1;
create policy knowledge_claim_evidence_v1_read on public.knowledge_claim_evidence_v1
for select to authenticated
using (public.can_read_knowledge_space(knowledge_space_id));

revoke all on table public.knowledge_claims_v1 from public, anon, authenticated;
revoke all on table public.knowledge_claim_evidence_v1 from public, anon, authenticated;
grant select on table public.knowledge_claims_v1 to authenticated;
grant select on table public.knowledge_claim_evidence_v1 to authenticated;
grant all on table public.knowledge_claims_v1 to service_role;
grant all on table public.knowledge_claim_evidence_v1 to service_role;

create or replace function public.normalize_knowledge_relation_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_metadata_type text := upper(coalesce(new.metadata->>'extractionType',''));
  v_metadata_confidence text := coalesce(new.metadata->>'confidence','');
begin
  new.extraction_type := case
    when v_metadata_type in ('EXTRACTED','INFERRED','AMBIGUOUS') then v_metadata_type
    when coalesce(new.metadata->>'inferredFrom','') = 'semantic_compiler'
         and lower(coalesce(new.metadata->>'reviewRequired','false')) = 'true' then 'AMBIGUOUS'
    when coalesce(new.metadata->>'inferredFrom','') = 'semantic_compiler' then 'INFERRED'
    else 'EXTRACTED'
  end;

  new.confidence := case
    when v_metadata_confidence ~ '^(0(\.\d+)?|1(\.0+)?)$' then v_metadata_confidence::numeric
    else 1
  end;

  new.source_location := case
    when jsonb_typeof(new.metadata->'sourceLocation') = 'object' then new.metadata->'sourceLocation'
    when jsonb_typeof(new.metadata->'location') = 'object' then new.metadata->'location'
    else coalesce(new.source_location,'{}'::jsonb)
  end;

  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'evidenceModelVersion','v1',
    'extractionType',new.extraction_type,
    'confidence',new.confidence
  );
  return new;
end;
$$;

revoke all on function public.normalize_knowledge_relation_evidence_v1() from public, anon, authenticated;
grant execute on function public.normalize_knowledge_relation_evidence_v1() to service_role;

drop trigger if exists trg_knowledge_relation_evidence_normalize_v1 on public.knowledge_relations_v2;
create trigger trg_knowledge_relation_evidence_normalize_v1
before insert or update of metadata,evidence,source_version_id,active
on public.knowledge_relations_v2
for each row execute function public.normalize_knowledge_relation_evidence_v1();

create or replace function public.sync_knowledge_relation_claim_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_id uuid;
  v_raw_text text;
  v_verification text;
begin
  insert into public.knowledge_claims_v1(
    knowledge_space_id,source_version_id,relation_id,claim_type,
    subject_canonical_key,predicate,object_canonical_key,claim_text,
    extraction_type,confidence,active,metadata
  ) values (
    new.knowledge_space_id,new.source_version_id,new.id,'RELATION',
    new.source_canonical_key,new.relation_type,new.target_canonical_key,
    new.source_canonical_key || ' ' || new.relation_type || ' ' || new.target_canonical_key,
    new.extraction_type,new.confidence,new.active,
    jsonb_build_object('relationDerived',true,'claimModelVersion','v1')
  )
  on conflict (relation_id) do update set
    knowledge_space_id=excluded.knowledge_space_id,
    source_version_id=excluded.source_version_id,
    subject_canonical_key=excluded.subject_canonical_key,
    predicate=excluded.predicate,
    object_canonical_key=excluded.object_canonical_key,
    claim_text=excluded.claim_text,
    extraction_type=excluded.extraction_type,
    confidence=excluded.confidence,
    active=excluded.active,
    metadata=public.knowledge_claims_v1.metadata || excluded.metadata,
    updated_at=now()
  returning id into v_claim_id;

  select raw_text into v_raw_text
  from public.knowledge_source_versions_v2
  where id = new.source_version_id;

  v_verification := case
    when nullif(trim(coalesce(new.evidence,'')),'') is null then 'NO_EVIDENCE'
    when position(lower(trim(new.evidence)) in lower(coalesce(v_raw_text,''))) > 0 then 'LITERAL'
    else 'NON_LITERAL'
  end;

  insert into public.knowledge_claim_evidence_v1(
    claim_id,knowledge_space_id,source_version_id,relation_id,evidence_kind,
    verification_status,evidence_text,source_location,metadata
  ) values (
    v_claim_id,new.knowledge_space_id,new.source_version_id,new.id,'SUPPORTS',
    v_verification,new.evidence,new.source_location,
    jsonb_build_object('relationDerived',true,'evidenceModelVersion','v1')
  )
  on conflict (claim_id,relation_id) do update set
    knowledge_space_id=excluded.knowledge_space_id,
    source_version_id=excluded.source_version_id,
    verification_status=excluded.verification_status,
    evidence_text=excluded.evidence_text,
    source_location=excluded.source_location,
    metadata=public.knowledge_claim_evidence_v1.metadata || excluded.metadata;

  return new;
end;
$$;

revoke all on function public.sync_knowledge_relation_claim_v1() from public, anon, authenticated;
grant execute on function public.sync_knowledge_relation_claim_v1() to service_role;

drop trigger if exists trg_knowledge_relation_claim_sync_v1 on public.knowledge_relations_v2;
create trigger trg_knowledge_relation_claim_sync_v1
after insert or update of source_canonical_key,relation_type,target_canonical_key,evidence,metadata,source_version_id,active
on public.knowledge_relations_v2
for each row execute function public.sync_knowledge_relation_claim_v1();

insert into public.knowledge_claims_v1(
  knowledge_space_id,source_version_id,relation_id,claim_type,
  subject_canonical_key,predicate,object_canonical_key,claim_text,
  extraction_type,confidence,active,metadata
)
select
  r.knowledge_space_id,r.source_version_id,r.id,'RELATION',
  r.source_canonical_key,r.relation_type,r.target_canonical_key,
  r.source_canonical_key || ' ' || r.relation_type || ' ' || r.target_canonical_key,
  r.extraction_type,r.confidence,r.active,
  jsonb_build_object('relationDerived',true,'claimModelVersion','v1','backfilled',true)
from public.knowledge_relations_v2 r
on conflict (relation_id) do update set
  extraction_type=excluded.extraction_type,
  confidence=excluded.confidence,
  active=excluded.active,
  metadata=public.knowledge_claims_v1.metadata || excluded.metadata,
  updated_at=now();

insert into public.knowledge_claim_evidence_v1(
  claim_id,knowledge_space_id,source_version_id,relation_id,evidence_kind,
  verification_status,evidence_text,source_location,metadata
)
select
  c.id,r.knowledge_space_id,r.source_version_id,r.id,'SUPPORTS',
  case
    when nullif(trim(coalesce(r.evidence,'')),'') is null then 'NO_EVIDENCE'
    when position(lower(trim(r.evidence)) in lower(coalesce(sv.raw_text,''))) > 0 then 'LITERAL'
    else 'NON_LITERAL'
  end,
  r.evidence,r.source_location,
  jsonb_build_object('relationDerived',true,'evidenceModelVersion','v1','backfilled',true)
from public.knowledge_relations_v2 r
join public.knowledge_claims_v1 c on c.relation_id=r.id
join public.knowledge_source_versions_v2 sv on sv.id=r.source_version_id
on conflict (claim_id,relation_id) do update set
  verification_status=excluded.verification_status,
  evidence_text=excluded.evidence_text,
  source_location=excluded.source_location,
  metadata=public.knowledge_claim_evidence_v1.metadata || excluded.metadata;

create or replace function public.get_knowledge_evidence_pack_v1(
  p_workspace_id text,
  p_canonical_key text,
  p_hops integer default 1,
  p_limit integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with recursive
params as (
  select lower(trim(coalesce(p_canonical_key,''))) as root_key,
         greatest(1,least(coalesce(p_hops,1),2)) as max_hops,
         greatest(1,least(coalesce(p_limit,24),40)) as lim
),
ctx as (
  select * from public.resolve_knowledge_context(p_workspace_id)
),
spaces as (
  select project_space_id as id,'project'::text as scope_type,0 as priority
  from ctx where project_space_id is not null
  union all
  select global_space_id,'global'::text,1 from ctx where global_space_id is not null
),
published_relations as (
  select r.*,sp.scope_type,sp.priority,sv.source_id,src.name as source_name
  from spaces sp
  join public.knowledge_relations_v2 r on r.knowledge_space_id=sp.id and r.active
  join public.knowledge_source_versions_v2 sv on sv.id=r.source_version_id
  join public.knowledge_sources_v2 src
    on src.id=sv.source_id
   and src.publication_status='published'
   and src.published_version_id=sv.id
),
walk(node_key,depth,path) as (
  select p.root_key,0,array[p.root_key]::text[] from params p where p.root_key<>''
  union all
  select nx.next_key,w.depth+1,w.path || nx.next_key
  from walk w
  join published_relations r
    on r.source_canonical_key=w.node_key or r.target_canonical_key=w.node_key
  cross join lateral (
    select case when r.source_canonical_key=w.node_key then r.target_canonical_key else r.source_canonical_key end as next_key
  ) nx
  cross join params p
  where w.depth < p.max_hops
    and not (nx.next_key = any(w.path))
),
node_depths as (
  select node_key,min(depth) as depth from walk group by node_key
),
ranked_edges as (
  select r.*,
         greatest(ns.depth,nt.depth) as graph_depth,
         row_number() over (
           partition by r.source_canonical_key,r.relation_type,r.target_canonical_key
           order by r.priority,r.confidence desc,r.created_at desc
         ) as precedence_rank
  from published_relations r
  join node_depths ns on ns.node_key=r.source_canonical_key
  join node_depths nt on nt.node_key=r.target_canonical_key
),
selected_edges as (
  select * from ranked_edges
  where precedence_rank=1
  order by graph_depth,priority,confidence desc,relation_type,source_canonical_key,target_canonical_key
  limit (select lim from params)
),
selected_node_keys as (
  select (select root_key from params) as canonical_key
  union select source_canonical_key from selected_edges
  union select target_canonical_key from selected_edges
),
object_candidates as (
  select o.*,sp.scope_type,sp.priority,v.title,v.summary,sv.source_id,src.name as source_name,
         row_number() over (partition by o.canonical_key order by sp.priority,o.updated_at desc) as precedence_rank
  from spaces sp
  join public.knowledge_objects_v2 o
    on o.knowledge_space_id=sp.id
   and o.publication_status='published'
   and o.canonical_key in (select canonical_key from selected_node_keys where canonical_key is not null)
  left join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
  left join public.knowledge_source_versions_v2 sv on sv.id=o.published_source_version_id
  left join public.knowledge_sources_v2 src on src.id=sv.source_id
),
selected_objects as (
  select * from object_candidates where precedence_rank=1
),
selected_claims as (
  select c.*
  from public.knowledge_claims_v1 c
  join selected_edges e on e.id=c.relation_id
  where c.active
),
review_signals as (
  select q.*
  from public.knowledge_review_items_v3 q
  where q.knowledge_space_id in (select id from spaces)
    and q.status='open'
    and q.review_type in ('possible_conflict','low_confidence_relation')
    and (
      q.canonical_key in (select canonical_key from selected_node_keys)
      or q.related_canonical_key in (select canonical_key from selected_node_keys)
    )
  order by q.created_at desc
  limit 20
)
select jsonb_build_object(
  'rootCanonicalKey',(select root_key from params),
  'hops',(select max_hops from params),
  'relationCount',(select count(*) from selected_edges),
  'objectCount',(select count(*) from selected_objects),
  'claimCount',(select count(*) from selected_claims),
  'reviewSignalCount',(select count(*) from review_signals),
  'relations',coalesce((select jsonb_agg(jsonb_build_object(
    'id',e.id,
    'scope',e.scope_type,
    'depth',e.graph_depth,
    'sourceCanonicalKey',e.source_canonical_key,
    'relationType',e.relation_type,
    'targetCanonicalKey',e.target_canonical_key,
    'extractionType',e.extraction_type,
    'confidence',e.confidence,
    'evidence',coalesce(e.evidence,''),
    'sourceLocation',e.source_location,
    'sourceId',e.source_id,
    'sourceName',e.source_name
  ) order by e.graph_depth,e.priority,e.confidence desc,e.relation_type) from selected_edges e),'[]'::jsonb),
  'objects',coalesce((select jsonb_agg(jsonb_build_object(
    'scope',o.scope_type,
    'canonicalKey',o.canonical_key,
    'objectType',o.published_object_type,
    'name',o.published_name,
    'title',coalesce(o.title,o.published_name),
    'summary',coalesce(o.summary,''),
    'sourceId',o.source_id,
    'sourceName',coalesce(o.source_name,'Kurumsal bilgi kaynağı')
  ) order by o.priority,o.published_object_type,o.canonical_key) from selected_objects o),'[]'::jsonb),
  'claims',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,
    'subjectCanonicalKey',c.subject_canonical_key,
    'predicate',c.predicate,
    'objectCanonicalKey',c.object_canonical_key,
    'statement',c.claim_text,
    'extractionType',c.extraction_type,
    'confidence',c.confidence,
    'evidence',coalesce((select jsonb_agg(jsonb_build_object(
      'kind',ce.evidence_kind,
      'verificationStatus',ce.verification_status,
      'text',coalesce(ce.evidence_text,''),
      'sourceLocation',ce.source_location
    ) order by ce.created_at) from public.knowledge_claim_evidence_v1 ce where ce.claim_id=c.id),'[]'::jsonb)
  ) order by c.subject_canonical_key,c.predicate,c.object_canonical_key) from selected_claims c),'[]'::jsonb),
  'reviewSignals',coalesce((select jsonb_agg(jsonb_build_object(
    'id',q.id,
    'type',q.review_type,
    'canonicalKey',q.canonical_key,
    'relatedCanonicalKey',q.related_canonical_key,
    'confidence',q.confidence
  ) order by q.created_at desc) from review_signals q),'[]'::jsonb),
  'citationReady',exists(select 1 from selected_edges)
);
$$;

revoke all on function public.get_knowledge_evidence_pack_v1(text,text,integer,integer) from public, anon;
grant execute on function public.get_knowledge_evidence_pack_v1(text,text,integer,integer) to authenticated, service_role;

comment on table public.knowledge_claims_v1 is
  'Jetbase relation-derived claim ledger. Machine-generated claims remain evidence data and never become project memory authority by themselves.';
comment on function public.get_knowledge_evidence_pack_v1(text,text,integer,integer) is
  'Returns a bounded 1-2 hop Jetbase evidence subgraph. This is a read capability, not a planner/router.';
