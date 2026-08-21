import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contentReferencesTechnicalReference,
  detectTechnicalReferenceRelationLookup,
  extractTechnicalReference,
} from '../../../supabase/functions/_shared/methodMessageRoutingQuality';

const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts', import.meta.url),
  'utf8',
);
const toolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsMethodQuality.ts', import.meta.url),
  'utf8',
);

describe('generic technical-reference relation routing', () => {
  it.each([
    ['CHECK_ZTKS hangi mesajları üretiyor?', 'CHECK_ZTKS', ['message'], 'messages'],
    ['Z_FICA_TKS_CHECK hangi mesajları döndürüyor?', 'Z_FICA_TKS_CHECK', ['message'], 'messages'],
    ['NINJA_CALCULATE_ONCRM hangi tabloları kullanıyor?', 'NINJA_CALCULATE_ONCRM', ['table'], 'tables'],
    ['ZCL_ORDER_SAVE_QUOTATIONS hangi methodları kullanıyor?', 'ZCL_ORDER_SAVE_QUOTATIONS', ['method'], 'methods'],
    ['Z_FICA_TKS_CHECK hangi FMleri çağırıyor?', 'Z_FICA_TKS_CHECK', ['function'], 'functions'],
    ['ZCL_ORDER_SAVE_QUOTATIONS nerede kullanılıyor?', 'ZCL_ORDER_SAVE_QUOTATIONS', null, 'usage'],
  ])('detects relation intent generically: %s', (message, technicalReference, targetObjectTypes, relationKind) => {
    expect(detectTechnicalReferenceRelationLookup(message)).toEqual({
      technicalReference,
      targetObjectTypes,
      relationKind,
    });
  });

  it.each([
    ['CHECK_ZTKS teknik olarak açıkla', 'CHECK_ZTKS'],
    ['NINJA_CALCULATE_ONCRM ne yapar?', 'NINJA_CALCULATE_ONCRM'],
    ['ZCRM2-545 hangi koşulda alınır?', 'ZCRM2-545'],
    ['cost hataları neler', ''],
  ])('extracts identifiers without hijacking non-relation intent: %s', (message, expectedIdentifier) => {
    expect(extractTechnicalReference(message)).toBe(expectedIdentifier);
    expect(detectTechnicalReferenceRelationLookup(message)).toBeNull();
  });

  it('matches exact technical identifier boundaries regardless of identifier family', () => {
    expect(contentReferencesTechnicalReference('Teknik referans: CHECK_ZTKS / item message', 'CHECK_ZTKS')).toBe(true);
    expect(contentReferencesTechnicalReference('Çağrı: Z_FICA_TKS_CHECK', 'Z_FICA_TKS_CHECK')).toBe(true);
    expect(contentReferencesTechnicalReference('NINJA_CALCULATE_ONCRM kullanılır.', 'NINJA_CALCULATE_ONCRM')).toBe(true);
    expect(contentReferencesTechnicalReference('CHECK_ZTKS_EXTRA başka bir kontroldür', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('X_CHECK_ZTKS başka bir identifierdır', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('Z_FICA_TKS_CHECK_V2 farklıdır', 'Z_FICA_TKS_CHECK')).toBe(false);
  });

  it('routes any technical relation to one generic verified tool and disables catalog enumeration', () => {
    expect(semanticSource).toContain('const relationLookup = detectTechnicalReferenceRelationLookup(message)');
    expect(semanticSource).toContain("? 'technical-reference-relations'");
    expect(semanticSource).toContain('get_objects_by_technical_reference(technicalReference=');
    expect(semanticSource).toContain('enumerationTarget: technicalRelationLookup ? undefined : plan.enumerationTarget');
    expect(semanticSource).toContain('quality_technical_relation_routing');
    expect(semanticSource).not.toContain('methodMessageReference');
  });

  it('exposes one generic citation-ready tool without identifier-specific branches', () => {
    expect(toolSource).toContain("name: 'get_objects_by_technical_reference'");
    expect(toolSource).toContain('...original.ASSISTANT_KNOWLEDGE_TOOLS');
    expect(toolSource).toContain('requestedObjectTypes: objectTypes');
    expect(toolSource).toContain(".eq('publication_status', 'published')");
    expect(toolSource).toContain('published_version_id');
    expect(toolSource).toContain('deterministicTechnicalReferenceLookup: true');
    expect(toolSource).toContain('return original.executeAssistantTool(client, workspaceId, toolName, rawArguments)');
    expect(toolSource).not.toContain("must be a CHECK_*");
    expect(toolSource).not.toContain("technicalReference === 'CHECK_ZTKS'");
  });

  it('uses CHECK_ZTKS only as a regression fixture, not as routing policy', () => {
    const fixture = [
      { code: 'ZCRM2-544', text: 'Teknik referans: CHECK_ZTKS / Z_FICA_TKS_CHECK' },
      { code: 'ZCRM2-545', text: 'Teknik referans: CHECK_ZTKS / item message' },
      { code: 'ZCRM2-586', text: 'Teknik referans: CHECK_ZTKS' },
      { code: 'ZCRM_COST-000', text: 'Cost mesajı' },
      { code: 'ZB2B_CIKTI-001', text: 'Çıktı mesajı' },
      { code: 'FAKE-001', text: 'Teknik referans: CHECK_ZTKS_EXTRA' },
    ];

    expect(
      fixture
        .filter(row => contentReferencesTechnicalReference(row.text, 'CHECK_ZTKS'))
        .map(row => row.code),
    ).toEqual(['ZCRM2-544', 'ZCRM2-545', 'ZCRM2-586']);
  });
});
