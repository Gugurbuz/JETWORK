export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const defaultShouldRetry = (error: unknown): boolean => {
  if (!error) return false;
  const msg = (error as { message?: string })?.message?.toLowerCase() || '';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return true;
  const status = (error as { status?: number; code?: string })?.status;
  if (status && status >= 500) return true;
  if (status === 429) return true;
  return false;
};

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 4000,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !shouldRetry(error, attempt)) throw error;
      if (onRetry) onRetry(error, attempt);
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
      const jitter = Math.random() * delay * 0.2;
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}
