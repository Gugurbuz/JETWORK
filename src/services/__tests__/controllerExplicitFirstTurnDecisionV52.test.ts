import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildPublicWorkProtocolInstruction,
  PUBLIC_WORK_DIRECT_ANSWER_TOOL,
  PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME,
} from '../../../supabase/functions/_shared/agent/publicWorkProtocol.ts'
import { buildGeminiInteractionsRequest } from '../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts'

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
)
const controllerPolicySource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
)

describe('explicit first-turn Controller decision gate', () => {
  it('forces Gemini to choose a function instead of bypassing the pre-work gate with free text', () => {
    const request = buildGeminiInteractionsRequest({
      apiKey: 'test',
      systemInstruction: 'test',
      items: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          name: 'report_progress',
          description: 'start work',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
        PUBLIC_WORK_DIRECT_ANSWER_TOOL as unknown as Record<string, unknown>,
      ],
      allowTools: true,
      requiredFunctionNames: ['report_progress', PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME],
      maxOutputTokens: 1024,
      onText: () => {},
    })

    const generationConfig = request.generation_config as Record<string, unknown>
    expect(generationConfig.tool_choice).toEqual({
      allowed_tools: {
        mode: 'any',
        tools: ['report_progress', PUBLIC_WORK_DIRECT_ANSWER_TOOL_NAME],
      },
    })
    expect((request.tools as Array<Record<string, unknown>>).map(tool => tool.type)).not.toEqual(
      expect.arrayContaining(['google_search', 'url_context', 'code_execution']),
    )
  })

  it('keeps normal post-start Gemini tool use on validated mode', () => {
    const request = buildGeminiInteractionsRequest({
      apiKey: 'test',
      systemInstruction: 'test',
      items: [{ role: 'user', content: 'hello' }],
      tools: [{
        type: 'function',
        name: 'search_knowledge_catalog',
        description: 'search',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      }],
      allowTools: true,
      maxOutputTokens: 1024,
      onText: () => {},
    })

    const generationConfig = request.generation_config as Record<string, unknown>
    expect(generationConfig.tool_choice).toBe('validated')
  })

  it('makes direct answer an explicit model decision and excludes ambiguous enterprise terms from that path', () => {
    const instruction = buildPublicWorkProtocolInstruction([], true)
    expect(instruction).toContain('answer_directly')
    expect(instruction).toContain('Açıklaması verilmemiş kısaltma')
    expect(PUBLIC_WORK_DIRECT_ANSWER_TOOL.description).toContain('unexplained acronym')
    expect(PUBLIC_WORK_DIRECT_ANSWER_TOOL.description).toContain('technical/enterprise question')
    expect(PUBLIC_WORK_DIRECT_ANSWER_TOOL.description).not.toContain('LRT')
    expect(PUBLIC_WORK_DIRECT_ANSWER_TOOL.description).not.toContain('Last Resort Tariff')
  })

  it('materializes a valid direct-answer tool call as the one-call user response', () => {
    expect(providerSource).toContain('const explicitFirstTurnDecision = Boolean(')
    expect(providerSource).toContain('requiredFunctionNames: explicitFirstTurnDecision')
    expect(providerSource).toContain('controller_direct_answer_decision: 1')
    expect(providerSource).toContain('input.onText(answer)')
    expect(providerSource).toContain('explicit first-turn decision gate returned no function decision')
  })

  it('keeps enterprise-context preference semantic and generic rather than hard-coded to the acceptance term', () => {
    expect(controllerPolicySource).toContain('açıklaması verilmemiş kısa kısaltma, ürün kodu veya teknik identifier')
    expect(controllerPolicySource).toContain('Jetbase/capability kanıtı bu ayrımı maddi olarak değiştirecekse')
    expect(controllerPolicySource).not.toContain('Last Retweet')
    expect(controllerPolicySource).not.toContain("if (term === 'LRT')")
  })
})
