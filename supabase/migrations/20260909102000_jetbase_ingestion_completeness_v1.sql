-- JetBase ingestion completeness v1
-- 1) consolidates exact-content duplicate source versions across a knowledge space
-- 2) enforces knowledge-space + SHA256 uniqueness
-- 3) preserves the ABAP graph guard while deduplicating before expensive persistence
-- 4) queues every published source version with missing embeddings for async batch completion

-- Consolidate exact-content duplicates before adding the stronger uniqueness guard.
do $$
declare
  winner record;
  loser record;
  winner_source_id uuid;
begin
  for winner in
    with scored as (
      select
        sv.id as source_version_id,
        sv.source_id,
        sv.knowledge_space_id,
        sv.content_hash,
        sv.created_at,
        (case when s.published_version_id = sv.id then 1000000 else 0 end)
          + (select count(*) * 1000 from public.knowledge_objects_v2 o where o.published_source_version_id = sv.id)
          + (select count(*) from public.knowledge_chunks_v2 c where c.source_version_id = sv.id)
          + (select count(*) from public.knowledge_object_versions_v2 ov where ov.source_version_id = sv.id) as score
      from public.knowledge_source_versions_v2 sv
      join public.knowledge_sources_v2 s on s.id = sv.source_id
    ), ranked as (
      select
        scored.*,
        count(*) over (partition by knowledge_space_id, content_hash) as duplicate_count,
        row_number() over (
          partition by knowledge_space_id, content_hash
          order by score desc, created_at desc, source_version_id desc
        ) as rn
      from scored
    )
    select * from ranked where duplicate_count > 1 and rn = 1
  loop
    winner_source_id := winner.source_id;

    for loser in
      select sv.id as source_version_id, sv.source_id
      from public.knowledge_source_versions_v2 sv
      where sv.knowledge_space_id = winner.knowledge_space_id
        and sv.content_hash = winner.content_hash
        and sv.id <> winner.source_version_id
      order by sv.created_at
    loop
      insert into public.knowledge_source_version_objects_v2(
        source_version_id, knowledge_space_id, object_id, object_version_id
      )
      select winner.source_version_id, knowledge_space_id, object_id, object_version_id
      from public.knowledge_source_version_objects_v2
      where source_version_id = loser.source_version_id
      on conflict (source_version_id, object_id)
      do update set object_version_id = excluded.object_version_id;

      update public.knowledge_object_versions_v2
      set source_version_id = winner.source_version_id
      where source_version_id = loser.source_version_id;

      update public.knowledge_chunks_v2
      set source_version_id = winner.source_version_id
      where source_version_id = loser.source_version_id;

      insert into public.knowledge_relations_v2(
        knowledge_space_id,
        source_version_id,
        source_canonical_key,
        source_object_id,
        relation_type,
        target_canonical_key,
        target_object_id,
        evidence,
        active,
        metadata
      )
      select
        r.knowledge_space_id,
        winner.source_version_id,
        r.source_canonical_key,
        r.source_object_id,
        r.relation_type,
        r.target_canonical_key,
        r.target_object_id,
        r.evidence,
        r.active,
        r.metadata
      from public.knowledge_relations_v2 r
      where r.source_version_id = loser.source_version_id
      on conflict (source_version_id, source_canonical_key, relation_type, target_canonical_key)
      do update set
        evidence = coalesce(public.knowledge_relations_v2.evidence, excluded.evidence),
        active = public.knowledge_relations_v2.active or excluded.active,
        metadata = coalesce(public.knowledge_relations_v2.metadata, '{}'::jsonb) || coalesce(excluded.metadata, '{}'::jsonb);

      update public.knowledge_objects_v2
      set primary_source_id = winner_source_id,
          updated_at = now()
      where primary_source_id = loser.source_id;

      update public.knowledge_objects_v2
      set published_source_version_id = winner.source_version_id,
          updated_at = now()
      where published_source_version_id = loser.source_version_id;

      update public.knowledge_ingestion_jobs_v2
      set source_id = winner_source_id
      where source_id = loser.source_id;

      update public.knowledge_review_items_v3
      set source_version_id = winner.source_version_id,
          payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
            'sourceVersionConsolidatedBy', 'jetbase_ingestion_completeness_v1',
            'originalSourceVersionId', loser.source_version_id
          )
      where source_version_id = loser.source_version_id;

      delete from public.knowledge_relations_v2
      where source_version_id = loser.source_version_id;

      delete from public.knowledge_source_version_objects_v2
      where source_version_id = loser.source_version_id;

      delete from public.knowledge_source_versions_v2
      where id = loser.source_version_id;

      delete from public.knowledge_sources_v2 s
      where s.id = loser.source_id
        and s.id <> winner_source_id
        and not exists (
          select 1 from public.knowledge_source_versions_v2 sv where sv.source_id = s.id
        );
    end loop;

    update public.knowledge_source_versions_v2 sv
    set object_count = (
          select count(*) from public.knowledge_source_version_objects_v2 svo
          where svo.source_version_id = sv.id
        ),
        relation_count = (
          select count(*) from public.knowledge_relations_v2 r
          where r.source_version_id = sv.id and r.active
        )
    where sv.id = winner.source_version_id;

    update public.knowledge_sources_v2
    set published_version_id = winner.source_version_id,
        ingestion_status = 'ready',
        updated_at = now()
    where id = winner_source_id
      and publication_status = 'published';
  end loop;
end;
$$;

create unique index if not exists knowledge_source_versions_v2_space_content_hash_uq
  on public.knowledge_source_versions_v2 (knowledge_space_id, content_hash);

-- Preserve the v5 ABAP SQL guard while adding cross-source SHA256 deduplication.
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
  existing_version_id uuid;
  existing_source_id uuid;
  existing_publication_status text;
  v_relations jsonb := '[]'::jsonb;
  v_objects jsonb := '[]'::jsonb;
  v_result jsonb;
  v_input_relation_count integer := coalesce(jsonb_array_length(coalesce(p_relations,'[]'::jsonb)),0);
  v_input_object_count integer := coalesce(jsonb_array_length(coalesce(p_objects,'[]'::jsonb)),0);
  v_relation_count integer := 0;
  v_object_count integer := 0;
begin
  if current_user_id is null or not public.can_write_knowledge_space(p_knowledge_space_id) then
    raise exception 'Knowledge space access denied';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid content hash';
  end if;

  -- Serialize concurrent uploads of the same bytes within a knowledge space.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_knowledge_space_id::text || ':' || p_content_hash, 0)
  );

  select sv.id, sv.source_id, s.publication_status
    into existing_version_id, existing_source_id, existing_publication_status
  from public.knowledge_source_versions_v2 sv
  join public.knowledge_sources_v2 s on s.id = sv.source_id
  where sv.knowledge_space_id = p_knowledge_space_id
    and sv.content_hash = p_content_hash
  order by sv.created_at desc
  limit 1;

  if existing_version_id is not null then
    update public.knowledge_sources_v2
    set ingestion_status = 'ready', updated_at = now()
    where id = existing_source_id;

    update public.knowledge_ingestion_jobs_v2
    set source_id = existing_source_id,
        status = 'completed',
        phase = 'deduplicated',
        stats = coalesce(stats, '{}'::jsonb) || jsonb_build_object(
          'deduplicated', true,
          'dedupScope', 'knowledge_space_content_hash',
          'contentHash', p_content_hash
        ),
        completed_at = now()
    where id = p_job_id and owner_id = current_user_id;

    return jsonb_build_object(
      'sourceId', existing_source_id,
      'sourceVersionId', existing_version_id,
      'deduplicated', true,
      'dedupScope', 'knowledge_space_content_hash',
      'publicationStatus', existing_publication_status
    );
  end if;

  if jsonb_typeof(coalesce(p_relations,'[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_objects,'[]'::jsonb)) <> 'array' then
    return public.ingest_knowledge_catalog_v2_unsanitized_v5(
      p_job_id,p_knowledge_space_id,p_storage_path,p_file_name,p_mime_type,
      p_content_hash,p_raw_text,p_parser_version,p_document_type,p_objects,
      p_relations,p_warnings
    );
  end if;

  select coalesce(jsonb_agg(rel.value order by rel.ordinality), '[]'::jsonb)
    into v_relations
    from jsonb_array_elements(coalesce(p_relations,'[]'::jsonb)) with ordinality as rel(value, ordinality)
   where public.is_valid_abap_table_relation_v5(p_raw_text,p_document_type,rel.value);

  v_relation_count := jsonb_array_length(v_relations);

  select coalesce(jsonb_agg(obj.value order by obj.ordinality), '[]'::jsonb)
    into v_objects
    from jsonb_array_elements(coalesce(p_objects,'[]'::jsonb)) with ordinality as obj(value, ordinality)
   where not (
     coalesce((obj.value->'metadata'->>'synthetic')::boolean,false)
     and coalesce(obj.value->'metadata'->>'syntheticReason','') = 'relation_endpoint'
     and not exists (
       select 1
         from jsonb_array_elements(v_relations) rel
        where lower(coalesce(rel->>'sourceCanonicalKey','')) = lower(coalesce(obj.value->>'canonicalKey',''))
           or lower(coalesce(rel->>'targetCanonicalKey','')) = lower(coalesce(obj.value->>'canonicalKey',''))
     )
   );

  v_object_count := jsonb_array_length(v_objects);

  v_result := public.ingest_knowledge_catalog_v2_unsanitized_v5(
    p_job_id,p_knowledge_space_id,p_storage_path,p_file_name,p_mime_type,
    p_content_hash,p_raw_text,p_parser_version,p_document_type,v_objects,
    v_relations,p_warnings
  );

  return v_result || jsonb_build_object(
    'abapSqlGuardVersion','v5',
    'dedupScope','knowledge_space_content_hash',
    'relationsRejectedByAbapSqlGuard', greatest(v_input_relation_count-v_relation_count,0),
    'syntheticObjectsRejectedByAbapSqlGuard', greatest(v_input_object_count-v_object_count,0)
  );
end;
$$;

revoke all on function public.ingest_knowledge_catalog_v2(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.ingest_knowledge_catalog_v2(
  uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

-- Internal queue + custom-auth webhook secret for asynchronous embedding completion.
create table if not exists public.jetbase_internal_config_v1 (
  key text primary key,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.jetbase_internal_config_v1 enable row level security;
revoke all on table public.jetbase_internal_config_v1 from public, anon, authenticated;
grant select on table public.jetbase_internal_config_v1 to service_role;

insert into public.jetbase_internal_config_v1(key, secret)
values ('embedding_backfill_webhook_secret', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table if not exists public.jetbase_embedding_backfill_requests_v1 (
  id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null unique references public.knowledge_source_versions_v2(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts integer not null default 0,
  dispatch_request_id bigint null,
  result jsonb not null default '{}'::jsonb,
  error_message text null,
  requested_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now()
);
alter table public.jetbase_embedding_backfill_requests_v1 enable row level security;
revoke all on table public.jetbase_embedding_backfill_requests_v1 from public, anon, authenticated;
grant select, insert, update on table public.jetbase_embedding_backfill_requests_v1 to service_role;

create or replace function public.apply_jetbase_embedding_batch_v1(
  p_source_version_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  applied integer := 0;
  changed integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rows,'[]'::jsonb)) > 100 then
    raise exception 'Invalid embedding batch';
  end if;

  for item in select value from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb))
  loop
    if coalesce(item->>'id','') = ''
       or jsonb_typeof(item->'embedding') <> 'array'
       or jsonb_array_length(item->'embedding') <> 768 then
      raise exception 'Invalid embedding batch row';
    end if;

    update public.knowledge_chunks_v2
    set embedding = (item->'embedding')::text::public.vector,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'embeddingStatus','ready',
          'embeddingCompletion','async_batch_v1',
          'embeddingCompletedAt',now()
        )
    where id = (item->>'id')::uuid
      and source_version_id = p_source_version_id
      and embedding is null;
    get diagnostics changed = row_count;
    applied := applied + changed;
  end loop;

  return applied;
end;
$$;
revoke all on function public.apply_jetbase_embedding_batch_v1(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.apply_jetbase_embedding_batch_v1(uuid,jsonb) to service_role;

create or replace function public.dispatch_jetbase_embedding_backfill_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  webhook_secret text;
  request_id bigint;
begin
  if new.status <> 'queued' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'queued' then
    return new;
  end if;

  select secret into webhook_secret
  from public.jetbase_internal_config_v1
  where key = 'embedding_backfill_webhook_secret';

  if webhook_secret is null then
    raise exception 'JetBase embedding backfill secret is not configured';
  end if;

  select net.http_post(
    url := 'https://bpbbvjigostgrssnduhk.supabase.co/functions/v1/jetbase-embedding-backfill-internal',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('requestId', new.id, 'secret', webhook_secret),
    timeout_milliseconds := 5000
  ) into request_id;

  update public.jetbase_embedding_backfill_requests_v1
  set dispatch_request_id = request_id,
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;
revoke all on function public.dispatch_jetbase_embedding_backfill_v1() from public, anon, authenticated;

drop trigger if exists jetbase_embedding_backfill_dispatch_v1 on public.jetbase_embedding_backfill_requests_v1;
create trigger jetbase_embedding_backfill_dispatch_v1
after insert or update of status on public.jetbase_embedding_backfill_requests_v1
for each row execute function public.dispatch_jetbase_embedding_backfill_v1();

create or replace function public.enqueue_jetbase_embedding_backfill_for_job_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_version_id uuid;
begin
  if new.status <> 'completed'
     or new.phase not in ('ready_for_review','deduplicated')
     or new.source_id is null then
    return new;
  end if;

  select sv.id into source_version_id
  from public.knowledge_source_versions_v2 sv
  where sv.source_id = new.source_id
  order by sv.version_number desc
  limit 1;

  if source_version_id is null or not exists (
    select 1 from public.knowledge_chunks_v2 c
    where c.source_version_id = source_version_id and c.embedding is null
  ) then
    return new;
  end if;

  insert into public.jetbase_embedding_backfill_requests_v1(source_version_id,status,requested_at,updated_at)
  values (source_version_id,'queued',now(),now())
  on conflict (source_version_id) do update set
    status = case
      when public.jetbase_embedding_backfill_requests_v1.status = 'running' then 'running'
      else 'queued'
    end,
    requested_at = case
      when public.jetbase_embedding_backfill_requests_v1.status = 'running' then public.jetbase_embedding_backfill_requests_v1.requested_at
      else now()
    end,
    completed_at = case
      when public.jetbase_embedding_backfill_requests_v1.status = 'running' then public.jetbase_embedding_backfill_requests_v1.completed_at
      else null
    end,
    error_message = case
      when public.jetbase_embedding_backfill_requests_v1.status = 'running' then public.jetbase_embedding_backfill_requests_v1.error_message
      else null
    end,
    updated_at = now();

  return new;
end;
$$;
revoke all on function public.enqueue_jetbase_embedding_backfill_for_job_v1() from public, anon, authenticated;

drop trigger if exists jetbase_embedding_backfill_job_enqueue_v1 on public.knowledge_ingestion_jobs_v2;
create trigger jetbase_embedding_backfill_job_enqueue_v1
after update of status, phase on public.knowledge_ingestion_jobs_v2
for each row
when (new.status = 'completed')
execute function public.enqueue_jetbase_embedding_backfill_for_job_v1();

-- Seed all currently published source versions that still have missing vectors.
insert into public.jetbase_embedding_backfill_requests_v1(source_version_id,status,requested_at,updated_at)
select distinct sv.id, 'queued', now(), now()
from public.knowledge_source_versions_v2 sv
join public.knowledge_sources_v2 s on s.id = sv.source_id
join public.knowledge_chunks_v2 c on c.source_version_id = sv.id
where s.publication_status = 'published'
  and s.published_version_id = sv.id
  and c.embedding is null
on conflict (source_version_id) do update set
  status = 'queued',
  requested_at = now(),
  completed_at = null,
  error_message = null,
  updated_at = now();
