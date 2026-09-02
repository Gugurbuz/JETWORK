import { consumeSseBuffer } from '../services/sseParser'

export const AGENTIC_RUNTIME_STAGING_PROBE_VERSION = 'agentic-runtime-staging-probe-v1'

export interface AgenticRuntimeStagingProbeInput {
  targetSupabaseUrl: string
  productionSupabaseUrl: string
  anonKey: string
  accessToken: string
  workspaceId: string
  messageId: string
  message: string
  model?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

export interface AgenticRuntimeStagingProbeResult {
  version: typeof AGENTIC_RUNTIME_STAGING_PROBE_VERSION
  fullText: string
  endToEndTtftMs: number | null
  headersLatencyMs: number
  headersToFirstTextMs: number | null
  totalLatencyMs: number
  completed: boolean
  conversationId?: string
  model?: string
  provider?: 'openai' | 'gemini'
  usage?: Record<string, number>
  sourceCount: number
  artifactCount: number
}

const normalizedBaseUrl = (value: string) => String(value || '').trim().replace(/\/+$/u, '').toLocaleLowerCase('en-US')
const clean = (value: unknown, max = 2_000) => String(value ?? '').trim().slice(0, max)

/**
 * Executes exactly one Agentic Runtime turn against an explicitly separate
 * staging Supabase target and measures request-start -> first visible text delta.
 * It refuses to run when target and production URLs are the same.
 */
export async function probeAgenticRuntimeStagingTurn(
  input: AgenticRuntimeStagingProbeInput,
): Promise<AgenticRuntimeStagingProbeResult> {
  const target = normalizedBaseUrl(input.targetSupabaseUrl)
  const production = normalizedBaseUrl(input.productionSupabaseUrl)
  if (!target || !production) throw new Error('STAGING_PROBE_URLS_REQUIRED')
  if (target === production) throw new Error('STAGING_PROBE_PRODUCTION_TARGET_FORBIDDEN')
  if (!input.anonKey || !input.accessToken) throw new Error('STAGING_PROBE_AUTH_REQUIRED')
  if (!clean(input.workspaceId, 200) || !clean(input.messageId, 240) || !clean(input.message, 32_000)) {
    throw new Error('STAGING_PROBE_TURN_INPUT_REQUIRED')
  }

  const fetchImpl = input.fetchImpl || fetch
  const now = input.now || (() => performance.now())
  const requestStartedAtMs = now()
  const response = await fetchImpl(`${target}/functions/v1/openai-assistant-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.accessToken}`,
      apikey: input.anonKey,
    },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      message: input.message,
      model: input.model || 'auto',
      chatAttachments: [],
    }),
  })
  const headersReceivedAtMs = now()
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`STAGING_PROBE_HTTP_${response.status}:${detail.slice(0, 500)}`)
  }
  if (!response.body) throw new Error('STAGING_PROBE_EMPTY_STREAM')

  let fullText = ''
  let firstTextAtMs: number | null = null
  let completed = false
  let conversationId = ''
  let responseModel = ''
  let provider: 'openai' | 'gemini' | undefined
  let usage: Record<string, number> | undefined
  let sourceCount = 0
  let artifactCount = 0

  const handleFrame = (event: { event?: string; data: string }) => {
    if (event.data === '[DONE]') return
    let payload: Record<string, unknown>
    try {
      const parsed = JSON.parse(event.data)
      if (!parsed || typeof parsed !== 'object') return
      payload = parsed as Record<string, unknown>
    } catch {
      return
    }
    const type = String(event.event || payload.type || '')
    if (type === 'text_delta') {
      const delta = String(payload.delta || '')
      fullText += delta
      if (firstTextAtMs === null && delta.trim()) firstTextAtMs = now()
      return
    }
    if (type === 'sources') {
      sourceCount = Array.isArray(payload.sources) ? payload.sources.length : sourceCount
      return
    }
    if (type === 'artifacts') {
      artifactCount = Array.isArray(payload.artifacts) ? payload.artifacts.length : artifactCount
      return
    }
    if (type !== 'completed') return
    completed = true
    conversationId = clean(payload.conversationId, 240)
    responseModel = clean(payload.model, 120)
    provider = payload.provider === 'gemini' ? 'gemini' : payload.provider === 'openai' ? 'openai' : undefined
    if (payload.usage && typeof payload.usage === 'object') {
      usage = Object.fromEntries(Object.entries(payload.usage as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))) as Record<string, number>
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = consumeSseBuffer(buffer)
    buffer = parsed.remainder
    parsed.events.forEach(handleFrame)
  }
  buffer += decoder.decode()
  consumeSseBuffer(buffer, true).events.forEach(handleFrame)
  const completedAtMs = now()

  if (!completed) throw new Error('STAGING_PROBE_COMPLETION_EVENT_MISSING')
  if (!fullText.trim() && artifactCount === 0) throw new Error('STAGING_PROBE_NO_USER_VISIBLE_OUTPUT')

  return {
    version: AGENTIC_RUNTIME_STAGING_PROBE_VERSION,
    fullText,
    endToEndTtftMs: firstTextAtMs === null ? null : Math.max(0, firstTextAtMs - requestStartedAtMs),
    headersLatencyMs: Math.max(0, headersReceivedAtMs - requestStartedAtMs),
    headersToFirstTextMs: firstTextAtMs === null ? null : Math.max(0, firstTextAtMs - headersReceivedAtMs),
    totalLatencyMs: Math.max(0, completedAtMs - requestStartedAtMs),
    completed,
    conversationId: conversationId || undefined,
    model: responseModel || undefined,
    provider,
    usage,
    sourceCount,
    artifactCount,
  }
}
