alter table public.kb_sources
  add column if not exists published_version_id uuid
    references public.kb_source_versions(id) on delete set null;

alter table public.kb_objects
  add column if not exists published_version_id uuid
    references public.kb_object_versions(id) on delete set null;

alter table public.kb_objects
  add column if not exists published_source_version_id uuid
    references public.kb_source_versions(id) on delete set null;

alter table public.kb_objects
  add column if not exists published_object_type text;

alter table public.kb_objects
  add column if not exists published_name text;

alter table public.kb_objects
  add column if not exists published_normalized_name text;

create table if not exists public.kb_source_version_objects (
  source_version_id uuid not null
    references public.kb_source_versions(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  object_id uuid not null references public.kb_objects(id) on delete cascade,
  object_version_id uuid not null
    references public.kb_object_versions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_version_id, object_id),
  unique (source_version_id, object_version_id)
);

create index if not exists kb_source_version_objects_object_idx
  on public.kb_source_version_objects (object_id, source_version_id);

alter table public.kb_source_version_objects enable row level security;
revoke all on table public.kb_source_version_objects from public, anon, authenticated;
grant all on table public.kb_source_version_objects to service_role;

create index if not exists kb_sources_published_version_idx
  on public.kb_sources (published_version_id)
  where published_version_id is not null;

create index if not exists kb_objects_published_version_idx
  on public.kb_objects (published_version_id)
  where published_version_id is not null;

create index if not exists kb_objects_published_source_version_idx
  on public.kb_objects (published_source_version_id)
  where published_source_version_id is not null;

-- Preserve the version that was visible before this hardening migration.
update public.kb_sources source
   set published_version_id = version.id
  from public.kb_source_versions version
 where source.publication_status = 'published'
   and source.published_version_id is null
   and version.source_id = source.id
   and version.version_number = source.latest_version;

update public.kb_objects object
   set published_version_id = version.id,
       published_source_version_id = source.published_version_id,
       published_object_type = object.object_type,
       published_name = object.name,
       published_normalized_name = object.normalized_name
  from public.kb_object_versions version,
       public.kb_sources source
 where object.publication_status = 'published'
   and object.published_version_id is null
   and version.object_id = object.id
   and version.is_current
   and source.id = object.primary_source_id
   and source.publication_status = 'published'
   and source.published_version_id is not null;

insert into public.kb_source_version_objects (
  source_version_id,
  workspace_id,
  object_id,
  object_version_id
)
select
  target_version.id,
  target_version.workspace_id,
  object.id,
  chosen_object_version.id
from public.kb_source_versions target_version
join public.kb_sources source
  on source.id = target_version.source_id
join public.kb_objects object
  on object.workspace_id = target_version.workspace_id
 and object.primary_source_id = source.id
join lateral (
  select candidate.id
    from public.kb_object_versions candidate
    join public.kb_source_versions candidate_source_version
      on candidate_source_version.id = candidate.source_version_id
   where candidate.object_id = object.id
     and candidate_source_version.source_id = source.id
     and candidate_source_version.version_number <= target_version.version_number
   order by
     candidate_source_version.version_number desc,
     candidate.version_number desc
   limit 1
) chosen_object_version on true
on conflict do nothing;

-- Preserve the exact object snapshot that was visible immediately before the
-- migration, including unchanged objects reused by a later source version.
insert into public.kb_source_version_objects (
  source_version_id,
  workspace_id,
  object_id,
  object_version_id
)
select
  object.published_source_version_id,
  object.workspace_id,
  object.id,
  object.published_version_id
from public.kb_objects object
where object.publication_status = 'published'
  and object.published_source_version_id is not null
  and object.published_version_id is not null
on conflict (source_version_id, object_id)
do update set object_version_id = excluded.object_version_id;

alter function public.ingest_knowledge_catalog(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) rename to ingest_knowledge_catalog_internal;

revoke all on function public.ingest_knowledge_catalog_internal(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon, authenticated;

create or replace function public.ingest_knowledge_catalog(
  p_job_id uuid,
  p_workspace_id text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_content_hash text,
  p_raw_text text,
  p_parser_version text,
  p_document_type text,
  p_objects jsonb,
  p_relations jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  ingest_result jsonb;
  target_source_id uuid;
  target_source_version_id uuid;
  requested_count integer;
  linked_count integer;
begin
  if current_user_id is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;
  if not exists (
    select 1
      from public.kb_ingestion_jobs job
     where job.id = p_job_id
       and job.workspace_id = p_workspace_id
       and job.owner_id = current_user_id
  ) then
    raise exception 'Ingestion job access denied';
  end if;

  ingest_result := public.ingest_knowledge_catalog_internal(
    p_job_id,
    p_workspace_id,
    p_storage_path,
    p_file_name,
    p_mime_type,
    p_content_hash,
    p_raw_text,
    p_parser_version,
    p_document_type,
    p_objects,
    p_relations,
    p_warnings
  );
  target_source_id := (ingest_result->>'sourceId')::uuid;
  target_source_version_id := (ingest_result->>'sourceVersionId')::uuid;

  select count(distinct object_item->>'canonicalKey')::integer
    into requested_count
    from jsonb_array_elements(p_objects) object_item
   where coalesce(object_item->>'canonicalKey', '') <> '';

  insert into public.kb_source_version_objects (
    source_version_id,
    workspace_id,
    object_id,
    object_version_id
  )
  select
    target_source_version_id,
    p_workspace_id,
    object.id,
    version.id
  from jsonb_array_elements(p_objects) object_item
  join public.kb_objects object
    on object.workspace_id = p_workspace_id
   and object.primary_source_id = target_source_id
   and object.canonical_key = object_item->>'canonicalKey'
  join lateral (
    select candidate.id
      from public.kb_object_versions candidate
     where candidate.object_id = object.id
       and candidate.content_hash = encode(
         extensions.digest(
           convert_to(coalesce(object_item->>'content', ''), 'UTF8'),
           'sha256'
         ),
         'hex'
       )
     order by candidate.version_number desc
     limit 1
  ) version on true
  on conflict (source_version_id, object_id)
  do nothing;

  select count(*)::integer
    into linked_count
    from public.kb_source_version_objects membership
   where membership.source_version_id = target_source_version_id;

  if linked_count <> requested_count then
    raise exception
      'Source membership validation failed: expected %, linked %',
      requested_count,
      linked_count;
  end if;
  return ingest_result || jsonb_build_object('linkedObjects', linked_count);
end;
$$;

create or replace function public.publish_knowledge_source(
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_record public.kb_sources%rowtype;
  target_source_version_id uuid;
  published_objects integer;
begin
  if current_user_id is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;
  select *
    into source_record
    from public.kb_sources
   where id = p_source_id
   for update;

  if source_record.id is null
     or not public.is_workspace_member(source_record.workspace_id) then
    raise exception 'Knowledge source not found';
  end if;
  if source_record.ingestion_status <> 'ready' then
    raise exception 'Only ready knowledge sources can be published';
  end if;

  select version.id
    into target_source_version_id
    from public.kb_source_versions version
   where version.source_id = p_source_id
     and version.version_number = source_record.latest_version;

  if target_source_version_id is null then
    raise exception 'Latest source version could not be found';
  end if;

  update public.kb_sources
     set publication_status = 'published',
         published_version_id = target_source_version_id
   where id = p_source_id;

  update public.kb_objects object
     set publication_status = 'archived',
         published_version_id = null,
         published_source_version_id = null,
         published_object_type = null,
         published_name = null,
         published_normalized_name = null
   where object.workspace_id = source_record.workspace_id
     and object.primary_source_id = p_source_id
     and not exists (
       select 1
         from public.kb_source_version_objects membership
        where membership.source_version_id = target_source_version_id
          and membership.object_id = object.id
     );

  update public.kb_objects object
     set publication_status = 'published',
         published_version_id = membership.object_version_id,
         published_source_version_id = target_source_version_id,
         published_object_type = object.object_type,
         published_name = object.name,
         published_normalized_name = object.normalized_name
    from public.kb_source_version_objects membership
   where membership.source_version_id = target_source_version_id
     and membership.object_id = object.id
     and membership.workspace_id = source_record.workspace_id;
  get diagnostics published_objects = row_count;

  update public.kb_relations relation
     set active = relation.source_version_id = target_source_version_id
   where relation.source_version_id in (
     select version.id
       from public.kb_source_versions version
      where version.source_id = p_source_id
   );

  return jsonb_build_object(
    'sourceId', p_source_id,
    'sourceVersionId', target_source_version_id,
    'publicationStatus', 'published',
    'objects', published_objects
  );
end;
$$;

create or replace function public.search_knowledge_catalog(
  p_workspace_id text,
  p_query text,
  p_object_types text[] default null,
  p_limit integer default 8
)
returns table (
  object_id uuid,
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  source_id uuid,
  source_name text,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      obj.id as object_id,
      obj.canonical_key,
      obj.published_object_type as object_type,
      obj.published_name as object_name,
      ver.title,
      ver.summary,
      ver.content,
      src.id as source_id,
      src.name as source_name,
      greatest(
        case when upper(obj.canonical_key) = upper(trim(p_query)) then 1.0 else 0.0 end,
        case when obj.published_normalized_name = upper(trim(p_query)) then 0.98 else 0.0 end,
        case when upper(obj.canonical_key) like upper(trim(p_query)) || '%' then 0.9 else 0.0 end,
        case when obj.published_normalized_name like upper(trim(p_query)) || '%' then 0.88 else 0.0 end,
        extensions.similarity(obj.canonical_key, trim(p_query)) * 0.78,
        extensions.similarity(obj.published_normalized_name, upper(trim(p_query))) * 0.76,
        case
          when ver.search_document @@ websearch_to_tsquery('simple'::regconfig, trim(p_query))
          then 0.72
          else 0.0
        end
      )::double precision as score
    from public.kb_objects obj
    join public.kb_object_versions ver
      on ver.id = obj.published_version_id
    join public.kb_source_versions published_source_version
      on published_source_version.id = obj.published_source_version_id
    join public.kb_sources src
      on src.id = published_source_version.source_id
    where obj.workspace_id = p_workspace_id
      and public.is_workspace_member(p_workspace_id)
      and obj.publication_status = 'published'
      and src.publication_status = 'published'
      and src.published_version_id = published_source_version.id
      and trim(p_query) <> ''
      and (
        p_object_types is null
        or obj.published_object_type = any(p_object_types)
      )
  )
  select
    ranked.object_id,
    ranked.canonical_key,
    ranked.object_type,
    ranked.object_name,
    ranked.title,
    ranked.summary,
    ranked.content,
    ranked.source_id,
    ranked.source_name,
    ranked.score
  from ranked
  where ranked.score >= 0.18
  order by ranked.score desc, ranked.canonical_key
  limit greatest(1, least(p_limit, 20));
$$;

create or replace function public.get_abap_source(
  p_workspace_id text,
  p_canonical_key text
)
returns table (
  canonical_key text,
  object_type text,
  object_name text,
  content text,
  source_name text,
  version_number integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    obj.canonical_key,
    obj.published_object_type,
    obj.published_name,
    ver.content,
    src.name,
    ver.version_number
  from public.kb_objects obj
  join public.kb_object_versions ver
    on ver.id = obj.published_version_id
  join public.kb_source_versions published_source_version
    on published_source_version.id = obj.published_source_version_id
  join public.kb_sources src
    on src.id = published_source_version.source_id
  where obj.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and obj.canonical_key = lower(trim(p_canonical_key))
    and obj.published_object_type in ('class', 'method', 'function')
    and obj.publication_status = 'published'
    and src.publication_status = 'published'
    and src.published_version_id = published_source_version.id
  limit 1;
$$;

revoke all on function public.publish_knowledge_source(uuid)
from public, anon;
grant execute on function public.publish_knowledge_source(uuid)
to authenticated, service_role;

revoke all on function public.ingest_knowledge_catalog(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.ingest_knowledge_catalog(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

revoke all on function public.search_knowledge_catalog(text, text, text[], integer)
from public, anon;
grant execute on function public.search_knowledge_catalog(text, text, text[], integer)
to authenticated, service_role;

revoke all on function public.get_abap_source(text, text)
from public, anon;
grant execute on function public.get_abap_source(text, text)
to authenticated, service_role;

revoke insert, update, delete on table
  public.kb_sources,
  public.kb_source_versions,
  public.kb_objects,
  public.kb_object_versions,
  public.kb_relations,
  public.kb_chunks,
  public.kb_ingestion_jobs
from authenticated;

grant select on table
  public.kb_sources,
  public.kb_source_versions,
  public.kb_objects,
  public.kb_object_versions,
  public.kb_relations,
  public.kb_chunks,
  public.kb_ingestion_jobs
to authenticated;
