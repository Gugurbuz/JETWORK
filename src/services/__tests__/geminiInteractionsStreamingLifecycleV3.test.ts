import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeminiProviderStateItem } from '../../../supabase/functions/_shared/geminiInteractionsRuntimeV3.ts'
import {
  GEMINI_INTERACTIONS_URL,
  requestGeminiInteractionsResponseGA,
} from '../../../supabase/functions/_shared/geminiInteractionsTransportGA.ts'

const sse = (eventType: string, payload: Record<string, unknown>) =>
  `event: ${eventType}\ndata: ${JSON.stringify({ event_type: eventType, ...payload })}\n\n`

const streamResponse = (body: string) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/event-stream; charset=utf-8' },
})

afterEach(() => vi.unstubAllGlobals())

describe('Gemini Interactions streaming lifecycle V3', () => {
  it('uses GA v1 SSE, never publishes thought steps, and exposes safe server-tool lifecycle plus text deltas', async () => {
    const body = [
      sse('interaction.created', { interaction: { id: 'int_stream', model: 'gemini-3.8-flash', status: 'in_progress' } }),
      sse('interaction.in_progress', { interaction_id: 'int_stream' }),
      sse('step.start', { index: 0, step: { id: 'th_1', type: 'thought' } }),
      sse('step.stop', { index: 0 }),
      sse('step.start', { index: 1, step: { id: 'gs_1', type: 'google_search_call' } }),
      sse('step.delta', { index: 1, delta: { type: 'google_search_call', arguments: { queries: ['Gemini 3.8 Flash'] } } }),
      sse('step.stop', { index: 1 }),
      sse('step.start', { index: 2, step: { id: 'out_1', type: 'model_output' } }),
      sse('step.delta', { index: 2, delta: { type: 'text', text: 'Doğrulandı.' } }),
      sse('step.stop', { index: 2 }),
      sse('interaction.completed', { interaction: { id: 'int_stream', model: 'gemini-3.8-flash', status: 'completed', usage: { total_input_tokens: 10, total_output_tokens: 3, total_tokens: 13 } } }),
      'event: done\ndata: [DONE]\n\n',
    ].join('')

    let requestedUrl = ''
    let acceptHeader = ''
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      requestedUrl = String(url)
      acceptHeader = String((init?.headers as Record<string, string> | undefined)?.Accept || '')
      return streamResponse(body)
    }))
    const text: string[] = []
    const steps: Array<Record<string, unknown>> = []

    const response = await requestGeminiInteractionsResponseGA({
      apiKey: 'test-key',
      systemInstruction: 'Controller constitution',
      items: [{ role: 'user', content: 'Araştır' }],
      tools: [],
      allowTools: true,
      allowProviderWeb: true,
      workMode: 'balanced',
      maxOutputTokens: 1_000,
      onText: delta => text.push(delta),
      onStepEvent: event => steps.push(event as unknown as Record<string, unknown>),
    })

    expect(requestedUrl).toBe(GEMINI_INTERACTIONS_URL)
    expect(requestedUrl).toContain('/v1/interactions?alt=sse')
    expect(acceptHeader).toBe('text/event-stream')
    expect(text).toEqual(['Doğrulandı.'])
    expect(steps).toEqual([
      expect.objectContaining({ lifecycle: 'start', operationId: 'gs_1', stepType: 'google_search_call', toolFamily: 'web' }),
      expect.objectContaining({ lifecycle: 'complete', operationId: 'gs_1', stepType: 'google_search_call', toolFamily: 'web' }),
    ])
    expect(JSON.stringify(steps)).not.toContain('thought')
    expect(response.id).toBe('int_stream')
    expect(response.status).toBe('completed')
    expect(response.usage?.gemini_interactions_ga_v1).toBe(1)
    expect(response.output).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'message', role: 'assistant' }),
    ]))
  })

  it('uses persisted previous_interaction_id without replaying prior conversation and records telemetry', async () => {
    let requestBody: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({
        id: 'int_next', model: 'gemini-3.8-flash', status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Devam.' }] }],
        usage: { total_input_tokens: 5, total_output_tokens: 2, total_tokens: 7 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const response = await requestGeminiInteractionsResponseGA({
      apiKey: 'test-key',
      systemInstruction: 'Controller constitution',
      items: [
        { role: 'user', content: 'Eski soru' },
        { role: 'assistant', content: 'Eski cevap' },
        createGeminiProviderStateItem('int_previous'),
        { role: 'user', content: 'Devam et' },
      ],
      tools: [],
      allowTools: false,
      allowProviderWeb: false,
      maxOutputTokens: 1_000,
      onText: () => {},
    })

    expect(requestBody.previous_interaction_id).toBe('int_previous')
    expect(requestBody.input).toEqual([{
      type: 'user_input', content: [{ type: 'text', text: 'Devam et' }],
    }])
    expect(JSON.stringify(requestBody)).not.toContain('Eski soru')
    expect(JSON.stringify(requestBody)).not.toContain('Eski cevap')
    expect(response.usage?.gemini_previous_interaction_used).toBe(1)
    expect(response.usage?.gemini_interactions_ga_v1).toBe(1)
  })

  it('fails closed on incomplete terminal interaction state', async () => {
    const body = [
      sse('interaction.created', { interaction: { id: 'int_incomplete', model: 'gemini-3.8-flash', status: 'in_progress' } }),
      sse('interaction.incomplete', { interaction_id: 'int_incomplete' }),
    ].join('')
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(body)))

    await expect(requestGeminiInteractionsResponseGA({
      apiKey: 'test-key',
      systemInstruction: 'Controller constitution',
      items: [{ role: 'user', content: 'Devam et' }],
      tools: [],
      allowTools: false,
      allowProviderWeb: false,
      maxOutputTokens: 1_000,
      onText: () => {},
    })).rejects.toThrow(/incomplete/i)
  })
})
