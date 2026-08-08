export interface StreamControllerLike {
  enqueue(chunk: Uint8Array): void
  close(): void
}

export interface SafeStreamSink {
  write(chunk: Uint8Array): boolean
  event(event: string, payload: unknown): boolean
  done(): boolean
  close(): boolean
  isOpen(): boolean
}

/**
 * A ReadableStream controller becomes unusable as soon as the downstream
 * consumer disconnects or the stream is closed. Direct enqueue/close calls
 * turn that normal lifecycle event into a TypeError. This sink makes terminal
 * stream operations idempotent and converts downstream disconnects into a
 * no-op instead of a business/runtime failure.
 */
export function createSafeStreamSink(
  controller: StreamControllerLike,
  encoder = new TextEncoder(),
): SafeStreamSink {
  let open = true

  const markClosed = () => {
    open = false
  }

  const write = (chunk: Uint8Array): boolean => {
    if (!open) return false
    try {
      controller.enqueue(chunk)
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
