revoke all privileges on table public.document_versions from authenticated;
grant select on table public.document_versions to authenticated;

revoke all privileges on table public.document_versions from anon;

revoke all on function public.commit_document_version_v2(
  text, text, jsonb, text, text, text, text[], text, text, text, text
) from public, anon;
grant execute on function public.commit_document_version_v2(
  text, text, jsonb, text, text, text, text[], text, text, text, text
) to authenticated;

revoke all on function public.save_document_version(text, text, jsonb) from public, anon;
grant execute on function public.save_document_version(text, text, jsonb) to authenticated;
