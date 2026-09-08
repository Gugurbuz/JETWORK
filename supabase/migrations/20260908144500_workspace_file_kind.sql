alter table public.workspace_files
  add column if not exists file_kind text generated always as (
    case
      when lower(name) ~ '\.(xlsx|xls|csv|tsv)$' or mime_type ilike '%spreadsheet%' then 'spreadsheet'
      when lower(name) ~ '\.(pptx|ppt)$' or mime_type ilike '%presentation%' then 'presentation'
      when lower(name) ~ '\.pdf$' or mime_type = 'application/pdf' then 'pdf'
      when mime_type like 'image/%' or lower(name) ~ '\.(png|jpe?g|webp|gif|svg)$' then 'image'
      else 'document'
    end
  ) stored;

create index if not exists workspace_files_kind_created_idx
  on public.workspace_files (file_kind, created_at desc) where deleted_at is null;
