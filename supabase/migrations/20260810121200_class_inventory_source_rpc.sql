-- Read only the currently published class-inventory source text for the active
-- workspace knowledge context. The caller's workspace membership is enforced by
-- resolve_knowledge_context; raw text is returned only for published inventory
-- sources and is parsed by the bounded assistant inventory tool.

create or replace function public.get_class_inventory_sources_v1(
  p_workspace_id text
)
returns table (
  scope_type text,
  source_id uuid,
  source_name text,
  raw_text text
)
language sql
stable
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
  )
  select
    sp.scope_type,
    s.id as source_id,
    s.name as source_name,
    sv.raw_text
  from spaces sp
  join public.knowledge_sources_v2 s
    on s.knowledge_space_id = sp.id
  join public.knowledge_source_versions_v2 sv
    on sv.id = s.published_version_id
  where s.publication_status = 'published'
    and s.ingestion_status = 'ready'
    and sv.document_type = 'class_inventory'
  order by sp.scope_rank asc, s.updated_at desc, s.id asc;
$$;

revoke execute on function public.get_class_inventory_sources_v1(text) from public;
revoke execute on function public.get_class_inventory_sources_v1(text) from anon;
grant execute on function public.get_class_inventory_sources_v1(text) to authenticated;
grant execute on function public.get_class_inventory_sources_v1(text) to service_role;

comment on function public.get_class_inventory_sources_v1(text) is
  'Returns published class-inventory source text for the authenticated workspace knowledge context; project scope is ordered before global scope.';
