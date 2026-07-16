create table if not exists public.project_memory_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  memory_key text not null,
  value text not null,
  category text not null default 'fact'
    check (category in ('fact', 'decision', 'requirement', 'constraint', 'assumption', 'business_rule', 'term', 'preference', 'open_question')),
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, memory_key)
);

create index if not exists project_memory_entries_workspace_idx
  on public.project_memory_entries (workspace_id, updated_at desc);

create index if not exists project_memory_entries_owner_idx
  on public.project_memory_entries (owner_id, updated_at desc);

create table if not exists public.pending_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  action text not null,
  operation text not null,
  target_section text,
  base_document jsonb not null default '{}'::jsonb,
  proposed_document jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  request_text text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'applied', 'cancelled', 'expired', 'failed')),
  confirmation_message_id text,
  error_message text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  confirmed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pending_operations_workspace_status_idx
  on public.pending_operations (workspace_id, status, created_at desc);

create index if not exists pending_operations_creator_idx
  on public.pending_operations (created_by, created_at desc);

create or replace function public.set_jetwork_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_project_memory_entries_updated_at on public.project_memory_entries;
create trigger set_project_memory_entries_updated_at
before update on public.project_memory_entries
for each row execute function public.set_jetwork_updated_at();

drop trigger if exists set_pending_operations_updated_at on public.pending_operations;
create trigger set_pending_operations_updated_at
before update on public.pending_operations
for each row execute function public.set_jetwork_updated_at();

alter table public.project_memory_entries enable row level security;
alter table public.pending_operations enable row level security;

revoke all on public.project_memory_entries from anon;
revoke all on public.pending_operations from anon;
grant select, insert, update, delete on public.project_memory_entries to authenticated;
grant select, insert, update, delete on public.pending_operations to authenticated;
grant all on public.project_memory_entries to service_role;
grant all on public.pending_operations to service_role;

create policy "Workspace members can read project memory"
on public.project_memory_entries
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.workspaces w
    where w.id = project_memory_entries.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Workspace members can create their project memory"
on public.project_memory_entries
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.workspaces w
    where w.id = project_memory_entries.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Memory owners can update their entries"
on public.project_memory_entries
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and exists (
    select 1
    from public.workspaces w
    where w.id = project_memory_entries.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Memory owners can delete their entries"
on public.project_memory_entries
for delete
to authenticated
using (owner_id = (select auth.uid()));

create policy "Workspace members can read pending operations"
on public.pending_operations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.workspaces w
    where w.id = pending_operations.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Workspace members can create pending operations"
on public.pending_operations
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.workspaces w
    where w.id = pending_operations.workspace_id
      and (
        w.owner_id = (select auth.uid())
        or w.collaborators @> jsonb_build_array(jsonb_build_object('id', (select auth.uid())::text))
      )
  )
);

create policy "Operation creators can update pending operations"
on public.pending_operations
for update
to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

create policy "Operation creators can delete pending operations"
on public.pending_operations
for delete
to authenticated
using (created_by = (select auth.uid()));
