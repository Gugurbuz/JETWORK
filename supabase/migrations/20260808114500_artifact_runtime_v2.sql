create table if not exists public.artifact_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  artifact_type text not null default 'business_analysis'
    check (artifact_type in ('business_analysis')),
  operation text not null default 'create'
    check (operation in ('create', 'revise')),
  status text not null default 'awaiting_input'
    check (status in ('awaiting_input', 'generating', 'validating', 'persisting', 'completed', 'failed', 'cancelled')),
  request_message_id text,
  request_text text not null default '',
  artifact_payload jsonb not null default '{}'::jsonb,
  document_id text not null default 'main',
  document_version_id text,
  document_version_number integer,
  error_message text,
  last_transition_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artifact_tasks_workspace_status_idx
  on public.artifact_tasks (workspace_id, owner_id, status, updated_at desc);

create index if not exists artifact_tasks_request_message_idx
  on public.artifact_tasks (request_message_id)
  where request_message_id is not null;

create unique index if not exists artifact_tasks_one_active_idx
  on public.artifact_tasks (workspace_id, owner_id, artifact_type)
  where status in ('awaiting_input', 'generating', 'validating', 'persisting');

drop trigger if exists set_artifact_tasks_updated_at on public.artifact_tasks;
create trigger set_artifact_tasks_updated_at
before update on public.artifact_tasks
for each row execute function public.set_jetwork_updated_at();

alter table public.artifact_tasks enable row level security;
revoke all on public.artifact_tasks from anon;
grant select, insert, update, delete on public.artifact_tasks to authenticated;
grant all on public.artifact_tasks to service_role;

create policy "Workspace members can read artifact tasks"
on public.artifact_tasks
for select
to authenticated
using (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.workspaces w
    where w.id = artifact_tasks.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Workspace members can create artifact tasks"
on public.artifact_tasks
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1 from public.workspaces w
    where w.id = artifact_tasks.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Artifact task owners can update tasks"
on public.artifact_tasks
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Artifact task owners can delete tasks"
on public.artifact_tasks
for delete
to authenticated
using (owner_id = (select auth.uid()));
