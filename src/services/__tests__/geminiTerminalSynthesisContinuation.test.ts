import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestGeminiInteractionsResponseGA } from '../../../supabase/functions/_shared/geminiInteractionsTransportGA.ts'

afterEach(() => vi.unstubAllGlobals())

describe('Gemini terminal synthesis continuation', () => {
  it('rematerializes only a pending function continuation and disables tools', async () => {
    let requestBody: Record<string, any> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, any>
      return new Response(JSON.stringify({
        id: 'int_terminal',
        model: 'gemini-3.8-flash',
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Final cevap.' }] }],
        usage: { total_input_tokens: 20, total_output_tokens: 3, total_tokens: 23 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    await requestGeminiInteractionsResponseGA({
      apiKey: 'test-key',
      systemInstruction: 'Controller constitution',
      items: [
        { role: 'user', content: 'Kaynağı bul ve cevapla' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'get_abap_source',
          arguments: JSON.stringify({ canonicalKey: 'method:x/y' }),
          _gemini_interaction_id: 'int_requires_action',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: JSON.stringify({ source: 'METHOD y. ENDMETHOD.' }),
        },
      ],
      tools: [],
      allowTools: false,
      allowProviderWeb: false,
      maxOutputTokens: 1_000,
      onText: () => {},
    })

    expect(requestBody.previous_interaction_id).toBeUndefined()
    expect(requestBody.tools).toEqual([])
    expect(requestBody.generation_config?.tool_choice).toBe('none')
    expect(requestBody.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'user_input' }),
      expect.objectContaining({ type: 'function_call', id: 'call_1', name: 'get_abap_source' }),
      expect.objectContaining({ type: 'function_result', call_id: 'call_1', name: 'get_abap_source' }),
    ]))
  })
})
