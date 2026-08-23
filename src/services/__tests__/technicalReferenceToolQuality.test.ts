import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
  'utf8',
);
const migrationSource = readFileSync(
  new URL('../../../supabase/migrations/20260823205300_paginate_technical_reference_lookup_v5.sql', import.meta.url),
  'utf8',
);
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts', import.meta.url),
  'utf8',
);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contentReferencesTechnicalReference = (content: string, technicalReference: string) => {
  const ref = technicalReference.trim().toLocaleUpperCase('en-US');
  const pattern = new RegExp(`(^|[^A-Z0-9_-]|/)${escapeRegex(ref)}(?=$|->|[^A-Z0-9_-]|/)`, 'u');
  return pattern.test(content.toLocaleUpperCase('en-US'));
};

const normalizeEnumerationText = (value: string) => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[!?.,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const enumerationIntent = (value: string) => {
  const text = normalizeEnumerationText(value);
  return /\b(?:hangi|hangileri|neler|nelerdir|liste|listele|listeleyin|tum|tumu|tumunu|hepsi|hepsini|kac|adet|var|all|list|show|enumerate|how many)\b/iu.test(text)
    && /\b(?:metot\w*|metod\w*|method\w*|fonksiyon\w*|function\w*|class\w*|klas\w*|sinif\w*|object\w*|nesne\w*|mesaj\w*|message\w*)\b/iu.test(text);
};

describe('generic technical-reference evidence capability', () => {
  it('locks the exact identifier-boundary contract for unrelated identifier families', () => {
    expect(contentReferencesTechnicalReference('Teknik referans: CHECK_ZTKS / item message', 'CHECK_ZTKS')).toBe(true);
    expect(contentReferencesTechnicalReference('Çağrı: Z_FICA_TKS_CHECK', 'Z_FICA_TKS_CHECK')).toBe(true);
    expect(contentReferencesTechnicalReference('NINJA_CALCULATE_ONCRM kullanılır.', 'NINJA_CALCULATE_ONCRM')).toBe(true);
    expect(contentReferencesTechnicalReference('ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS', 'ZCL_ORDER_SAVE_QUOTATIONS')).toBe(true);
    expect(contentReferencesTechnicalReference('method:ZCL_ORDER_SAVE_QUOTATIONS/CHECK_ZTKS', 'CHECK_ZTKS')).toBe(true);
    expect(contentReferencesTechnicalReference('CHECK_ZTKS_EXTRA başka bir kontroldür', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('X_CHECK_ZTKS başka bir identifierdır', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('Z_FICA_TKS_CHECK_V2 farklıdır', 'Z_FICA_TKS_CHECK')).toBe(false);
    expect(contentReferencesTechnicalReference('ZCRM_COST-000', 'ZCRM_COST')).toBe(false);
    expect(toolSource).toContain("const pattern = new RegExp(`(^|[^A-Z0-9_-]|/)${escapeRegex(ref)}(?=$|->|[^A-Z0-9_-]|/)`, 'u')");
  });

  it('treats limit as page size and automatically exhausts technical-reference inventory requests', () => {
    expect(enumerationIntent('hangi metotlar var bu klasta')).toBe(true);
    expect(enumerationIntent('bu class içindeki tüm methodları listele')).toBe(true);
    expect(enumerationIntent('ZCL_ORDER_SAVE_QUOTATIONS nedir')).toBe(false);
    expect(toolSource).toContain('MAX_ENUMERATION_RECORDS = 100');
    expect(toolSource).toContain('latestUserEnumerationContext');
    expect(toolSource).toContain("client.rpc('lookup_knowledge_technical_reference_v5'");
    expect(toolSource).toContain('p_offset: pageOffset');
    expect(toolSource).toContain('automaticEnumerationPagination: exhaustiveEnumeration');
    expect(toolSource).toContain('continuationAvailable: truncated');
    expect(migrationSource).toContain("'totalCount'");
    expect(migrationSource).toContain("'nextCursor'");
    expect(migrationSource).toContain('limit (select lim from params)');
    expect(migrationSource).toContain('offset (select off from params)');
  });

  it('scopes a class method inventory to that exact class instead of cross-reference methods', () => {
    expect(toolSource).toContain("enumeration.targetObjectType === 'method'");
    expect(toolSource).toContain('const expectedPrefix = `method:${technicalReference.toLocaleLowerCase');
    expect(toolSource).toContain('startsWith(expectedPrefix)');
    expect(toolSource).toContain('rawCandidateTotalCount');
    expect(toolSource).toContain('const totalCount = exhaustiveEnumeration && !truncated ? records.length : rawCandidateTotalCount');
  });

  it('keeps normal exact technical-reference lookups bounded to one page', () => {
    expect(toolSource).toContain('if (!exhaustiveEnumeration || !nextCursor) break');
    expect(toolSource).toContain('singleRpcLookup: pageCount === 1');
    expect(toolSource).toContain("limit: { type: ['integer','null'], minimum: 1, maximum: 20");
  });

  it('adds one generic model-selectable tool and keeps publication filtering in the RLS-preserving RPC', () => {
    expect(toolSource).toContain("name: 'get_objects_by_technical_reference'");
    expect(toolSource).toContain('...original.ASSISTANT_KNOWLEDGE_TOOLS');
    expect(toolSource).toContain('technicalReference');
    expect(toolSource).toContain('objectTypes');
    expect(migrationSource).toContain("o.publication_status = 'published'");
    expect(migrationSource).toContain('o.published_version_id');
    expect(migrationSource).toContain('security invoker');
    expect(toolSource).toContain('deterministicTechnicalReferenceLookup: true');
    expect(toolSource).toContain('return original.executeAssistantTool(client, workspaceId, toolName, rawArguments)');
  });

  it('contains no identifier-specific routing policy', () => {
    expect(toolSource).not.toContain("technicalReference === 'CHECK_ZTKS'");
    expect(toolSource).not.toContain("technicalReference === 'Z_FICA_TKS_CHECK'");
    expect(toolSource).not.toContain('detectTechnicalReferenceRelationLookup');
    expect(semanticSource).not.toContain('get_objects_by_technical_reference');
  });

  it('keeps CHECK_ZTKS only as test evidence, not production branching', () => {
    const fixture = [
      { code: 'ZCRM2-544', text: 'Teknik referans: CHECK_ZTKS / Z_FICA_TKS_CHECK' },
      { code: 'ZCRM2-545', text: 'Teknik referans: CHECK_ZTKS / item message' },
      { code: 'ZCRM2-586', text: 'Teknik referans: CHECK_ZTKS' },
      { code: 'FAKE-METHOD', text: 'method:ZCL_ORDER_SAVE_QUOTATIONS/CHECK_ZTKS' },
      { code: 'ZCRM_COST-000', text: 'Cost mesajı' },
      { code: 'FAKE-001', text: 'Teknik referans: CHECK_ZTKS_EXTRA' },
    ];
    expect(fixture.filter(row => contentReferencesTechnicalReference(row.text, 'CHECK_ZTKS')).map(row => row.code)).toEqual(['ZCRM2-544', 'ZCRM2-545', 'ZCRM2-586', 'FAKE-METHOD']);
  });
});
