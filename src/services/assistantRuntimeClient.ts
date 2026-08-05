import { supabase } from '../supabase';
import { consumeSseBuffer, type SseEvent } from './sseParser';
import type { AssistantKnowledgeSource, MessageAttachment } from '../types';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CHAT_ATTACHMENTS = 3;
const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000;

const runtimeEnv = (): Record<string, string | undefined> => ({
  ...(typeof process !== 'undefined' ? process.env : {}),
  ...((import.meta as any).env || {}),
});

export type AssistantRuntimeStage =
  | 'connecting'
  | 'thinking'
  | 'searching_knowledge'
  | 'answering';

export type AssistantRuntimeEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'sources'; sources: AssistantKnowledgeSource[] }
  | { type: 'status'; stage: AssistantRuntimeStage; label?: string }
  | {
    type: 'completed';
    conversationId?: string;
    model?: string;
    provider?: 'openai' | 'gemini';
    fallbackUsed?: boolean;
    usage?: Record<string, number>;
  }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AssistantRuntimeResult {
  text: string;
  sources: AssistantKnowledgeSource[];
  conversationId?: string;
  model?: string;
  provider?: 'openai' | 'gemini';
  fallbackUsed?: boolean;
  usage?: Record<string, number>;
}

export interface AssistantChatAttachment {
  name: string;
  mimeType: string;
  content: string;
}

export class AssistantRuntimeHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AssistantRuntimeHttpError';
  }
}

export class AssistantAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantAttachmentValidationError';
  }
}

function asKnowledgeSources(value: unknown): AssistantKnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AssistantKnowledgeSource | null => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Record<string, unknown>;
      const sourceName = String(candidate.sourceName || '').trim();
      if (!sourceName) return null;
      return {
        sourceId: candidate.sourceId ? String(candidate.sourceId) : undefined,
        sourceName,
        canonicalKey: candidate.canonicalKey ? String(candidate.canonicalKey) : undefined,
        objectType: candidate.objectType ? String(candidate.objectType) : undefined,
        title: candidate.title ? String(candidate.title) : undefined,
      };
    })
    .filter((item): item is AssistantKnowledgeSource => !!item);
}

async function readAttachmentText(attachment: MessageAttachment): Promise<string> {
  if (attachment.file) return attachment.file.text();
  if (!attachment.data) {
    throw new Error(`${attachment.name || 'Dosya'} içeriği artık mevcut değil; dosyayı yeniden ekleyin.`);
  }
  const encoded = attachment.data.includes(',')
    ? attachment.data.slice(attachment.data.indexOf(',') + 1)
    : attachment.data;
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export async function prepareAssistantChatAttachments(
  attachments: MessageAttachment[] = [],
): Promise<AssistantChatAttachment[]> {
  const chatAttachments = attachments.filter(candidate => candidate.purpose === 'chat_only');
  if (chatAttachments.length > MAX_CHAT_ATTACHMENTS) {
    throw new AssistantAttachmentValidationError(
      `Bir mesajda en fazla ${MAX_CHAT_ATTACHMENTS} sohbet eki kullanılabilir.`,
    );
  }

  const prepared: AssistantChatAttachment[] = [];
  let remainingCharacters = MAX_CHAT_ATTACHMENT_CHARACTERS;

  for (const attachment of chatAttachments) {
    const content = (await readAttachmentText(attachment))
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');
    if (!content.trim()) continue;
    if (content.length > remainingCharacters) {
      throw new AssistantAttachmentValidationError(
        `Sohbet eklerinin toplam metni ${MAX_CHAT_ATTACHMENT_CHARACTERS.toLocaleString('tr-TR')} karakteri aşamaz.`,
      );
    }
    prepared.push({
      name: String(attachment.name || 'sohbet-eki.txt').slice(0, 240),
      mimeType: String(attachment.mimeType || 'text/plain').slice(0, 120),
      content,
    });
    remainingCharacters -= content.length;
  }
  return prepared;
}


export function parseAssistantRuntimeEvent(event: SseEvent): AssistantRuntimeEvent | null {
  if (event.data === '[DONE]') return { type: 'done' };

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.data);
    if (!parsed || typeof parsed !== 'object') return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const eventType = String(event.event || payload.type || '');
  if (eventType === 'text_delta') {
    return { type: 'text_delta', delta: String(payload.delta || '') };
  }
  if (eventType === 'sources') {
    return { type: 'sources', sources: asKnowledgeSources(payload.sources) };
  }
  if (eventType === 'status') {
    const allowedStages = new Set<AssistantRuntimeStage>([
      'connecting',
      'thinking',
      'searching_knowledge',
      'answering',
    ]);
    const stage = String(payload.stage || 'thinking') as AssistantRuntimeStage;
    return {
      type: 'status',
      stage: allowedStages.has(stage) ? stage : 'thinking',
      label: payload.label ? String(payload.label) : undefined,
    };
  }
  if (eventType === 'completed') {
    const rawUsage = payload.usage;
    const usage = rawUsage && typeof rawUsage === 'object'
      ? Object.fromEntries(
        Object.entries(rawUsage as Record<string, unknown>)
          .filter(([, value]) => typeof value === 'number'),
      ) as Record<string, number>
      : undefined;
    const completedEvent: AssistantRuntimeEvent = {
      type: 'completed',
      conversationId: payload.conversationId ? String(payload.conversationId) : undefined,
      model: payload.model ? String(payload.model) : undefined,
      usage,
    };
    if (payload.provider === 'gemini' || payload.provider === 'openai') {
      completedEvent.provider = payload.provider;
    }
    if (typeof payload.fallbackUsed === 'boolean') {
      completedEvent.fallbackUsed = payload.fallbackUsed;
    }
    return completedEvent;
  }
  if (eventType === 'error') {
    return { type: 'error', message: String(payload.message || 'Asistan yanıtı oluşturulamadı.') };
  }
  return null;
}

export async function streamAssistantResponse(input: {
  workspaceId: string;
  messageId: string;
  message: string;
  model?: string;
  chatAttachments?: AssistantChatAttachment[];
  signal?: AbortSignal;
  timeoutMs?: number;
  onText?: (fullText: string) => void;
  onSources?: (sources: AssistantKnowledgeSource[]) => void;
  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;
}): Promise<AssistantRuntimeResult> {
  const env = runtimeEnv();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey || !token) {
    throw new Error('Asistan için geçerli bir kullanıcı oturumu ve Supabase yapılandırması gerekiyor.');
  }

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromParent();
  else input.signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Asistan isteği zaman aşımına uğradı.', 'TimeoutError')),
    input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let fullText = '';
  let sources: AssistantKnowledgeSource[] = [];
  let conversationId: string | undefined;
  let model: string | undefined;
  let provider: 'openai' | 'gemini' | undefined;
  let fallbackUsed = false;
  let usage: Record<string, number> | undefined;
  let completedSeen = false;

  try {
    input.onStatus?.('connecting', 'Asistana bağlanılıyor...');
    const response = await fetch(`${supabaseUrl}/functions/v1/openai-assistant`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        message: input.message,
        model: input.model || 'auto',
        chatAttachments: input.chatAttachments || [],
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new AssistantRuntimeHttpError(
        String(errorPayload.error || `Asistan servisi ${response.status} hatası döndürdü.`),
        response.status,
      );
    }
    if (!response.body) throw new Error('Asistan servisi boş yanıt döndürdü.');

    const handleEvent = (event: SseEvent) => {
      const parsed = parseAssistantRuntimeEvent(event);
      if (!parsed) return;
      if (parsed.type === 'done') return;
      if (parsed.type === 'error') throw new Error(parsed.message);
      if (parsed.type === 'text_delta') {
        fullText += parsed.delta;
        input.onText?.(fullText);
        return;
      }
      if (parsed.type === 'sources') {
        sources = parsed.sources;
        input.onSources?.(sources);
        return;
      }
      if (parsed.type === 'status') {
        input.onStatus?.(parsed.stage, parsed.label);
        return;
      }
      completedSeen = true;
      conversationId = parsed.conversationId;
      model = parsed.model;
      provider = parsed.provider;
      fallbackUsed = parsed.fallbackUsed === true;
      usage = parsed.usage;
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remainder;
      parsed.events.forEach(handleEvent);
    }
    buffer += decoder.decode();
    consumeSseBuffer(buffer, true).events.forEach(handleEvent);

    if (!completedSeen) {
      throw new Error('Asistan bağlantısı yanıt tamamlanmadan kesildi.');
    }
    if (!fullText.trim()) {
      throw new Error('Asistan yanıt metni üretmedi.');
    }

    return { text: fullText, sources, conversationId, model, provider, fallbackUsed, usage };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortFromParent);
  }
}
