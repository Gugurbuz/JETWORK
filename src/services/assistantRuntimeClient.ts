import { supabase } from '../supabase';
import { consumeSseBuffer, type SseEvent } from './sseParser';
import type { AssistantKnowledgeSource, Message, MessageAttachment, Question } from '../types';
import {
  buildDocumentGenerationMessage,
  persistAssistantDocument,
  resolveAssistantDocumentRequestMode,
  validateEnerjisaDocumentContract,
  type AssistantDocumentRequestMode,
} from './assistantDocumentIntent';
import {
  inferDocumentContinuationMode,
  isDocumentContinuationAnswerCandidate,
} from './assistantDocumentContinuation';
import { parseAssistantPresentationMetadata } from './assistantPresentationMetadata';
import { useDocumentStore } from '../store/useDocumentStore';

const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_CHAT_ATTACHMENTS = 3;
const MAX_CHAT_ATTACHMENT_CHARACTERS = 60_000;

const runtimeEnv = (): Record<string, string | undefined> => ({
  ...(typeof process !== 'undefined' ? process.env : {}),
  ...((import.meta as any).env || {}),
});

const isFeatureEnabled = (value?: string): boolean => (
  String(value ?? 'true').trim().toLowerCase() !== 'false'
);

export type AssistantRuntimeStage =
  | 'connecting'
  | 'thinking'
  | 'routing'
  | 'planning'
  | 'searching_knowledge'
  | 'searching_web'
  | 'verifying'
  | 'synthesizing'
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
  workSummary?: string;
  questions?: Question[];
  actionSummary?: string;
  documentCreated?: boolean;
  documentVersionNumber?: number;
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
      const sourceType = candidate.sourceType === 'web' ? 'web' : 'knowledge';
      const url = candidate.url && /^https?:\/\//i.test(String(candidate.url))
        ? String(candidate.url)
        : undefined;
      return {
        sourceId: candidate.sourceId ? String(candidate.sourceId) : undefined,
        sourceName,
        canonicalKey: candidate.canonicalKey ? String(candidate.canonicalKey) : undefined,
        objectType: candidate.objectType ? String(candidate.objectType) : undefined,
        title: candidate.title ? String(candidate.title) : undefined,
        sourceType,
        url,
      };
    })
    .filter((item): item is AssistantKnowledgeSource => !!item);
}

function documentStageLabel(
  mode: AssistantDocumentRequestMode,
  stage: AssistantRuntimeStage,
  fallback?: string,
): string | undefined {
  if (mode === 'none') return fallback;
  if (stage === 'connecting') {
    return mode === 'revise'
      ? 'Mevcut doküman bağlamı hazırlanıyor...'
      : 'Doküman bağlamı hazırlanıyor...';
  }
  if (stage === 'answering' || stage === 'synthesizing') {
    return mode === 'revise'
      ? 'Doküman yeni sürüm olarak hazırlanıyor...'
      : 'Doküman hazırlanıyor...';
  }
  return fallback;
}

async function resolvePersistedDocumentContinuationMode(input: {
  workspaceId: string;
  messageId: string;
  message: string;
}): Promise<AssistantDocumentRequestMode | undefined> {
  if (!isDocumentContinuationAnswerCandidate(input.message)) return undefined;

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, text, questions, action_summary, created_at')
    .eq('workspace_id', input.workspaceId)
    .neq('id', input.messageId)
    .order('created_at', { ascending: false })
    .limit(4);

  if (error) {
    console.warn('Document continuation context could not be loaded:', error);
    return undefined;
  }

  const recentMessages: Message[] = [...(data || [])]
    .reverse()
    .map((row: any) => ({
      id: String(row.id),
      role: row.role === 'user' ? 'user' : 'model',
      text: String(row.text || ''),
      questions: Array.isArray(row.questions) ? row.questions as Question[] : [],
      actionSummary: row.action_summary ? String(row.action_summary) : undefined,
      createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined,
    }));

  return inferDocumentContinuationMode({
    message: input.message,
    recentMessages,
    document: useDocumentStore.getState().documentContent,
  });
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
      'routing',
      'planning',
      'searching_knowledge',
      'searching_web',
      'verifying',
      'synthesizing',
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
  let documentRequestMode = resolveAssistantDocumentRequestMode(input.message);
  if (documentRequestMode === 'none') {
    documentRequestMode = (await resolvePersistedDocumentContinuationMode({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      message: input.message,
    })) || 'none';
  }
  const documentRequest = documentRequestMode !== 'none';
  const assistantMessage = documentRequest
    ? buildDocumentGenerationMessage(input.message)
    : input.message;
  const reasoningEngineEnabled = isFeatureEnabled(env.VITE_REASONING_ENGINE_V2);

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
  const executionLabels: string[] = [];

  const rememberExecutionLabel = (label?: string) => {
    const safe = String(label || '').trim();
    if (!safe || safe === 'Asistana bağlanılıyor...' || executionLabels[executionLabels.length - 1] === safe) return;
    executionLabels.push(safe);
    if (executionLabels.length > 10) executionLabels.shift();
  };

  try {
    input.onStatus?.(
      'connecting',
      documentStageLabel(documentRequestMode, 'connecting', 'Asistana bağlanılıyor...'),
    );

    const requestBody = JSON.stringify({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      message: assistantMessage,
      model: input.model || 'auto',
      chatAttachments: input.chatAttachments || [],
    });
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    };
    const callEndpoint = (slug: string) => fetch(`${supabaseUrl}/functions/v1/${slug}`, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: requestBody,
    });

    let response = await callEndpoint(reasoningEngineEnabled ? 'openai-assistant-v2' : 'openai-assistant');
    if (reasoningEngineEnabled && !response.ok && (response.status === 404 || response.status === 503)) {
      const errorPayload = await response.clone().json().catch(() => ({}));
      const code = String(errorPayload.code || '');
      if (response.status === 404 || code === 'REASONING_ENGINE_DISABLED' || code === 'RUNTIME_DISABLED') {
        rememberExecutionLabel('Reasoning Engine v2 kullanılamadı; güvenli legacy runtime devreye alındı.');
        response = await callEndpoint('openai-assistant');
      }
    }

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
        const presentation = parseAssistantPresentationMetadata(fullText);
        input.onText?.(
          documentRequest
            ? documentStageLabel(documentRequestMode, 'answering') || 'Doküman hazırlanıyor...'
            : presentation.visibleText,
        );
        return;
      }
      if (parsed.type === 'sources') {
        sources = parsed.sources;
        input.onSources?.(sources);
        return;
      }
      if (parsed.type === 'status') {
        const label = documentStageLabel(documentRequestMode, parsed.stage, parsed.label);
        rememberExecutionLabel(label);
        input.onStatus?.(parsed.stage, label);
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

    const presentation = parseAssistantPresentationMetadata(fullText);
    const executionSummary = executionLabels.length
      ? executionLabels.map(label => `• ${label}`).join('\n')
      : undefined;
    const autoCaptureDocument = documentRequestMode === 'none'
      && !useDocumentStore.getState().documentContent?.businessAnalysis?.content?.trim()
      && validateEnerjisaDocumentContract(presentation.visibleText).valid;
    const effectiveDocumentRequestMode: AssistantDocumentRequestMode = autoCaptureDocument
      ? 'create'
      : documentRequestMode;

    if (effectiveDocumentRequestMode !== 'none') {
      if (autoCaptureDocument) {
        rememberExecutionLabel('Tam Enerjisa dokümanı algılandı; sohbet yerine Canvas’a aktarılıyor...');
      }
      const persistenceLabel = effectiveDocumentRequestMode === 'revise'
        ? 'BA Analiz dokümanı yeni sürüm olarak kaydediliyor...'
        : 'BA Analiz dokümanı kaydediliyor...';
      rememberExecutionLabel(persistenceLabel);
      input.onStatus?.('answering', persistenceLabel);
      const persisted = await persistAssistantDocument({
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        rawText: autoCaptureDocument ? presentation.visibleText : fullText,
        provider,
        model,
      });
      const displayText = effectiveDocumentRequestMode === 'revise'
        ? (
          persisted.versionNumber
            ? `BA Analiz dokümanı güncellendi ve Canvas'a v${persisted.versionNumber} olarak kaydedildi.`
            : "BA Analiz dokümanı güncellendi ve Canvas'a kaydedildi."
        )
        : (
          persisted.versionNumber
            ? `BA Analiz dokümanı oluşturuldu ve Canvas'a v${persisted.versionNumber} olarak kaydedildi.`
            : "BA Analiz dokümanı oluşturuldu ve Canvas'a kaydedildi."
        );
      input.onText?.(displayText);
      const documentExecutionSummary = executionLabels.length
        ? executionLabels.map(label => `• ${label}`).join('\n')
        : executionSummary;
      return {
        text: displayText,
        sources,
        conversationId,
        model,
        provider,
        fallbackUsed,
        usage,
        workSummary: documentExecutionSummary || presentation.workSummary,
        questions: presentation.questions,
        actionSummary: presentation.actionSummary || (
          effectiveDocumentRequestMode === 'revise'
            ? `Enerjisa analiz dokümanını güncelledim${persisted.versionNumber ? ` ve v${persisted.versionNumber} olarak kaydettim` : ''}.`
            : `Enerjisa analiz dokümanını oluşturdum${persisted.versionNumber ? ` ve v${persisted.versionNumber} olarak kaydettim` : ''}.`
        ),
        documentCreated: true,
        documentVersionNumber: persisted.versionNumber,
      };
    }

    return {
      text: presentation.visibleText || fullText,
      sources,
      conversationId,
      model,
      provider,
      fallbackUsed,
      usage,
      workSummary: executionSummary || presentation.workSummary,
      questions: presentation.questions,
      actionSummary: presentation.actionSummary,
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abortFromParent);
  }
}
