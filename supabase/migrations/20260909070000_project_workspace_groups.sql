-- Project workspace hierarchy
-- Existing public.workspaces rows are conversations. This migration adds a
-- project-level grouping layer so a project can contain both direct chats and
-- named workspaces that themselves contain chats.

create table if not exists public.project_workspace_groups (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  owner_id uuid not null references public.users(uid) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  constraint project_workspace_groups_name_check check (char_length(btrim(name)) between 1 and 120)
);

create index if not exists project_workspace_groups_project_idx
  on public.project_workspace_groups(project_id, position, last_updated desc);

alter table public.workspaces
  add column if not exists workspace_group_id text references public.project_workspace_groups(id) on delete set null;

create index if not exists workspaces_workspace_group_idx
  on public.workspaces(workspace_group_id, last_updated desc)
  where workspace_group_id is not null;

create or replace function public.validate_workspace_group_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project_id text;
begin
  if new.workspace_group_id is null then
    return new;
  end if;

  select workspace_group.project_id
    into target_project_id
  from public.project_workspace_groups workspace_group
  where workspace_group.id = new.workspace_group_id
    and workspace_group.deleted_at is null;

  if target_project_id is null then
    raise exception 'Workspace group does not exist or is deleted';
  end if;

  if new.project_id is distinct from target_project_id then
    raise exception 'Conversation project and workspace group project must match';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_workspace_group_scope() from public, anon, authenticated;
grant execute on function public.validate_workspace_group_scope() to service_role;

drop trigger if exists validate_workspace_group_scope_trigger on public.workspaces;
create trigger validate_workspace_group_scope_trigger
before insert or update of project_id, workspace_group_id on public.workspaces
for each row execute function public.validate_workspace_group_scope();

alter table public.project_workspace_groups enable row level security;
grant select, insert, update, delete on table public.project_workspace_groups to authenticated;
grant all on table public.project_workspace_groups to service_role;

drop policy if exists project_workspace_groups_select_member on public.project_workspace_groups;
create policy project_workspace_groups_select_member
on public.project_workspace_groups for select to authenticated
using (public.is_project_member(project_id));

drop policy if exists project_workspace_groups_insert_member on public.project_workspace_groups;
create policy project_workspace_groups_insert_member
on public.project_workspace_groups for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.is_project_member(project_id)
);

drop policy if exists project_workspace_groups_update_manager on public.project_workspace_groups;
create policy project_workspace_groups_update_manager
on public.project_workspace_groups for update to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1
    from public.projects project
    where project.id = project_workspace_groups.project_id
      and project.owner_id = (select auth.uid())
  )
)
with check (
  public.is_project_member(project_id)
  and (
    owner_id = (select auth.uid())
    or exists (
      select 1
      from public.projects project
      where project.id = project_workspace_groups.project_id
        and project.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists project_workspace_groups_delete_manager on public.project_workspace_groups;
create policy project_workspace_groups_delete_manager
on public.project_workspace_groups for delete to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1
    from public.projects project
    where project.id = project_workspace_groups.project_id
      and project.owner_id = (select auth.uid())
  )
);

comment on table public.project_workspace_groups is
  'Optional project-level workspace containers. Chats remain in public.workspaces and may point to one group or live directly under the project.';
