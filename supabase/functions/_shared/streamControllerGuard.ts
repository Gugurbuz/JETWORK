const STREAM_CONTROLLER_GUARD_MARKER = Symbol.for('jetwork.stream-controller-lifecycle-guard.v1')

const CLOSED_CONTROLLER_PATTERNS = [
  /stream controller cannot close or enqueue/iu,
  /controller is already closed/iu,
  /cannot (?:close|enqueue).*closed/iu,
  /invalid state.*(?:close|enqueue)/iu,
  /readable stream is already closed/iu,
]

export function isClosedStreamControllerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name && error.name !== 'TypeError' && error.name !== 'InvalidStateError') return false
  const message = String(error.message || '')
  return CLOSED_CONTROLLER_PATTERNS.some(pattern => pattern.test(message))
}

type ControllerPrototype = {
  enqueue?: (...args: unknown[]) => unknown
  close?: (...args: unknown[]) => unknown
  [STREAM_CONTROLLER_GUARD_MARKER]?: boolean
}

type StreamControllerTarget = {
  ReadableStreamDefaultController?: {
    prototype?: ControllerPrototype
  }
}

const restoreDescriptor = (
  prototype: ControllerPrototype,
  key: 'enqueue' | 'close',
  descriptor: PropertyDescriptor | undefined,
) => {
  try {
    if (descriptor) Object.defineProperty(prototype, key, descriptor)
  } catch {
    // Best-effort rollback only. Installation will surface the original failure.
  }
}

/**
 * The reasoning core is intentionally durable: a browser/navigation disconnect
 * must not abort the model/tool run or mark the assistant turn as failed.
 *
 * Native ReadableStream controllers throw when late enqueue/close calls happen
 * after their downstream consumer has disconnected. The core implementation
 * contains many direct controller writes, so this isolate-scoped guard converts
 * ONLY that normal terminal lifecycle error into a no-op. All unrelated errors
 * still propagate normally and keep the existing fail-closed behavior.
 */
export function installStreamControllerLifecycleGuard(
  target: StreamControllerTarget = globalThis as unknown as StreamControllerTarget,
): boolean {
  const prototype = target.ReadableStreamDefaultController?.prototype
  if (!prototype || prototype[STREAM_CONTROLLER_GUARD_MARKER]) return false

  const enqueueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'enqueue')
  const closeDescriptor = Object.getOwnPropertyDescriptor(prototype, 'close')
  const originalEnqueue = enqueueDescriptor?.value ?? prototype.enqueue
  const originalClose = closeDescriptor?.value ?? prototype.close
  if (typeof originalEnqueue !== 'function' || typeof originalClose !== 'function') return false

  const guardedEnqueue = function (this: unknown, ...args: unknown[]) {
    try {
      return Reflect.apply(originalEnqueue, this, args)
    } catch (error) {
      if (isClosedStreamControllerError(error)) return undefined
      throw error
    }
  }

  const guardedClose = function (this: unknown, ...args: unknown[]) {
    try {
      return Reflect.apply(originalClose, this, args)
    } catch (error) {
      if (isClosedStreamControllerError(error)) return undefined
      throw error
    }
  }

  try {
    Object.defineProperty(prototype, 'enqueue', {
      ...(enqueueDescriptor || {}),
      value: guardedEnqueue,
      writable: enqueueDescriptor?.writable ?? true,
      configurable: enqueueDescriptor?.configurable ?? true,
    })
    Object.defineProperty(prototype, 'close', {
      ...(closeDescriptor || {}),
      value: guardedClose,
      writable: closeDescriptor?.writable ?? true,
      configurable: closeDescriptor?.configurable ?? true,
    })
    Object.defineProperty(prototype, STREAM_CONTROLLER_GUARD_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    })
    return true
  } catch (error) {
    restoreDescriptor(prototype, 'enqueue', enqueueDescriptor)
    restoreDescriptor(prototype, 'close', closeDescriptor)
    throw error
  }
}
