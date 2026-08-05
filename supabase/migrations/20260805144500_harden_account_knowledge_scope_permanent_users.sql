create policy "Permanent users only for account knowledge scopes"
on public.account_knowledge_scopes
as restrictive
for all
to authenticated
using (
  coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
)
with check (
  coalesce((select (auth.jwt()->>'is_anonymous')::boolean), false) is false
);
