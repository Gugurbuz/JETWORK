export interface StreamControllerLike {
  enqueue(chunk: Uint8Array): void
  close(): void
}

export interface SafeStreamTimingObservation {
  version: 'safe-stream-timing-v1'
  streamOpenedAtMs: number
  firstTextDeltaAtMs: number | null
  completedAtMs: number
  streamOpenToFirstTextMs: number | null
  streamTotalMs: number
  firstTextObserved: boolean
  completedEventObserved: boolean
  conversationId?: string
  model?: string
  provider?: string
  cached?: boolean
}

export interface SafeStreamSinkOptions {
  now?: () => number
  onTiming?: (observation: SafeStreamTimingObservation) => void
  logTiming?: boolean
}

export interface SafeStreamSink {
  write(chunk: Uint8Array): boolean
  event(event: string, payload: unknown): boolean
  done(): boolean
  close(): boolean
  isOpen(): boolean
}

const clean = (value: unknown, max = 240) => String(value ?? '').trim().slice(0, max)

/**
 * A ReadableStream controller becomes unusable as soon as the downstream
 * consumer disconnects or the stream is closed. Direct enqueue/close calls
 * turn that normal lifecycle event into a TypeError. This sink makes terminal
 * stream operations idempotent and converts downstream disconnects into a
 * no-op instead of a business/runtime failure.
 *
 * P7 observation is intentionally limited to stream-layer timing. The metric is
 * named streamOpenToFirstTextMs because this layer does not know the original
 * request-received timestamp and therefore must never label this value as
 * end-to-end TTFT.
 */
export function createSafeStreamSink(
  controller: StreamControllerLike,
  encoder = new TextEncoder(),
  options: SafeStreamSinkOptions = {},
): SafeStreamSink {
  let open = true
  const now = options.now || (() => Date.now())
  const streamOpenedAtMs = now()
  let firstTextDeltaAtMs: number | null = null
  let completedEventObserved = false
  let conversationId = ''
  let model = ''
  let provider = ''
  let cached: boolean | undefined
  let observationEmitted = false
  let observationBuffer = ''
  const observationDecoder = new TextDecoder()

  const emitTiming = () => {
    if (observationEmitted) return
    observationEmitted = true
    const completedAtMs = now()
    const observation: SafeStreamTimingObservation = {
      version: 'safe-stream-timing-v1',
      streamOpenedAtMs,
      firstTextDeltaAtMs,
      completedAtMs,
      streamOpenToFirstTextMs: firstTextDeltaAtMs === null ? null : Math.max(0, firstTextDeltaAtMs - streamOpenedAtMs),
      streamTotalMs: Math.max(0, completedAtMs - streamOpenedAtMs),
      firstTextObserved: firstTextDeltaAtMs !== null,
      completedEventObserved,
      conversationId: conversationId || undefined,
      model: model || undefined,
      provider: provider || undefined,
      cached,
    }
    options.onTiming?.(observation)
    if (options.logTiming !== false) console.info('ASSISTANT_STREAM_TIMING', JSON.stringify(observation))
  }

  const observeFrame = (frame: string) => {
    const eventName = frame.split(/\r?\n/u).find(line => line.startsWith('event:'))?.slice(6).trim() || ''
    const data = frame.split(/\r?\n/u)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /u, ''))
      .join('\n')
    if (!data || data === '[DONE]') return
    let payload: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(data)
      payload = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      return
    }
    const type = clean(eventName || payload?.type, 80)
    if (type === 'text_delta' && firstTextDeltaAtMs === null && clean(payload?.delta, 8_000)) {
      firstTextDeltaAtMs = now()
    }
    if (type === 'completed') {
      completedEventObserved = true
      conversationId = clean(payload?.conversationId, 240)
      model = clean(payload?.model, 120)
      provider = clean(payload?.provider, 40)
      cached = typeof payload?.cached === 'boolean' ? payload.cached : undefined
    }
  }

  const observeChunk = (chunk: Uint8Array) => {
    observationBuffer += observationDecoder.decode(chunk, { stream: true })
    if (observationBuffer.length > 64_000) observationBuffer = observationBuffer.slice(-32_000)
    const frames = observationBuffer.split(/\r?\n\r?\n/u)
    observationBuffer = frames.pop() || ''
    frames.forEach(observeFrame)
  }

  const markClosed = () => {
    if (!open) return
    open = false
    emitTiming()
  }

  const write = (chunk: Uint8Array): boolean => {
    if (!open) return false
    try {
      controller.enqueue(chunk)
      observeChunk(chunk)
      return true
    } catch {
      markClosed()
      return false
    }
  }

  const event = (eventName: string, payload: unknown): boolean => write(
    encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`),
  )

  const close = (): boolean => {
    if (!open) return false
    try {
      controller.close()
      markClosed()
      return true
    } catch {
      markClosed()
      return false
    }
  }

  const done = (): boolean => {
    if (!open) return false
    if (!write(encoder.encode('data: [DONE]\n\n'))) return false
    return close()
  }

  return {
    write,
    event,
    done,
    close,
    isOpen: () => open,
  }
}
