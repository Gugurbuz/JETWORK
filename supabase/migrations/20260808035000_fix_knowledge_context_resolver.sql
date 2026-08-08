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

  select w.project_id
    into current_project_id
    from public.workspaces w
   where w.id = p_workspace_id
     and w.deleted_at is null;

  select s.id
    into resolved_global_id
    from public.knowledge_spaces s
   where s.scope_type = 'global'
   limit 1;

  if resolved_global_id is null then
    insert into public.knowledge_spaces(scope_type, name, created_by)
    values ('global', 'JetWork Bilgi Bankası', (select auth.uid()))
    on conflict do nothing;

    select s.id
      into resolved_global_id
      from public.knowledge_spaces s
     where s.scope_type = 'global'
     limit 1;
  end if;

  if current_project_id is not null then
    if not public.is_project_member_v2(current_project_id) then
      raise exception 'Project access denied';
    end if;

    insert into public.knowledge_spaces(scope_type, project_id, name, created_by)
    select 'project', p.id, p.name || ' · Proje Bilgisi', (select auth.uid())
      from public.projects p
     where p.id = current_project_id
    on conflict do nothing;

    select s.id
      into resolved_project_id
      from public.knowledge_spaces s
     where s.scope_type = 'project'
       and s.project_id = current_project_id;
  end if;

  return query
  select resolved_global_id, resolved_project_id, current_project_id;
end;
$$;
