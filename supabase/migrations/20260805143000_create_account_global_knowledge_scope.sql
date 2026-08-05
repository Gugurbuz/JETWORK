create table public.account_knowledge_scopes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  knowledge_workspace_id text not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index account_knowledge_scopes_workspace_idx
  on public.account_knowledge_scopes (knowledge_workspace_id);

create trigger set_account_knowledge_scopes_updated_at
before update on public.account_knowledge_scopes
for each row execute function public.set_jetwork_updated_at();

alter table public.account_knowledge_scopes enable row level security;

revoke all on table public.account_knowledge_scopes from public, anon;
grant select, insert, update, delete on table public.account_knowledge_scopes to authenticated;
grant all on table public.account_knowledge_scopes to service_role;

create policy account_knowledge_scopes_select_owner
on public.account_knowledge_scopes for select to authenticated
using (owner_id = (select auth.uid()));

create policy account_knowledge_scopes_insert_owner
on public.account_knowledge_scopes for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(knowledge_workspace_id)
);

create policy account_knowledge_scopes_update_owner
on public.account_knowledge_scopes for update to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(knowledge_workspace_id)
);

create policy account_knowledge_scopes_delete_owner
on public.account_knowledge_scopes for delete to authenticated
using (owner_id = (select auth.uid()));

-- Preserve the richest established catalog when one exists. Other accounts use
-- their oldest owned workspace as a stable account-level catalog anchor.
insert into public.account_knowledge_scopes (owner_id, knowledge_workspace_id)
select candidate.owner_id, candidate.id
from (
  select distinct on (workspace.owner_id)
    workspace.owner_id,
    workspace.id
  from public.workspaces workspace
  where workspace.owner_id is not null
  order by
    workspace.owner_id,
    (
      select count(*)
      from public.kb_sources source
      where source.workspace_id = workspace.id
        and source.publication_status = 'published'
        and source.ingestion_status = 'ready'
    ) desc,
    workspace.created_at asc,
    workspace.id asc
) candidate
on conflict (owner_id) do nothing;

create or replace function public.resolve_account_knowledge_workspace(
  p_workspace_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resolved_workspace_id text;
begin
  if current_user_id is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;

  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied';
  end if;

  insert into public.account_knowledge_scopes (owner_id, knowledge_workspace_id)
  values (current_user_id, p_workspace_id)
  on conflict (owner_id) do nothing;

  select scope.knowledge_workspace_id
    into resolved_workspace_id
    from public.account_knowledge_scopes scope
   where scope.owner_id = current_user_id;

  if resolved_workspace_id is null
     or not public.is_workspace_member(resolved_workspace_id) then
    raise exception 'Account knowledge workspace is unavailable';
  end if;

  return resolved_workspace_id;
end;
$$;

revoke all on function public.resolve_account_knowledge_workspace(text)
from public, anon;
grant execute on function public.resolve_account_knowledge_workspace(text)
to authenticated, service_role;
