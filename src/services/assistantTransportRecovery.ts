const ASSISTANT_V2_PATH = '/functions/v1/openai-assistant-v2';
const RECOVERY_DELAY_MS = 750;
const TRANSIENT_TRANSPORT_PATTERN = /(?:load failed|failed to fetch|networkerror|network request failed|connection.*(?:closed|lost|reset)|fetch.*failed|body stream.*(?:error|aborted)|premature.*close)/iu;
const RECOVERABLE_BUSY_CODES = new Set(['CONVERSATION_BUSY', 'TURN_IN_PROGRESS', 'SEMANTIC_PLAN_IN_PROGRESS']);

let installed = false;

const abortError = (signal?: AbortSignal) => (
  signal?.reason || new DOMException('Aborted', 'AbortError')
);

const waitWithSignal = async (signal?: AbortSignal, milliseconds = RECOVERY_DELAY_MS): Promise<void> => {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError(signal));
    const timer = setTimeout(() => finish(), milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

export const isAssistantV2Request = (input: RequestInfo | URL, init?: RequestInit): boolean => {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'POST') return false;
  const url = input instanceof Request ? input.url : String(input);
  try {
    return new URL(url, window.location.href).pathname === ASSISTANT_V2_PATH;
  } catch {
    return url.includes(ASSISTANT_V2_PATH);
  }
};

export const isTransientAssistantTransportError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  const message = error instanceof Error ? error.message : String(error || '');
  return TRANSIENT_TRANSPORT_PATTERN.test(message);
};

const responseBusyCode = async (response: Response): Promise<string> => {
  if (response.status !== 409) return '';
  const payload = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
  return String(payload.code || '').trim();
};

const sseEventName = (eventText: string): string => {
  const line = eventText.split(/\r?\n/).find(candidate => candidate.startsWith('event:'));
  return line ? line.slice('event:'.length).trim() : '';
};

const sseData = (eventText: string): string => eventText
  .split(/\r?\n/)
  .filter(line => line.startsWith('data:'))
  .map(line => line.slice('data:'.length).trimStart())
  .join('\n');

const encodeEvent = (encoder: TextEncoder, eventName: string, payload: unknown): Uint8Array => encoder.encode(
  `${eventName ? `event: ${eventName}\n` : ''}data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`,
);

interface ReplayState {
  assembledText: string;
  recoveryText: string;
  caughtUp: boolean;
  completedSeen: boolean;
}

const emitSseEvent = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  rawEvent: string,
  replaying: boolean,
  state: ReplayState,
): void => {
  const eventName = sseEventName(rawEvent);
  const data = sseData(rawEvent);
  if (!data) return;

  if (data === '[DONE]') {
    if (!replaying || state.caughtUp) controller.enqueue(encodeEvent(encoder, '', '[DONE]'));
    return;
  }

  if (eventName === 'text_delta') {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      if (!replaying) controller.enqueue(encoder.encode(`${rawEvent}\n\n`));
      return;
    }
    const delta = String(payload.delta || '');
    if (!replaying) {
      state.assembledText += delta;
      controller.enqueue(encodeEvent(encoder, 'text_delta', payload));
      return;
    }

    if (state.caughtUp) {
      state.assembledText += delta;
      controller.enqueue(encodeEvent(encoder, 'text_delta', payload));
      return;
    }

    state.recoveryText += delta;
    if (state.assembledText.startsWith(state.recoveryText)) return;
    if (!state.recoveryText.startsWith(state.assembledText)) {
      throw new Error('Assistant reconnect stream diverged from the already rendered prefix.');
    }

    const suffix = state.recoveryText.slice(state.assembledText.length);
    state.assembledText = state.recoveryText;
    state.caughtUp = true;
    if (suffix) {
      controller.enqueue(encodeEvent(encoder, 'text_delta', { ...payload, delta: suffix }));
    }
    return;
  }

  if (eventName === 'completed') {
    if (replaying && !state.caughtUp && state.recoveryText === state.assembledText) state.caughtUp = true;
    if (replaying && !state.caughtUp) {
      throw new Error('Assistant reconnect completed before matching the rendered prefix.');
    }
    state.completedSeen = true;
    controller.enqueue(encodeEvent(encoder, 'completed', JSON.parse(data)));
    return;
  }

  // A server-side assistant error is a terminal application event, not a broken
  // transport. Forward it once and stop reconnecting; otherwise the same failed
  // turn is reclaimed repeatedly and can remain stuck in running state.
  if (eventName === 'error') {
    state.completedSeen = true;
    controller.enqueue(encoder.encode(`${rawEvent}\n\n`));
    return;
  }

  // During replay, pre-prefix status/source events are safe but redundant. Skip
  // them until text catches up; the completed cached response will still carry
  // the final sources and completion metadata afterwards.
  if (!replaying || state.caughtUp) controller.enqueue(encoder.encode(`${rawEvent}\n\n`));
};

const pumpResponseBody = async (
  response: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  decoder: TextDecoder,
  replaying: boolean,
  state: ReplayState,
): Promise<void> => {
  if (!response.body) throw new Error('Assistant response body is empty.');
  const reader = response.body.getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const normalized = buffer.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    buffer = parts.pop() || '';
    for (const eventText of parts) {
      if (eventText.trim()) emitSseEvent(controller, encoder, eventText, replaying, state);
    }
  }
  buffer += decoder.decode();
  const normalizedTail = buffer.replace(/\r\n/g, '\n');
  for (const eventText of normalizedTail.split('\n\n')) {
    if (eventText.trim()) emitSseEvent(controller, encoder, eventText, replaying, state);
  }
};

const buildRecoveringResponse = (
  firstResponse: Response,
  originalFetch: typeof window.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Response => {
  const headers = new Headers(firstResponse.headers);
  headers.delete('content-length');
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let response = firstResponse;
      let replaying = false;
      const state: ReplayState = {
        assembledText: '',
        recoveryText: '',
        caughtUp: true,
        completedSeen: false,
      };

      try {
        while (true) {
          state.completedSeen = false;
          if (replaying) {
            state.recoveryText = '';
            state.caughtUp = state.assembledText.length === 0;
          }

          try {
            await pumpResponseBody(response, controller, encoder, new TextDecoder(), replaying, state);
          } catch (error) {
            if (signal?.aborted) throw abortError(signal);
            if (!isTransientAssistantTransportError(error) && !String(error || '').includes('reconnect')) throw error;
          }

          if (state.completedSeen) {
            controller.close();
            return;
          }

          replaying = true;
          await waitWithSignal(signal);

          while (true) {
            try {
              response = await originalFetch(input, init);
            } catch (error) {
              if (signal?.aborted) throw abortError(signal);
              if (!isTransientAssistantTransportError(error)) throw error;
              await waitWithSignal(signal);
              continue;
            }

            const busyCode = await responseBusyCode(response);
            if (response.status === 409 && RECOVERABLE_BUSY_CODES.has(busyCode)) {
              await waitWithSignal(signal);
              continue;
            }
            if (!response.ok) {
              const payload = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
              throw new Error(String(payload.error || `Assistant recovery returned ${response.status}.`));
            }
            break;
          }
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    status: firstResponse.status,
    statusText: firstResponse.statusText,
    headers,
  });
};

export const installAssistantTransportRecovery = (): void => {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isAssistantV2Request(input, init)) return originalFetch(input, init);

    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    let response: Response;
    while (true) {
      try {
        response = await originalFetch(input, init);
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (!isTransientAssistantTransportError(error)) throw error;
        await waitWithSignal(signal);
        continue;
      }

      // A duplicate/replayed request can arrive while the durable turn or its
      // semantic plan is still running. Treat that as transport-level recovery,
      // not as a user-visible assistant failure. Keep replaying the same
      // idempotent messageId until the committed response is available (or the
      // caller aborts/times out).
      const busyCode = await responseBusyCode(response);
      if (response.status === 409 && RECOVERABLE_BUSY_CODES.has(busyCode)) {
        await waitWithSignal(signal);
        continue;
      }
      break;
    }

    if (!response.ok || !response.body) return response;
    return buildRecoveringResponse(response, originalFetch, input, init);
  }) as typeof window.fetch;
};