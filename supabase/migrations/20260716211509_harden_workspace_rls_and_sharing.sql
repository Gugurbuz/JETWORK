create extension if not exists pgcrypto with schema extensions;

create or replace function public.is_workspace_member(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces workspace
    where workspace.id = target_workspace_id
      and (
        workspace.owner_id = (select auth.uid())
        or coalesce(workspace.collaborators, '[]'::jsonb) @> jsonb_build_array(
          jsonb_build_object('id', (select auth.uid())::text)
        )
      )
  );
$$;

revoke all on function public.is_workspace_member(text) from public;
grant execute on function public.is_workspace_member(text) to authenticated;

do $$
declare
  target_table text;
  existing_policy record;
begin
  foreach target_table in array array[
    'projects',
    'workspaces',
    'messages',
    'documents',
    'document_versions',
    'raw_responses',
    'shared_analyses',
    'roles',
    'settings',
    'users'
  ] loop
    if to_regclass(format('public.%I', target_table)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', target_table);
    for existing_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy if exists %I on public.%I', existing_policy.policyname, target_table);
    end loop;
  end loop;
end;
$$;

create policy projects_select_member
on public.projects for select to authenticated
using (
  owner_id = (select auth.uid())
  or exists (
    select 1 from public.workspaces workspace
    where workspace.project_id = projects.id
      and public.is_workspace_member(workspace.id)
  )
);

create policy projects_insert_owner
on public.projects for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy projects_update_owner
on public.projects for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy projects_delete_owner
on public.projects for delete to authenticated
using (owner_id = (select auth.uid()));

create policy workspaces_select_member
on public.workspaces for select to authenticated
using (public.is_workspace_member(id));

create policy workspaces_insert_owner
on public.workspaces for insert to authenticated
with check (owner_id = (select auth.uid()));

create policy workspaces_update_owner
on public.workspaces for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy workspaces_delete_owner
on public.workspaces for delete to authenticated
using (owner_id = (select auth.uid()));

create policy messages_select_member
on public.messages for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy messages_insert_member
on public.messages for insert to authenticated
with check (
  public.is_workspace_member(workspace_id)
  and owner_id = (select auth.uid())
);

create policy messages_update_author
on public.messages for update to authenticated
using (owner_id = (select auth.uid()) and public.is_workspace_member(workspace_id))
with check (owner_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

create policy messages_delete_author
on public.messages for delete to authenticated
using (owner_id = (select auth.uid()) and public.is_workspace_member(workspace_id));

create policy documents_select_member
on public.documents for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy documents_insert_member
on public.documents for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy documents_update_member
on public.documents for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy documents_delete_owner
on public.documents for delete to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = documents.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy document_versions_select_member
on public.document_versions for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy document_versions_insert_member
on public.document_versions for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy document_versions_delete_owner
on public.document_versions for delete to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = document_versions.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy raw_responses_select_member
on public.raw_responses for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy raw_responses_insert_member
on public.raw_responses for insert to authenticated
with check (public.is_workspace_member(workspace_id));

create policy raw_responses_delete_owner
on public.raw_responses for delete to authenticated
using (
  exists (
    select 1 from public.workspaces workspace
    where workspace.id = raw_responses.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

alter table public.shared_analyses
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists token_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

update public.shared_analyses share
set owner_id = workspace.owner_id
from public.workspaces workspace
where share.owner_id is null and workspace.id = share.workspace_id;

create unique index if not exists shared_analyses_token_hash_key
on public.shared_analyses(token_hash)
where token_hash is not null;

create index if not exists shared_analyses_owner_created_idx
on public.shared_analyses(owner_id, created_at desc);

create policy shared_analyses_select_owner
on public.shared_analyses for select to authenticated
using (owner_id = (select auth.uid()));

create policy shared_analyses_insert_owner
on public.shared_analyses for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and public.is_workspace_member(workspace_id)
  and token_hash is not null
  and expires_at > now()
);

create policy shared_analyses_update_owner
on public.shared_analyses for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy shared_analyses_delete_owner
on public.shared_analyses for delete to authenticated
using (owner_id = (select auth.uid()));

create policy roles_select_authenticated
on public.roles for select to authenticated
using (true);

create policy users_select_directory
on public.users for select to authenticated
using (true);

create policy users_insert_self
on public.users for insert to authenticated
with check (uid = (select auth.uid()));

create policy users_update_self
on public.users for update to authenticated
using (uid = (select auth.uid()))
with check (uid = (select auth.uid()));

create policy users_delete_self
on public.users for delete to authenticated
using (uid = (select auth.uid()));

create or replace function public.resolve_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.email
  from public.users profile
  where lower(profile.username) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

create or replace function public.is_jetwork_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users profile
    where profile.uid = (select auth.uid())
      and lower(coalesce(profile.role, '')) in ('admin', 'administrator', 'yonetici', 'yönetici')
  );
$$;

revoke all on function public.is_jetwork_admin() from public;
grant execute on function public.is_jetwork_admin() to authenticated;

create policy settings_select_authenticated
on public.settings for select to authenticated
using (true);

create policy settings_insert_admin
on public.settings for insert to authenticated
with check (public.is_jetwork_admin());

create policy settings_update_admin
on public.settings for update to authenticated
using (public.is_jetwork_admin())
with check (public.is_jetwork_admin());

create policy settings_delete_admin
on public.settings for delete to authenticated
using (public.is_jetwork_admin());

create or replace function public.get_shared_analysis(p_token text)
returns table (
  share_id text,
  workspace_id text,
  data jsonb,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    share.id,
    share.workspace_id,
    coalesce(share.data, share.document),
    share.expires_at
  from public.shared_analyses share
  where share.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and share.revoked_at is null
    and share.expires_at > now()
  limit 1;
$$;

revoke all on function public.get_shared_analysis(text) from public;
grant execute on function public.get_shared_analysis(text) to authenticated;

create or replace function public.save_document_version(
  p_workspace_id text,
  p_message_id text,
  p_content jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.document_versions version
    where version.id = p_message_id
      and version.workspace_id <> p_workspace_id
  ) then
    raise exception 'document version id belongs to another workspace' using errcode = '23505';
  end if;

  insert into public.documents (
    id, workspace_id, content, updated_at, last_updated, updated_by
  ) values (
    'main', p_workspace_id, p_content, now(), now(), (select auth.uid())::text
  )
  on conflict (id, workspace_id) do update
    set content = excluded.content,
        updated_at = excluded.updated_at,
        last_updated = excluded.last_updated,
        updated_by = excluded.updated_by;

  insert into public.document_versions (
    id, workspace_id, document_id, message_id, content, created_at
  ) values (
    p_message_id, p_workspace_id, 'main', p_message_id, p_content, now()
  )
  on conflict (id) do update
    set content = excluded.content
    where public.document_versions.workspace_id = excluded.workspace_id;
end;
$$;

revoke all on function public.save_document_version(text, text, jsonb) from public;
grant execute on function public.save_document_version(text, text, jsonb) to authenticated;
