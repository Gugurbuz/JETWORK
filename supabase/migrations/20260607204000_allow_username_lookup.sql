-- The login screen supports signing in with either an email address or a username.
-- Username login needs a limited pre-auth lookup against public.users.
-- This keeps the current app behavior working until username lookup is moved behind an RPC.

grant usage on schema public to anon;
grant select on public.users to anon;

drop policy if exists users_read_profiles on public.users;
create policy users_read_profiles on public.users
for select to anon, authenticated
using (true);
