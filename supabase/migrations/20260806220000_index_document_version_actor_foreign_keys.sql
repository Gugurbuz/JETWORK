create index if not exists document_drafts_updated_by_idx
  on public.document_drafts(updated_by);

create index if not exists document_versions_created_by_idx
  on public.document_versions(created_by)
  where created_by is not null;
