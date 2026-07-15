-- JetWork baseline schema inferred from the current frontend data access.
-- This migration creates the tables used by the React app and enables RLS.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.users (
  uid uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text unique,
  name text,
  surname text,
  role text not null default 'Kullanıcı',
  photo_url text,
  color text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

insert into public.roles (name) values
  ('Kullanıcı'),
  ('Product Owner'),
  ('Scrum Master'),
  ('İş Analisti'),
  ('Yazılım Mimarı'),
  ('Test Uzmanı')
on conflict (name) do nothing;

create table if not exists public.projects (
  id text primary key,
  name text not null,
  description text not null default '',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now()
);

create table if not exists public.workspaces (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  issue_key text,
  title text not null,
  type text,
  status text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  collaborators jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  constraint workspaces_collaborators_array check (jsonb_typeof(collaborators) = 'array')
);

create table if not exists public.messages (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  role text not null,
  text text not null default '',
  sender_name text,
  sender_role text,
  sender_color text,
  owner_id uuid default auth.uid() references auth.users(id) on delete set null,
  attachments jsonb not null default '[]'::jsonb,
  reactions jsonb not null default '[]'::jsonb,
  document_snapshot jsonb,
  previous_document_snapshot jsonb,
  document_actions jsonb,
  agent_role text,
  score numeric,
  score_explanation text,
  token_count integer,
  thinking_time integer,
  questions jsonb,
  raw_response text,
  reply_to_id text references public.messages(id) on delete set null,
  is_error boolean not null default false,
  action_summary text,
  grounding_urls jsonb,
  thinking_text text,
  created_at timestamptz not null default now(),
  constraint messages_attachments_array check (jsonb_typeof(attachments) = 'array'),
  constraint messages_reactions_array check (jsonb_typeof(reactions) = 'array')
);

create table if not exists public.documents (
  id text not null default 'main',
  workspace_id text not null references public.workspaces(id) on delete cascade,
  content jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  primary key (id, workspace_id)
);

create table if not exists public.document_versions (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  document_id text not null default 'main',
  message_id text references public.messages(id) on delete set null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_id, workspace_id) references public.documents(id, workspace_id) on delete cascade
);

create table if not exists public.shared_analyses (
  id text primary key,
  data jsonb not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_responses (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  message_id text references public.messages(id) on delete set null,
  raw_text text,
  parsed_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (lower(email));
create index if not exists projects_owner_id_idx on public.projects (owner_id);
create index if not exists workspaces_project_id_idx on public.workspaces (project_id);
create index if not exists workspaces_owner_id_idx on public.workspaces (owner_id);
create index if not exists workspaces_collaborators_gin_idx on public.workspaces using gin (collaborators jsonb_path_ops);
create index if not exists messages_workspace_id_created_at_idx on public.messages (workspace_id, created_at);
create index if not exists documents_workspace_id_idx on public.documents (workspace_id);
create index if not exists document_versions_workspace_id_created_at_idx on public.document_versions (workspace_id, created_at desc);
create index if not exists raw_responses_workspace_id_idx on public.raw_responses (workspace_id);
create index if not exists shared_analyses_created_by_idx on public.shared_analyses (created_by);

create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_workspace_member(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace_id
      and (
        w.owner_id = auth.uid()
        or exists (
          select 1
          from jsonb_array_elements(coalesce(w.collaborators, '[]'::jsonb)) as collaborator
          where lower(collaborator ->> 'email') = public.current_user_email()
        )
      )
  );
$$;

create or replace function public.is_project_member(target_project_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and p.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspaces w
    where w.project_id = target_project_id
      and public.is_workspace_member(w.id)
  );
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.current_user_email() to authenticated;
grant execute on function public.is_workspace_member(text) to authenticated;
grant execute on function public.is_project_member(text) to authenticated;

alter table public.users enable row level security;
alter table public.roles enable row level security;
alter table public.projects enable row level security;
alter table public.workspaces enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.shared_analyses enable row level security;
alter table public.settings enable row level security;
alter table public.raw_responses enable row level security;

drop policy if exists users_read_profiles on public.users;
create policy users_read_profiles on public.users
for select to authenticated
using (true);

drop policy if exists users_insert_own_profile on public.users;
create policy users_insert_own_profile on public.users
for insert to authenticated
with check (uid = auth.uid());

drop policy if exists users_update_own_profile on public.users;
create policy users_update_own_profile on public.users
for update to authenticated
using (uid = auth.uid())
with check (uid = auth.uid());

drop policy if exists roles_read_authenticated on public.roles;
create policy roles_read_authenticated on public.roles
for select to authenticated
using (true);

drop policy if exists projects_read_members on public.projects;
create policy projects_read_members on public.projects
for select to authenticated
using (public.is_project_member(id));

drop policy if exists projects_insert_owner on public.projects;
create policy projects_insert_owner on public.projects
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists projects_update_owner on public.projects;
create policy projects_update_owner on public.projects
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects
for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists workspaces_read_members on public.workspaces;
create policy workspaces_read_members on public.workspaces
for select to authenticated
using (public.is_workspace_member(id));

drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner on public.workspaces
for insert to authenticated
with check (owner_id = auth.uid());

drop policy if exists workspaces_update_members on public.workspaces;
create policy workspaces_update_members on public.workspaces
for update to authenticated
using (public.is_workspace_member(id))
with check (public.is_workspace_member(id));

drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner on public.workspaces
for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists messages_read_workspace_members on public.messages;
create policy messages_read_workspace_members on public.messages
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists messages_insert_workspace_members on public.messages;
create policy messages_insert_workspace_members on public.messages
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists messages_update_workspace_members on public.messages;
create policy messages_update_workspace_members on public.messages
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists documents_read_workspace_members on public.documents;
create policy documents_read_workspace_members on public.documents
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists documents_insert_workspace_members on public.documents;
create policy documents_insert_workspace_members on public.documents
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists documents_update_workspace_members on public.documents;
create policy documents_update_workspace_members on public.documents
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists document_versions_read_workspace_members on public.document_versions;
create policy document_versions_read_workspace_members on public.document_versions
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists document_versions_insert_workspace_members on public.document_versions;
create policy document_versions_insert_workspace_members on public.document_versions
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists document_versions_update_workspace_members on public.document_versions;
create policy document_versions_update_workspace_members on public.document_versions
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists raw_responses_read_workspace_members on public.raw_responses;
create policy raw_responses_read_workspace_members on public.raw_responses
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists raw_responses_insert_workspace_members on public.raw_responses;
create policy raw_responses_insert_workspace_members on public.raw_responses
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists raw_responses_update_workspace_members on public.raw_responses;
create policy raw_responses_update_workspace_members on public.raw_responses
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists shared_analyses_read_authenticated on public.shared_analyses;
create policy shared_analyses_read_authenticated on public.shared_analyses
for select to authenticated
using (true);

drop policy if exists shared_analyses_insert_authenticated on public.shared_analyses;
create policy shared_analyses_insert_authenticated on public.shared_analyses
for insert to authenticated
with check (created_by = auth.uid());

drop policy if exists settings_read_authenticated on public.settings;
create policy settings_read_authenticated on public.settings
for select to authenticated
using (true);

drop policy if exists settings_insert_authenticated on public.settings;
create policy settings_insert_authenticated on public.settings
for insert to authenticated
with check (true);

drop policy if exists settings_update_authenticated on public.settings;
create policy settings_update_authenticated on public.settings
for update to authenticated
using (true)
with check (true);

alter table public.projects replica identity full;
alter table public.workspaces replica identity full;
alter table public.messages replica identity full;
alter table public.documents replica identity full;

do $$
declare
  realtime_table text;
begin
  foreach realtime_table in array array['projects', 'workspaces', 'messages', 'documents']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', realtime_table);
    exception
      when duplicate_object or undefined_object then null;
    end;
  end loop;
end;
$$;
