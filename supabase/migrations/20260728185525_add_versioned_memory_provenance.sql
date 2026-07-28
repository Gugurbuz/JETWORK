alter table public.project_memory_entries
  add column supersedes_id uuid,
  add column valid_from timestamptz;

update public.project_memory_entries
set valid_from = coalesce(created_at, now())
where valid_from is null;

alter table public.project_memory_entries
  alter column valid_from set default now(),
  alter column valid_from set not null;

alter table public.project_memory_entries
  drop constraint project_memory_entries_workspace_id_owner_id_memory_key_key,
  drop constraint project_memory_entries_source_type_check,
  drop constraint project_memory_entries_confirmation_state_check;

alter table public.project_memory_entries
  add constraint project_memory_entries_source_type_check
    check (source_type = any (array[
      'user_message'::text,
      'manual'::text,
      'document'::text,
      'system'::text,
      'ai_inference'::text,
      'legacy_unknown'::text
    ])),
  add constraint project_memory_entries_confirmation_state_check
    check (confirmation_state = any (array[
      'confirmed'::text,
      'inferred_from_user'::text,
      'unverified'::text,
      'proposed'::text,
      'rejected'::text
    ])),
  add constraint project_memory_entries_identity_scope_key
    unique (id, workspace_id, owner_id),
  add constraint project_memory_entries_supersedes_scope_fkey
    foreign key (supersedes_id, workspace_id, owner_id)
    references public.project_memory_entries (id, workspace_id, owner_id)
    on delete set null (supersedes_id);

create index project_memory_entries_lookup_idx
  on public.project_memory_entries (workspace_id, owner_id, memory_key, valid_from desc);

create index project_memory_entries_supersedes_idx
  on public.project_memory_entries (supersedes_id)
  where supersedes_id is not null;

comment on column public.project_memory_entries.supersedes_id is
  'Previous memory entry replaced by this version within the same workspace and owner scope.';
comment on column public.project_memory_entries.valid_from is
  'Time from which this memory version is considered valid.';
