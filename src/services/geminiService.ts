import { supabase } from '../supabase';
import { consumeSseBuffer, type SseEvent } from './sseParser';

const DEFAULT_TIMEOUT_MS = 60_000;

export class AiHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AiHttpError';
  }
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export const callGemini = async (params: {
  model: string;
  systemInstruction: string;
  contents: any[];
  responseSchema?: any;
  tools?: any[];
  toolConfig?: any;
  timeoutMs?: number;
  signal?: AbortSignal;
  onChunk: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Yapay zeka isteği için aktif oturum bulunamadı.');
  }

  const token = session.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const abortController = new AbortController();
  const abortFromParent = () => abortController.abort(params.signal?.reason);
  if (params.signal?.aborted) abortFromParent();
  else params.signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(
    () => abortController.abort(new DOMException('AI request timed out.', 'TimeoutError')),
    params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/gemini-chat`, {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      },
      body: JSON.stringify({
        model: params.model,
        systemInstruction: params.systemInstruction,
        contents: params.contents,
        responseSchema: params.responseSchema,
        tools: params.tools,
        toolConfig: params.toolConfig,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AiHttpError(
        errorData.error || `API error: ${response.status}`,
        response.status,
        retryAfterMs(response.headers.get('Retry-After')),
      );
    }
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let fullThinking = '';
    let tokenCount = 0;
    let buffer = '';
    const allFunctionCalls: any[] = [];

    const processEvent = (event: SseEvent): void => {
      if (event.data === '[DONE]') return;
      try {
        const chunk = JSON.parse(event.data);
        if (chunk.usageMetadata?.totalTokenCount) tokenCount = chunk.usageMetadata.totalTokenCount;

        const chunkFunctionCalls: any[] = [];
        for (const part of chunk.candidates?.[0]?.content?.parts || []) {
          if (part.thought) fullThinking += part.text || '';
          else if (part.text) fullText += part.text;
          else if (part.functionCall) {
            chunkFunctionCalls.push(part.functionCall);
            allFunctionCalls.push(part.functionCall);
          }
        }

        const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks && params.onGrounding) {
          const urls = groundingChunks
            .filter((item: any) => item.web?.uri && item.web?.title)
            .map((item: any) => ({ uri: item.web.uri, title: item.web.title }));
          if (urls.length > 0) params.onGrounding(urls);
        }

        params.onChunk(
          fullText,
          fullThinking,
          tokenCount,
          chunkFunctionCalls.length > 0 ? chunkFunctionCalls : undefined,
        );
      } catch (error) {
        console.error('Error parsing SSE event:', error, event.data);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remainder;
      parsed.events.forEach(processEvent);
    }

    buffer += decoder.decode();
    consumeSseBuffer(buffer, true).events.forEach(processEvent);
    return { text: fullText, thinking: fullThinking, tokenCount, functionCalls: allFunctionCalls };
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', abortFromParent);
  }
};

function isRetryable(error: unknown): boolean {
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return false;
  if (error instanceof AiHttpError) return error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

export const callAiWithRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 1000,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts - 1) throw error;
      const serverDelay = error instanceof AiHttpError ? error.retryAfterMs : undefined;
      const exponential = initialDelayMs * 2 ** attempt;
      const jitter = Math.floor(Math.random() * Math.max(100, exponential * 0.25));
      const delay = Math.min(15_000, serverDelay ?? exponential + jitter);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};