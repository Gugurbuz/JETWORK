do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'kb_sources',
    'kb_source_versions',
    'kb_objects',
    'kb_object_versions',
    'kb_relations',
    'kb_chunks',
    'kb_ingestion_jobs'
  ] loop
    execute format(
      'create policy "Permanent users only for %1$s"
       on public.%1$I
       as restrictive
       for all
       to authenticated
       using (
         coalesce((select (auth.jwt()->>''is_anonymous'')::boolean), false) is false
       )
       with check (
         coalesce((select (auth.jwt()->>''is_anonymous'')::boolean), false) is false
       )',
      target_table
    );
  end loop;
end
$$;

create policy "Permanent users only for knowledge storage"
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id <> 'knowledge-sources'
  or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
)
with check (
  bucket_id <> 'knowledge-sources'
  or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
);
