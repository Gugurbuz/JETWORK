create extension if not exists pg_trgm with schema extensions;

create table public.kb_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 240),
  media_type text not null,
  source_kind text not null default 'uploaded_file'
    check (source_kind in ('uploaded_file', 'pasted_text', 'manual')),
  storage_bucket text not null default 'knowledge-sources',
  storage_path text not null,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending', 'processing', 'ready', 'failed')),
  latest_version integer not null default 0 check (latest_version >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, storage_path)
);

create table public.kb_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.kb_sources(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  raw_text text not null,
  parser_version text not null,
  document_type text not null,
  object_count integer not null default 0 check (object_count >= 0),
  relation_count integer not null default 0 check (relation_count >= 0),
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (source_id, version_number),
  unique (source_id, content_hash)
);

create table public.kb_objects (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  canonical_key text not null check (char_length(canonical_key) between 3 and 320),
  object_type text not null check (
    object_type in (
      'class', 'method', 'function', 'message', 'table',
      'document', 'business_rule', 'interface', 'unknown'
    )
  ),
  name text not null check (char_length(name) between 1 and 240),
  normalized_name text not null,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  latest_version integer not null default 0 check (latest_version >= 0),
  primary_source_id uuid references public.kb_sources(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, canonical_key)
);

create table public.kb_object_versions (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.kb_objects(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  title text not null,
  summary text,
  content text not null,
  is_current boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  search_document tsvector generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  unique (object_id, version_number)
);

create table public.kb_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  source_canonical_key text not null,
  source_object_id uuid references public.kb_objects(id) on delete cascade,
  relation_type text not null check (
    relation_type in (
      'CONTAINS', 'CALLS', 'READS', 'WRITES', 'EMITS_MESSAGE',
      'EXTENDS', 'IMPLEMENTS', 'DOCUMENTS', 'RELATES_TO'
    )
  ),
  target_canonical_key text not null,
  target_object_id uuid references public.kb_objects(id) on delete set null,
  evidence text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (
    source_version_id,
    source_canonical_key,
    relation_type,
    target_canonical_key
  )
);

create table public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  source_version_id uuid not null references public.kb_source_versions(id) on delete cascade,
  object_version_id uuid references public.kb_object_versions(id) on delete cascade,
  chunk_index integer not null default 0 check (chunk_index >= 0),
  content text not null,
  embedding vector(768),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (object_version_id, chunk_index)
);

create table public.kb_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  source_id uuid references public.kb_sources(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  phase text not null default 'queued',
  error_message text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index kb_sources_workspace_status_idx
  on public.kb_sources (workspace_id, publication_status, updated_at desc);
create index kb_source_versions_workspace_idx
  on public.kb_source_versions (workspace_id, created_at desc);
create index kb_objects_workspace_type_idx
  on public.kb_objects (workspace_id, object_type, publication_status);
create index kb_objects_canonical_trgm_idx
  on public.kb_objects using gin (canonical_key extensions.gin_trgm_ops);
create index kb_objects_name_trgm_idx
  on public.kb_objects using gin (normalized_name extensions.gin_trgm_ops);
create index kb_object_versions_search_idx
  on public.kb_object_versions using gin (search_document);
create index kb_relations_source_idx
  on public.kb_relations (workspace_id, source_canonical_key, relation_type)
  where active;
create index kb_relations_target_idx
  on public.kb_relations (workspace_id, target_canonical_key, relation_type)
  where active;
create index kb_chunks_embedding_idx
  on public.kb_chunks using hnsw (embedding vector_cosine_ops);
create index kb_ingestion_jobs_workspace_idx
  on public.kb_ingestion_jobs (workspace_id, created_at desc);

create trigger set_kb_sources_updated_at
before update on public.kb_sources
for each row execute function public.set_jetwork_updated_at();

create trigger set_kb_objects_updated_at
before update on public.kb_objects
for each row execute function public.set_jetwork_updated_at();

alter table public.kb_sources enable row level security;
alter table public.kb_source_versions enable row level security;
alter table public.kb_objects enable row level security;
alter table public.kb_object_versions enable row level security;
alter table public.kb_relations enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.kb_ingestion_jobs enable row level security;

revoke all on table
  public.kb_sources,
  public.kb_source_versions,
  public.kb_objects,
  public.kb_object_versions,
  public.kb_relations,
  public.kb_chunks,
  public.kb_ingestion_jobs
from anon;

grant select, insert, update, delete on table
  public.kb_sources,
  public.kb_source_versions,
  public.kb_objects,
  public.kb_object_versions,
  public.kb_relations,
  public.kb_chunks,
  public.kb_ingestion_jobs
to authenticated;

grant all on table
  public.kb_sources,
  public.kb_source_versions,
  public.kb_objects,
  public.kb_object_versions,
  public.kb_relations,
  public.kb_chunks,
  public.kb_ingestion_jobs
to service_role;

create policy "Workspace members can read knowledge sources"
on public.kb_sources for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create their knowledge sources"
on public.kb_sources for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can update knowledge sources"
on public.kb_sources for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Source owners can delete knowledge sources"
on public.kb_sources for delete to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can read knowledge source versions"
on public.kb_source_versions for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create knowledge source versions"
on public.kb_source_versions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can update knowledge source versions"
on public.kb_source_versions for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete knowledge source versions"
on public.kb_source_versions for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read knowledge objects"
on public.kb_objects for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create knowledge objects"
on public.kb_objects for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update knowledge objects"
on public.kb_objects for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete knowledge objects"
on public.kb_objects for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read knowledge object versions"
on public.kb_object_versions for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create knowledge object versions"
on public.kb_object_versions for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update knowledge object versions"
on public.kb_object_versions for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete knowledge object versions"
on public.kb_object_versions for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read knowledge relations"
on public.kb_relations for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create knowledge relations"
on public.kb_relations for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update knowledge relations"
on public.kb_relations for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete knowledge relations"
on public.kb_relations for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read knowledge chunks"
on public.kb_chunks for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can create knowledge chunks"
on public.kb_chunks for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can update knowledge chunks"
on public.kb_chunks for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy "Workspace members can delete knowledge chunks"
on public.kb_chunks for delete to authenticated
using (public.is_workspace_member(workspace_id));

create policy "Workspace members can read their ingestion jobs"
on public.kb_ingestion_jobs for select to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can create their ingestion jobs"
on public.kb_ingestion_jobs for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can update their ingestion jobs"
on public.kb_ingestion_jobs for update to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
)
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

create policy "Workspace members can delete their ingestion jobs"
on public.kb_ingestion_jobs for delete to authenticated
using (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'knowledge-sources',
  'knowledge-sources',
  false,
  5242880,
  array['text/plain', 'text/markdown']::text[]
)
on conflict (id) do nothing;

create policy "Workspace members can read private knowledge files"
on storage.objects for select to authenticated
using (
  bucket_id = 'knowledge-sources'
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Workspace members can upload private knowledge files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'knowledge-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Upload owners can update private knowledge files"
on storage.objects for update to authenticated
using (
  bucket_id = 'knowledge-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
)
with check (
  bucket_id = 'knowledge-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Upload owners can delete private knowledge files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'knowledge-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

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
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_record public.kb_sources%rowtype;
  source_version_id uuid;
  next_source_version integer;
  object_item jsonb;
  relation_item jsonb;
  object_record public.kb_objects%rowtype;
  object_version_id uuid;
  next_object_version integer;
  object_content text;
  object_content_hash text;
  source_object_id uuid;
  target_object_id uuid;
  inserted_objects integer := 0;
  inserted_relations integer := 0;
  existing_version_id uuid;
begin
  if current_user_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied';
  end if;
  if split_part(p_storage_path, '/', 1) <> current_user_id::text
     or split_part(p_storage_path, '/', 2) <> p_workspace_id then
    raise exception 'Storage path is outside the authenticated workspace scope';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid content hash';
  end if;
  if octet_length(p_raw_text) > 5242880 then
    raise exception 'Source text exceeds the 5 MB limit';
  end if;
  if jsonb_typeof(p_objects) <> 'array'
     or jsonb_array_length(p_objects) = 0
     or jsonb_array_length(p_objects) > 2000 then
    raise exception 'Parsed object collection is invalid';
  end if;
  if jsonb_typeof(p_relations) <> 'array'
     or jsonb_array_length(p_relations) > 10000 then
    raise exception 'Parsed relation collection is invalid';
  end if;

  select *
    into source_record
    from public.kb_sources
   where workspace_id = p_workspace_id
     and storage_path = p_storage_path
   for update;

  if source_record.id is null then
    insert into public.kb_sources (
      workspace_id,
      owner_id,
      name,
      media_type,
      storage_path,
      ingestion_status,
      metadata
    )
    values (
      p_workspace_id,
      current_user_id,
      left(p_file_name, 240),
      p_mime_type,
      p_storage_path,
      'processing',
      jsonb_build_object('documentType', p_document_type)
    )
    returning * into source_record;
  else
    update public.kb_sources
       set name = left(p_file_name, 240),
           media_type = p_mime_type,
           ingestion_status = 'processing',
           metadata = metadata || jsonb_build_object('documentType', p_document_type)
     where id = source_record.id
     returning * into source_record;
  end if;

  select id
    into existing_version_id
    from public.kb_source_versions
   where source_id = source_record.id
     and content_hash = p_content_hash;

  if existing_version_id is not null then
    update public.kb_sources
       set ingestion_status = 'ready'
     where id = source_record.id;
    update public.kb_ingestion_jobs
       set source_id = source_record.id,
           status = 'completed',
           phase = 'deduplicated',
           stats = jsonb_build_object('deduplicated', true),
           completed_at = now()
     where id = p_job_id
       and owner_id = current_user_id;
    return jsonb_build_object(
      'sourceId', source_record.id,
      'sourceVersionId', existing_version_id,
      'deduplicated', true,
      'publicationStatus', source_record.publication_status
    );
  end if;

  next_source_version := source_record.latest_version + 1;
  insert into public.kb_source_versions (
    source_id,
    workspace_id,
    version_number,
    content_hash,
    raw_text,
    parser_version,
    document_type,
    warnings,
    created_by
  )
  values (
    source_record.id,
    p_workspace_id,
    next_source_version,
    p_content_hash,
    p_raw_text,
    p_parser_version,
    p_document_type,
    coalesce(p_warnings, '[]'::jsonb),
    current_user_id
  )
  returning id into source_version_id;

  for object_item in select value from jsonb_array_elements(p_objects)
  loop
    if coalesce(object_item->>'canonicalKey', '') = ''
       or coalesce(object_item->>'name', '') = ''
       or coalesce(object_item->>'objectType', '') = '' then
      raise exception 'Parsed object is missing a required identity field';
    end if;

    object_content := coalesce(object_item->>'content', '');
    object_content_hash := encode(
      extensions.digest(convert_to(object_content, 'UTF8'), 'sha256'),
      'hex'
    );

    select *
      into object_record
      from public.kb_objects
     where workspace_id = p_workspace_id
       and canonical_key = object_item->>'canonicalKey'
     for update;

    if object_record.id is null then
      insert into public.kb_objects (
        workspace_id,
        canonical_key,
        object_type,
        name,
        normalized_name,
        primary_source_id,
        metadata
      )
      values (
        p_workspace_id,
        left(object_item->>'canonicalKey', 320),
        object_item->>'objectType',
        left(object_item->>'name', 240),
        upper(left(object_item->>'name', 240)),
        source_record.id,
        coalesce(object_item->'metadata', '{}'::jsonb)
      )
      returning * into object_record;
    else
      update public.kb_objects
         set object_type = object_item->>'objectType',
             name = left(object_item->>'name', 240),
             normalized_name = upper(left(object_item->>'name', 240)),
             primary_source_id = source_record.id,
             metadata = metadata || coalesce(object_item->'metadata', '{}'::jsonb)
       where id = object_record.id
       returning * into object_record;
    end if;

    select id
      into object_version_id
      from public.kb_object_versions
     where object_id = object_record.id
       and content_hash = object_content_hash
     order by version_number desc
     limit 1;

    if object_version_id is null then
      next_object_version := object_record.latest_version + 1;
      update public.kb_object_versions
         set is_current = false
       where object_id = object_record.id
         and is_current;

      insert into public.kb_object_versions (
        object_id,
        workspace_id,
        source_version_id,
        version_number,
        content_hash,
        title,
        summary,
        content,
        metadata
      )
      values (
        object_record.id,
        p_workspace_id,
        source_version_id,
        next_object_version,
        object_content_hash,
        left(coalesce(object_item->>'title', object_item->>'name'), 500),
        nullif(left(coalesce(object_item->>'summary', ''), 2000), ''),
        object_content,
        coalesce(object_item->'metadata', '{}'::jsonb)
      )
      returning id into object_version_id;

      insert into public.kb_chunks (
        workspace_id,
        source_version_id,
        object_version_id,
        chunk_index,
        content,
        metadata
      )
      values (
        p_workspace_id,
        source_version_id,
        object_version_id,
        0,
        object_content,
        jsonb_build_object('canonicalKey', object_item->>'canonicalKey')
      );

      update public.kb_objects
         set latest_version = next_object_version
       where id = object_record.id;
      inserted_objects := inserted_objects + 1;
    end if;
  end loop;

  for relation_item in select value from jsonb_array_elements(p_relations)
  loop
    select id into source_object_id
      from public.kb_objects
     where workspace_id = p_workspace_id
       and canonical_key = relation_item->>'sourceCanonicalKey';
    select id into target_object_id
      from public.kb_objects
     where workspace_id = p_workspace_id
       and canonical_key = relation_item->>'targetCanonicalKey';

    insert into public.kb_relations (
      workspace_id,
      source_version_id,
      source_canonical_key,
      source_object_id,
      relation_type,
      target_canonical_key,
      target_object_id,
      evidence,
      metadata
    )
    values (
      p_workspace_id,
      source_version_id,
      relation_item->>'sourceCanonicalKey',
      source_object_id,
      relation_item->>'relationType',
      relation_item->>'targetCanonicalKey',
      target_object_id,
      nullif(left(coalesce(relation_item->>'evidence', ''), 2000), ''),
      coalesce(relation_item->'metadata', '{}'::jsonb)
    )
    on conflict do nothing;
    if found then
      inserted_relations := inserted_relations + 1;
    end if;
  end loop;

  update public.kb_source_versions
     set object_count = inserted_objects,
         relation_count = inserted_relations
   where id = source_version_id;

  update public.kb_sources
     set latest_version = next_source_version,
         ingestion_status = 'ready'
   where id = source_record.id;

  update public.kb_ingestion_jobs
     set source_id = source_record.id,
         status = 'completed',
         phase = 'ready_for_review',
         stats = jsonb_build_object(
           'objects', inserted_objects,
           'relations', inserted_relations,
           'deduplicated', false
         ),
         completed_at = now()
   where id = p_job_id
     and owner_id = current_user_id;

  return jsonb_build_object(
    'sourceId', source_record.id,
    'sourceVersionId', source_version_id,
    'objects', inserted_objects,
    'relations', inserted_relations,
    'deduplicated', false,
    'publicationStatus', source_record.publication_status
  );
end;
$$;

create or replace function public.publish_knowledge_source(
  p_source_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_record public.kb_sources%rowtype;
  published_objects integer;
begin
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

  update public.kb_sources
     set publication_status = 'published'
   where id = p_source_id;

  update public.kb_objects
     set publication_status = 'published'
   where workspace_id = source_record.workspace_id
     and primary_source_id = p_source_id;
  get diagnostics published_objects = row_count;

  return jsonb_build_object(
    'sourceId', p_source_id,
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
      obj.object_type,
      obj.name as object_name,
      ver.title,
      ver.summary,
      ver.content,
      src.id as source_id,
      src.name as source_name,
      greatest(
        case when upper(obj.canonical_key) = upper(trim(p_query)) then 1.0 else 0.0 end,
        case when obj.normalized_name = upper(trim(p_query)) then 0.98 else 0.0 end,
        case when upper(obj.canonical_key) like upper(trim(p_query)) || '%' then 0.9 else 0.0 end,
        case when obj.normalized_name like upper(trim(p_query)) || '%' then 0.88 else 0.0 end,
        extensions.similarity(obj.canonical_key, trim(p_query)) * 0.78,
        extensions.similarity(obj.normalized_name, upper(trim(p_query))) * 0.76,
        case
          when ver.search_document @@ websearch_to_tsquery('simple'::regconfig, trim(p_query))
          then 0.72
          else 0.0
        end
      )::double precision as score
    from public.kb_objects obj
    join public.kb_object_versions ver
      on ver.object_id = obj.id
     and ver.is_current
    join public.kb_sources src
      on src.id = obj.primary_source_id
    where obj.workspace_id = p_workspace_id
      and public.is_workspace_member(p_workspace_id)
      and obj.publication_status = 'published'
      and src.publication_status = 'published'
      and trim(p_query) <> ''
      and (
        p_object_types is null
        or obj.object_type = any(p_object_types)
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
    obj.object_type,
    obj.name,
    ver.content,
    src.name,
    ver.version_number
  from public.kb_objects obj
  join public.kb_object_versions ver
    on ver.object_id = obj.id
   and ver.is_current
  join public.kb_sources src
    on src.id = obj.primary_source_id
  where obj.workspace_id = p_workspace_id
    and public.is_workspace_member(p_workspace_id)
    and obj.canonical_key = lower(trim(p_canonical_key))
    and obj.object_type in ('class', 'method', 'function')
    and obj.publication_status = 'published'
    and src.publication_status = 'published'
  limit 1;
$$;

revoke all on function public.ingest_knowledge_catalog(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.ingest_knowledge_catalog(
  uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

revoke all on function public.publish_knowledge_source(uuid) from public, anon;
grant execute on function public.publish_knowledge_source(uuid)
to authenticated, service_role;

revoke all on function public.search_knowledge_catalog(text, text, text[], integer)
from public, anon;
grant execute on function public.search_knowledge_catalog(text, text, text[], integer)
to authenticated, service_role;

revoke all on function public.get_abap_source(text, text) from public, anon;
grant execute on function public.get_abap_source(text, text)
to authenticated, service_role;
