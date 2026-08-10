-- Knowledge Hybrid RAG Engine
-- Adds semantic chunks, embeddings, architecture entity types, and hybrid retrieval.

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.knowledge_objects_v2'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%object_type%'
  loop
    execute format('alter table public.knowledge_objects_v2 drop constraint %I', constraint_record.conname);
  end loop;
end;
$$;

alter table public.knowledge_objects_v2
  add constraint knowledge_objects_v2_object_type_check
  check (
    object_type in (
      'class','method','function','message','table','document','business_rule','interface',
      'system','component','service','api','database','queue','job','screen','decision','requirement','unknown'
    )
  );

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.knowledge_relations_v2'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%relation_type%'
  loop
    execute format('alter table public.knowledge_relations_v2 drop constraint %I', constraint_record.conname);
  end loop;
end;
$$;

alter table public.knowledge_relations_v2
  add constraint knowledge_relations_v2_relation_type_check
  check (
    relation_type in (
      'CONTAINS','CALLS','READS','WRITES','EMITS_MESSAGE','EXTENDS','IMPLEMENTS','DOCUMENTS',
      'DEPENDS_ON','CONNECTS_TO','EXPOSES','CONSUMES','PRODUCES','USES','OWNS','TRIGGERS','RELATES_TO'
    )
  );

alter table public.knowledge_chunks_v2
  add column if not exists search_document tsvector
  generated always as (to_tsvector('simple'::regconfig, coalesce(content, ''))) stored;

create index if not exists knowledge_chunks_v2_search_idx
  on public.knowledge_chunks_v2 using gin (search_document);
create index if not exists knowledge_chunks_v2_object_idx
  on public.knowledge_chunks_v2 (object_version_id, chunk_index);
create index if not exists knowledge_chunks_v2_source_idx
  on public.knowledge_chunks_v2 (source_version_id, chunk_index);

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
  chunk_item jsonb;
  object_record public.knowledge_objects_v2%rowtype;
  object_version_id uuid;
  next_object_version integer;
  object_content text;
  object_content_hash text;
  source_object_id uuid;
  target_object_id uuid;
  inserted_objects integer := 0;
  inserted_relations integer := 0;
  inserted_chunks integer := 0;
  existing_version_id uuid;
  chunk_index integer;
  chunk_collection jsonb;
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

      chunk_collection := case
        when jsonb_typeof(object_item->'chunks') = 'array' and jsonb_array_length(object_item->'chunks') > 0
          then object_item->'chunks'
        else jsonb_build_array(jsonb_build_object('content', object_content, 'metadata', jsonb_build_object('canonicalKey', object_item->>'canonicalKey')))
      end;
      chunk_index := 0;
      for chunk_item in select value from jsonb_array_elements(chunk_collection)
      loop
        insert into public.knowledge_chunks_v2(
          knowledge_space_id,source_version_id,object_version_id,chunk_index,content,embedding,metadata
        ) values (
          p_knowledge_space_id,
          source_version_id,
          object_version_id,
          chunk_index,
          left(coalesce(chunk_item->>'content', object_content), 12000),
          case
            when jsonb_typeof(chunk_item->'embedding') = 'array'
              then (chunk_item->'embedding')::text::public.vector
            else null
          end,
          coalesce(chunk_item->'metadata','{}'::jsonb)
            || jsonb_build_object('canonicalKey',object_item->>'canonicalKey')
        )
        on conflict (object_version_id, chunk_index) do update
        set content=excluded.content,
            embedding=excluded.embedding,
            metadata=excluded.metadata;
        inserted_chunks := inserted_chunks + 1;
        chunk_index := chunk_index + 1;
      end loop;

      update public.knowledge_objects_v2 set latest_version=next_object_version where id=object_record.id;
      inserted_objects := inserted_objects + 1;
    end if;

    insert into public.knowledge_source_version_objects_v2(source_version_id,knowledge_space_id,object_id,object_version_id)
    values (source_version_id,p_knowledge_space_id,object_record.id,object_version_id)
    on conflict on constraint knowledge_source_version_objects_v2_pkey
    do update set object_version_id=excluded.object_version_id;
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
      stats=jsonb_build_object('objects',inserted_objects,'relations',inserted_relations,'chunks',inserted_chunks,'deduplicated',false),completed_at=now()
  where id=p_job_id and owner_id=current_user_id;

  return jsonb_build_object(
    'sourceId',source_record.id,
    'sourceVersionId',source_version_id,
    'objects',inserted_objects,
    'relations',inserted_relations,
    'chunks',inserted_chunks,
    'deduplicated',false,
    'publicationStatus',source_record.publication_status
  );
end;
$$;

create or replace function public.hybrid_search_knowledge_catalog_v2(
  p_workspace_id text,
  p_query text,
  p_query_embedding public.vector default null,
  p_object_types text[] default null,
  p_limit integer default 8
)
returns table(
  object_id uuid,
  canonical_key text,
  object_type text,
  object_name text,
  title text,
  summary text,
  content text,
  chunk_id uuid,
  chunk_index integer,
  chunk_content text,
  citation jsonb,
  source_id uuid,
  source_name text,
  scope_type text,
  score double precision,
  lexical_score double precision,
  vector_score double precision
)
language sql
volatile
security definer
set search_path = ''
as $$
  with query_input as (
    select trim(coalesce(p_query, '')) as query_text,
           case
             when trim(coalesce(p_query, '')) <> ''
               then websearch_to_tsquery('simple'::regconfig, trim(coalesce(p_query, '')))
             else null::tsquery
           end as query_ts
  ), ctx as (
    select * from public.resolve_knowledge_context(p_workspace_id)
  ), spaces as (
    select global_space_id as id, 'global'::text as scope_type, 0.0::double precision as scope_bonus, 1 as priority from ctx
    union all
    select project_space_id, 'project'::text, 0.08::double precision, 0 from ctx where project_space_id is not null
  ), candidates as (
    select
      o.id as object_id,
      o.canonical_key,
      o.published_object_type as object_type,
      o.published_name as object_name,
      v.title,
      v.summary,
      v.content as object_content,
      c.id as chunk_id,
      c.chunk_index,
      c.content as chunk_content,
      c.metadata as chunk_metadata,
      s.id as source_id,
      s.name as source_name,
      sp.scope_type,
      sp.scope_bonus,
      sp.priority,
      greatest(
        case when upper(o.canonical_key)=upper(q.query_text) then 1.0 else 0.0 end,
        case when o.published_normalized_name=upper(q.query_text) then 0.98 else 0.0 end,
        case when upper(o.canonical_key) like upper(q.query_text)||'%' then 0.9 else 0.0 end,
        case when o.published_normalized_name like upper(q.query_text)||'%' then 0.88 else 0.0 end,
        extensions.similarity(o.canonical_key,q.query_text)*0.78,
        extensions.similarity(o.published_normalized_name,upper(q.query_text))*0.76,
        case when q.query_ts is not null and v.search_document @@ q.query_ts then 0.72 else 0.0 end,
        case when q.query_ts is not null and c.search_document @@ q.query_ts then 0.82 else 0.0 end,
        coalesce(extensions.similarity(left(c.content, 800), q.query_text)*0.58, 0.0)
      )::double precision as lexical_score,
      case
        when p_query_embedding is not null and c.embedding is not null
          then greatest(0.0, 1 - (c.embedding operator(public.<=>) p_query_embedding))::double precision
        else 0.0::double precision
      end as vector_score
    from query_input q
    cross join spaces sp
    join public.knowledge_objects_v2 o on o.knowledge_space_id=sp.id
    join public.knowledge_object_versions_v2 v on v.id=o.published_version_id
    join public.knowledge_source_versions_v2 sv on sv.id=o.published_source_version_id
    join public.knowledge_sources_v2 s on s.id=sv.source_id
    left join public.knowledge_chunks_v2 c on c.object_version_id=v.id
    where o.publication_status='published'
      and s.publication_status='published'
      and s.published_version_id=sv.id
      and q.query_text <> ''
      and (p_object_types is null or o.published_object_type=any(p_object_types))
  ), ranked as (
    select
      candidates.*,
      least(1.0, greatest(lexical_score, vector_score * 0.92) + scope_bonus)::double precision as final_score,
      row_number() over (
        partition by scope_type, canonical_key, coalesce(chunk_id::text, 'object')
        order by greatest(lexical_score, vector_score * 0.92) desc, chunk_index nulls last
      ) as duplicate_rank
    from candidates
  )
  select
    ranked.object_id,
    ranked.canonical_key,
    ranked.object_type,
    ranked.object_name,
    ranked.title,
    ranked.summary,
    coalesce(ranked.chunk_content, ranked.object_content) as content,
    ranked.chunk_id,
    ranked.chunk_index,
    ranked.chunk_content,
    jsonb_build_object(
      'chunkId', ranked.chunk_id,
      'chunkIndex', ranked.chunk_index,
      'sectionTitle', ranked.chunk_metadata->>'sectionTitle',
      'headingPath', ranked.chunk_metadata->'headingPath',
      'startLine', ranked.chunk_metadata->>'startLine',
      'sourceId', ranked.source_id,
      'sourceName', ranked.source_name
    ) as citation,
    ranked.source_id,
    ranked.source_name,
    ranked.scope_type,
    ranked.final_score as score,
    ranked.lexical_score,
    ranked.vector_score
  from ranked
  where ranked.duplicate_rank = 1
    and (
      ranked.lexical_score >= 0.18
      or ranked.vector_score >= 0.50
    )
  order by ranked.final_score desc, ranked.priority, ranked.canonical_key, ranked.chunk_index nulls last
  limit greatest(1,least(p_limit,20));
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
  select
    result.object_id,
    result.canonical_key,
    result.object_type,
    result.object_name,
    result.title,
    result.summary,
    result.content,
    result.source_id,
    result.source_name,
    result.scope_type,
    result.score
  from public.hybrid_search_knowledge_catalog_v2(
    p_workspace_id,
    p_query,
    null,
    p_object_types,
    p_limit
  ) result;
$$;

revoke execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from public;
revoke execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) from anon;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to authenticated;
grant execute on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) to service_role;

revoke execute on function public.search_knowledge_catalog_v2(text,text,text[],integer) from public;
revoke execute on function public.search_knowledge_catalog_v2(text,text,text[],integer) from anon;
grant execute on function public.search_knowledge_catalog_v2(text,text,text[],integer) to authenticated;
grant execute on function public.search_knowledge_catalog_v2(text,text,text[],integer) to service_role;

comment on function public.hybrid_search_knowledge_catalog_v2(text,text,public.vector,text[],integer) is
  'Hybrid published knowledge retrieval using object lexical signals, chunk full-text search, optional pgvector similarity, source citation metadata, and project-over-global ranking.';
