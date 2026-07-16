begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    '00000000-0000-4000-8000-0000000000a1',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-a@example.test', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-0000000000b2',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'rls-b@example.test', 'test',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb
  );

insert into public.users (uid, email, username, name, surname, role, onboarding_completed)
values
  ('00000000-0000-4000-8000-0000000000a1', 'rls-a@example.test', 'rls-a', 'RLS', 'User A', 'Business Analyst', true),
  ('00000000-0000-4000-8000-0000000000b2', 'rls-b@example.test', 'rls-b', 'RLS', 'User B', 'Business Analyst', true);

insert into public.projects (
  id, name, description, owner_id, created_at, last_updated
) values (
  'rls-project-a', 'RLS Project A', 'contract fixture',
  '00000000-0000-4000-8000-0000000000a1', now(), now()
);

insert into public.workspaces (
  id, project_id, issue_key, title, type, status,
  owner_id, collaborators, created_at, last_updated
) values (
  'rls-workspace-a', 'rls-project-a', 'RLS-1', 'RLS Workspace A',
  'Analysis', 'Draft', '00000000-0000-4000-8000-0000000000a1',
  '[]'::jsonb, now(), now()
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.workspaces where id = 'rls-workspace-a'),
  0,
  'unrelated user cannot read another workspace'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.workspaces where id = 'rls-workspace-a'),
  1,
  'owner can read workspace'
);
update public.workspaces
set collaborators = '[{"id":"00000000-0000-4000-8000-0000000000b2","name":"User B","role":"Business Analyst"}]'::jsonb
where id = 'rls-workspace-a';

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.workspaces where id = 'rls-workspace-a'),
  1,
  'collaborator can read workspace'
);
select lives_ok(
  $$select public.save_document_version('rls-workspace-a', 'rls-version-1', '{"businessAnalysis":{"content":"safe"}}'::jsonb)$$,
  'collaborator can atomically save document and version'
);
select is(
  (select count(*)::integer from public.documents where workspace_id = 'rls-workspace-a' and id = 'main'),
  1,
  'atomic save writes main document'
);
select is(
  (select count(*)::integer from public.document_versions where workspace_id = 'rls-workspace-a' and id = 'rls-version-1'),
  1,
  'atomic save writes matching version'
);
select is(
  (select count(*)::integer from public.get_shared_analysis('rls-share-token')),
  0,
  'unknown share token returns no data'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
insert into public.shared_analyses (
  id, workspace_id, owner_id, token_hash, data, expires_at
) values (
  'rls-share-a', 'rls-workspace-a',
  '00000000-0000-4000-8000-0000000000a1',
  encode(extensions.digest('rls-share-token', 'sha256'), 'hex'),
  '{"businessAnalysis":{"content":"shared"}}'::jsonb,
  now() + interval '1 hour'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.get_shared_analysis('rls-share-token')),
  1,
  'authenticated recipient can resolve active opaque share token'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}',
  true
);
update public.shared_analyses set revoked_at = now() where id = 'rls-share-a';

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}',
  true
);
select is(
  (select count(*)::integer from public.get_shared_analysis('rls-share-token')),
  0,
  'revoked share token returns no data'
);

select * from finish();
rollback;
