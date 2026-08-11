-- Conversation Scope + Project Brain v2
-- Standalone chats are workspaces with project_id = null.
-- Project membership is project-level and grants visibility to all project workspaces.
-- The active assistant prompt receives an explicit standalone/project scope block.

alter table public.workspaces
  add column if not exists title_source text not null default 'user',
  add column if not exists title_generated_at timestamptz;

alter table public.workspaces
  drop constraint if exists workspaces_title_source_check;

alter table public.workspaces
  add constraint workspaces_title_source_check
  check (title_source in ('pending', 'auto', 'user'));

create table if not exists public.project_members (
  project_id text not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.users(uid) on delete cascade,
  role text not null default 'member',
  added_by uuid references public.users(uid) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_project_idx
  on public.project_members(user_id, project_id);

alter table public.project_members enable row level security;
grant select, insert, update, delete on table public.project_members to authenticated;
grant all on table public.project_members to service_role;

create or replace function public.is_project_member(target_project_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects project
      where project.id = target_project_id
        and project.deleted_at is null
        and (
          project.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.project_members member
            where member.project_id = project.id
              and member.user_id = (select auth.uid())
          )
        )
    );
$$;

revoke all on function public.is_project_member(text) from public, anon;
grant execute on function public.is_project_member(text) to authenticated, service_role;

-- Knowledge Architecture v2 must use the same canonical membership rule.
create or replace function public.is_project_member_v2(target_project_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_project_member(target_project_id);
$$;

revoke all on function public.is_project_member_v2(text) from public, anon;
grant execute on function public.is_project_member_v2(text) to authenticated, service_role;

create or replace function public.is_workspace_member(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.workspaces workspace
      where workspace.id = target_workspace_id
        and workspace.deleted_at is null
        and (
          workspace.owner_id = (select auth.uid())
          or (
            workspace.project_id is null
            and coalesce(workspace.collaborators, '[]'::jsonb) @> jsonb_build_array(
              jsonb_build_object('id', (select auth.uid())::text)
            )
          )
          or (
            workspace.project_id is not null
            and public.is_project_member(workspace.project_id)
          )
        )
    );
$$;

revoke all on function public.is_workspace_member(text) from public, anon;
grant execute on function public.is_workspace_member(text) to authenticated, service_role;

-- Existing project owners are always represented in the membership ledger.
insert into public.project_members(project_id, user_id, role, added_by)
select project.id, project.owner_id, 'owner', project.owner_id
from public.projects project
where project.owner_id is not null
on conflict (project_id, user_id) do update set role = 'owner';

create or replace function public.sync_project_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.project_members(project_id, user_id, role, added_by)
    values (new.id, new.owner_id, 'owner', new.owner_id)
    on conflict (project_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;

revoke all on function public.sync_project_owner_membership() from public, anon, authenticated;
grant execute on function public.sync_project_owner_membership() to service_role;

drop trigger if exists sync_project_owner_membership_trigger on public.projects;
create trigger sync_project_owner_membership_trigger
after insert or update of owner_id on public.projects
for each row execute function public.sync_project_owner_membership();

-- Initial workspace teams and a standalone chat moved into a project become
-- project members once. Later collaborator edits do not silently re-grant a
-- member that was explicitly removed from the project.
create or replace function public.sync_workspace_initial_project_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  collaborator record;
  collaborator_id uuid;
begin
  if new.project_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.project_id is not distinct from new.project_id then
    return new;
  end if;

  if new.owner_id is not null then
    insert into public.project_members(project_id, user_id, role, added_by)
    values (new.project_id, new.owner_id, 'member', new.owner_id)
    on conflict (project_id, user_id) do nothing;
  end if;

  for collaborator in
    select value
    from jsonb_array_elements(coalesce(new.collaborators, '[]'::jsonb))
  loop
    if coalesce(collaborator.value->>'id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      collaborator_id := (collaborator.value->>'id')::uuid;
      if exists (select 1 from public.users profile where profile.uid = collaborator_id) then
        insert into public.project_members(project_id, user_id, role, added_by)
        values (new.project_id, collaborator_id, 'member', new.owner_id)
        on conflict (project_id, user_id) do nothing;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.sync_workspace_initial_project_membership() from public, anon, authenticated;
grant execute on function public.sync_workspace_initial_project_membership() to service_role;

drop trigger if exists sync_workspace_initial_project_membership_trigger on public.workspaces;
create trigger sync_workspace_initial_project_membership_trigger
after insert or update of project_id on public.workspaces
for each row execute function public.sync_workspace_initial_project_membership();

-- Project-member RLS. Owners manage membership; non-owner members may leave.
drop policy if exists project_members_select_member on public.project_members;
create policy project_members_select_member
on public.project_members for select to authenticated
using (public.is_project_member(project_id));

drop policy if exists project_members_insert_owner on public.project_members;
create policy project_members_insert_owner
on public.project_members for insert to authenticated
with check (
  exists (
    select 1 from public.projects project
    where project.id = project_members.project_id
      and project.owner_id = (select auth.uid())
  )
);

drop policy if exists project_members_update_owner on public.project_members;
create policy project_members_update_owner
on public.project_members for update to authenticated
using (
  exists (
    select 1 from public.projects project
    where project.id = project_members.project_id
      and project.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.projects project
    where project.id = project_members.project_id
      and project.owner_id = (select auth.uid())
  )
);

drop policy if exists project_members_delete_member_or_owner on public.project_members;
create policy project_members_delete_member_or_owner
on public.project_members for delete to authenticated
using (
  (
    user_id = (select auth.uid())
    and not exists (
      select 1 from public.projects project
      where project.id = project_members.project_id
        and project.owner_id = (select auth.uid())
    )
  )
  or (
    user_id <> (select auth.uid())
    and exists (
      select 1 from public.projects project
      where project.id = project_members.project_id
        and project.owner_id = (select auth.uid())
    )
  )
);

-- Projects become visible through project membership, not only via one
-- workspace collaborator list.
drop policy if exists projects_select_member on public.projects;
create policy projects_select_member
on public.projects for select to authenticated
using (owner_id = (select auth.uid()) or public.is_project_member(id));

-- A user may create a standalone workspace, or create inside a project they
-- already belong to. A workspace owner may move their standalone chat into a
-- project they belong to.
drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner
on public.workspaces for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and (project_id is null or public.is_project_member(project_id))
);

drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner
on public.workspaces for update to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and (project_id is null or public.is_project_member(project_id))
);

-- Deterministic, one-time title generation for standalone chats. It runs on
-- the first meaningful human message and never overwrites a user-controlled
-- title.
create or replace function public.derive_standalone_chat_title(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized text;
  lowered text;
  candidate text;
  clipped text;
  word_count integer;
begin
  normalized := regexp_replace(btrim(coalesce(p_text, '')), '[[:space:]]+', ' ', 'g');
  if normalized = '' then return null; end if;

  lowered := lower(btrim(regexp_replace(normalized, '[!?.,;:]+$', '', 'g')));
  if lowered = any (array[
    'selam','merhaba','hey','hello','hi','sa','slm','günaydın','gunaydin',
    'iyi akşamlar','iyi aksamlar','iyi geceler','ok','tamam','peki','evet','hayır','hayir'
  ]::text[]) then
    return null;
  end if;

  word_count := coalesce(array_length(regexp_split_to_array(lowered, '[[:space:]]+'), 1), 0);
  if word_count < 2 and normalized !~ '[A-Z][A-Z0-9_/-]{2,}' then
    return null;
  end if;

  candidate := regexp_replace(
    normalized,
    '^(şimdi|simdi|burada|bana|acaba|peki|tamam|şöyle|soyle|bir de)[[:space:]]+',
    '',
    'i'
  );
  candidate := btrim(regexp_replace(candidate, '[!?.,;:]+$', '', 'g'));
  if candidate = '' then candidate := normalized; end if;

  if char_length(candidate) > 58 then
    clipped := left(candidate, 58);
    if clipped ~ '[[:space:]]' then
      clipped := regexp_replace(clipped, '[[:space:]]+[^[:space:]]*$', '');
    end if;
    candidate := coalesce(nullif(btrim(clipped), ''), left(candidate, 58));
  end if;

  return nullif(candidate, '');
end;
$$;

revoke all on function public.derive_standalone_chat_title(text) from public, anon, authenticated;
grant execute on function public.derive_standalone_chat_title(text) to service_role;

create or replace function public.auto_title_standalone_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_record public.workspaces%rowtype;
  generated_title text;
begin
  if new.role <> 'user' or btrim(coalesce(new.text, '')) = '' then
    return new;
  end if;

  select * into workspace_record
  from public.workspaces workspace
  where workspace.id = new.workspace_id
  for update;

  if workspace_record.id is null
     or workspace_record.project_id is not null
     or workspace_record.title_source <> 'pending' then
    return new;
  end if;

  generated_title := public.derive_standalone_chat_title(new.text);
  if generated_title is null then return new; end if;

  update public.workspaces
  set title = generated_title,
      title_source = 'auto',
      title_generated_at = now(),
      last_updated = now()
  where id = new.workspace_id
    and project_id is null
    and title_source = 'pending';

  return new;
end;
$$;

revoke all on function public.auto_title_standalone_chat() from public, anon, authenticated;
grant execute on function public.auto_title_standalone_chat() to service_role;

drop trigger if exists auto_title_standalone_chat_trigger on public.messages;
create trigger auto_title_standalone_chat_trigger
after insert on public.messages
for each row
when (new.role = 'user')
execute function public.auto_title_standalone_chat();

-- Build the cross-workspace project context centrally on the server. Only
-- human-authored sibling messages are included. AI sibling answers are never
-- promoted to project facts by this context block.
create or replace function public.render_conversation_scope_prompt(target_workspace_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with active_workspace as (
    select workspace.id, workspace.title, workspace.project_id
    from public.workspaces workspace
    where workspace.id = target_workspace_id
      and workspace.deleted_at is null
    limit 1
  ),
  active_project as (
    select project.id, project.name, project.description
    from public.projects project
    join active_workspace workspace on workspace.project_id = project.id
    where project.deleted_at is null
    limit 1
  ),
  siblings as (
    select workspace.id, workspace.title, workspace.last_updated
    from public.workspaces workspace
    join active_workspace active on active.project_id = workspace.project_id
    where active.project_id is not null
      and workspace.id <> active.id
      and workspace.deleted_at is null
    order by workspace.last_updated desc
    limit 12
  ),
  sibling_context as (
    select string_agg(
      '--- Sibling workspace: ' || coalesce(sibling.title, 'Adsız çalışma alanı') || ' ---' || E'\n' ||
      coalesce((
        select string_agg(
          'USER: ' || left(message_window.text, 1200),
          E'\n' order by message_window.created_at
        )
        from (
          select message.text, message.created_at
          from public.messages message
          where message.workspace_id = sibling.id
            and message.role = 'user'
            and btrim(coalesce(message.text, '')) <> ''
          order by message.created_at desc
          limit 5
        ) message_window
      ), '[Yakın insan mesajı yok]'),
      E'\n' order by sibling.last_updated desc
    ) as value
    from siblings sibling
  )
  select case
    when workspace.project_id is null then
      '[CONVERSATION SCOPE]' || E'\n' ||
      'Mode: STANDALONE' || E'\n' ||
      'Workspace: ' || coalesce(workspace.title, 'Adsız çalışma alanı') || E'\n' ||
      'Bu konuşma herhangi bir projeye bağlı değildir.' || E'\n' ||
      'Proje adı, proje belleği, proje üyesi veya başka workspace bağlamı varsayma.' || E'\n' ||
      'Global JetWork bilgi bankası kullanılabilir; proje-özel bağlam ancak kullanıcı bu sohbeti bir projeye taşıdıktan sonra kullanılabilir.'
    else
      '[CONVERSATION SCOPE]' || E'\n' ||
      'Mode: PROJECT' || E'\n' ||
      'Project: ' || coalesce(project.name, workspace.project_id) || E'\n' ||
      case when btrim(coalesce(project.description, '')) <> ''
        then 'Project description: ' || left(project.description, 800) || E'\n'
        else ''
      end ||
      'Active workspace: ' || coalesce(workspace.title, 'Adsız çalışma alanı') || E'\n' ||
      'Aynı projedeki diğer çalışma alanları ortak proje bağlamıdır.' || E'\n' ||
      'Aşağıdaki sibling içerikte yalnız insan-yazarlı mesajlar bulunur; sibling AI cevapları FACT olarak taşınmaz.' || E'\n' ||
      'Exact teknik mesaj, sınıf, metot, tablo, kod veya benzeri iddiaları sibling bağlamda geçse bile mevcut grounding/evidence kurallarıyla ayrıca doğrula.' || E'\n' ||
      case when coalesce(context.value, '') <> '' then
        '[UNTRUSTED_PROJECT_SIBLING_HUMAN_CONTEXT]' || E'\n' ||
        left(context.value, 18000) || E'\n' ||
        '[END_UNTRUSTED_PROJECT_SIBLING_HUMAN_CONTEXT]'
      else
        'Sibling workspace insan bağlamı henüz yok.'
      end
  end
  from active_workspace workspace
  left join active_project project on true
  left join sibling_context context on true;
$$;

revoke all on function public.render_conversation_scope_prompt(text) from public, anon, authenticated;
grant execute on function public.render_conversation_scope_prompt(text) to service_role;

-- The runtime already loads the active prompt for every turn. Append the scope
-- block there so both OpenAI and Gemini receive the same authoritative scope
-- without trusting browser-supplied project context.
create or replace function public.get_active_assistant_prompt(
  p_workspace_id text
)
returns table (
  id uuid,
  workspace_id text,
  version integer,
  prompt_text text,
  model text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    prompt.id,
    prompt.workspace_id,
    prompt.version,
    prompt.prompt_text || E'\n\n' || coalesce(public.render_conversation_scope_prompt(p_workspace_id), ''),
    prompt.model
  from public.assistant_prompt_versions prompt
  where prompt.is_active
    and (
      prompt.workspace_id = p_workspace_id
      or prompt.workspace_id is null
    )
  order by
    (prompt.workspace_id = p_workspace_id) desc,
    prompt.version desc
  limit 1;
$$;

revoke all on function public.get_active_assistant_prompt(text)
from public, anon, authenticated;
grant execute on function public.get_active_assistant_prompt(text)
to service_role;

comment on column public.workspaces.project_id is
  'Nullable by design. NULL means standalone conversation; non-NULL means project-scoped workspace.';
comment on column public.workspaces.title_source is
  'pending: waiting for first meaningful user turn; auto: generated once; user: manually controlled.';
comment on table public.project_members is
  'Canonical project-level membership. Project-scoped workspace access inherits from this table.';
