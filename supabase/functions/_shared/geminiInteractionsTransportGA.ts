import {
  buildGeminiInteractionsRequest,
  GEMINI_INTERACTIONS_MODEL,
  normalizeGeminiInteraction,
  type GeminiInteractionPublicStepEvent,
  type GeminiInteractionsNormalizedResponse,
  type GeminiInteractionsRequest,
} from './geminiInteractionsRuntimeV3.ts'

export const GEMINI_INTERACTIONS_API_VERSION = 'v1'
export const GEMINI_INTERACTIONS_URL = `https://generativelanguage.googleapis.com/${GEMINI_INTERACTIONS_API_VERSION}/interactions?alt=sse`

type SseEnvelope = { event?: string; data: string }
type StreamingStep = {
  index: number
  step: Record<string, unknown>
  text: string
  argumentsText: string
  annotations: Array<Record<string, unknown>>
}

const parseArguments = (value: string): Record<string, unknown> => {
  if (!value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

const parseSseFrames = (buffer: string, flush = false): { frames: SseEnvelope[]; remainder: string } => {
  const frames: SseEnvelope[] = []
  let cursor = 0
  const separator = /\r?\n\r?\n/g
  let match: RegExpExecArray | null
  while ((match = separator.exec(buffer)) !== null) {
    const raw = buffer.slice(cursor, match.index)
    const lines = raw.split(/\r?\n/)
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (data) frames.push({ event, data })
    cursor = match.index + match[0].length
  }
  let remainder = buffer.slice(cursor)
  if (flush && remainder.trim()) {
    const lines = remainder.split(/\r?\n/)
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (data) frames.push({ event, data })
    remainder = ''
  }
  return { frames, remainder }
}

const contentTextAndAnnotations = (step: Record<string, unknown>) => {
  if (!Array.isArray(step.content)) return { text: '', annotations: [] as Array<Record<string, unknown>> }
  let text = ''
  const annotations: Array<Record<string, unknown>> = []
  for (const raw of step.content as Array<unknown>) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as Record<string, unknown>
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
    if (Array.isArray(block.annotations)) {
      annotations.push(...block.annotations.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>)
    }
  }
  return { text, annotations }
}

const finalizeStreamingStep = (builder: StreamingStep): Record<string, unknown> => {
  const type = String(builder.step.type || '')
  if (type === 'function_call') {
    return {
      ...builder.step,
      arguments: builder.argumentsText.trim()
        ? parseArguments(builder.argumentsText)
        : (builder.step.arguments && typeof builder.step.arguments === 'object' ? builder.step.arguments : {}),
    }
  }
  if (type === 'model_output') {
    const existing = contentTextAndAnnotations(builder.step)
    const text = `${existing.text}${builder.text}`
    return {
      ...builder.step,
      content: text
        ? [{ type: 'text', text, annotations: [...existing.annotations, ...builder.annotations] }]
        : [],
    }
  }
  return builder.step
}

const publicStepDescriptor = (
  step: Record<string, unknown>,
): Omit<GeminiInteractionPublicStepEvent, 'lifecycle' | 'failed'> | null => {
  const stepType = String(step.type || '')
  const operationId = String(step.id || '').trim()
  if (!operationId) return null
  if (stepType === 'google_search_call') return { operationId, stepType, toolFamily: 'web' }
  if (stepType === 'url_context_call') return { operationId, stepType, toolFamily: 'web' }
  if (stepType === 'code_execution_call') return { operationId, stepType, toolFamily: 'code' }
  return null
}

const normalizeUsageWithTiming = (
  response: GeminiInteractionsNormalizedResponse,
  startedAt: number,
  firstTextAt: number | null,
  previousInteractionUsed: boolean,
) => ({
  ...response,
  usage: {
    ...(response.usage || {}),
    gemini_provider_total_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    gemini_previous_interaction_used: previousInteractionUsed ? 1 : 0,
    gemini_interactions_ga_v1: 1,
    ...(firstTextAt == null ? {} : {
      gemini_provider_first_text_ms: Math.max(0, Math.round(firstTextAt - startedAt)),
    }),
  },
})

const terminalStreamError = (eventType: string, event: Record<string, unknown>) => {
  const error = event.error && typeof event.error === 'object' && !Array.isArray(event.error)
    ? event.error as Record<string, unknown>
    : {}
  const detail = String(error.message || event.message || '').trim()
  if (detail) return detail
  if (eventType === 'interaction.cancelled') return 'Gemini Interactions stream was cancelled.'
  if (eventType === 'interaction.incomplete') return 'Gemini Interactions stream ended incomplete.'
  return 'Gemini Interactions stream failed.'
}

const requestStreamingInteraction = async (
  response: Response,
  input: GeminiInteractionsRequest,
  startedAt: number,
  previousInteractionUsed: boolean,
): Promise<GeminiInteractionsNormalizedResponse> => {
  if (!response.body) throw new Error('Gemini Interactions API returned an empty stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const builders = new Map<number, StreamingStep>()
  const completedSteps: Array<Record<string, unknown>> = []
  let buffer = ''
  let interaction: Record<string, unknown> = { model: GEMINI_INTERACTIONS_MODEL, status: 'in_progress' }
  let firstTextAt: number | null = null

  const handleFrame = (frame: SseEnvelope) => {
    if (!frame.data || frame.data === '[DONE]') return
    const event = JSON.parse(frame.data) as Record<string, unknown>
    const eventType = String(event.event_type || frame.event || '')

    if (eventType === 'interaction.created') {
      const created = event.interaction && typeof event.interaction === 'object' && !Array.isArray(event.interaction)
        ? event.interaction as Record<string, unknown>
        : {}
      interaction = { ...interaction, ...created }
      return
    }

    if (eventType === 'interaction.in_progress') {
      interaction.status = 'in_progress'
      return
    }

    if (eventType === 'interaction.requires_action') {
      interaction.status = 'requires_action'
      return
    }

    // Backward-compatible during Google's schema transition; v1 uses the
    // dedicated status events above.
    if (eventType === 'interaction.status_update') {
      interaction.status = String(event.status || interaction.status || 'in_progress')
      return
    }

    if (eventType === 'step.start') {
      const index = Number(event.index)
      const step = event.step && typeof event.step === 'object' && !Array.isArray(event.step)
        ? event.step as Record<string, unknown>
        : {}
      if (Number.isFinite(index)) builders.set(index, { index, step, text: '', argumentsText: '', annotations: [] })
      const descriptor = publicStepDescriptor(step)
      if (descriptor) input.onStepEvent?.({ lifecycle: 'start', ...descriptor })
      return
    }

    if (eventType === 'step.delta') {
      const index = Number(event.index)
      const builder = builders.get(index)
      if (!builder) return
      const delta = event.delta && typeof event.delta === 'object' && !Array.isArray(event.delta)
        ? event.delta as Record<string, unknown>
        : {}
      const deltaType = String(delta.type || '')
      if (deltaType === 'text' && typeof delta.text === 'string') {
        if (firstTextAt == null && delta.text) firstTextAt = performance.now()
        builder.text += delta.text
        if (Array.isArray(delta.annotations)) {
          builder.annotations.push(...delta.annotations.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>>)
        }
        input.onText(delta.text)
        return
      }
      if (deltaType === 'arguments_delta' || deltaType === 'arguments') {
        const partial = typeof delta.arguments === 'string'
          ? delta.arguments
          : typeof delta.partial_arguments === 'string'
            ? delta.partial_arguments
            : ''
        builder.argumentsText += partial
        return
      }
      if (deltaType === 'google_search_call' && delta.arguments && typeof delta.arguments === 'object') {
        builder.step = { ...builder.step, arguments: delta.arguments }
      }
      return
    }

    if (eventType === 'step.stop') {
      const index = Number(event.index)
      const builder = builders.get(index)
      if (!builder) return
      const finalStep = event.step && typeof event.step === 'object' && !Array.isArray(event.step)
        ? { ...builder.step, ...(event.step as Record<string, unknown>) }
        : builder.step
      builder.step = finalStep
      completedSteps.push(finalizeStreamingStep(builder))
      builders.delete(index)
      const descriptor = publicStepDescriptor(finalStep)
      if (descriptor) input.onStepEvent?.({ lifecycle: 'complete', ...descriptor })
      return
    }

    if (eventType === 'interaction.completed') {
      const completed = event.interaction && typeof event.interaction === 'object' && !Array.isArray(event.interaction)
        ? event.interaction as Record<string, unknown>
        : {}
      interaction = { ...interaction, ...completed }
      return
    }

    if (
      eventType === 'error'
      || eventType === 'interaction.failed'
      || eventType === 'interaction.cancelled'
      || eventType === 'interaction.incomplete'
    ) {
      throw new Error(terminalStreamError(eventType, event))
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseFrames(buffer)
    buffer = parsed.remainder
    parsed.frames.forEach(handleFrame)
  }
  buffer += decoder.decode()
  parseSseFrames(buffer, true).frames.forEach(handleFrame)

  for (const builder of [...builders.values()].sort((a, b) => a.index - b.index)) {
    completedSteps.push(finalizeStreamingStep(builder))
    const descriptor = publicStepDescriptor(builder.step)
    if (descriptor) input.onStepEvent?.({ lifecycle: 'complete', ...descriptor, failed: true })
  }

  const normalized = normalizeGeminiInteraction({ ...interaction, steps: completedSteps })
  if (!['completed', 'requires_action'].includes(String(normalized.status || ''))) {
    throw new Error(`Gemini Interactions stream ended with status ${String(normalized.status || 'unknown')}.`)
  }
  return normalizeUsageWithTiming(normalized, startedAt, firstTextAt, previousInteractionUsed)
}

export async function requestGeminiInteractionsResponseGA(
  input: GeminiInteractionsRequest,
): Promise<GeminiInteractionsNormalizedResponse> {
  const body = buildGeminiInteractionsRequest(input)
  const previousInteractionUsed = typeof (body as Record<string, unknown>).previous_interaction_id === 'string'
  const startedAt = performance.now()
  const response = await fetch(GEMINI_INTERACTIONS_URL, {
    method: 'POST',
    signal: input.signal,
    headers: {
      'x-goog-api-key': input.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    const error = payload.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
      ? payload.error as Record<string, unknown>
      : {}
    throw new Error(String(error.message || `Gemini Interactions API returned ${response.status}.`))
  }

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) {
    return requestStreamingInteraction(response, input, startedAt, previousInteractionUsed)
  }

  // Defensive fallback for gateways/tests that buffer a successful interaction
  // even when SSE was requested.
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  const normalized = normalizeGeminiInteraction(payload)
  if (!['completed', 'requires_action'].includes(String(normalized.status || ''))) {
    throw new Error(`Gemini Interactions response status is ${String(normalized.status || 'unknown')}.`)
  }
  let firstTextAt: number | null = null
  for (const item of normalized.output || []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (part.type === 'output_text' && typeof part.text === 'string' && part.text) {
        if (firstTextAt == null) firstTextAt = performance.now()
        input.onText(part.text)
      }
    }
  }
  return normalizeUsageWithTiming(normalized, startedAt, firstTextAt, previousInteractionUsed)
}
