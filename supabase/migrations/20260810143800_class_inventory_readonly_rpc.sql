-- Inventory Runtime Hardening
-- Keep class inventory reads side-effect free. The previous implementation used
-- resolve_knowledge_context(), which may create a project knowledge space and
-- therefore cannot safely run under a STABLE/read-only function contract.

create or replace function public.get_class_inventory_sources_v1(
  p_workspace_id text
)
returns table (
  scope_type text,
  source_id uuid,
  source_name text,
  raw_text text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_project_id text;
begin
  if (select auth.uid()) is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied';
  end if;

  select w.project_id
    into current_project_id
  from public.workspaces w
  where w.id = p_workspace_id
    and w.deleted_at is null;

  if not found then
    raise exception 'Workspace access denied';
  end if;

  if current_project_id is not null
     and not public.is_project_member_v2(current_project_id) then
    raise exception 'Project access denied';
  end if;

  return query
  with spaces as (
    select s.id, 'global'::text as scope_type, 1 as scope_rank
    from public.knowledge_spaces s
    where s.scope_type = 'global'

    union all

    select s.id, 'project'::text as scope_type, 0 as scope_rank
    from public.knowledge_spaces s
    where current_project_id is not null
      and s.scope_type = 'project'
      and s.project_id = current_project_id
  )
  select
    sp.scope_type,
    src.id as source_id,
    src.name as source_name,
    sv.raw_text
  from spaces sp
  join public.knowledge_sources_v2 src
    on src.knowledge_space_id = sp.id
  join public.knowledge_source_versions_v2 sv
    on sv.id = src.published_version_id
  where src.publication_status = 'published'
    and src.ingestion_status = 'ready'
    and sv.document_type = 'class_inventory'
  order by sp.scope_rank asc, src.updated_at desc, src.id asc;
end;
$$;

revoke execute on function public.get_class_inventory_sources_v1(text) from public;
revoke execute on function public.get_class_inventory_sources_v1(text) from anon;
grant execute on function public.get_class_inventory_sources_v1(text) to authenticated;
grant execute on function public.get_class_inventory_sources_v1(text) to service_role;

comment on function public.get_class_inventory_sources_v1(text) is
  'Read-only published class-inventory source lookup for an authenticated workspace; does not create knowledge spaces or invoke side-effecting knowledge context resolution.';
