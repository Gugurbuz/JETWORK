create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Extend current document and version records without breaking old data.
-- -----------------------------------------------------------------------------

alter table public.documents
  add column if not exists current_version_id text,
  add column if not exists current_version_number bigint not null default 0,
  add column if not exists content_hash text;

alter table public.document_versions
  add column if not exists version_number bigint,
  add column if not exists parent_version_id text,
  add column if not exists change_source text,
  add column if not exists change_summary text,
  add column if not exists changed_sections text[] not null default '{}'::text[],
  add column if not exists source_message_id text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists content_hash text,
  add column if not exists idempotency_key text;

update public.document_versions
set source_message_id = message_id
where source_message_id is null
  and message_id is not null;

update public.document_versions
set change_source = case
  when coalesce(message_id, '') like 'manual-%' then 'MANUAL'
  else 'SYSTEM'
end
where change_source is null;

update public.document_versions
set change_summary = case
  when change_source = 'MANUAL' then 'Geçmiş manuel doküman kaydı'
  else 'Geçmiş doküman kaydı'
end
where change_summary is null;

with ranked_versions as (
  select
    version.id,
    row_number() over (
      partition by version.workspace_id, version.document_id
      order by version.created_at asc, version.id asc
    )::bigint as calculated_version_number
  from public.document_versions version
)
update public.document_versions version
set version_number = ranked.calculated_version_number
from ranked_versions ranked
where version.id = ranked.id
  and version.version_number is null;

update public.document_versions
set content_hash = encode(extensions.digest(content::text, 'sha256'), 'hex')
where content_hash is null;

alter table public.document_versions
  alter column version_number set not null,
  alter column change_source set not null,
  alter column change_summary set not null;

create unique index if not exists document_versions_workspace_document_number_key
  on public.document_versions(workspace_id, document_id, version_number);

create unique index if not exists document_versions_idempotency_key
  on public.document_versions(workspace_id, document_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists document_versions_workspace_document_created_idx
  on public.document_versions(workspace_id, document_id, created_at desc);

create index if not exists document_versions_parent_idx
  on public.document_versions(parent_version_id)
  where parent_version_id is not null;

with latest_versions as (
  select distinct on (version.workspace_id, version.document_id)
    version.workspace_id,
    version.document_id,
    version.id,
    version.version_number,
    version.content_hash
  from public.document_versions version
  order by
    version.workspace_id,
    version.document_id,
    version.version_number desc,
    version.created_at desc
)
update public.documents document
set
  current_version_id = latest.id,
  current_version_number = latest.version_number,
  content_hash = latest.content_hash
from latest_versions latest
where document.workspace_id = latest.workspace_id
  and document.id = latest.document_id
  and (
    document.current_version_id is null
    or document.current_version_number = 0
  );

-- -----------------------------------------------------------------------------
-- 2. Store autosaved editor drafts separately from immutable checkpoints.
-- -----------------------------------------------------------------------------

create table if not exists public.document_drafts (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  document_id text not null default 'main',
  section_key text not null check (section_key in ('businessAnalysis', 'review')),
  base_version_id text,
  content text not null default '',
  updated_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, document_id, section_key, updated_by)
);

alter table public.document_drafts enable row level security;

drop policy if exists document_drafts_select_own on public.document_drafts;
create policy document_drafts_select_own
on public.document_drafts for select
to authenticated
using (
  updated_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

drop policy if exists document_drafts_insert_own on public.document_drafts;
create policy document_drafts_insert_own
on public.document_drafts for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

drop policy if exists document_drafts_update_own on public.document_drafts;
create policy document_drafts_update_own
on public.document_drafts for update
to authenticated
using (
  updated_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
)
with check (
  updated_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

drop policy if exists document_drafts_delete_own on public.document_drafts;
create policy document_drafts_delete_own
on public.document_drafts for delete
to authenticated
using (
  updated_by = (select auth.uid())
  and public.is_workspace_member(workspace_id)
);

grant select, insert, update, delete on public.document_drafts to authenticated;

-- Version rows are append-only. They can only be inserted by the security-definer
-- commit function below. Workspace deletion can still remove them through FK cascade.
drop policy if exists document_versions_insert_member on public.document_versions;
drop policy if exists document_versions_delete_owner on public.document_versions;
revoke insert, update, delete on public.document_versions from authenticated;
grant select on public.document_versions to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Atomically commit a version with optimistic concurrency and idempotency.
-- -----------------------------------------------------------------------------

create or replace function public.commit_document_version_v2(
  p_workspace_id text,
  p_document_id text,
  p_content jsonb,
  p_expected_current_version_id text,
  p_change_source text,
  p_change_summary text,
  p_changed_sections text[],
  p_source_message_id text,
  p_idempotency_key text,
  p_provider text,
  p_model text
)
returns table (
  version_id text,
  version_number bigint,
  parent_version_id text,
  content_hash text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_version_id text;
  v_current_version_number bigint;
  v_new_version_id text;
  v_new_version_number bigint;
  v_content_hash text;
  v_created_at timestamptz;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  if p_document_id is null or btrim(p_document_id) = '' then
    raise exception 'document id is required' using errcode = '22023';
  end if;

  if p_change_source not in ('AI', 'MANUAL', 'RESTORE', 'TEMPLATE', 'IMPORT', 'SYSTEM') then
    raise exception 'unsupported document change source: %', p_change_source
      using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    return query
    select
      existing.id,
      existing.version_number,
      existing.parent_version_id,
      existing.content_hash,
      existing.created_at
    from public.document_versions existing
    where existing.workspace_id = p_workspace_id
      and existing.document_id = p_document_id
      and existing.idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return;
    end if;
  end if;

  insert into public.documents (
    id,
    workspace_id,
    content,
    current_version_number,
    updated_at,
    last_updated,
    updated_by
  )
  values (
    p_document_id,
    p_workspace_id,
    '{}'::jsonb,
    0,
    now(),
    now(),
    (select auth.uid())::text
  )
  on conflict (id, workspace_id) do nothing;

  select
    document.current_version_id,
    coalesce(document.current_version_number, 0)
  into
    v_current_version_id,
    v_current_version_number
  from public.documents document
  where document.id = p_document_id
    and document.workspace_id = p_workspace_id
  for update;

  if v_current_version_id is distinct from p_expected_current_version_id then
    raise exception 'DOCUMENT_VERSION_CONFLICT'
      using
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedCurrentVersionId', p_expected_current_version_id,
          'actualCurrentVersionId', v_current_version_id,
          'actualCurrentVersionNumber', v_current_version_number
        )::text,
        hint = 'Belge başka bir oturum tarafından güncellendi. Yeni sürümü yükleyip değişiklikleri karşılaştırın.';
  end if;

  v_new_version_id := gen_random_uuid()::text;
  v_new_version_number := v_current_version_number + 1;
  v_content_hash := encode(extensions.digest(p_content::text, 'sha256'), 'hex');
  v_created_at := now();

  insert into public.document_versions (
    id,
    workspace_id,
    document_id,
    message_id,
    content,
    created_at,
    version_number,
    parent_version_id,
    change_source,
    change_summary,
    changed_sections,
    source_message_id,
    created_by,
    provider,
    model,
    content_hash,
    idempotency_key
  )
  values (
    v_new_version_id,
    p_workspace_id,
    p_document_id,
    p_source_message_id,
    p_content,
    v_created_at,
    v_new_version_number,
    v_current_version_id,
    p_change_source,
    coalesce(nullif(btrim(p_change_summary), ''), 'Doküman güncellendi'),
    coalesce(p_changed_sections, '{}'::text[]),
    p_source_message_id,
    (select auth.uid()),
    p_provider,
    p_model,
    v_content_hash,
    p_idempotency_key
  );

  update public.documents document
  set
    content = p_content,
    current_version_id = v_new_version_id,
    current_version_number = v_new_version_number,
    content_hash = v_content_hash,
    updated_at = v_created_at,
    last_updated = v_created_at,
    updated_by = (select auth.uid())::text
  where document.id = p_document_id
    and document.workspace_id = p_workspace_id;

  update public.workspaces workspace
  set last_updated = v_created_at
  where workspace.id = p_workspace_id;

  return query
  select
    v_new_version_id,
    v_new_version_number,
    v_current_version_id,
    v_content_hash,
    v_created_at;
end;
$$;

revoke all on function public.commit_document_version_v2(
  text, text, jsonb, text, text, text, text[], text, text, text, text
) from public, anon;
grant execute on function public.commit_document_version_v2(
  text, text, jsonb, text, text, text, text[], text, text, text, text
) to authenticated;

-- Keep all existing callers working, but route them through the safe V2 function.
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
declare
  v_expected_current_version_id text;
  v_change_source text;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'workspace access denied' using errcode = '42501';
  end if;

  select document.current_version_id
  into v_expected_current_version_id
  from public.documents document
  where document.id = 'main'
    and document.workspace_id = p_workspace_id;

  v_change_source := case
    when coalesce(p_message_id, '') like 'manual-%' then 'MANUAL'
    when coalesce(p_message_id, '') like 'restore-%' then 'RESTORE'
    else 'AI'
  end;

  perform *
  from public.commit_document_version_v2(
    p_workspace_id,
    'main',
    p_content,
    v_expected_current_version_id,
    v_change_source,
    case
      when v_change_source = 'MANUAL' then 'Doküman manuel olarak düzenlendi'
      when v_change_source = 'RESTORE' then 'Geçmiş doküman sürümü geri yüklendi'
      else 'AI dokümanı güncelledi'
    end,
    '{}'::text[],
    p_message_id,
    p_message_id,
    null,
    null
  );
end;
$$;

revoke all on function public.save_document_version(text, text, jsonb) from public, anon;
grant execute on function public.save_document_version(text, text, jsonb) to authenticated;

-- Realtime is useful for showing that another participant committed a new version.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'document_drafts'
  ) then
    alter publication supabase_realtime add table public.document_drafts;
  end if;
end;
$$;
