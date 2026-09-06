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

describe('legacy deterministic Gemini web executor', () => {
  it('remains testable as a rollback/history helper but is not active routing authority', () => {
    const request = buildDeterministicGeminiWebRequest({
      query: 'CHECK_ZTKS hangi mesajları üretiyor?',
      complexity: 'high',
    }) as any

    expect(request.model).toBe('gemini-3.8-flash')
    expect(request.tools).toEqual([{ type: 'google_search', search_types: ['web_search'] }])
    expect(request.generation_config.tool_choice).toBe('any')
    expect(request.generation_config.thinking_level).toBe('low')
    expect(request.store).toBe(false)
    expect(request.background).toBe(false)
  })

  it('still normalizes historical executor results deterministically', () => {
    const result = normalizeDeterministicGeminiWebResult({
      steps: [
        {
          type: 'google_search_call',
          arguments: { query: 'CHECK_ZTKS SAP' },
          id: 'search_1',
          result: [{ title: 'Example source', url: 'https://example.com/check-ztks', snippet: 'Public context.' }],
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
  })

  it('does not pre-execute deterministic research in the active Gemini provider wrapper', () => {
    expect(providerSource).not.toContain("import { runDeterministicGeminiWebResearch")
    expect(providerSource).not.toContain("plan?.intent === 'research' && providerWebRequested")
    expect(providerSource).not.toContain('runDeterministicGeminiWebResearch({')
    expect(providerSource).toContain('requestBaseWithEmptyFinalizationRecovery')
  })
})
