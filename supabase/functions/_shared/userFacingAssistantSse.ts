const isStatusFrame = (frame: string): boolean => {
  if (/^event:\s*status\s*$/mi.test(frame)) return true
  const data = frame
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''))
    .join('\n')
    .trim()
  if (!data || data === '[DONE]') return false
  try {
    const payload = JSON.parse(data)
    return payload && typeof payload === 'object' && payload.type === 'status'
  } catch {
    return false
  }
}

const nextFrameBoundary = (value: string): { index: number; separator: string } | null => {
  const match = /\r?\n\r?\n/.exec(value)
  return match ? { index: match.index, separator: match[0] } : null
}

/**
 * Removes internal runtime status/progress events from the browser-facing SSE
 * stream while preserving text, sources, completed, error and DONE frames.
 * Operational stage data remains available in reasoning telemetry/logs.
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
        controller.enqueue(encoder.encode(`${frame}${boundary.separator}`))
      }
    }

    if (flush && buffer) {
      if (!isStatusFrame(buffer)) controller.enqueue(encoder.encode(buffer))
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
