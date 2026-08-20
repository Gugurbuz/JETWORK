-- Avoid a PL/pgSQL variable/column name collision while persisting catalog objects.
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
  v_object_version_id uuid;
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

    select id into v_object_version_id from public.knowledge_object_versions_v2
    where object_id=object_record.id and content_hash=object_content_hash
    order by version_number desc limit 1;

    if v_object_version_id is null then
      next_object_version := object_record.latest_version + 1;
      update public.knowledge_object_versions_v2 set is_current=false where object_id=object_record.id and is_current;
      insert into public.knowledge_object_versions_v2(
        object_id,knowledge_space_id,source_version_id,version_number,content_hash,title,summary,content,metadata
      ) values (
        object_record.id,p_knowledge_space_id,source_version_id,next_object_version,object_content_hash,
        left(coalesce(object_item->>'title',object_item->>'name'),500),nullif(left(coalesce(object_item->>'summary',''),2000),''),
        object_content,coalesce(object_item->'metadata','{}'::jsonb)
      ) returning id into v_object_version_id;

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
          v_object_version_id,
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
    values (source_version_id,p_knowledge_space_id,object_record.id,v_object_version_id)
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
