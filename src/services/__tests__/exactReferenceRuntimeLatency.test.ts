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
const paginatedMigrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260823205300_paginate_technical_reference_lookup_v5.sql', import.meta.url),
  'utf8',
);

describe('exact technical reference runtime latency path', () => {
  it('uses one database RPC per page instead of a multi-roundtrip object/version/source scan', () => {
    expect(technicalToolSource).toContain("client.rpc('lookup_knowledge_technical_reference_v5'");
    expect(technicalToolSource).toContain('singleRpcLookup: pageCount === 1');
    expect(technicalToolSource).not.toContain("client.from('knowledge_object_versions_v2')");
    expect(technicalToolSource).not.toContain("client.from('knowledge_objects_v2')");
  });

  it('treats slash as a structural separator for leaf identifiers', () => {
    expect(technicalToolSource).toContain("(^|[^A-Z0-9_-]|/)");
    expect(technicalToolSource).toContain("(?=$|->|[^A-Z0-9_-]|/)");
  });

  it('keeps direct, relation-neighbor, and every requested source type available until final-answer focus', () => {
    expect(technicalToolSource).toContain("matchMode === 'direct'");
    expect(technicalToolSource).toContain("matchMode === 'relation'");
    expect(technicalToolSource).toContain('const requestedTypeSet = new Set(requestedTypes)');
    expect(technicalToolSource).toContain('requestedTypeSet.has(objectType)');
    expect(technicalToolSource).toContain('sourceCandidateCount: sources.length');
    expect(technicalToolSource).toContain('ordering is only a hint and is not treated as authoritative');
  });

  it('does not duplicate the runtime knowledge lookup in Auto preflight', () => {
    expect(bridgeSource).not.toContain("client.rpc('lookup_knowledge_technical_reference_v5'");
    expect(bridgeSource).not.toContain('inspectEvidence');
    expect(bridgeSource).toContain("EvidenceState = 'deferred'");
    expect(bridgeSource).toContain('evidence_deferred_to_runtime');
    expect(bridgeSource).toContain("ROUTER_VERSION = 'primary-bridge-runtime-evidence-v6'");
  });

  it('focuses source refs only after the completed answer reveals actually used identifiers', () => {
    expect(bridgeSource).toContain('focusSourcesForAnswer');
    expect(bridgeSource).toContain('sourceIdentifiers');
    expect(bridgeSource).toContain('answerMentionsIdentifier');
    expect(bridgeSource).toContain("payload?.type==='sources'");
    expect(bridgeSource).toContain("payload?.type==='completed'");
    expect(bridgeSource).toContain("controller.enqueue(encodeFrame(encoder,'sources',{type:'sources',sources:focused}))");
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
    expect(paginatedMigrationSource).toContain('security invoker');
    expect(paginatedMigrationSource).toContain("search_document @@ plainto_tsquery('simple', p.ref)");
    expect(paginatedMigrationSource).toContain("upper(regexp_replace(o.canonical_key, '^.*[:/]', '')) = p.ref");
    expect(paginatedMigrationSource).toContain('revoke all on function public.lookup_knowledge_technical_reference_v5');
    expect(paginatedMigrationSource).toContain('grant execute on function public.lookup_knowledge_technical_reference_v5');
  });

  it('gives published synthetic graph endpoints structural provenance versions', () => {
    expect(migrationSource).toContain("encode(extensions.digest(v_content,'sha256'),'hex')");
    expect(migrationSource).toContain("'structuralEndpoint',true");
    expect(migrationSource).toContain('published_version_id=v_version_id');
    expect(migrationSource).toContain('published_source_version_id=new.source_version_id');
  });
});