import type { DocumentData, KnowledgeItem, Message } from '../../types';
import { buildProjectMemoryContext, type ProjectMemory } from './projectMemoryEngine';

export type ModelHistoryEntry = {
  role: 'user' | 'model';
  parts: { text: string }[];
};

export type CanonicalContextSource =
  | 'locked_user_memory'
  | 'user_correction'
  | 'uploaded_source'
  | 'approved_analysis'
  | 'conversation_summary'
  | 'recent_chat'
  | 'workspace_knowledge'
  | 'ai_inference'
  | 'ai_assumption';

export const CONTEXT_SOURCE_PRIORITY: Record<CanonicalContextSource, number> = {
  locked_user_memory: 100,
  user_correction: 95,
  uploaded_source: 90,
  approved_analysis: 85,
  conversation_summary: 75,
  recent_chat: 70,
  workspace_knowledge: 60,
  ai_inference: 30,
  ai_assumption: 10,
};

export interface ContextDebugEntry {
  source: CanonicalContextSource;
  label: string;
  priority: number;
  included: boolean;
  estimatedTokens: number;
  provenance: 'user' | 'document' | 'workspace' | 'system' | 'ai';
  note: string;
}

export interface CanonicalContextDebugSnapshot {
  workspaceId: string;
  tokenBudget: number;
  estimatedTokensUsed: number;
  priorMessageCount: number;
  historyMessageCount: number;
  summarizedMessageCount: number;
  retrievedKnowledgeCount: number;
  documentSummary: string;
  conversationSummary: string;
  entries: ContextDebugEntry[];
}

export interface CanonicalProjectContext {
  history: ModelHistoryEntry[];
  messageHistory: Message[];
  promptContext: string;
  workspaceKnowledge: KnowledgeItem[];
  debug: CanonicalContextDebugSnapshot;
}

export interface BuildCanonicalProjectContextInput {
  workspaceId: string;
  workspaceTitle?: string;
  currentUserMessageId: string;
  currentAiMessageId: string;
  currentUserMessage: string;
  currentAttachments?: Message['attachments'];
  messages: Message[];
  document: DocumentData | null;
  projectMemory: ProjectMemory;
  knowledgeBase: KnowledgeItem[];
  memoryEnabled: boolean;
  tokenBudget?: number;
  summarizeMessages?: (messages: Message[]) => Promise<string>;
  retrieveKnowledge?: (query: string) => Promise<KnowledgeItem[]>;
}

const MIN_TOKEN_BUDGET = 2_000;
const MAX_TOKEN_BUDGET = 24_000;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 8_000;

const CANONICAL_PRIORITY_POLICY = [
  '[CANONICAL PROJECT CONTEXT / PROJECT BRAIN]',
  'Bağlam önceliği (yüksekten düşüğe):',
  '1. Kullanıcının kilitlediği karar ve kısıtlar',
  '2. Kullanıcının açık düzeltmeleri',
  '3. Kullanıcının yüklediği kaynaklar',
  '4. Onaylı/mevcut BA analiz dokümanı',
  '5. Konuşma özeti ve yakın sohbet',
  '6. Workspace kapsamlı kurumsal bilgi',
  '7. AI çıkarımları',
  '8. AI varsayımları',
  'Çakışmada üst sıradaki kaynak kazanır. AI metni kullanıcı kararı veya FACT değildir.',
  'Revizyon, kullanıcı açıkça istemedikçe proje adını, amacını, kapsamını ve kilitli kararlarını değiştiremez.',
  'Son kullanıcı mesajı yalnız talep edilen hedefi yamalar; yaşayan dokümanı sıfırdan yeniden yorumlamaz.',
].join('\n');

export function estimateTokens(value = ''): number {
  if (!value.trim()) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

function clampTokenBudget(value?: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CONTEXT_TOKEN_BUDGET;
  return Math.max(MIN_TOKEN_BUDGET, Math.min(MAX_TOKEN_BUDGET, Math.round(numeric)));
}

function stripHtml(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compact(value = '', limit = 2_400): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function withinTokenAllocation(value: string, tokenAllocation: number): string {
  if (!value.trim() || tokenAllocation <= 0) return '';
  return compact(value, Math.max(4, tokenAllocation * 4));
}

function attachmentText(
  attachment: NonNullable<Message['attachments']>[number],
  byteLimit: number,
): string {
  if (!/^(text\/|application\/(?:json|xml))/i.test(attachment.mimeType || '')) return '';
  try {
    const encodedLimit = Math.max(4, Math.floor((byteLimit * 4 / 3) / 4) * 4);
    const binary = globalThis.atob(attachment.data.slice(0, encodedLimit));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return '';
  }
}

function buildUploadedSourceContext(
  input: BuildCanonicalProjectContextInput,
  priorMessages: Message[],
  tokenAllocation: number,
): string {
  const attachments = [
    ...(input.currentAttachments || []),
    ...priorMessages
      .filter(message => message.role === 'user')
      .flatMap(message => message.attachments || []),
  ];
  const seen = new Set<string>();
  const unique = attachments.filter(attachment => {
    const key = `${attachment.name || ''}:${attachment.mimeType}:${attachment.data.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
  if (unique.length === 0) return '';

  const perAttachmentBytes = Math.max(256, Math.floor((tokenAllocation * 4) / unique.length));
  return withinTokenAllocation([
    '[UPLOADED SOURCES - USER PROVIDED]',
    'Bu içerik kullanıcı tarafından yüklenmiş kaynaktır; AI çıkarımından daha yüksek önceliklidir.',
    ...unique.map(attachment => {
      const content = attachmentText(attachment, perAttachmentBytes);
      const label = attachment.name || 'adsız dosya';
      return content
        ? `--- ${label} (${attachment.mimeType}) ---\n${content}`
        : `--- ${label} (${attachment.mimeType}) ---\n[İkili/görsel kaynak; dosya metni Project Brain özetinde çözümlenmedi.]`;
    }),
  ].join('\n'), tokenAllocation);
}

function firstHeading(value = ''): string {
  const htmlHeading = value.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1];
  if (htmlHeading) return stripHtml(htmlHeading);
  const markdownHeading = value.match(/^#{1,3}\s+(.+)$/m)?.[1];
  if (markdownHeading) return markdownHeading.trim();
  return stripHtml(value).split('\n').map(line => line.trim()).find(Boolean) || '';
}

function labeledDocumentLines(value = ''): string[] {
  return stripHtml(value)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => (
      /^(proje ad[ıi]|proje ismi|ama[cç]|hedef|kapsam|kapsam d[ıi][sş][ıi]|problem|mevcut durum|hedef durum|k[ıi]s[ıi]t|karar|i[sş] kural[ıi])\s*[:\-]/i.test(line)
      || /\b[A-ZÇĞİÖŞÜ]{2,}\d{2,}\b/.test(line)
    ))
    .slice(0, 14);
}

export function buildDocumentContextSummary(
  document: DocumentData | null,
  workspaceTitle = '',
): string {
  if (!document?.businessAnalysis?.content?.trim()) {
    return workspaceTitle ? `Workspace: ${workspaceTitle}. Henüz BA analiz dokümanı yok.` : '';
  }

  const business = document.businessAnalysis.content;
  const review = document.review?.content || '';
  const reviewSignals = stripHtml(review)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /\[(ACIK KONU|AÇIK KONU|CELISKI|ÇELİŞKİ|VARSAYIM|DOGRULANDI|DOĞRULANDI)\]/i.test(line))
    .slice(0, 8);
  const headings = Array.from(business.matchAll(/(?:<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>|^#{1,3}\s+(.+)$)/gim))
    .map(match => stripHtml(match[1] || match[2] || ''))
    .filter(Boolean)
    .slice(0, 16);

  return [
    workspaceTitle ? `Workspace: ${workspaceTitle}` : '',
    `Doküman kimliği: ${firstHeading(business) || '[BELİRSİZ]'}`,
    `BA durumu: ${document.businessAnalysis.status}`,
    document.review ? `Review durumu: ${document.review.status}` : '',
    labeledDocumentLines(business).length
      ? `Kilitli omurga:\n${labeledDocumentLines(business).map(line => `- ${compact(line, 240)}`).join('\n')}`
      : '',
    headings.length ? `Mevcut bölümler: ${headings.join(' | ')}` : '',
    reviewSignals.length ? `Review karar sinyalleri:\n${reviewSignals.map(line => `- ${compact(line, 260)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function eligiblePriorMessages(input: BuildCanonicalProjectContextInput): Message[] {
  return input.messages.filter(message => (
    message.id !== input.currentUserMessageId
    && message.id !== input.currentAiMessageId
    && !message.isTyping
    && !message.isError
    && !!message.text?.trim()
  ));
}

function selectRecentMessages(messages: Message[], tokenBudget: number): {
  selected: Message[];
  excluded: Message[];
} {
  const selectedReversed: Message[] = [];
  let used = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = estimateTokens(message.text) + 12;
    if (selectedReversed.length > 0 && used + cost > tokenBudget) break;
    if (cost > tokenBudget && selectedReversed.length === 0) {
      selectedReversed.push({ ...message, text: compact(message.text, tokenBudget * 4) });
      used = tokenBudget;
      break;
    }
    selectedReversed.push(message);
    used += cost;
  }

  const selected = selectedReversed.reverse();
  const selectedIds = new Set(selected.map(message => message.id));
  return {
    selected,
    excluded: messages.filter(message => !selectedIds.has(message.id)),
  };
}

export function normalizeModelHistory(messages: Message[]): ModelHistoryEntry[] {
  const normalized: ModelHistoryEntry[] = [];

  for (const message of messages) {
    const role: 'user' | 'model' = message.role === 'user' ? 'user' : 'model';
    if (normalized.length === 0 && role === 'model') continue;
    const sender = [message.senderName, message.senderRole].filter(Boolean).join(' - ');
    const text = sender ? `[${sender}]: ${message.text.trim()}` : message.text.trim();
    const previous = normalized[normalized.length - 1];
    if (previous?.role === role) {
      previous.parts[0].text = `${previous.parts[0].text}\n\n${text}`;
    } else {
      normalized.push({ role, parts: [{ text }] });
    }
  }

  return normalized;
}

function extractiveConversationSummary(messages: Message[]): string {
  const decisionLines = messages
    .filter(message => message.role === 'user')
    .flatMap(message => message.text.split(/\r?\n/))
    .map(line => line.trim())
    .filter(line => (
      /^(karar|k[ıi]s[ıi]t|kapsam|kapsam d[ıi][sş][ıi]|i[sş] kural[ıi]|varsay[ıi]m|a[cç][ıi]k konu)\s*[:\-]/i.test(line)
      || /\b(hat[ıi]rla|not et|bundan sonra|de[gğ]i[sş]mesin|etkilenmesin)\b/i.test(line)
    ))
    .slice(-12);
  const recentUserTurns = messages
    .filter(message => message.role === 'user')
    .slice(-6)
    .map(message => compact(message.text, 320));
  return Array.from(new Set([...decisionLines, ...recentUserTurns]))
    .map(line => `- ${line}`)
    .join('\n');
}

function contextEntry(
  source: CanonicalContextSource,
  label: string,
  value: string,
  provenance: ContextDebugEntry['provenance'],
  note: string,
): ContextDebugEntry {
  return {
    source,
    label,
    priority: CONTEXT_SOURCE_PRIORITY[source],
    included: !!value.trim(),
    estimatedTokens: estimateTokens(value),
    provenance,
    note,
  };
}

export async function buildCanonicalProjectContext(
  input: BuildCanonicalProjectContextInput,
): Promise<CanonicalProjectContext> {
  const tokenBudget = clampTokenBudget(input.tokenBudget);
  const allocatableTokens = Math.max(
    1_000,
    tokenBudget - estimateTokens(CANONICAL_PRIORITY_POLICY) - 32,
  );
  const hasUploadedSources = !!input.currentAttachments?.length
    || input.messages.some(message => !!message.attachments?.length);
  const uploadedSourceAllocation = hasUploadedSources
    ? Math.floor(allocatableTokens * 0.18)
    : 0;
  const memoryAllocation = Math.floor(allocatableTokens * (hasUploadedSources ? 0.24 : 0.27));
  const documentAllocation = Math.floor(allocatableTokens * (hasUploadedSources ? 0.19 : 0.22));
  const summaryAllocation = Math.floor(allocatableTokens * (hasUploadedSources ? 0.12 : 0.14));
  const knowledgeAllocation = Math.floor(allocatableTokens * (hasUploadedSources ? 0.08 : 0.1));
  const historyBudget = Math.max(
    200,
    Math.floor(allocatableTokens * (hasUploadedSources ? 0.19 : 0.27)),
  );
  const priorMessages = eligiblePriorMessages(input);
  const { selected, excluded } = selectRecentMessages(priorMessages, historyBudget);
  const localWorkspaceKnowledge = input.knowledgeBase
    .filter(item => item.projectId === input.workspaceId);

  const [summaryResult, retrievedResult] = await Promise.all([
    input.memoryEnabled && excluded.length > 0 && input.summarizeMessages
      ? input.summarizeMessages(excluded).catch(() => '')
      : Promise.resolve(''),
    input.memoryEnabled && input.retrieveKnowledge
      ? input.retrieveKnowledge(input.currentUserMessage).catch(() => localWorkspaceKnowledge)
      : Promise.resolve(localWorkspaceKnowledge),
  ]);

  const conversationSummary = withinTokenAllocation(
    summaryResult.trim() || (excluded.length > 0 ? extractiveConversationSummary(excluded) : ''),
    summaryAllocation,
  );
  const workspaceKnowledge = retrievedResult
    .filter(item => item.projectId === input.workspaceId)
    .slice(0, 6);
  const documentSummary = withinTokenAllocation(
    buildDocumentContextSummary(input.document, input.workspaceTitle),
    documentAllocation,
  );
  const memoryContext = withinTokenAllocation(
    input.memoryEnabled ? buildProjectMemoryContext(input.projectMemory) : '',
    memoryAllocation,
  );
  const uploadedSourceContext = buildUploadedSourceContext(
    input,
    priorMessages,
    uploadedSourceAllocation,
  );
  const knowledgeContext = withinTokenAllocation(
    workspaceKnowledge.length ? [
      '[WORKSPACE KNOWLEDGE - KANONİK GERÇEK DEĞİL]',
      'Bu kayıtlar yalnız destekleyici bağlamdır. Kilitli kullanıcı kararı veya onaylı dokümanla çelişirse kullanma.',
      ...workspaceKnowledge.map(item => `- ${item.content} (önem=${item.importance}/10, workspace=${item.projectId})`),
    ].join('\n')
      : '',
    knowledgeAllocation,
  );
  const promptContext = [
    CANONICAL_PRIORITY_POLICY,
    memoryContext,
    uploadedSourceContext,
    documentSummary ? `[CURRENT DOCUMENT SUMMARY - APPROVED BACKBONE]\n${documentSummary}` : '',
    conversationSummary ? `[SYNCHRONOUS CONVERSATION SUMMARY]\n${conversationSummary}` : '',
    knowledgeContext,
  ].filter(Boolean).join('\n\n');

  const entries = [
    contextEntry('locked_user_memory', 'Kilitli proje hafızası', memoryContext, 'user', 'Kullanıcı kaynaklı workspace hafızası'),
    contextEntry('uploaded_source', 'Yüklenen kullanıcı kaynakları', uploadedSourceContext, 'user', 'Aktif ve yakın kullanıcı mesajlarındaki ekler'),
    contextEntry('approved_analysis', 'Mevcut doküman özeti', documentSummary, 'document', 'Yaşayan BA Analiz + Review omurgası'),
    contextEntry('conversation_summary', 'Senkron konuşma özeti', conversationSummary, 'system', 'Token bütçesi dışında kalan eski turlar'),
    contextEntry('recent_chat', 'Token bütçeli yakın sohbet', selected.map(message => message.text).join('\n'), 'user', 'Typing ve aktif kullanıcı turu hariç'),
    contextEntry('workspace_knowledge', 'Workspace bilgi sonuçları', knowledgeContext, 'workspace', 'Yalnız aktif workspace ile eşleşen kayıtlar'),
  ];

  return {
    history: normalizeModelHistory(selected),
    messageHistory: selected,
    promptContext,
    workspaceKnowledge,
    debug: {
      workspaceId: input.workspaceId,
      tokenBudget,
      estimatedTokensUsed: estimateTokens(promptContext)
        + normalizeModelHistory(selected).reduce((sum, item) => sum + estimateTokens(item.parts[0].text), 0),
      priorMessageCount: priorMessages.length,
      historyMessageCount: selected.length,
      summarizedMessageCount: excluded.length,
      retrievedKnowledgeCount: workspaceKnowledge.length,
      documentSummary,
      conversationSummary,
      entries,
    },
  };
}
