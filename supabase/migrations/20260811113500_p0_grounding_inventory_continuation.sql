-- P0 hardening for grounded enterprise answers and deterministic inventory continuation.
create or replace function public.list_knowledge_catalog_v2(
  p_workspace_id text,
  p_object_type text default null,
  p_prefix text default null,
  p_cursor text default null,
  p_limit integer default 25
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  with ctx as (
    select * from public.resolve_knowledge_context(p_workspace_id)
  ),
  spaces as (
    select global_space_id as id, 'global'::text as scope_type, 1 as scope_rank from ctx
    union all
    select project_space_id as id, 'project'::text as scope_type, 0 as scope_rank from ctx where project_space_id is not null
  ),
  raw_args as (
    select trim(coalesce(p_prefix, '')) as raw_prefix
  ),
  filter_args as (
    select
      raw_prefix,
      (raw_prefix = '__jetwork_message_methods__' or raw_prefix like '__jetwork_message_methods__|cursor=%') as relation_mode,
      case
        when raw_prefix like '__jetwork_message_methods__|cursor=%' then nullif(substring(raw_prefix from length('__jetwork_message_methods__|cursor=') + 1), '')
        when raw_prefix like '__jetwork_resume__|cursor=%' then nullif(substring(raw_prefix from length('__jetwork_resume__|cursor=') + 1), '')
        else null
      end as embedded_cursor,
      case
        when raw_prefix = '__jetwork_message_methods__'
          or raw_prefix like '__jetwork_message_methods__|cursor=%'
          or raw_prefix like '__jetwork_resume__|cursor=%'
          then null
        else nullif(trim(p_prefix), '')
      end as effective_prefix
    from raw_args
  ),
  effective_args as (
    select
      f.*,
      coalesce(nullif(trim(p_cursor), ''), f.embedded_cursor) as effective_cursor,
      nullif(regexp_replace(lower(coalesce(f.effective_prefix, '')), '[^a-z0-9]+', '', 'g'), '') as normalized_prefix
    from filter_args f
  ),
  candidates as (
    select
      o.id as object_id,
      o.canonical_key,
      o.published_object_type as object_type,
      o.published_name as object_name,
      v.title,
      v.summary,
      s.id as source_id,
      s.name as source_name,
      sp.scope_type,
      row_number() over (partition by o.canonical_key order by sp.scope_rank asc, o.updated_at desc) as override_rank
    from spaces sp
    cross join effective_args f
    join public.knowledge_objects_v2 o on o.knowledge_space_id = sp.id
    join public.knowledge_object_versions_v2 v on v.id = o.published_version_id
    join public.knowledge_source_versions_v2 sv on sv.id = o.published_source_version_id
    join public.knowledge_sources_v2 s on s.id = sv.source_id
    where o.publication_status = 'published'
      and s.publication_status = 'published'
      and s.published_version_id = sv.id
      and (p_object_type is null or trim(p_object_type) = '' or o.published_object_type = trim(p_object_type))
      and (
        f.effective_prefix is null
        or lower(o.canonical_key) like lower(f.effective_prefix) || '%'
        or lower(o.published_name) like lower(f.effective_prefix) || '%'
        or (f.normalized_prefix is not null and regexp_replace(lower(coalesce(o.published_name, '')), '[^a-z0-9]+', '', 'g') like f.normalized_prefix || '%')
        or (f.normalized_prefix is not null and regexp_replace(lower(split_part(o.canonical_key, ':', 2)), '[^a-z0-9]+', '', 'g') like f.normalized_prefix || '%')
      )
  ),
  deduped as (select * from candidates where override_rank = 1),
  bounded as (select greatest(1, least(coalesce(p_limit, 25), 25)) as page_limit),
  page_plus_one as (
    select d.*
    from deduped d
    cross join bounded b
    cross join effective_args f
    where f.effective_cursor is null or d.canonical_key > f.effective_cursor
    order by d.canonical_key asc
    limit (select page_limit + 1 from bounded)
  ),
  visible as (
    select * from page_plus_one order by canonical_key asc limit (select page_limit from bounded)
  ),
  relation_candidates as (
    select
      r.source_canonical_key,
      r.target_canonical_key,
      row_number() over (
        partition by r.source_canonical_key, r.target_canonical_key, r.relation_type
        order by sp.scope_rank asc, r.created_at desc
      ) as override_rank
    from spaces sp
    cross join effective_args f
    join public.knowledge_relations_v2 r on r.knowledge_space_id = sp.id
    where f.relation_mode
      and r.active = true
      and r.relation_type = 'EMITS_MESSAGE'
  ),
  relation_methods as (
    select distinct target_canonical_key, upper(split_part(source_canonical_key, ':', 2)) as method_name
    from relation_candidates
    where override_rank = 1 and source_canonical_key is not null and target_canonical_key is not null
  ),
  relation_agg as (
    select target_canonical_key, string_agg(method_name, ', ' order by method_name) as methods
    from relation_methods group by target_canonical_key
  ),
  page_stats as (
    select
      (select count(*) from deduped)::integer as total_count,
      (select count(*) from page_plus_one)::integer as fetched_count,
      (select page_limit from bounded)::integer as page_limit,
      (select canonical_key from visible order by canonical_key desc limit 1) as last_cursor
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'objectId', v.object_id,
          'canonicalKey', v.canonical_key,
          'objectType', v.object_type,
          'name', v.object_name,
          'title', case
            when f.relation_mode and v.object_type = 'message' then concat(
              coalesce(nullif(v.title, ''), v.object_name),
              ' · Metotlar: ',
              coalesce(nullif(ra.methods, ''), 'Metot ilişkisi belgelenmemiş')
            )
            else v.title
          end,
          'summary', v.summary,
          'sourceId', v.source_id,
          'sourceName', v.source_name,
          'scope', v.scope_type
        ) order by v.canonical_key asc
      )
      from visible v
      cross join effective_args f
      left join relation_agg ra on ra.target_canonical_key = v.canonical_key
    ), '[]'::jsonb),
    'totalCount', page_stats.total_count,
    'nextCursor', case when page_stats.fetched_count > page_stats.page_limit then page_stats.last_cursor else null end
  )
  from page_stats;
$function$;

create or replace function public.complete_assistant_turn(
  p_turn_id uuid,
  p_conversation_id uuid,
  p_lease_token uuid,
  p_expected_revision bigint,
  p_state_items jsonb,
  p_response_text text,
  p_source_refs jsonb,
  p_usage jsonb,
  p_response_model text
)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  conversation_record public.assistant_conversations%rowtype;
  turn_record public.assistant_turns%rowtype;
  grounding_required boolean := false;
  has_verified_source boolean := false;
begin
  if jsonb_typeof(p_state_items) <> 'array' or jsonb_typeof(p_source_refs) <> 'array' or jsonb_typeof(p_usage) <> 'object' then
    raise exception 'Assistant completion payload is invalid';
  end if;

  select * into turn_record
  from public.assistant_turns
  where id = p_turn_id and conversation_id = p_conversation_id and lease_token = p_lease_token and status = 'running'
  for update;

  if turn_record.id is null then raise exception 'Assistant turn lock is no longer valid'; end if;

  select coalesce(
    (r.plan ->> 'knowledgeRequired')::boolean
    and coalesce(r.plan ->> 'executionMode', 'knowledge') in ('knowledge', 'research'),
    false
  )
  into grounding_required
  from public.assistant_reasoning_runs r
  where r.turn_id = p_turn_id
  order by r.started_at desc
  limit 1;

  grounding_required := coalesce(grounding_required, false);

  select exists (
    select 1
    from jsonb_array_elements(p_source_refs) source_ref
    where coalesce(
      nullif(trim(source_ref ->> 'canonicalKey'), ''),
      nullif(trim(source_ref ->> 'url'), ''),
      nullif(trim(source_ref ->> 'sourceId'), '')
    ) is not null
  ) into has_verified_source;

  if grounding_required and not has_verified_source then
    raise exception 'GROUNDING_REQUIRED_NO_VERIFIED_SOURCE';
  end if;

  select * into conversation_record
  from public.assistant_conversations
  where id = p_conversation_id
  for update;

  if conversation_record.id is null or conversation_record.locked_turn_id <> p_turn_id then
    raise exception 'Assistant turn lock is no longer valid';
  end if;
  if conversation_record.revision <> p_expected_revision then
    raise exception 'Assistant conversation revision conflict';
  end if;

  update public.assistant_conversations
  set model = left(p_response_model, 80), state_items = p_state_items, revision = revision + 1,
      locked_turn_id = null, lock_expires_at = null, updated_at = now()
  where id = p_conversation_id;

  update public.assistant_turns
  set status = 'completed', response_text = p_response_text, source_refs = p_source_refs, usage = p_usage,
      response_model = left(p_response_model, 80), error_message = null, completed_at = now()
  where id = p_turn_id;
end;
$function$;

create or replace function private.normalize_reasoning_knowledge_used()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  has_verified_knowledge boolean := false;
begin
  if new.knowledge_used is distinct from true then return new; end if;

  select exists (
    select 1
    from public.assistant_tool_runs tr
    where tr.turn_id = new.turn_id
      and tr.status = 'completed'
      and tr.tool_name <> 'web_search'
      and jsonb_typeof(tr.source_refs) = 'array'
      and exists (
        select 1
        from jsonb_array_elements(tr.source_refs) source_ref
        where coalesce(nullif(trim(source_ref ->> 'canonicalKey'), ''), nullif(trim(source_ref ->> 'sourceId'), '')) is not null
      )
  ) into has_verified_knowledge;

  new.knowledge_used := has_verified_knowledge;
  return new;
end;
$function$;

drop trigger if exists assistant_reasoning_runs_grounded_knowledge_used on public.assistant_reasoning_runs;
create trigger assistant_reasoning_runs_grounded_knowledge_used
before insert or update of knowledge_used on public.assistant_reasoning_runs
for each row execute function private.normalize_reasoning_knowledge_used();