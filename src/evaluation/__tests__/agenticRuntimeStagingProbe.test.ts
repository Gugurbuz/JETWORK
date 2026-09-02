import { describe, expect, it, vi } from 'vitest'
import { probeAgenticRuntimeStagingTurn } from '../agenticRuntimeStagingProbe'

const sseResponse = (frames: string[]) => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    const encoder = new TextEncoder()
    frames.forEach(frame => controller.enqueue(encoder.encode(frame)))
    controller.close()
  },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

describe('agentic runtime staging probe', () => {
  it('refuses to send a golden probe to the production Supabase target', async () => {
    const fetchImpl = vi.fn()
    await expect(probeAgenticRuntimeStagingTurn({
      targetSupabaseUrl: 'https://prod.supabase.co/',
      productionSupabaseUrl: 'https://PROD.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      messageId: 'm-1',
      message: 'test',
      fetchImpl: fetchImpl as any,
    })).rejects.toThrow('STAGING_PROBE_PRODUCTION_TARGET_FORBIDDEN')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('measures real request-start to first non-empty text delta on staging SSE', async () => {
    const times = [1_000, 1_100, 1_250, 1_400]
    const fetchImpl = vi.fn(async () => sseResponse([
      'event: status\ndata: {"type":"status","stage":"planning"}\n\n',
      'event: text_delta\ndata: {"type":"text_delta","delta":"Merhaba"}\n\n',
      'event: sources\ndata: {"type":"sources","sources":[{"sourceName":"KB"}]}\n\n',
      'event: completed\ndata: {"type":"completed","conversationId":"conv-1","model":"gpt-5.6-sol","provider":"openai","usage":{"input_tokens":100,"output_tokens":20}}\n\n',
      'data: [DONE]\n\n',
    ]))

    const result = await probeAgenticRuntimeStagingTurn({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      messageId: 'm-1',
      message: 'test',
      fetchImpl: fetchImpl as any,
      now: () => times.shift() ?? 1_400,
    })

    expect(result.endToEndTtftMs).toBe(250)
    expect(result.headersLatencyMs).toBe(100)
    expect(result.headersToFirstTextMs).toBe(150)
    expect(result.totalLatencyMs).toBe(400)
    expect(result.fullText).toBe('Merhaba')
    expect(result.sourceCount).toBe(1)
    expect(result.completed).toBe(true)
    expect(result.conversationId).toBe('conv-1')
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 20 })
  })

  it('keeps TTFT null for a valid artifact-only completion instead of inventing a token time', async () => {
    const times = [2_000, 2_050, 2_300]
    const result = await probeAgenticRuntimeStagingTurn({
      targetSupabaseUrl: 'https://staging.supabase.co',
      productionSupabaseUrl: 'https://prod.supabase.co',
      anonKey: 'anon',
      accessToken: 'token',
      workspaceId: 'ws-1',
      messageId: 'm-2',
      message: 'docx üret',
      fetchImpl: (async () => sseResponse([
        'event: artifacts\ndata: {"type":"artifacts","artifacts":[{"attachmentId":"a1"}]}\n\n',
        'event: completed\ndata: {"type":"completed","conversationId":"conv-2","model":"gpt-5.6-sol","provider":"openai"}\n\n',
        'data: [DONE]\n\n',
      ])) as any,
      now: () => times.shift() ?? 2_300,
    })

    expect(result.endToEndTtftMs).toBeNull()
    expect(result.artifactCount).toBe(1)
    expect(result.totalLatencyMs).toBe(300)
  })
})
