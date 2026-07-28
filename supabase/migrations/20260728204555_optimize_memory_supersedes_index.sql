create index if not exists project_memory_entries_supersedes_scope_idx
  on public.project_memory_entries (supersedes_id, workspace_id, owner_id)
  where supersedes_id is not null;
