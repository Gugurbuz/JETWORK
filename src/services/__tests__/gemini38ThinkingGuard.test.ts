import { describe, expect, it } from 'vitest'
import { applyGeminiThinkingGuardBody } from '../../../supabase/functions/_shared/geminiThinkingGuard'

const generateUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
const streamUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse'

const boundedBody = () => ({
  systemInstruction: { parts: [{ text: '[JETWORK_COST_GUARD] Araştırma tamamlandı.' }] },
  contents: [{ role: 'user', parts: [{ text: 'kanıt' }] }],
  generationConfig: { maxOutputTokens: 1200 },
})

describe('Gemini 3.8 bounded final synthesis thinking guard', () => {
  it('uses low thinking for Gemini 3.8 generateContent and never minimal', () => {
    const body = boundedBody()
    const result = applyGeminiThinkingGuardBody(generateUrl, body)

    expect(result).not.toBe(body)
    expect((result.generationConfig as any).thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(JSON.stringify(result)).not.toContain('"thinkingLevel":"minimal"')
  })

  it('uses low thinking for Gemini 3.8 streaming final synthesis', () => {
    const body = boundedBody()
    const result = applyGeminiThinkingGuardBody(streamUrl, body)

    expect(result).not.toBe(body)
    expect((result.generationConfig as any).thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('does not override tool-enabled controller calls', () => {
    const body = {
      ...boundedBody(),
      tools: [{ functionDeclarations: [{ name: 'search_knowledge_catalog' }] }],
    }

    expect(applyGeminiThinkingGuardBody(streamUrl, body)).toBe(body)
  })

  it('preserves an explicit Gemini 3.8 thinking level', () => {
    const body = {
      ...boundedBody(),
      generationConfig: {
        maxOutputTokens: 1200,
        thinkingConfig: { thinkingLevel: 'medium' },
      },
    }

    expect(applyGeminiThinkingGuardBody(streamUrl, body)).toBe(body)
  })

  it('does not apply the policy to unrelated hosts or calls without the cost-guard marker', () => {
    const unrelatedHost = 'https://example.com/v1beta/models/gemini-3.8-flash:generateContent'
    const normalBody = {
      systemInstruction: { parts: [{ text: 'normal synthesis' }] },
      generationConfig: {},
    }

    expect(applyGeminiThinkingGuardBody(unrelatedHost, boundedBody())).toEqual(boundedBody())
    expect(applyGeminiThinkingGuardBody(generateUrl, normalBody)).toBe(normalBody)
  })
})
