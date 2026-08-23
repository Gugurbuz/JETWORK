import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const technicalToolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
  'utf8',
);
const bridgeSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2-primary-bridge-evidence/index.ts', import.meta.url),
  'utf8',
);
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260823164641_optimize_exact_reference_runtime_v4.sql', import.meta.url),
  'utf8',
);

describe('exact technical reference runtime latency path', () => {
  it('uses one database RPC instead of a multi-roundtrip object/version/source scan', () => {
    expect(technicalToolSource).toContain("client.rpc('lookup_knowledge_technical_reference_v4'");
    expect(technicalToolSource).toContain('singleRpcLookup: true');
    expect(technicalToolSource).not.toContain("client.from('knowledge_object_versions_v2')");
    expect(technicalToolSource).not.toContain("client.from('knowledge_objects_v2')");
  });

  it('treats slash as a structural separator for leaf identifiers', () => {
    expect(technicalToolSource).toContain("(^|[^A-Z0-9_-]|/)");
    expect(technicalToolSource).toContain("(?=$|->|[^A-Z0-9_-]|/)");
  });

  it('keeps broad evidence for synthesis but focuses displayed sources by the primary requested type', () => {
    expect(technicalToolSource).toContain('const primaryRequestedType = requestedTypes[0]');
    expect(technicalToolSource).toContain("String(record.matchMode || '') === 'direct'");
    expect(technicalToolSource).toContain('clean(record.objectType, 80) === primaryRequestedType');
    expect(technicalToolSource).toContain('focusedSourceCount: sources.length');
  });

  it('reuses the same RPC in the Auto evidence preflight', () => {
    expect(bridgeSource).toContain("client.rpc('lookup_knowledge_technical_reference_v4'");
    expect(bridgeSource).not.toContain("client.from('knowledge_object_versions_v2')");
    expect(bridgeSource).not.toContain("client.from('knowledge_relations_v2')");
    expect(bridgeSource).toContain("ROUTER_VERSION = 'primary-bridge-evidence-v3-single-rpc'");
  });

  it('keeps one active conversation when Auto changes routed model between turns', () => {
    expect(bridgeSource).toContain('async function alignAutoConversationModel');
    expect(bridgeSource).toContain(".from('assistant_conversations')");
    expect(bridgeSource).toContain(".eq('status','active')");
    expect(bridgeSource).toContain(".neq('model',input.routedModel)");
    expect(bridgeSource).toContain('alignAutoConversationModel({supabaseUrl,serviceRoleKey,workspaceId,routedModel:route.routedModel})');
    expect(bridgeSource).toContain('autoRouted:true');
  });

  it('keeps the lookup RLS-preserving and indexes exact-reference content candidates', () => {
    expect(migrationSource).toContain('security invoker');
    expect(migrationSource).toContain("search_document @@ plainto_tsquery('simple', p.ref)");
    expect(migrationSource).toContain("upper(regexp_replace(o.canonical_key, '^.*[:/]', '')) = p.ref");
    expect(migrationSource).toContain('revoke all on function public.lookup_knowledge_technical_reference_v4');
    expect(migrationSource).toContain('grant execute on function public.lookup_knowledge_technical_reference_v4');
  });

  it('gives published synthetic graph endpoints structural provenance versions', () => {
    expect(migrationSource).toContain("encode(extensions.digest(v_content,'sha256'),'hex')");
    expect(migrationSource).toContain("'structuralEndpoint',true");
    expect(migrationSource).toContain('published_version_id=v_version_id');
    expect(migrationSource).toContain('published_source_version_id=new.source_version_id');
  });
});
