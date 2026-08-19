import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildDeterministicGeminiWebRequest,
  normalizeDeterministicGeminiWebResult,
} from '../../../supabase/functions/_shared/deterministicGeminiWebResearch'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)

describe('deterministic Gemini Deep Research executor', () => {
  it('forces Google Search via Interactions API tool_choice any', () => {
    const request = buildDeterministicGeminiWebRequest({
      query: 'CHECK_ZTKS hangi mesajları üretiyor?',
      complexity: 'high',
    }) as any

    expect(request.model).toBe('gemini-3.5-flash')
    expect(request.tools).toEqual([{ type: 'google_search', search_types: ['web_search'] }])
    expect(request.generation_config.tool_choice).toBe('any')
    expect(request.store).toBe(false)
    expect(request.background).toBe(false)
  })

  it('normalizes executed search, citable sources, notes and grounding telemetry', () => {
    const result = normalizeDeterministicGeminiWebResult({
      steps: [
        { type: 'google_search_call', arguments: { query: 'CHECK_ZTKS SAP' }, id: 'search_1' },
        {
          type: 'google_search_result', call_id: 'search_1', result: [{
            title: 'Example source',
            url: 'https://example.com/check-ztks',
            snippet: 'Public context.',
          }],
        },
        { type: 'model_output', content: [{ type: 'text', text: 'Grounded research note.' }] },
      ],
      usage: {
        total_input_tokens: 100,
        total_output_tokens: 40,
        total_thought_tokens: 20,
        total_tokens: 160,
        grounding_tool_count: [{ type: 'google_search', count: 1 }],
      },
    } as any)

    expect(result.searchCount).toBe(1)
    expect(result.searchQueries).toEqual(['CHECK_ZTKS SAP'])
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].url).toBe('https://example.com/check-ztks')
    expect(result.text).toContain('Public context.')
    expect(result.text).toContain('Grounded research note.')
    expect(result.usage?.deterministic_web_executor_calls).toBe(1)
    expect(result.usage?.gemini_interactions_web_search_calls).toBe(1)
    expect(result.usage?.gemini_grounding_tool_calls).toBe(1)
  })

  it('routes only research web turns through executor before final synthesis', () => {
    expect(providerSource).toContain("plan?.intent === 'research' && input.allowProviderWeb === true")
    expect(providerSource).toContain('runDeterministicGeminiWebResearch({')
    expect(providerSource.indexOf('runDeterministicGeminiWebResearch({'))
      .toBeLessThan(providerSource.indexOf('baseRequestGeminiResponse({'))
    expect(providerSource).toContain('allowProviderWeb: false')
    expect(providerSource).toContain('allowTools: false')
    expect(providerSource).toContain('deterministic_deep_research_used')
  })
})
