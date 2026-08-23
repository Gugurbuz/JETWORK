-- Logical source identity for repeat uploads and per-version blob provenance.

alter table public.knowledge_sources_v2
  add column if not exists source_key text;

alter table public.knowledge_source_versions_v2
  add column if not exists storage_path text;

create or replace function public.normalize_knowledge_source_key_v3(p_name text)
returns text
language sql
immutable
set search_path=''
as $$
  select left(
    trim(both '-' from regexp_replace(
      lower(regexp_replace(coalesce(p_name,''), '\.[^.]+$', '')),
      '[^a-z0-9çğıöşü]+', '-', 'g'
    )),
    220
  );
$$;

update public.knowledge_sources_v2
set source_key = public.normalize_knowledge_source_key_v3(name)
where source_key is null or source_key = '';

create index if not exists knowledge_sources_v2_space_source_key_idx
  on public.knowledge_sources_v2(knowledge_space_id,source_key)
  where source_key is not null;

create index if not exists knowledge_source_versions_v2_source_created_idx
  on public.knowledge_source_versions_v2(source_id,created_at desc);

-- Existing versions inherit the source blob path as best-effort provenance.
update public.knowledge_source_versions_v2 v
set storage_path = s.storage_path
from public.knowledge_sources_v2 s
where s.id=v.source_id and v.storage_path is null;

create or replace view public.knowledge_source_lineage_v3
with (security_invoker=true)
as
select
  s.id as source_id,
  s.knowledge_space_id,
  s.source_key,
  s.name,
  s.publication_status,
  s.latest_version,
  v.id as source_version_id,
  v.version_number,
  v.content_hash,
  v.document_type,
  v.parser_version,
  v.storage_path,
  v.object_count,
  v.relation_count,
  v.created_at as version_created_at
from public.knowledge_sources_v2 s
join public.knowledge_source_versions_v2 v on v.source_id=s.id;

grant select on public.knowledge_source_lineage_v3 to authenticated;
