import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contentReferencesTechnicalReference,
  detectTechnicalReferenceMessageLookup,
} from '../../../supabase/functions/_shared/methodMessageRoutingQuality';

const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts', import.meta.url),
  'utf8',
);
const toolSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantToolsMethodQuality.ts', import.meta.url),
  'utf8',
);

describe('technical-reference message routing', () => {
  it.each([
    ['CHECK_ZTKS hangi mesajları üretiyor?', 'CHECK_ZTKS'],
    ['CHECK_ZTKS hangi hata mesajları var?', 'CHECK_ZTKS'],
    ['CHECK_ZTKS mesajları neler?', 'CHECK_ZTKS'],
    ['CHECK_ZTKS hangi mesajları döndürüyor?', 'CHECK_ZTKS'],
  ])('detects method-to-message lookup intent: %s', (message, expected) => {
    expect(detectTechnicalReferenceMessageLookup(message)).toBe(expected);
  });

  it.each([
    'CHECK_ZTKS teknik olarak açıkla',
    'CHECK_ZTKS ne yapar?',
    'ZCRM2-545 hangi koşulda alınır?',
    'cost hataları neler',
  ])('does not hijack non-list technical intents: %s', message => {
    expect(detectTechnicalReferenceMessageLookup(message)).toBe('');
  });

  it('matches only the exact CHECK_* identifier boundary in authoritative content', () => {
    expect(contentReferencesTechnicalReference('Teknik referans: CHECK_ZTKS / item message', 'CHECK_ZTKS')).toBe(true);
    expect(contentReferencesTechnicalReference('CHECK_ZTKS_EXTRA başka bir kontroldür', 'CHECK_ZTKS')).toBe(false);
    expect(contentReferencesTechnicalReference('X_CHECK_ZTKS başka bir identifierdır', 'CHECK_ZTKS')).toBe(false);
  });

  it('routes relation questions to the one-call verified tool and disables catalog enumeration', () => {
    expect(semanticSource).toContain('const methodMessageReference = detectTechnicalReferenceMessageLookup(message)');
    expect(semanticSource).toContain("? 'technical-reference-messages'");
    expect(semanticSource).toContain('get_messages_by_technical_reference(technicalReference=');
    expect(semanticSource).toContain('enumerationTarget: methodMessageLookup ? undefined : plan.enumerationTarget');
    expect(semanticSource).toContain('quality_method_message_routing');
  });

  it('exposes a citation-ready verified technical-reference tool without replacing existing tools', () => {
    expect(toolSource).toContain("name: 'get_messages_by_technical_reference'");
    expect(toolSource).toContain('...original.ASSISTANT_KNOWLEDGE_TOOLS');
    expect(toolSource).toContain(".eq('object_type', 'message')");
    expect(toolSource).toContain(".eq('publication_status', 'published')");
    expect(toolSource).toContain('published_version_id');
    expect(toolSource).toContain('deterministicTechnicalReferenceLookup: true');
    expect(toolSource).toContain('return original.executeAssistantTool(client, workspaceId, toolName, rawArguments)');
  });

  it('models the current CHECK_ZTKS knowledge relation without accepting unrelated records', () => {
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
