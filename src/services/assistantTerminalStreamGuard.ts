const ASSISTANT_V2_PATH = '/functions/v1/openai-assistant-v2';

let installed = false;

const requestMethod = (input: RequestInfo | URL, init?: RequestInit): string => (
  String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
);

const requestUrl = (input: RequestInfo | URL): string => (
  input instanceof Request ? input.url : String(input)
);

export const isAssistantTerminalGuardRequest = (input: RequestInfo | URL, init?: RequestInit): boolean => {
  if (requestMethod(input, init) !== 'POST') return false;
  const url = requestUrl(input);
  try {
    return new URL(url, window.location.href).pathname === ASSISTANT_V2_PATH;
  } catch {
    return url.includes(ASSISTANT_V2_PATH);
  }
};

const dataPayload = (frame: string): string => frame
  .split(/\r?\n/)
  .filter(line => line.startsWith('data:'))
  .map(line => line.slice('data:'.length).trimStart())
  .join('\n')
  .trim();

export const isTerminalAssistantSseFrame = (frame: string): boolean => {
  if (/^event:\s*(?:completed|error)\s*$/mi.test(frame)) return true;
  const data = dataPayload(frame);
  if (data === '[DONE]') return true;
  if (!data) return false;
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    return payload?.type === 'completed' || payload?.type === 'error';
  } catch {
    return false;
  }
};

export const closeOnAssistantTerminalEvent = (response: Response): Response => {
  if (!response.ok || !response.body) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const sourceReader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';
      let terminalSeen = false;

      const emitFrames = (flush = false) => {
        const normalized = buffer.replace(/\r\n/g, '\n');
        const parts = normalized.split('\n\n');
        buffer = flush ? '' : (parts.pop() || '');
        const completeFrames = flush ? parts.filter(Boolean) : parts;

        for (const frame of completeFrames) {
          if (!frame.trim()) continue;
          controller.enqueue(encoder.encode(`${frame}\n\n`));
          if (isTerminalAssistantSseFrame(frame)) {
            terminalSeen = true;
            break;
          }
        }
      };

      try {
        while (!terminalSeen) {
          const { done, value } = await sourceReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          emitFrames();
        }

        if (!terminalSeen) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            const tail = buffer.replace(/\r\n/g, '\n');
            controller.enqueue(encoder.encode(tail));
            terminalSeen = isTerminalAssistantSseFrame(tail);
          }
        }
      } catch (error) {
        controller.error(error);
        return;
      } finally {
        if (terminalSeen) {
          await sourceReader.cancel('Assistant terminal SSE event received.').catch(() => undefined);
        }
        sourceReader.releaseLock();
      }

      controller.close();
    },
    async cancel(reason) {
      await sourceReader.cancel(reason).catch(() => undefined);
      sourceReader.releaseLock();
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const installAssistantTerminalStreamGuard = (): void => {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;
  const previousFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await previousFetch(input, init);
    if (!isAssistantTerminalGuardRequest(input, init)) return response;
    return closeOnAssistantTerminalEvent(response);
  }) as typeof window.fetch;
};
