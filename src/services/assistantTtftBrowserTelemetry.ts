import { useMessageStore } from '../store/useMessageStore';

type BrowserTtftGlobal = typeof globalThis & {
  __jetworkBrowserTtftInstalled?: boolean;
};

type AssistantRequestBody = {
  workspaceId?: unknown;
  messageId?: unknown;
};

type BrowserObservation = {
  workspaceId: string;
  messageId: string;
  aiMessageId?: string;
  aiPlaceholderCreatedAtMs?: number;
  requestStartedAtMs: number;
  requestStartedEpochMs: number;
  responseHeadersAtMs?: number;
  firstTextDeltaAtMs?: number;
  browserRenderAtMs?: number;
  emitted: boolean;
};

const isAssistantRuntimeRequest = (input: RequestInfo | URL): boolean => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;
  return /\/functions\/v1\/openai-assistant-v2(?:\?|$)/i.test(url);
};

const assistantRequestFromInit = (init?: RequestInit): AssistantRequestBody => {
  if (typeof init?.body !== 'string') return {};
  try {
    return JSON.parse(init.body) as AssistantRequestBody;
  } catch {
    return {};
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

const emitBrowserTtft = (observation: BrowserObservation) => {
  if (
    observation.emitted
    || observation.responseHeadersAtMs === undefined
    || observation.firstTextDeltaAtMs === undefined
    || observation.browserRenderAtMs === undefined
  ) return;

  observation.emitted = true;
  const browserRenderEpochMs = observation.requestStartedEpochMs
    + (observation.browserRenderAtMs - observation.requestStartedAtMs);
  const payload = {
    workspaceId: observation.workspaceId || undefined,
    messageId: observation.messageId || undefined,
    aiMessageId: observation.aiMessageId || undefined,
    userTurnToRequestMs: observation.aiPlaceholderCreatedAtMs === undefined
      ? undefined
      : Math.max(0, Math.round(observation.requestStartedEpochMs - observation.aiPlaceholderCreatedAtMs)),
    requestToResponseHeadersMs: Math.max(0, Math.round(observation.responseHeadersAtMs - observation.requestStartedAtMs)),
    responseHeadersToFirstTextDeltaMs: Math.max(0, Math.round(observation.firstTextDeltaAtMs - observation.responseHeadersAtMs)),
    requestToFirstTextDeltaMs: Math.max(0, Math.round(observation.firstTextDeltaAtMs - observation.requestStartedAtMs)),
    firstTextDeltaToBrowserRenderMs: Math.max(0, Math.round(observation.browserRenderAtMs - observation.firstTextDeltaAtMs)),
    requestToBrowserRenderMs: Math.max(0, Math.round(observation.browserRenderAtMs - observation.requestStartedAtMs)),
    userTurnToBrowserRenderMs: observation.aiPlaceholderCreatedAtMs === undefined
      ? undefined
      : Math.max(0, Math.round(browserRenderEpochMs - observation.aiPlaceholderCreatedAtMs)),
  };
  console.info('ASSISTANT_BROWSER_TTFT', JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent('jetwork:assistant-ttft', { detail: payload }));
};

const findPendingAssistantMessage = (workspaceId: string) => {
  const messages = useMessageStore.getState().messagesByWorkspace[workspaceId] || [];
  return [...messages]
    .reverse()
    .find(message => message.role === 'model' && message.isTyping && !(message.text || '').trim());
};

const observeBrowserRender = (observation: BrowserObservation) => {
  if (!observation.workspaceId || !observation.aiMessageId) return;
  let finished = false;
  let unsubscribe = () => {};
  const timeout = window.setTimeout(() => {
    if (finished) return;
    finished = true;
    unsubscribe();
  }, 150_000);

  const check = () => {
    if (finished) return;
    const messages = useMessageStore.getState().messagesByWorkspace[observation.workspaceId] || [];
    const target = messages.find(message => message.id === observation.aiMessageId);
    if (!target || !(target.text || '').trim()) return;

    finished = true;
    unsubscribe();
    window.clearTimeout(timeout);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        observation.browserRenderAtMs = performance.now();
        emitBrowserTtft(observation);
      });
    });
  };

  unsubscribe = useMessageStore.subscribe(check);
  check();
};

const observeFirstTextDelta = (response: Response, observation: BrowserObservation) => {
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

        observation.firstTextDeltaAtMs = performance.now();
        await reader.cancel().catch(() => undefined);
        emitBrowserTtft(observation);
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

    const requestBody = assistantRequestFromInit(init);
    const workspaceId = String(requestBody.workspaceId || '').trim().slice(0, 200);
    const messageId = String(requestBody.messageId || '').trim().slice(0, 240);
    const pendingAssistant = workspaceId ? findPendingAssistantMessage(workspaceId) : undefined;
    const observation: BrowserObservation = {
      workspaceId,
      messageId,
      aiMessageId: pendingAssistant?.id,
      aiPlaceholderCreatedAtMs: pendingAssistant?.createdAt,
      requestStartedAtMs: performance.now(),
      requestStartedEpochMs: Date.now(),
      emitted: false,
    };

    observeBrowserRender(observation);
    const response = await originalFetch(input, init);
    observation.responseHeadersAtMs = performance.now();
    observeFirstTextDelta(response, observation);
    return response;
  };
};
