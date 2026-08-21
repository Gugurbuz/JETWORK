import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const toolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsTechnicalReferenceQuality.ts', import.meta.url),
  'utf8',
);
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts', import.meta.url),
  'utf8',
);

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contentReferencesTechnicalReference = (content: string, technicalReference: string) => {
  const ref = technicalReference.trim().toLocaleUpperCase('en-US');
  const pattern = new RegExp(`(^|[^A-Z0-9_/-])${escapeRegex(ref)}(?=$|->|[^A-Z0-9_/-])`, 'u');
  return pattern.test(content.toLocaleUpperCase('en-US'));
};

describe('generic technical-reference evidence capability', () => {
  it('locks the exact identifier-boundary contract for unrelated identifier families', () => {
    expect(contentReferencesTechnicalReference('Teknik referans: CHECK_ZTKS / item message', 'CHECK_ZTKS')).toBe(true);
    expect(contentReferencesTechnicalReference('Çağrı: Z_FICA_TKS_CHECK', 'Z_FICA_TKS_CHECK')).toBe(true);
    expect(contentReferencesTechnicalReference('NINJA_CALCULATE_ONCRM kullanılır.', 'NINJA_CALCULATE_ONCRM')).toBe(true);
    expect(contentReferencesTechnicalReference('ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS', 'ZCL_ORDER_SAVE_QUOTATIONS')).toBe(true);
    expect(contentReferencesTechnicalReference('CHECK_ZTKS_EXTRA başka bir kontroldür', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('X_CHECK_ZTKS başka bir identifierdır', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('Z_FICA_TKS_CHECK_V2 farklıdır', 'Z_FICA_TKS_CHECK')).toBe(false);
    expect(contentReferencesTechnicalReference('ZCRM_COST-000', 'ZCRM_COST')).toBe(false);
    expect(toolSource).toContain("const pattern = new RegExp(`(^|[^A-Z0-9_/-])${escapeRegex(ref)}(?=$|->|[^A-Z0-9_/-])`, 'u')");
  });

  it('adds one generic model-selectable tool and preserves all existing tools', () => {
    expect(toolSource).toContain("name: 'get_objects_by_technical_reference'");
    expect(toolSource).toContain('...original.ASSISTANT_KNOWLEDGE_TOOLS');
    expect(toolSource).toContain('technicalReference');
    expect(toolSource).toContain('objectTypes');
    expect(toolSource).toContain(".eq('publication_status', 'published')");
    expect(toolSource).toContain('published_version_id');
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
      { code: 'ZCRM_COST-000', text: 'Cost mesajı' },
      { code: 'FAKE-001', text: 'Teknik referans: CHECK_ZTKS_EXTRA' },
    ];
    expect(fixture.filter(row => contentReferencesTechnicalReference(row.text, 'CHECK_ZTKS')).map(row => row.code)).toEqual(['ZCRM2-544', 'ZCRM2-545', 'ZCRM2-586']);
  });
});
