export const ASSISTANT_STREAM_RECOVERY_DELAYS_MS = [250, 600, 1200, 2000] as const;

export const waitForAssistantRecovery = (delayMs: number, signal?: AbortSignal): Promise<void> => (
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
      return;
    }
    const abort = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
    };
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  })
);

/**
 * A streamed assistant request may finish server-side while the browser misses
 * the terminal SSE frame. Replaying the same message id and request body is safe
 * because assistant turns are idempotent; a completed turn is returned from the
 * server cache instead of generating a second answer.
 */
export const shouldRetryAssistantStreamRecovery = (status: number): boolean => (
  status === 409 || status === 425 || status === 503
);
