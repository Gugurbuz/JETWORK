-- The login screen supports signing in with either an email address or a username.
-- Username login needs a limited pre-auth lookup without exposing public.users.

create or replace function public.lookup_email_for_username(lookup_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
  from public.users u
  where lower(u.username) = lower(nullif(trim(lookup_username), ''))
  limit 1;
$$;

revoke all on function public.lookup_email_for_username(text) from public;
grant usage on schema public to anon;
grant execute on function public.lookup_email_for_username(text) to anon;
grant execute on function public.lookup_email_for_username(text) to authenticated;

-- Keep profile reads authenticated-only. Anonymous clients should use the RPC above.
drop policy if exists users_read_profiles on public.users;
create policy users_read_profiles on public.users
for select to authenticated
using (true);
