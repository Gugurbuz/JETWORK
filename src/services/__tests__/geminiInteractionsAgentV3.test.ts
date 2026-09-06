import { describe, expect, it, vi } from 'vitest'
import {
  buildGeminiInteractionsRequest,
  builtInToolsForInteractions,
  interactionInputFromJetWorkItems,
  normalizeGeminiInteraction,
} from '../../../supabase/functions/_shared/geminiInteractionsAgent.ts'

const baseInput = () => ({
  apiKey: 'test-key',
  model: 'gemini-3.8-flash',
  systemInstruction: 'You are the controller.',
  items: [{ role: 'user', content: 'ZCRM2-545 hangi koşulda alınır?' }],
  tools: [{
    type: 'function',
    name: 'search_knowledge_catalog',
    description: 'Search enterprise knowledge.',
    strict: true,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  }],
  allowTools: true,
  allowProviderWeb: true,
  workMode: 'balanced' as const,
  maxOutputTokens: 12_000,
  onText: vi.fn(),
})

describe('Gemini Interactions Agent V3', () => {
  it('exposes native built-ins together with custom JetWork functions using validated tool choice', () => {
    const request = buildGeminiInteractionsRequest(baseInput())
    const tools = request.tools as Array<Record<string, unknown>>

    expect(request.model).toBe('gemini-3.8-flash')
    expect(request.store).toBe(true)
    expect(request.background).toBe(false)
    expect(request.generation_config).toMatchObject({
      thinking_level: 'medium',
      tool_choice: 'validated',
      max_output_tokens: 12_000,
    })
    expect(tools.map(tool => tool.type)).toEqual(expect.arrayContaining([
      'google_search',
      'url_context',
      'code_execution',
      'function',
    ]))
    const custom = tools.find(tool => tool.type === 'function' && tool.name === 'search_knowledge_catalog')
    expect(custom).toBeTruthy()
    expect(custom).not.toHaveProperty('strict')
  })

  it('does not expose Google Search when provider web is disabled while keeping other native tools available', () => {
    const tools = builtInToolsForInteractions({ allowTools: true, allowProviderWeb: false })
    expect(tools.map(tool => tool.type)).toEqual(['url_context', 'code_execution'])
  })

  it('continues the model-owned function workflow using previous_interaction_id and function_result', () => {
    const request = buildGeminiInteractionsRequest({
      ...baseInput(),
      items: [
        { role: 'user', content: 'ABAP kodunu bul' },
        {
          type: 'function_call',
          name: 'search_knowledge_catalog',
          call_id: 'fc_1',
          arguments: '{"query":"CHECK_ZTKS"}',
          _gemini_interaction_id: 'int_123',
        },
        {
          type: 'function_call_output',
          call_id: 'fc_1',
          output: '{"resultCount":1}',
        },
      ],
    })

    expect(request.previous_interaction_id).toBe('int_123')
    expect(request.input).toEqual([{
      type: 'function_result',
      name: 'search_knowledge_catalog',
      call_id: 'fc_1',
      result: [{ type: 'text', text: '{"resultCount":1}' }],
    }])
  })

  it('converts JetWork history to stateless interaction steps when no stored interaction continuation exists', () => {
    const steps = interactionInputFromJetWorkItems([
      { role: 'user', content: 'Merhaba' },
      { role: 'assistant', content: 'Merhaba.' },
      { role: 'user', content: 'Bunu araştır.' },
    ])

    expect(steps).toEqual([
      { type: 'user_input', content: [{ type: 'text', text: 'Merhaba' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Merhaba.' }] },
      { type: 'user_input', content: [{ type: 'text', text: 'Bunu araştır.' }] },
    ])
  })

  it('normalizes model output, custom function calls, citations and usage into the existing JetWork provider contract', () => {
    const response = normalizeGeminiInteraction({
      id: 'int_456',
      model: 'gemini-3.8-flash',
      status: 'completed',
      steps: [
        {
          type: 'google_search_call',
          id: 'gs_1',
          arguments: { queries: ['Gemini 3.8 Flash'] },
        },
        {
          type: 'function_call',
          id: 'fc_2',
          name: 'get_knowledge_object',
          arguments: { canonicalKey: 'message:zcrm2-545' },
        },
        {
          type: 'model_output',
          content: [{
            type: 'text',
            text: 'Doğrulandı.',
            annotations: [{
              type: 'url_citation',
              title: 'Gemini docs',
              url: 'https://ai.google.dev/gemini-api/docs/interactions-overview',
            }],
          }],
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        thoughts_tokens: 30,
        cached_tokens: 40,
        total_tokens: 150,
      },
    })

    expect(response.id).toBe('int_456')
    expect(response.webSearchQueries).toEqual(['Gemini 3.8 Flash'])
    expect(response.webSources).toEqual([{
      title: 'Gemini docs',
      url: 'https://ai.google.dev/gemini-api/docs/interactions-overview',
    }])
    expect(response.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call',
        name: 'get_knowledge_object',
        call_id: 'fc_2',
        _gemini_interaction_id: 'int_456',
      }),
      expect.objectContaining({
        type: 'message',
        role: 'assistant',
        _gemini_interaction_id: 'int_456',
      }),
    ]))
    expect(response.usage).toMatchObject({
      input_tokens: 100,
      output_tokens: 20,
      reasoning_tokens: 30,
      cached_tokens: 40,
      total_tokens: 150,
      gemini_interactions_api_calls: 1,
      gemini_interactions_steps: 3,
    })
  })
})
