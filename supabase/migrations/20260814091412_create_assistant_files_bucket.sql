insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'assistant-files',
  'assistant-files',
  false,
  20971520,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Workspace members can read assistant files"
on storage.objects for select to authenticated
using (
  bucket_id = 'assistant-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Workspace members can upload assistant files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'assistant-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Workspace members can update assistant files"
on storage.objects for update to authenticated
using (
  bucket_id = 'assistant-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
)
with check (
  bucket_id = 'assistant-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);

create policy "Workspace members can delete assistant files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'assistant-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.is_workspace_member((storage.foldername(name))[2])
);
