import { describe, expect, it } from 'vitest';
import { collectWebSources } from '../../../supabase/functions/_shared/reasoningEngine';

describe('Reasoning web evidence extraction', () => {
  it('collects flat Responses API url_citation annotations', () => {
    const sources = collectWebSources({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          annotations: [{
            type: 'url_citation',
            url: 'https://developers.openai.com/api/docs/guides/tools-web-search',
            title: 'Web search | OpenAI API',
          }],
        }],
      }],
    });
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'web',
        url: 'https://developers.openai.com/api/docs/guides/tools-web-search',
        title: 'Web search | OpenAI API',
      }),
    ]));
  });

  it('collects complete web_search_call action.sources entries without titles', () => {
    const sources = collectWebSources({
      output: [{
        type: 'web_search_call',
        action: {
          type: 'search',
          sources: [
            { type: 'url', url: 'https://openai.com/' },
            { type: 'url', url: 'https://developers.openai.com/' },
          ],
        },
      }],
    });
    expect(sources.map(source => source.url)).toEqual([
      'https://openai.com/',
      'https://developers.openai.com/',
    ]);
  });

  it('uses web_search_call.results as a redundant evidence channel and deduplicates URLs', () => {
    const sources = collectWebSources({
      output: [{
        type: 'web_search_call',
        action: {
          type: 'search',
          sources: [{ type: 'url', url: 'https://example.com/a' }],
        },
        results: [
          { type: 'web_search_result', url: 'https://example.com/a', title: 'A duplicate' },
          { type: 'web_search_result', url: 'https://example.com/b', title: 'B' },
        ],
      }],
    });
    expect(sources).toHaveLength(2);
    expect(sources.map(source => source.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('tolerates nested citation shapes without accepting non-http URLs', () => {
    const sources = collectWebSources({
      output: [{
        type: 'message',
        content: [{
          annotations: [
            {
              type: 'url_citation',
              url_citation: { url: 'https://example.com/c', title: 'C' },
            },
            {
              type: 'url_citation',
              url: 'javascript:alert(1)',
              title: 'Unsafe',
            },
          ],
        }],
      }],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ url: 'https://example.com/c', title: 'C' });
  });
});
