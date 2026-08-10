const dataPayloadForFrame = (frame: string): { raw: string; payload?: Record<string, unknown> } => {
  const raw = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim()

  if (!raw || raw === '[DONE]') return { raw }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? { raw, payload: parsed as Record<string, unknown> }
      : { raw }
  } catch {
    return { raw }
  }
}

const isStatusFrame = (frame: string): boolean => {
  if (/^event:\s*status\s*$/mi.test(frame)) return true
  const { payload } = dataPayloadForFrame(frame)
  return payload?.type === 'status'
}

const sanitizeCompletedFrame = (frame: string): string => {
  const { payload } = dataPayloadForFrame(frame)
  if (payload?.type !== 'completed') return frame

  const sanitized = { ...payload }
  delete sanitized.model
  delete sanitized.provider
  delete sanitized.fallbackUsed
  delete sanitized.usage
  delete sanitized.reasoningEngine
  delete sanitized.deterministicEnumeration

  const lines = frame.split(/\r?\n/)
  const preserved = lines.filter(line => !line.startsWith('data:'))
  preserved.push(`data: ${JSON.stringify(sanitized)}`)
  return preserved.join('\n')
}

const nextFrameBoundary = (value: string): { index: number; separator: string } | null => {
  const match = /\r?\n\r?\n/.exec(value)
  return match ? { index: match.index, separator: match[0] } : null
}

/**
 * Removes internal runtime status/progress events and provider telemetry from
 * the browser-facing SSE stream while preserving text, sources, completion,
 * error and DONE frames. Operational/model data remains available in the
 * internal reasoning telemetry and persisted run ledger.
 */
export function filterUserFacingAssistantSse(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const emitCompleteFrames = (
    controller: TransformStreamDefaultController<Uint8Array>,
    flush = false,
  ) => {
    while (true) {
      const boundary = nextFrameBoundary(buffer)
      if (!boundary) break
      const frame = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary.separator.length)
      if (frame && !isStatusFrame(frame)) {
        controller.enqueue(encoder.encode(`${sanitizeCompletedFrame(frame)}${boundary.separator}`))
      }
    }

    if (flush && buffer) {
      if (!isStatusFrame(buffer)) controller.enqueue(encoder.encode(sanitizeCompletedFrame(buffer)))
      buffer = ''
    }
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      emitCompleteFrames(controller)
    },
    flush(controller) {
      buffer += decoder.decode()
      emitCompleteFrames(controller, true)
    },
  })

  return source.pipeThrough(transform)
}
