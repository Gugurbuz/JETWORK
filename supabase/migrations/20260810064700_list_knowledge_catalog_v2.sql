-- Enumeration/List Capability
-- Provides bounded, paginated catalogue enumeration without overloading semantic search.
-- Project knowledge overrides matching global canonical keys.

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
as $$
  with ctx as (
    select * from public.resolve_knowledge_context(p_workspace_id)
  ),
  spaces as (
    select global_space_id as id, 'global'::text as scope_type, 1 as scope_rank
    from ctx
    union all
    select project_space_id as id, 'project'::text as scope_type, 0 as scope_rank
    from ctx
    where project_space_id is not null
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
      row_number() over (
        partition by o.canonical_key
        order by sp.scope_rank asc, o.updated_at desc
      ) as override_rank
    from spaces sp
    join public.knowledge_objects_v2 o
      on o.knowledge_space_id = sp.id
    join public.knowledge_object_versions_v2 v
      on v.id = o.published_version_id
    join public.knowledge_source_versions_v2 sv
      on sv.id = o.published_source_version_id
    join public.knowledge_sources_v2 s
      on s.id = sv.source_id
    where o.publication_status = 'published'
      and s.publication_status = 'published'
      and s.published_version_id = sv.id
      and (
        p_object_type is null
        or trim(p_object_type) = ''
        or o.published_object_type = trim(p_object_type)
      )
      and (
        p_prefix is null
        or trim(p_prefix) = ''
        or lower(o.canonical_key) like lower(trim(p_prefix)) || '%'
        or lower(o.published_name) like lower(trim(p_prefix)) || '%'
      )
  ),
  deduped as (
    select *
    from candidates
    where override_rank = 1
  ),
  bounded as (
    select greatest(1, least(coalesce(p_limit, 25), 25)) as page_limit
  ),
  page_plus_one as (
    select d.*
    from deduped d
    cross join bounded b
    where p_cursor is null
      or trim(p_cursor) = ''
      or d.canonical_key > trim(p_cursor)
    order by d.canonical_key asc
    limit (select page_limit + 1 from bounded)
  ),
  visible as (
    select *
    from page_plus_one
    order by canonical_key asc
    limit (select page_limit from bounded)
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
          'objectId', object_id,
          'canonicalKey', canonical_key,
          'objectType', object_type,
          'name', object_name,
          'title', title,
          'summary', summary,
          'sourceId', source_id,
          'sourceName', source_name,
          'scope', scope_type
        )
        order by canonical_key asc
      )
      from visible
    ), '[]'::jsonb),
    'totalCount', page_stats.total_count,
    'nextCursor', case
      when page_stats.fetched_count > page_stats.page_limit then page_stats.last_cursor
      else null
    end
  )
  from page_stats;
$$;

revoke execute on function public.list_knowledge_catalog_v2(text, text, text, text, integer) from public;
revoke execute on function public.list_knowledge_catalog_v2(text, text, text, text, integer) from anon;
grant execute on function public.list_knowledge_catalog_v2(text, text, text, text, integer) to authenticated;
grant execute on function public.list_knowledge_catalog_v2(text, text, text, text, integer) to service_role;

comment on function public.list_knowledge_catalog_v2(text, text, text, text, integer) is
  'Bounded catalogue enumeration for authenticated workspace members. Returns compact paginated objects, totalCount and nextCursor; project knowledge overrides matching global canonical keys.';
