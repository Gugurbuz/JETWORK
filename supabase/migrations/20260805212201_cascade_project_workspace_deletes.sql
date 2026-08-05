alter table public.workspaces
  drop constraint if exists workspaces_project_id_fkey;

alter table public.workspaces
  add constraint workspaces_project_id_fkey
  foreign key (project_id)
  references public.projects(id)
  on delete cascade;
