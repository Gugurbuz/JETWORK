begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

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

insert into public.kb_sources (
  id, workspace_id, owner_id, name, media_type, storage_path,
  publication_status, ingestion_status, latest_version
) values (
  '10000000-0000-4000-8000-000000000001',
  'rls-workspace-a',
  '00000000-0000-4000-8000-0000000000a1',
  'RLS source.md',
  'text/markdown',
  '00000000-0000-4000-8000-0000000000a1/rls-workspace-a/source.md',
  'published',
  'ready',
  1
);

insert into public.kb_objects (
  id, workspace_id, canonical_key, object_type, name, normalized_name,
  publication_status, primary_source_id
) values (
  '20000000-0000-4000-8000-000000000002',
  'rls-workspace-a',
  'function:z_rls_source',
  'function',
  'Z_RLS_SOURCE',
  'Z_RLS_SOURCE',
  'published',
  '10000000-0000-4000-8000-000000000001'
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
select is(
  (select count(*)::integer from public.kb_sources where workspace_id = 'rls-workspace-a'),
  0,
  'unrelated user cannot read another workspace knowledge source'
);
select is(
  (select count(*)::integer from public.kb_objects where workspace_id = 'rls-workspace-a'),
  0,
  'unrelated user cannot read another workspace knowledge object'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_conversations', 'select'),
  'browser-authenticated users cannot read assistant conversation state'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_turns', 'select'),
  'browser-authenticated users cannot read assistant turn state'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_tool_runs', 'select'),
  'browser-authenticated users cannot read assistant tool audit'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","is_anonymous":true}',
  true
);
select is(
  (select count(*)::integer from public.kb_sources where workspace_id = 'rls-workspace-a'),
  0,
  'anonymous authenticated session cannot read corporate knowledge sources'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_conversations', 'select'),
  'anonymous browser sessions have no assistant state table privilege'
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
select is(
  (select count(*)::integer from public.kb_sources where workspace_id = 'rls-workspace-a'),
  1,
  'owner can read workspace knowledge source'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_conversations', 'select'),
  'workspace owners still cannot read server-only assistant conversations'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_turns', 'select'),
  'workspace owners still cannot read server-only assistant turns'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_tool_runs', 'select'),
  'workspace owners still cannot read server-only assistant tool audit'
);
select ok(
  not has_table_privilege('authenticated', 'public.assistant_prompt_versions', 'select'),
  'browser-authenticated users cannot read the active assistant prompt table'
);
select ok(
  not has_table_privilege('authenticated', 'public.kb_sources', 'insert'),
  'browser-authenticated users cannot bypass the controlled knowledge ingestion RPC'
);
select ok(
  not has_table_privilege('authenticated', 'public.kb_objects', 'update'),
  'browser-authenticated users cannot alter knowledge objects directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.kb_relations', 'delete'),
  'browser-authenticated users cannot delete knowledge relations directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.kb_source_version_objects', 'select'),
  'browser-authenticated users cannot inspect internal source snapshot membership'
);
select ok(
  has_table_privilege('service_role', 'public.assistant_turns', 'select,insert,update,delete'),
  'service role can manage assistant turn state'
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
select is(
  (select count(*)::integer from public.kb_objects where workspace_id = 'rls-workspace-a'),
  1,
  'collaborator can read workspace knowledge object'
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
