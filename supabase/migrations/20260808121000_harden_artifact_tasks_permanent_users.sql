drop policy if exists "Workspace members can read artifact tasks" on public.artifact_tasks;
drop policy if exists "Workspace members can create artifact tasks" on public.artifact_tasks;
drop policy if exists "Artifact task owners can update tasks" on public.artifact_tasks;
drop policy if exists "Artifact task owners can delete tasks" on public.artifact_tasks;

create policy "Permanent workspace members can read artifact tasks"
on public.artifact_tasks
for select
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and owner_id = (select auth.uid())
  and exists (
    select 1 from public.workspaces w
    where w.id = artifact_tasks.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Permanent workspace members can create artifact tasks"
on public.artifact_tasks
for insert
to authenticated
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and owner_id = (select auth.uid())
  and exists (
    select 1 from public.workspaces w
    where w.id = artifact_tasks.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Permanent artifact task owners can update tasks"
on public.artifact_tasks
for update
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and owner_id = (select auth.uid())
)
with check (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and owner_id = (select auth.uid())
);

create policy "Permanent artifact task owners can delete tasks"
on public.artifact_tasks
for delete
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
  and owner_id = (select auth.uid())
);
