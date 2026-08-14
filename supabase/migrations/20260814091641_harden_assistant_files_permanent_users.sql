create policy "Permanent users only for assistant files"
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id <> 'assistant-files'
  or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
)
with check (
  bucket_id <> 'assistant-files'
  or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
);
