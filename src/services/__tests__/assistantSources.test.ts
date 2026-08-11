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
