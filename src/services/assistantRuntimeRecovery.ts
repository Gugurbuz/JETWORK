const RECOVERY_DELAY_MS = 750;

const RETRYABLE_HTTP_CODES = new Set([
  'CONVERSATION_BUSY',
  'TURN_IN_PROGRESS',
  'SEMANTIC_PLAN_IN_PROGRESS',
]);

const RETRYABLE_HTTP_MESSAGES = /(?:başka bir yanıt hâlâ hazırlanıyor|yanıt.*hazırlanıyor|turn.*in progress|semantic plan.*in progress)/iu;
const RETRYABLE_TRANSPORT_MESSAGES = /(?:load failed|failed to fetch|networkerror|network request failed|connection.*(?:closed|lost|reset)|fetch.*failed|yanıt tamamlanmadan kesildi)/iu;

export const isRecoverableAssistantTransportError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return RETRYABLE_TRANSPORT_MESSAGES.test(message);
};

export const isRecoverableAssistantBusyResponse = async (response: Response): Promise<boolean> => {
  if (response.status !== 409) return false;
  const payload = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
  const code = String(payload.code || '').trim();
  const message = String(payload.error || '').trim();
  return RETRYABLE_HTTP_CODES.has(code) || RETRYABLE_HTTP_MESSAGES.test(message);
};

export const waitForAssistantRecovery = async (
  signal: AbortSignal,
  milliseconds = RECOVERY_DELAY_MS,
): Promise<void> => {
  if (signal.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(signal.reason || new DOMException('Aborted', 'AbortError'));
    const timeout = setTimeout(() => finish(), Math.max(0, milliseconds));
    signal.addEventListener('abort', onAbort, { once: true });
  });
};
