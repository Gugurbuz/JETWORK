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
  constraint project_workspace_groups_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint project_workspace_groups_id_project_key unique (id, project_id)
);

create index if not exists project_workspace_groups_project_idx
  on public.project_workspace_groups(project_id, position, last_updated desc);

alter table public.workspaces
  add column if not exists workspace_group_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.workspaces'::regclass
      and conname = 'workspaces_workspace_group_project_fkey'
  ) then
    alter table public.workspaces
      add constraint workspaces_workspace_group_project_fkey
      foreign key (workspace_group_id, project_id)
      references public.project_workspace_groups(id, project_id)
      on delete set null (workspace_group_id);
  end if;
end;
$$;

create index if not exists workspaces_workspace_group_idx
  on public.workspaces(workspace_group_id, last_updated desc)
  where workspace_group_id is not null;

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
