alter table public.messages
  add column if not exists is_error boolean not null default false,
  add column if not exists retry_payload jsonb,
  add column if not exists provider text,
  add column if not exists response_model text,
  add column if not exists fallback_used boolean not null default false;

alter table public.messages
  drop constraint if exists messages_provider_check;

alter table public.messages
  add constraint messages_provider_check
  check (provider is null or provider in ('openai', 'gemini'));

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.workspaces
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

create index if not exists projects_owner_lifecycle_updated_idx
  on public.projects (owner_id, deleted_at, archived_at, last_updated desc);

create index if not exists workspaces_owner_lifecycle_updated_idx
  on public.workspaces (owner_id, deleted_at, archived_at, last_updated desc);
