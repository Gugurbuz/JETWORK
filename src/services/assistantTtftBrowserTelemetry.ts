type BrowserTtftGlobal = typeof globalThis & {
  __jetworkBrowserTtftInstalled?: boolean;
};

type AssistantRequestBody = {
  messageId?: unknown;
};

const isAssistantRuntimeRequest = (input: RequestInfo | URL): boolean => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  return /\/functions\/v1\/openai-assistant-v2(?:\?|$)/i.test(url);
};

const messageIdFromInit = (init?: RequestInit): string => {
  if (typeof init?.body !== 'string') return '';
  try {
    const body = JSON.parse(init.body) as AssistantRequestBody;
    return String(body?.messageId || '').trim().slice(0, 240);
  } catch {
    return '';
  }
};

const parseFirstTextDelta = (buffer: string): { found: boolean; remainder: string } => {
  let cursor = 0;
  const separator = /\r?\n\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = separator.exec(buffer)) !== null) {
    const frame = buffer.slice(cursor, match.index);
    const eventName = frame.split(/\r?\n/)
      .find(line => line.startsWith('event:'))
      ?.slice(6)
      .trim();
    const data = frame.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data && data !== '[DONE]') {
      try {
        const payload = JSON.parse(data) as Record<string, unknown>;
        const type = eventName || String(payload.type || '');
        if (type === 'text_delta' && String(payload.delta || '')) {
          return { found: true, remainder: '' };
        }
      } catch {
        // Ignore malformed telemetry copies; the real assistant stream is untouched.
      }
    }
    cursor = match.index + match[0].length;
  }
  return { found: false, remainder: buffer.slice(cursor) };
};

const emitBrowserTtft = (payload: Record<string, unknown>) => {
  console.info('ASSISTANT_BROWSER_TTFT', JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('jetwork:assistant-ttft', { detail: payload }));
};

const observeFirstTextDelta = (
  response: Response,
  input: {
    messageId: string;
    requestStartedAtMs: number;
    responseHeadersAtMs: number;
  },
) => {
  if (!response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return;
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    return;
  }
  const reader = clone.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        if (!value?.byteLength) continue;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseFirstTextDelta(buffer);
        buffer = parsed.remainder;
        if (!parsed.found) continue;

        const firstTextReceivedAtMs = performance.now();
        await reader.cancel().catch(() => undefined);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const nextPaintAtMs = performance.now();
            emitBrowserTtft({
              messageId: input.messageId || undefined,
              requestToResponseHeadersMs: Math.max(0, Math.round(input.responseHeadersAtMs - input.requestStartedAtMs)),
              responseHeadersToFirstTextDeltaMs: Math.max(0, Math.round(firstTextReceivedAtMs - input.responseHeadersAtMs)),
              requestToFirstTextDeltaMs: Math.max(0, Math.round(firstTextReceivedAtMs - input.requestStartedAtMs)),
              firstTextDeltaToNextPaintMs: Math.max(0, Math.round(nextPaintAtMs - firstTextReceivedAtMs)),
              requestToNextPaintMs: Math.max(0, Math.round(nextPaintAtMs - input.requestStartedAtMs)),
            });
          });
        });
        return;
      }
    } catch {
      // Telemetry must never affect the actual response stream.
    }
  })();
};

export const installAssistantTtftBrowserTelemetry = () => {
  if (typeof window === 'undefined' || typeof globalThis.fetch !== 'function') return;
  const state = globalThis as BrowserTtftGlobal;
  if (state.__jetworkBrowserTtftInstalled) return;
  state.__jetworkBrowserTtftInstalled = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAssistantRuntimeRequest(input)) return originalFetch(input, init);

    const requestStartedAtMs = performance.now();
    const messageId = messageIdFromInit(init);
    const response = await originalFetch(input, init);
    const responseHeadersAtMs = performance.now();
    observeFirstTextDelta(response, { messageId, requestStartedAtMs, responseHeadersAtMs });
    return response;
  };
};
