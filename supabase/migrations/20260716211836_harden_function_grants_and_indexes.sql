alter function public.handle_new_user() set search_path = '';
revoke all on function public.handle_new_user() from public, anon, authenticated;

alter function public.match_documents(vector, double precision, integer) set search_path = public;
revoke all on function public.match_documents(vector, double precision, integer) from public, anon;
grant execute on function public.match_documents(vector, double precision, integer) to authenticated;

alter function public.match_knowledge_text(text, integer) set search_path = public;
revoke all on function public.match_knowledge_text(text, integer) from public, anon;
grant execute on function public.match_knowledge_text(text, integer) to authenticated;

revoke all on function public.is_workspace_member(text) from public, anon;
grant execute on function public.is_workspace_member(text) to authenticated;

revoke all on function public.is_jetwork_admin() from public, anon;
grant execute on function public.is_jetwork_admin() to authenticated;

revoke all on function public.get_shared_analysis(text) from public, anon;
grant execute on function public.get_shared_analysis(text) to authenticated;

revoke all on function public.save_document_version(text, text, jsonb) from public, anon;
grant execute on function public.save_document_version(text, text, jsonb) to authenticated;

-- Username resolution is intentionally available before authentication.
revoke all on function public.resolve_login_email(text) from public;
grant execute on function public.resolve_login_email(text) to anon, authenticated;

drop policy if exists "KB owners can select" on public.knowledge_base;
create policy "KB owners can select"
on public.knowledge_base for select
to authenticated
using (owner_id = (select auth.uid()) or owner_id is null);

drop policy if exists "KB owners can insert" on public.knowledge_base;
create policy "KB owners can insert"
on public.knowledge_base for insert
to authenticated
with check (owner_id = (select auth.uid()) or owner_id is null);

create index if not exists document_versions_workspace_idx
  on public.document_versions(workspace_id);
create index if not exists documents_workspace_idx
  on public.documents(workspace_id);
create index if not exists messages_workspace_idx
  on public.messages(workspace_id);
create index if not exists projects_owner_idx
  on public.projects(owner_id);
create index if not exists raw_responses_workspace_idx
  on public.raw_responses(workspace_id);
create index if not exists shared_analyses_workspace_idx
  on public.shared_analyses(workspace_id);
create index if not exists workspaces_owner_idx
  on public.workspaces(owner_id);
create index if not exists workspaces_project_idx
  on public.workspaces(project_id);
