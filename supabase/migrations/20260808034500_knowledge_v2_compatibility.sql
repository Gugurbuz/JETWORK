-- Runtime compatibility and privilege hardening for Knowledge Architecture v2.
-- Old assistant code calls resolve_account_knowledge_workspace before invoking tools.
-- In v2 the active workspace is only a project-context pointer, not a knowledge container.
create or replace function public.resolve_account_knowledge_workspace(
  p_workspace_id text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) then
    raise exception 'A permanent authenticated user is required';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace access denied';
  end if;
  return p_workspace_id;
end;
$$;

revoke all on function public.resolve_account_knowledge_workspace(text) from public, anon;
grant execute on function public.resolve_account_knowledge_workspace(text) to authenticated, service_role;

revoke all on function public.is_project_member_v2(text) from public, anon;
revoke all on function public.can_read_knowledge_space(uuid) from public, anon;
revoke all on function public.can_write_knowledge_space(uuid) from public, anon;
revoke all on function public.knowledge_space_type(uuid) from public, anon;
revoke all on function public.can_read_knowledge_file_v2(text) from public, anon;
revoke all on function public.can_write_knowledge_file_v2(text) from public, anon;

grant execute on function public.is_project_member_v2(text) to authenticated, service_role;
grant execute on function public.can_read_knowledge_space(uuid) to authenticated, service_role;
grant execute on function public.can_write_knowledge_space(uuid) to authenticated, service_role;
grant execute on function public.knowledge_space_type(uuid) to authenticated, service_role;
grant execute on function public.can_read_knowledge_file_v2(text) to authenticated, service_role;
grant execute on function public.can_write_knowledge_file_v2(text) to authenticated, service_role;
