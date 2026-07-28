drop policy if exists "Workspace members can read workspace knowledge"
  on public.workspace_knowledge;
create policy "Workspace members can read workspace knowledge"
on public.workspace_knowledge
for select
to authenticated
using (
  (select auth.uid()) is not null
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(
          jsonb_build_object('id', (select auth.uid())::text)
        )
      )
  )
);

drop policy if exists "Workspace members can create workspace knowledge"
  on public.workspace_knowledge;
create policy "Workspace members can create workspace knowledge"
on public.workspace_knowledge
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(
          jsonb_build_object('id', (select auth.uid())::text)
        )
      )
  )
);

drop policy if exists "Knowledge owners can update workspace knowledge"
  on public.workspace_knowledge;
create policy "Knowledge owners can update workspace knowledge"
on public.workspace_knowledge
for update
to authenticated
using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
)
with check (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_knowledge.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(
          jsonb_build_object('id', (select auth.uid())::text)
        )
      )
  )
);

drop policy if exists "Knowledge owners can delete workspace knowledge"
  on public.workspace_knowledge;
create policy "Knowledge owners can delete workspace knowledge"
on public.workspace_knowledge
for delete
to authenticated
using (
  owner_id = (select auth.uid())
  and coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) = false
);
