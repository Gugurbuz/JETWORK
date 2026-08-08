-- Knowledge Architecture v2
-- Global JetWork knowledge is independent from projects/workspaces.
-- Project knowledge is scoped to a project, never to an individual workspace.

create table if not exists public.knowledge_spaces (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('global', 'project')),
  project_id text references public.projects(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope_type = 'global' and project_id is null)
    or (scope_type = 'project' and project_id is not null)
  )
);

create unique index if not exists knowledge_spaces_single_global_idx
  on public.knowledge_spaces ((scope_type))
  where scope_type = 'global';
create unique index if not exists knowledge_spaces_project_idx
  on public.knowledge_spaces (project_id)
  where scope_type = 'project';

insert into public.knowledge_spaces (scope_type, project_id, name)
select 'global', null, 'JetWork Bilgi Bankası'
where not exists (
  select 1 from public.knowledge_spaces where scope_type = 'global'
);

create table if not exists public.knowledge_sources_v2 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
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
  unique (knowledge_space_id, storage_path)
);

create table if not exists public.knowledge_source_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.knowledge_sources_v2(id) on delete cascade,
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
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

alter table public.knowledge_sources_v2
  add column if not exists published_version_id uuid
    references public.knowledge_source_versions_v2(id) on delete set null;

create table if not exists public.knowledge_objects_v2 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  canonical_key text not null check (char_length(canonical_key) between 3 and 320),
  object_type text not null check (
    object_type in ('class','method','function','message','table','document','business_rule','interface','unknown')
  ),
  name text not null check (char_length(name) between 1 and 240),
  normalized_name text not null,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published', 'archived')),
  latest_version integer not null default 0 check (latest_version >= 0),
  primary_source_id uuid references public.knowledge_sources_v2(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  published_version_id uuid,
  published_source_version_id uuid references public.knowledge_source_versions_v2(id) on delete set null,
  published_object_type text,
  published_name text,
  published_normalized_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_space_id, canonical_key)
);

create table if not exists public.knowledge_object_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references public.knowledge_objects_v2(id) on delete cascade,
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  title text not null,
  summary text,
  content text not null,
  is_current boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (object_id, version_number)
);

alter table public.knowledge_objects_v2
  add constraint knowledge_objects_v2_published_version_fkey
  foreign key (published_version_id)
  references public.knowledge_object_versions_v2(id) on delete set null;

create table if not exists public.knowledge_source_version_objects_v2 (
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  object_id uuid not null references public.knowledge_objects_v2(id) on delete cascade,
  object_version_id uuid not null references public.knowledge_object_versions_v2(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_version_id, object_id),
  unique (source_version_id, object_version_id)
);

create table if not exists public.knowledge_relations_v2 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  source_canonical_key text not null,
  source_object_id uuid references public.knowledge_objects_v2(id) on delete cascade,
  relation_type text not null check (
    relation_type in ('CONTAINS','CALLS','READS','WRITES','EMITS_MESSAGE','EXTENDS','IMPLEMENTS','DOCUMENTS','RELATES_TO')
  ),
  target_canonical_key text not null,
  target_object_id uuid references public.knowledge_objects_v2(id) on delete set null,
  evidence text,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_version_id, source_canonical_key, relation_type, target_canonical_key)
);

create table if not exists public.knowledge_chunks_v2 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_version_id uuid not null references public.knowledge_source_versions_v2(id) on delete cascade,
  object_version_id uuid references public.knowledge_object_versions_v2(id) on delete cascade,
  chunk_index integer not null default 0 check (chunk_index >= 0),
  content text not null,
  embedding vector(768),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (object_version_id, chunk_index)
);

create table if not exists public.knowledge_ingestion_jobs_v2 (
  id uuid primary key default gen_random_uuid(),
  knowledge_space_id uuid not null references public.knowledge_spaces(id) on delete cascade,
  source_id uuid references public.knowledge_sources_v2(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  phase text not null default 'queued',
  error_message text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists knowledge_sources_v2_space_status_idx
  on public.knowledge_sources_v2 (knowledge_space_id, publication_status, updated_at desc);
create index if not exists knowledge_source_versions_v2_space_idx
  on public.knowledge_source_versions_v2 (knowledge_space_id, created_at desc);
create index if not exists knowledge_objects_v2_space_type_idx
  on public.knowledge_objects_v2 (knowledge_space_id, published_object_type, publication_status);
create index if not exists knowledge_objects_v2_canonical_trgm_idx
  on public.knowledge_objects_v2 using gin (canonical_key extensions.gin_trgm_ops);
create index if not exists knowledge_objects_v2_name_trgm_idx
  on public.knowledge_objects_v2 using gin (published_normalized_name extensions.gin_trgm_ops);
create index if not exists knowledge_object_versions_v2_search_idx
  on public.knowledge_object_versions_v2 using gin (search_document);
create index if not exists knowledge_relations_v2_source_idx
  on public.knowledge_relations_v2 (knowledge_space_id, source_canonical_key, relation_type) where active;
create index if not exists knowledge_relations_v2_target_idx
  on public.knowledge_relations_v2 (knowledge_space_id, target_canonical_key, relation_type) where active;
create index if not exists knowledge_chunks_v2_embedding_idx
  on public.knowledge_chunks_v2 using hnsw (embedding vector_cosine_ops);

create or replace function public.is_project_member_v2(target_project_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = target_project_id
      and p.deleted_at is null
      and (
        p.owner_id = (select auth.uid())
        or exists (
          select 1 from public.workspaces w
          where w.project_id = p.id
            and w.deleted_at is null
            and public.is_workspace_member(w.id)
        )
      )
  );
$$;

create or replace function public.can_read_knowledge_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and not coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false)
    and exists (
      select 1 from public.knowledge_spaces s
      where s.id = target_space_id
        and (
          s.scope_type = 'global'
          or (s.scope_type = 'project' and public.is_project_member_v2(s.project_id))
        )
    );
$$;

create or replace function public.can_write_knowledge_space(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_read_knowledge_space(target_space_id);
$$;

create or replace function public.knowledge_space_type(target_space_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select scope_type from public.knowledge_spaces where id = target_space_id;
$$;

create or replace function public.resolve_knowledge_context(p_workspace_id text)
returns table(global_space_id uuid, project_space_id uuid, project_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_project_id text;
  resolved_global_id uuid;
  resolved_project_id uuid;
begin
  if (select auth.uid()) is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied';
  end if;

  select w.project_id into current_project_id
  from public.workspaces w
  where w.id = p_workspace_id and w.deleted_at is null;

  select s.id into resolved_global_id
  from public.knowledge_spaces s
  where s.scope_type = 'global'
  limit 1;

  if resolved_global_id is null then
    insert into public.knowledge_spaces(scope_type, name, created_by)
    values ('global', 'JetWork Bilgi Bankası', (select auth.uid()))
    returning id into resolved_global_id;
  end if;

  if current_project_id is not null then
    if not public.is_project_member_v2(current_project_id) then
      raise exception 'Project access denied';
    end if;
    insert into public.knowledge_spaces(scope_type, project_id, name, created_by)
    select 'project', p.id, p.name || ' · Proje Bilgisi', (select auth.uid())
    from public.projects p
    where p.id = current_project_id
    on conflict (project_id) where scope_type = 'project' do nothing;

    select s.id into resolved_project_id
    from public.knowledge_spaces s
    where s.scope_type = 'project' and s.project_id = current_project_id;
  end if;

  return query select resolved_global_id, resolved_project_id, current_project_id;
end;
$$;

create or replace function public.resolve_knowledge_space_v2(p_workspace_id text, p_scope_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ctx record;
begin
  if p_scope_type not in ('global','project') then
    raise exception 'Invalid knowledge scope';
  end if;
  select * into ctx from public.resolve_knowledge_context(p_workspace_id);
  if p_scope_type = 'global' then return ctx.global_space_id; end if;
  if ctx.project_space_id is null then raise exception 'This workspace has no project knowledge space'; end if;
  return ctx.project_space_id;
end;
$$;

create or replace function public.ingest_knowledge_catalog_v2(
  p_job_id uuid,
  p_knowledge_space_id uuid,
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
  source_record public.knowledge_sources_v2%rowtype;
  source_version_id uuid;
  next_source_version integer;
  object_item jsonb;
  relation_item jsonb;
  object_record public.knowledge_objects_v2%rowtype;
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
  if current_user_id is null or not public.can_write_knowledge_space(p_knowledge_space_id) then
    raise exception 'Knowledge space access denied';
  end if;
  if split_part(p_storage_path, '/', 1) <> current_user_id::text
     or split_part(p_storage_path, '/', 2) <> p_knowledge_space_id::text then
    raise exception 'Storage path is outside the authenticated knowledge scope';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid content hash'; end if;
  if octet_length(p_raw_text) > 5242880 then raise exception 'Source text exceeds the 5 MB limit'; end if;
  if jsonb_typeof(p_objects) <> 'array' or jsonb_array_length(p_objects) = 0 or jsonb_array_length(p_objects) > 2000 then
    raise exception 'Parsed object collection is invalid';
  end if;
  if jsonb_typeof(p_relations) <> 'array' or jsonb_array_length(p_relations) > 10000 then
    raise exception 'Parsed relation collection is invalid';
  end if;
  if not exists (
    select 1 from public.knowledge_ingestion_jobs_v2 j
    where j.id = p_job_id and j.knowledge_space_id = p_knowledge_space_id and j.owner_id = current_user_id
  ) then raise exception 'Ingestion job access denied'; end if;

  select * into source_record
  from public.knowledge_sources_v2
  where knowledge_space_id = p_knowledge_space_id and storage_path = p_storage_path
  for update;

  if source_record.id is null then
    insert into public.knowledge_sources_v2(
      knowledge_space_id, owner_id, name, media_type, storage_path, ingestion_status, metadata
    ) values (
      p_knowledge_space_id, current_user_id, left(p_file_name,240), p_mime_type, p_storage_path,
      'processing', jsonb_build_object('documentType', p_document_type)
    ) returning * into source_record;
  else
    update public.knowledge_sources_v2
    set name=left(p_file_name,240), media_type=p_mime_type, ingestion_status='processing',
        metadata=metadata || jsonb_build_object('documentType', p_document_type), updated_at=now()
    where id=source_record.id returning * into source_record;
  end if;

  select id into existing_version_id
  from public.knowledge_source_versions_v2
  where source_id=source_record.id and content_hash=p_content_hash;

  if existing_version_id is not null then
    update public.knowledge_sources_v2 set ingestion_status='ready', updated_at=now() where id=source_record.id;
    update public.knowledge_ingestion_jobs_v2
    set source_id=source_record.id,status='completed',phase='deduplicated',stats=jsonb_build_object('deduplicated',true),completed_at=now()
    where id=p_job_id and owner_id=current_user_id;
    return jsonb_build_object('sourceId',source_record.id,'sourceVersionId',existing_version_id,'deduplicated',true,'publicationStatus',source_record.publication_status);
  end if;

  next_source_version := source_record.latest_version + 1;
  insert into public.knowledge_source_versions_v2(
    source_id,knowledge_space_id,version_number,content_hash,raw_text,parser_version,document_type,warnings,created_by
  ) values (
    source_record.id,p_knowledge_space_id,next_source_version,p_content_hash,p_raw_text,p_parser_version,p_document_type,coalesce(p_warnings,'[]'::jsonb),current_user_id
  ) returning id into source_version_id;

  for object_item in select value from jsonb_array_elements(p_objects)
  loop
    if coalesce(object_item->>'canonicalKey','')='' or coalesce(object_item->>'name','')='' or coalesce(object_item->>'objectType','')='' then
      raise exception 'Parsed object is missing a required identity field';
    end if;
    object_content := coalesce(object_item->>'content','');
    object_content_hash := encode(extensions.digest(convert_to(object_content,'UTF8'),'sha256'),'hex');

    select * into object_record from public.knowledge_objects_v2
    where knowledge_space_id=p_knowledge_space_id and canonical_key=object_item->>'canonicalKey'
    for update;

    if object_record.id is null then
      insert into public.knowledge_objects_v2(
        knowledge_space_id,canonical_key,object_type,name,normalized_name,primary_source_id,metadata
      ) values (
        p_knowledge_space_id,left(object_item->>'canonicalKey',320),object_item->>'objectType',left(object_item->>'name',240),
        upper(left(object_item->>'name',240)),source_record.id,coalesce(object_item->'metadata','{}'::jsonb)
      ) returning * into object_record;
    else
      update public.knowledge_objects_v2
      set object_type=object_item->>'objectType',name=left(object_item->>'name',240),normalized_name=upper(left(object_item->>'name',240)),
          primary_source_id=source_record.id,metadata=metadata || coalesce(object_item->'metadata','{}'::jsonb),updated_at=now()
      where id=object_record.id returning * into object_record;
    end if;

    select id into object_version_id from public.knowledge_object_versions_v2
    where object_id=object_record.id and content_hash=object_content_hash
    order by version_number desc limit 1;

    if object_version_id is null then
      next_object_version := object_record.latest_version + 1;
      update public.knowledge_object_versions_v2 set is_current=false where object_id=object_record.id and is_current;
      insert into public.knowledge_object_versions_v2(
        object_id,knowledge_space_id,source_version_id,version_number,content_hash,title,summary,content,metadata
      ) values (
        object_record.id,p_knowledge_space_id,source_version_id,next_object_version,object_content_hash,
        left(coalesce(object_item->>'title',object_item->>'name'),500),nullif(left(coalesce(object_item->>'summary',''),2000),''),
        object_content,coalesce(object_item->'metadata','{}'::jsonb)
      ) returning id into object_version_id;
      insert into public.knowledge_chunks_v2(knowledge_space_id,source_version_id,object_version_id,chunk_index,content,metadata)
      values (p_knowledge_space_id,source_version_id,object_version_id,0,object_content,jsonb_build_object('canonicalKey',object_item->>'canonicalKey'));
      update public.knowledge_objects_v2 set latest_version=next_object_version where id=object_record.id;
      inserted_objects := inserted_objects + 1;
    end if;

    insert into public.knowledge_source_version_objects_v2(source_version_id,knowledge_space_id,object_id,object_version_id)
    values (source_version_id,p_knowledge_space_id,object_record.id,object_version_id)
    on conflict (source_version_id,object_id) do update set object_version_id=excluded.object_version_id;
  end loop;

  for relation_item in select value from jsonb_array_elements(p_relations)
  loop
    select id into source_object_id from public.knowledge_objects_v2
    where knowledge_space_id=p_knowledge_space_id and canonical_key=relation_item->>'sourceCanonicalKey';
    select id into target_object_id from public.knowledge_objects_v2
    where knowledge_space_id=p_knowledge_space_id and canonical_key=relation_item->>'targetCanonicalKey';
    insert into public.knowledge_relations_v2(
      knowledge_space_id,source_version_id,source_canonical_key,source_object_id,relation_type,target_canonical_key,target_object_id,evidence,metadata
    ) values (
      p_knowledge_space_id,source_version_id,relation_item->>'sourceCanonicalKey',source_object_id,relation_item->>'relationType',
      relation_item->>'targetCanonicalKey',target_object_id,nullif(left(coalesce(relation_item->>'evidence',''),2000),''),coalesce(relation_item->'metadata','{}'::jsonb)
    ) on conflict do nothing;
    if found then inserted_relations := inserted_relations + 1; end if;
  end loop;

  update public.knowledge_source_versions_v2 set object_count=inserted_objects,relation_count=inserted_relations where id=source_version_id;
  update public.knowledge_sources_v2 set latest_version=next_source_version,ingestion_status='ready',updated_at=now() where id=source_record.id;
  update public.knowledge_ingestion_jobs_v2
  set source_id=source_record.id,status='completed',phase='ready_for_review',
      stats=jsonb_build_object('objects',inserted_objects,'relations',inserted_relations,'deduplicated',false),completed_at=now()
  where id=p_job_id and owner_id=current_user_id;

  return jsonb_build_object('sourceId',source_record.id,'sourceVersionId',source_version_id,'objects',inserted_objects,'relations',inserted_relations,'deduplicated',false,'publicationStatus',source_record.publication_status);
end;
$$;

create or replace function public.publish_knowledge_source_v2(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  source_record public.knowledge_sources_v2%rowtype;
  target_source_version_id uuid;
  published_objects integer;
begin
  select * into source_record from public.knowledge_sources_v2 where id=p_source_id for update;
  if source_record.id is null or source_record.owner_id <> current_user_id or not public.can_write_knowledge_space(source_record.knowledge_space_id) then
    raise exception 'Knowledge source not found or not manageable';
  end if;
  if source_record.ingestion_status <> 'ready' then raise exception 'Only ready knowledge sources can be published'; end if;
  select id into target_source_version_id from public.knowledge_source_versions_v2
  where source_id=p_source_id and version_number=source_record.latest_version;
  if target_source_version_id is null then raise exception 'Latest source version could not be found'; end if;

  update public.knowledge_sources_v2
  set publication_status='published',published_version_id=target_source_version_id,updated_at=now()
  where id=p_source_id;

  update public.knowledge_objects_v2 o
  set publication_status='archived',published_version_id=null,published_source_version_id=null,
      published_object_type=null,published_name=null,published_normalized_name=null,updated_at=now()
  where o.knowledge_space_id=source_record.knowledge_space_id and o.primary_source_id=p_source_id
    and not exists (
      select 1 from public.knowledge_source_version_objects_v2 m
      where m.source_version_id=target_source_version_id and m.object_id=o.id
    );

  update public.knowledge_objects_v2 o
  set publication_status='published',published_version_id=m.object_version_id,published_source_version_id=target_source_version_id,
      published_object_type=o.object_type,published_name=o.name,published_normalized_name=o.normalized_name,updated_at=now()
  from public.knowledge_source_version_objects_v2 m
  where m.source_version_id=target_source_version_id and m.object_id=o.id and m.knowledge_space_id=source_record.knowledge_space_id;
  get diagnostics published_objects = row_count;

  update public.knowledge_relations_v2 r
  set active=(r.source_version_id=target_source_version_id)
  where r.source_version_id in (select id from public.knowledge_source_versions_v2 where source_id=p_source_id);

  return jsonb_build_object('sourceId',p_source_id,'sourceVersionId',target_source_version_id,'publicationStatus','published','objects',published_objects);
end;
$$;

create or replace function public.search_knowledge_catalog_v2(
  p_workspace_id text,
  p_query text,
  p_object_types text[] default null,
  p_limit integer default 8
)
returns table(
  object_id uuid, canonical_key text, object_type text, object_name text,
  title text, summary text, content text, source_id uuid, source_name text,
  scope_type text, score double precision
)
language sql
volatile
security definer
set search_path = ''
as $$
  with ctx as (select * from public.resolve_knowledge_context(p_workspace_id)),
  spaces as (
    select global_space_id as id, 'global'::text as scope_type, 0.0::double precision as scope_bonus from ctx
    union all
    select project_space_id, 'project'::text, 0.08::double precision from ctx where project_space_id is not null
  ), ranked as (
    select o.id object_id,o.canonical_key,o.published_object_type object_type,o.published_name object_name,
           v.title,v.summary,v.content,s.id source_id,s.name source_name,sp.scope_type,
           least(1.0, greatest(
             case when upper(o.canonical_key)=upper(trim(p_query)) then 1.0 else 0.0 end,
             case when o.published_normalized_name=upper(trim(p_query)) then 0.98 else 0.0 end,
             case when upper(o.canonical_key) like upper(trim(p_query))||'%' then 0.9 else 0.0 end,
             case when o.published_normalized_name like upper(trim(p_query))||'%' then 0.88 else 0.0 end,
             extensions.similarity(o.canonical_key,trim(p_query))*0.78,
             extensions.similarity(o.published_normalized_name,upper(trim(p_query)))*0.76,
             case when v.search_document @@ websearch_to_tsquery('simple'::regconfig,trim(p_query)) then 0.72 else 0.0 end
           ) + sp.scope_bonus)::double precision score
    from spaces sp
    join public.knowledge_objects_v2 o on o.knowledge_space_id=sp.id
    join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
    join public.knowledge_source_versions_v2 sv on sv.id=o.published_source_version_id
    join public.knowledge_sources_v2 s on s.id=sv.source_id
    where o.publication_status='published' and s.publication_status='published'
      and s.published_version_id=sv.id and trim(p_query)<>''
      and (p_object_types is null or o.published_object_type=any(p_object_types))
  )
  select * from ranked where ranked.score>=0.18
  order by ranked.score desc, case when ranked.scope_type='project' then 0 else 1 end, ranked.canonical_key
  limit greatest(1,least(p_limit,20));
$$;

create or replace function public.get_knowledge_object_v2(
  p_workspace_id text,
  p_canonical_key text,
  p_object_types text[] default null
)
returns table(
  canonical_key text, object_type text, object_name text, title text, summary text, content text,
  version_number integer, source_id uuid, source_name text, scope_type text
)
language sql
volatile
security definer
set search_path = ''
as $$
  with ctx as (select * from public.resolve_knowledge_context(p_workspace_id)),
  spaces as (
    select project_space_id id,'project'::text scope_type,0 priority from ctx where project_space_id is not null
    union all select global_space_id,'global'::text,1 from ctx
  )
  select o.canonical_key,o.published_object_type,o.published_name,v.title,v.summary,v.content,v.version_number,s.id,s.name,sp.scope_type
  from spaces sp
  join public.knowledge_objects_v2 o on o.knowledge_space_id=sp.id
  join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
  join public.knowledge_source_versions_v2 sv on sv.id=o.published_source_version_id
  join public.knowledge_sources_v2 s on s.id=sv.source_id and s.published_version_id=sv.id
  where o.canonical_key=lower(trim(p_canonical_key)) and o.publication_status='published' and s.publication_status='published'
    and (p_object_types is null or o.published_object_type=any(p_object_types))
  order by sp.priority
  limit 1;
$$;

create or replace function public.get_related_knowledge_objects_v2(
  p_workspace_id text,
  p_canonical_key text,
  p_relation_types text[] default null,
  p_direction text default 'both',
  p_limit integer default 12
)
returns table(
  relation_id uuid, source_canonical_key text, relation_type text, target_canonical_key text, evidence text,
  related_canonical_key text, related_object_type text, related_name text, related_title text, related_summary text,
  source_id uuid, source_name text, scope_type text
)
language sql
volatile
security definer
set search_path = ''
as $$
  with ctx as (select * from public.resolve_knowledge_context(p_workspace_id)),
  spaces as (
    select project_space_id id,'project'::text scope_type,0 priority from ctx where project_space_id is not null
    union all select global_space_id,'global'::text,1 from ctx
  ), rels as (
    select r.*,sp.scope_type,sp.priority,
      case when r.source_canonical_key=lower(trim(p_canonical_key)) then r.target_canonical_key else r.source_canonical_key end related_key,
      sv.source_id
    from spaces sp
    join public.knowledge_relations_v2 r on r.knowledge_space_id=sp.id and r.active
    join public.knowledge_source_versions_v2 sv on sv.id=r.source_version_id
    join public.knowledge_sources_v2 src on src.id=sv.source_id and src.publication_status='published' and src.published_version_id=sv.id
    where (p_relation_types is null or r.relation_type=any(p_relation_types))
      and (
        (p_direction in ('outgoing','both') and r.source_canonical_key=lower(trim(p_canonical_key)))
        or (p_direction in ('incoming','both') and r.target_canonical_key=lower(trim(p_canonical_key)))
      )
  )
  select r.id,r.source_canonical_key,r.relation_type,r.target_canonical_key,r.evidence,
         o.canonical_key,o.published_object_type,o.published_name,v.title,v.summary,s.id,s.name,r.scope_type
  from rels r
  left join public.knowledge_objects_v2 o on o.knowledge_space_id=r.knowledge_space_id and o.canonical_key=r.related_key and o.publication_status='published'
  left join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
  left join public.knowledge_source_versions_v2 osv on osv.id=o.published_source_version_id
  left join public.knowledge_sources_v2 s on s.id=osv.source_id and s.published_version_id=osv.id and s.publication_status='published'
  order by r.priority,r.relation_type,r.related_key
  limit greatest(1,least(p_limit,20));
$$;

alter table public.knowledge_spaces enable row level security;
alter table public.knowledge_sources_v2 enable row level security;
alter table public.knowledge_source_versions_v2 enable row level security;
alter table public.knowledge_objects_v2 enable row level security;
alter table public.knowledge_object_versions_v2 enable row level security;
alter table public.knowledge_source_version_objects_v2 enable row level security;
alter table public.knowledge_relations_v2 enable row level security;
alter table public.knowledge_chunks_v2 enable row level security;
alter table public.knowledge_ingestion_jobs_v2 enable row level security;

create policy knowledge_spaces_read on public.knowledge_spaces for select to authenticated
using (public.can_read_knowledge_space(id));

create policy knowledge_sources_v2_read on public.knowledge_sources_v2 for select to authenticated
using (
  public.can_read_knowledge_space(knowledge_space_id)
  and (
    public.knowledge_space_type(knowledge_space_id)='project'
    or publication_status='published'
    or owner_id=(select auth.uid())
  )
);
create policy knowledge_sources_v2_update_owner on public.knowledge_sources_v2 for update to authenticated
using (owner_id=(select auth.uid()) and public.can_write_knowledge_space(knowledge_space_id))
with check (owner_id=(select auth.uid()) and public.can_write_knowledge_space(knowledge_space_id));
create policy knowledge_sources_v2_delete_owner on public.knowledge_sources_v2 for delete to authenticated
using (owner_id=(select auth.uid()) and public.can_write_knowledge_space(knowledge_space_id));

create policy knowledge_source_versions_v2_read on public.knowledge_source_versions_v2 for select to authenticated
using (exists (select 1 from public.knowledge_sources_v2 s where s.id=source_id));
create policy knowledge_objects_v2_read on public.knowledge_objects_v2 for select to authenticated
using (
  public.can_read_knowledge_space(knowledge_space_id)
  and (
    public.knowledge_space_type(knowledge_space_id)='project'
    or publication_status='published'
    or exists (select 1 from public.knowledge_sources_v2 s where s.id=primary_source_id and s.owner_id=(select auth.uid()))
  )
);
create policy knowledge_object_versions_v2_read on public.knowledge_object_versions_v2 for select to authenticated
using (exists (select 1 from public.knowledge_objects_v2 o where o.id=object_id));
create policy knowledge_source_version_objects_v2_read on public.knowledge_source_version_objects_v2 for select to authenticated
using (exists (select 1 from public.knowledge_source_versions_v2 sv where sv.id=source_version_id));
create policy knowledge_relations_v2_read on public.knowledge_relations_v2 for select to authenticated
using (exists (select 1 from public.knowledge_source_versions_v2 sv where sv.id=source_version_id));
create policy knowledge_chunks_v2_read on public.knowledge_chunks_v2 for select to authenticated
using (exists (select 1 from public.knowledge_source_versions_v2 sv where sv.id=source_version_id));
create policy knowledge_ingestion_jobs_v2_read_owner on public.knowledge_ingestion_jobs_v2 for select to authenticated
using (owner_id=(select auth.uid()));

revoke all on table public.knowledge_spaces,public.knowledge_sources_v2,public.knowledge_source_versions_v2,
  public.knowledge_objects_v2,public.knowledge_object_versions_v2,public.knowledge_source_version_objects_v2,
  public.knowledge_relations_v2,public.knowledge_chunks_v2,public.knowledge_ingestion_jobs_v2 from public,anon;
grant select on table public.knowledge_spaces,public.knowledge_source_versions_v2,public.knowledge_objects_v2,
  public.knowledge_object_versions_v2,public.knowledge_source_version_objects_v2,public.knowledge_relations_v2,
  public.knowledge_chunks_v2,public.knowledge_ingestion_jobs_v2 to authenticated;
grant select,update,delete on table public.knowledge_sources_v2 to authenticated;
grant all on table public.knowledge_spaces,public.knowledge_sources_v2,public.knowledge_source_versions_v2,
  public.knowledge_objects_v2,public.knowledge_object_versions_v2,public.knowledge_source_version_objects_v2,
  public.knowledge_relations_v2,public.knowledge_chunks_v2,public.knowledge_ingestion_jobs_v2 to service_role;

revoke all on function public.resolve_knowledge_context(text),public.resolve_knowledge_space_v2(text,text),
  public.ingest_knowledge_catalog_v2(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb),
  public.publish_knowledge_source_v2(uuid),public.search_knowledge_catalog_v2(text,text,text[],integer),
  public.get_knowledge_object_v2(text,text,text[]),public.get_related_knowledge_objects_v2(text,text,text[],text,integer)
from public,anon;
grant execute on function public.resolve_knowledge_context(text),public.resolve_knowledge_space_v2(text,text),
  public.ingest_knowledge_catalog_v2(uuid,uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb),
  public.publish_knowledge_source_v2(uuid),public.search_knowledge_catalog_v2(text,text,text[],integer),
  public.get_knowledge_object_v2(text,text,text[]),public.get_related_knowledge_objects_v2(text,text,text[],text,integer)
to authenticated,service_role;

create or replace function public.can_read_knowledge_file_v2(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.knowledge_sources_v2 s
    where s.storage_path=object_name
      and public.can_read_knowledge_space(s.knowledge_space_id)
      and (
        public.knowledge_space_type(s.knowledge_space_id)='project'
        or s.publication_status='published'
        or s.owner_id=(select auth.uid())
      )
  );
$$;

create or replace function public.can_write_knowledge_file_v2(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_user text;
  path_space uuid;
begin
  path_user := split_part(object_name,'/',1);
  begin
    path_space := split_part(object_name,'/',2)::uuid;
  exception when others then
    return false;
  end;
  return path_user=(select auth.uid())::text and public.can_write_knowledge_space(path_space);
end;
$$;

drop policy if exists "Knowledge v2 authenticated read" on storage.objects;
drop policy if exists "Knowledge v2 authenticated upload" on storage.objects;
drop policy if exists "Knowledge v2 owner update" on storage.objects;
drop policy if exists "Knowledge v2 owner delete" on storage.objects;
create policy "Knowledge v2 authenticated read" on storage.objects for select to authenticated
using (bucket_id='knowledge-sources' and public.can_read_knowledge_file_v2(name));
create policy "Knowledge v2 authenticated upload" on storage.objects for insert to authenticated
with check (bucket_id='knowledge-sources' and public.can_write_knowledge_file_v2(name));
create policy "Knowledge v2 owner update" on storage.objects for update to authenticated
using (bucket_id='knowledge-sources' and public.can_write_knowledge_file_v2(name))
with check (bucket_id='knowledge-sources' and public.can_write_knowledge_file_v2(name));
create policy "Knowledge v2 owner delete" on storage.objects for delete to authenticated
using (bucket_id='knowledge-sources' and public.can_write_knowledge_file_v2(name));
