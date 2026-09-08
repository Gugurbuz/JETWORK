import { describe, expect, it } from 'vitest';
import { splitAssistantSources } from '../assistantSources';

describe('splitAssistantSources', () => {
  it('moves web sources with URLs into visible grounding links', () => {
    const result = splitAssistantSources([
      {
        sourceName: 'CRM Method Inventory',
        title: 'CHECK_ZTKS',
        sourceType: 'knowledge',
      },
      {
        sourceName: 'OpenAI Docs',
        title: 'Web Search Guide',
        sourceType: 'web',
        url: 'https://platform.openai.com/docs/guides/tools-web-search',
      },
    ]);

    expect(result.knowledgeSources).toEqual([{
      sourceName: 'CRM Method Inventory',
      title: 'CHECK_ZTKS',
      sourceType: 'knowledge',
    }]);
    expect(result.groundingUrls).toEqual([{
      uri: 'https://platform.openai.com/docs/guides/tools-web-search',
      title: 'Web Search Guide',
    }]);
  });

  it('deduplicates canonical objects extracted from the same enterprise source document', () => {
    const result = splitAssistantSources([
      {
        sourceId: 'source-crm-method-archive',
        sourceName: 'CRM_Metot_Arsivi.txt',
        canonicalKey: 'method:unscoped_class/check_a',
        title: 'CHECK_A',
        sourceType: 'knowledge',
      },
      {
        sourceId: 'source-crm-method-archive',
        sourceName: 'CRM_Metot_Arsivi.txt',
        canonicalKey: 'method:unscoped_class/check_b',
        title: 'CHECK_B',
        sourceType: 'knowledge',
      },
      {
        sourceId: 'source-message-bank',
        sourceName: 'CRM_Hata_Bilgi_Bankasi.md',
        canonicalKey: 'message:zcrm2-356',
        title: 'ZCRM2-356',
        sourceType: 'knowledge',
      },
    ]);

    expect(result.knowledgeSources).toHaveLength(2);
    expect(result.knowledgeSources.map(source => source.sourceId)).toEqual([
      'source-crm-method-archive',
      'source-message-bank',
    ]);
  });

  it('deduplicates sources by source name when an older source ref has no sourceId', () => {
    const result = splitAssistantSources([
      {
        sourceName: 'CRM_Metot_Arsivi.txt',
        canonicalKey: 'method:unscoped_class/check_a',
        title: 'CHECK_A',
        sourceType: 'knowledge',
      },
      {
        sourceName: 'CRM_Metot_Arsivi.txt',
        canonicalKey: 'method:unscoped_class/check_b',
        title: 'CHECK_B',
        sourceType: 'knowledge',
      },
    ]);

    expect(result.knowledgeSources).toHaveLength(1);
  });

  it('deduplicates existing grounding links and web source URLs', () => {
    const result = splitAssistantSources([
      {
        sourceName: 'Docs duplicate',
        sourceType: 'web',
        url: 'https://example.com/ref',
      },
    ], [
      { uri: 'https://example.com/ref', title: 'Existing ref' },
    ]);

    expect(result.groundingUrls).toEqual([
      { uri: 'https://example.com/ref', title: 'Existing ref' },
    ]);
  });
});