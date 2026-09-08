-- JETWORK Workspace & Artifact UX V2
-- Canonical artifact identity, immutable versions and a queryable workspace file index.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  artifact_type text not null default 'file',
  title text not null,
  status text not null default 'requested' check (status in (
    'requested','researching','drafting','validating','executing','verifying','persisted','completed',
    'executor_failed','verification_failed','persistence_failed'
  )),
  active_version integer not null default 0 check (active_version >= 0),
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.artifact_versions (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  attachment_id text not null,
  filename text not null,
  mime_type text not null,
  storage_bucket text not null,
  storage_path text not null,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
  executor_status text not null default 'completed' check (executor_status in ('not_started','completed','failed')),
  qa_status text not null default 'verified' check (qa_status in ('pending','verified','failed')),
  evidence_refs jsonb not null default '[]'::jsonb,
  supersedes_version integer,
  created_at timestamptz not null default now(),
  unique (artifact_id, version),
  unique (workspace_id, attachment_id)
);

create table if not exists public.workspace_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  message_id text,
  attachment_id text not null,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  storage_bucket text,
  storage_path text,
  origin text not null check (origin in ('generated','uploaded')),
  artifact_id uuid references public.artifacts(id) on delete set null,
  artifact_version integer,
  artifact_state text check (artifact_state is null or artifact_state in (
    'requested','researching','drafting','validating','executing','verifying','persisted','completed',
    'executor_failed','verification_failed','persistence_failed'
  )),
  byte_size bigint check (byte_size is null or byte_size >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (workspace_id, attachment_id)
);

create index if not exists artifacts_workspace_updated_idx
  on public.artifacts (workspace_id, updated_at desc) where deleted_at is null;
create index if not exists artifact_versions_workspace_created_idx
  on public.artifact_versions (workspace_id, created_at desc);
create index if not exists workspace_files_workspace_created_idx
  on public.workspace_files (workspace_id, created_at desc) where deleted_at is null;
create index if not exists workspace_files_origin_created_idx
  on public.workspace_files (origin, created_at desc) where deleted_at is null;
create index if not exists workspace_files_artifact_idx
  on public.workspace_files (artifact_id, artifact_version desc) where artifact_id is not null and deleted_at is null;
create index if not exists workspace_files_name_lower_idx
  on public.workspace_files (lower(name)) where deleted_at is null;

alter table public.artifacts enable row level security;
alter table public.artifact_versions enable row level security;
alter table public.workspace_files enable row level security;

drop policy if exists artifacts_select_member on public.artifacts;
create policy artifacts_select_member on public.artifacts for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists artifacts_insert_member on public.artifacts;
create policy artifacts_insert_member on public.artifacts for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists artifacts_update_member on public.artifacts;
create policy artifacts_update_member on public.artifacts for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists artifacts_delete_owner on public.artifacts;
create policy artifacts_delete_owner on public.artifacts for delete to authenticated
using (exists (
  select 1 from public.workspaces w where w.id = artifacts.workspace_id and w.owner_id = (select auth.uid())
));

drop policy if exists artifact_versions_select_member on public.artifact_versions;
create policy artifact_versions_select_member on public.artifact_versions for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists artifact_versions_insert_member on public.artifact_versions;
create policy artifact_versions_insert_member on public.artifact_versions for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists artifact_versions_delete_owner on public.artifact_versions;
create policy artifact_versions_delete_owner on public.artifact_versions for delete to authenticated
using (exists (
  select 1 from public.workspaces w where w.id = artifact_versions.workspace_id and w.owner_id = (select auth.uid())
));

drop policy if exists workspace_files_select_member on public.workspace_files;
create policy workspace_files_select_member on public.workspace_files for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_files_insert_member on public.workspace_files;
create policy workspace_files_insert_member on public.workspace_files for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_files_update_member on public.workspace_files;
create policy workspace_files_update_member on public.workspace_files for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists workspace_files_delete_owner on public.workspace_files;
create policy workspace_files_delete_owner on public.workspace_files for delete to authenticated
using (exists (
  select 1 from public.workspaces w where w.id = workspace_files.workspace_id and w.owner_id = (select auth.uid())
));

-- Index every persisted message attachment. Artifact metadata written by the executor is
-- deliberately preserved when a later message upsert replays the same attachment.
create or replace function public.index_message_workspace_files_v2()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attachment jsonb;
  attachment_key text;
  attachment_name text;
  attachment_purpose text;
begin
  if new.attachments is null or jsonb_typeof(new.attachments) <> 'array' then
    return new;
  end if;

  for attachment in select value from jsonb_array_elements(new.attachments)
  loop
    attachment_name := nullif(trim(attachment->>'name'), '');
    if attachment_name is null then
      continue;
    end if;
    if coalesce(nullif(trim(attachment->>'storagePath'), ''), nullif(trim(attachment->>'url'), '')) is null then
      continue;
    end if;

    attachment_key := coalesce(
      nullif(trim(attachment->>'attachmentId'), ''),
      nullif(trim(attachment->>'storagePath'), ''),
      new.id || ':' || attachment_name
    );
    attachment_purpose := coalesce(nullif(trim(attachment->>'purpose'), ''), 'chat_only');

    insert into public.workspace_files (
      workspace_id, message_id, attachment_id, name, mime_type, storage_bucket, storage_path,
      origin, created_at, updated_at
    ) values (
      new.workspace_id,
      new.id,
      attachment_key,
      attachment_name,
      coalesce(nullif(trim(attachment->>'mimeType'), ''), 'application/octet-stream'),
      nullif(trim(attachment->>'storageBucket'), ''),
      nullif(trim(attachment->>'storagePath'), ''),
      case when attachment_purpose = 'tool_output' then 'generated' else 'uploaded' end,
      coalesce(new.created_at, now()),
      now()
    )
    on conflict (workspace_id, attachment_id) do update set
      message_id = excluded.message_id,
      name = excluded.name,
      mime_type = excluded.mime_type,
      storage_bucket = coalesce(excluded.storage_bucket, public.workspace_files.storage_bucket),
      storage_path = coalesce(excluded.storage_path, public.workspace_files.storage_path),
      origin = excluded.origin,
      updated_at = now();
  end loop;
  return new;
end;
$$;

drop trigger if exists messages_workspace_files_v2 on public.messages;
create trigger messages_workspace_files_v2
after insert or update of attachments on public.messages
for each row execute function public.index_message_workspace_files_v2();

-- Historical backfill removes the previous client-side "last 500 messages" ceiling.
insert into public.workspace_files (
  workspace_id, message_id, attachment_id, name, mime_type, storage_bucket, storage_path,
  origin, created_at, updated_at
)
select
  m.workspace_id,
  m.id,
  coalesce(
    nullif(trim(a.value->>'attachmentId'), ''),
    nullif(trim(a.value->>'storagePath'), ''),
    m.id || ':' || trim(a.value->>'name')
  ),
  trim(a.value->>'name'),
  coalesce(nullif(trim(a.value->>'mimeType'), ''), 'application/octet-stream'),
  nullif(trim(a.value->>'storageBucket'), ''),
  nullif(trim(a.value->>'storagePath'), ''),
  case when coalesce(a.value->>'purpose', 'chat_only') = 'tool_output' then 'generated' else 'uploaded' end,
  coalesce(m.created_at, now()),
  now()
from public.messages m
cross join lateral jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) as a(value)
where nullif(trim(a.value->>'name'), '') is not null
  and coalesce(nullif(trim(a.value->>'storagePath'), ''), nullif(trim(a.value->>'url'), '')) is not null
on conflict (workspace_id, attachment_id) do nothing;

-- Single transactional persistence boundary. Version allocation happens under row lock;
-- a file is exposed as completed only after the caller has already passed executor + reload/QA.
create or replace function public.persist_completed_artifact_v2(
  p_workspace_id text,
  p_existing_artifact_id uuid,
  p_artifact_type text,
  p_title text,
  p_attachment_id text,
  p_filename text,
  p_mime_type text,
  p_storage_bucket text,
  p_storage_path text,
  p_byte_size bigint,
  p_sha256 text,
  p_evidence_refs jsonb default '[]'::jsonb,
  p_source_message_id text default null
)
returns table(artifact_id uuid, artifact_version integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_id uuid;
  next_version integer;
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'ARTIFACT_WORKSPACE_ACCESS_DENIED';
  end if;
  if p_attachment_id is null or trim(p_attachment_id) = '' or p_storage_path is null or trim(p_storage_path) = '' then
    raise exception 'ARTIFACT_REFERENCE_INVALID';
  end if;

  if p_existing_artifact_id is not null then
    select a.id, a.active_version + 1
      into target_id, next_version
    from public.artifacts a
    where a.id = p_existing_artifact_id
      and a.workspace_id = p_workspace_id
      and a.deleted_at is null
    for update;
    if target_id is null then
      raise exception 'ARTIFACT_NOT_FOUND';
    end if;
  else
    insert into public.artifacts (workspace_id, artifact_type, title, status, active_version, source_message_id)
    values (p_workspace_id, coalesce(nullif(trim(p_artifact_type), ''), 'file'), p_title, 'persisted', 0, p_source_message_id)
    returning id into target_id;
    next_version := 1;
  end if;

  insert into public.artifact_versions (
    artifact_id, workspace_id, version, attachment_id, filename, mime_type,
    storage_bucket, storage_path, byte_size, sha256, executor_status, qa_status,
    evidence_refs, supersedes_version
  ) values (
    target_id, p_workspace_id, next_version, p_attachment_id, p_filename, p_mime_type,
    p_storage_bucket, p_storage_path, p_byte_size, nullif(trim(p_sha256), ''), 'completed', 'verified',
    coalesce(p_evidence_refs, '[]'::jsonb), case when next_version > 1 then next_version - 1 else null end
  );

  insert into public.workspace_files (
    workspace_id, message_id, attachment_id, name, mime_type, storage_bucket, storage_path,
    origin, artifact_id, artifact_version, artifact_state, byte_size, sha256, created_at, updated_at
  ) values (
    p_workspace_id, p_source_message_id, p_attachment_id, p_filename, p_mime_type, p_storage_bucket, p_storage_path,
    'generated', target_id, next_version, 'completed', p_byte_size, nullif(trim(p_sha256), ''), now(), now()
  )
  on conflict (workspace_id, attachment_id) do update set
    artifact_id = excluded.artifact_id,
    artifact_version = excluded.artifact_version,
    artifact_state = 'completed',
    byte_size = excluded.byte_size,
    sha256 = excluded.sha256,
    storage_bucket = excluded.storage_bucket,
    storage_path = excluded.storage_path,
    name = excluded.name,
    mime_type = excluded.mime_type,
    origin = 'generated',
    updated_at = now(),
    deleted_at = null;

  update public.artifacts
  set active_version = next_version,
      status = 'completed',
      title = p_title,
      artifact_type = coalesce(nullif(trim(p_artifact_type), ''), artifact_type),
      updated_at = now()
  where id = target_id;

  artifact_id := target_id;
  artifact_version := next_version;
  return next;
end;
$$;

revoke all on function public.persist_completed_artifact_v2(text, uuid, text, text, text, text, text, text, text, bigint, text, jsonb, text) from public;
grant execute on function public.persist_completed_artifact_v2(text, uuid, text, text, text, text, text, text, text, bigint, text, jsonb, text) to authenticated;
