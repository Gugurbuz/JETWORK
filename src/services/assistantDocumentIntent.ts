import { marked } from 'marked';
import type { DocumentData } from '../types';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';
import { useDocumentStore } from '../store/useDocumentStore';
import { saveDocumentAndVersion } from '../utils/documentUtils';

const normalizeIntentText = (value: string): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const CREATION_VERBS = [
  'olustur',
  'hazirla',
  'yaz',
  'uret',
  'cikar',
  'donustur',
  'meydana getir',
];

const DOCUMENT_TARGETS = [
  'analiz',
  'ba analizi',
  'is analizi',
  'dokuman',
  'belge',
  'kavramsal tasarim',
  'talep dokumani',
  'ihtiyac analizi',
];

export function isExplicitDocumentCreationRequest(message: string): boolean {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;

  const hasCreationVerb = CREATION_VERBS.some(verb => normalized.includes(verb));
  const hasDocumentTarget = DOCUMENT_TARGETS.some(target => normalized.includes(target));
  return hasCreationVerb && hasDocumentTarget;
}

export function buildDocumentGenerationMessage(message: string): string {
  return [
    message.trim(),
    '',
    '[Sistem yönlendirmesi: Kullanıcı açıkça düzenlenebilir bir BA analiz dokümanı istiyor.]',
    'Yanıtı yalnızca aşağıdaki iki blok halinde üret. Blokların dışına sohbet açıklaması yazma.',
    '<ba_analysis>',
    'Kapsamlı BA analiz içeriğini Markdown olarak buraya yaz. Mevcut konuşma ve kaynaklarla sınırlı kal; veri uydurma.',
    '</ba_analysis>',
    '<review>',
    'Riskleri, varsayımları, açık konuları ve kalite bulgularını Markdown olarak buraya yaz.',
    '</review>',
  ].join('\n');
}

export interface AssistantDocumentDraft {
  businessAnalysisMarkdown: string;
  reviewMarkdown: string;
}

export function parseAssistantDocumentDraft(rawText: string): AssistantDocumentDraft {
  const businessAnalysisMatch = rawText.match(/<ba_analysis>([\s\S]*?)<\/ba_analysis>/i);
  const reviewMatch = rawText.match(/<review>([\s\S]*?)<\/review>/i);

  return {
    businessAnalysisMarkdown: (businessAnalysisMatch?.[1] || rawText)
      .replace(/<\/?ba_analysis>/gi, '')
      .replace(/<review>[\s\S]*?<\/review>/gi, '')
      .trim(),
    reviewMarkdown: (reviewMatch?.[1] || '').trim(),
  };
}

function markdownToSafeHtml(markdown: string): string {
  if (!markdown.trim()) return '';
  return sanitizeDocumentHtml(marked.parse(markdown, { async: false }) as string);
}

export async function persistAssistantDocument(input: {
  workspaceId: string;
  messageId: string;
  rawText: string;
  provider?: string;
  model?: string;
}): Promise<{ document: DocumentData; versionNumber?: number }> {
  const draft = parseAssistantDocumentDraft(input.rawText);
  const existingDocument = useDocumentStore.getState().documentContent;
  const businessAnalysisContent = markdownToSafeHtml(draft.businessAnalysisMarkdown);
  const reviewContent = markdownToSafeHtml(draft.reviewMarkdown);
  const revisionId = crypto.randomUUID();
  const changedSections = [
    'businessAnalysis',
    ...(reviewContent ? ['review'] : []),
  ];

  const document: DocumentData = {
    ...(existingDocument || {}),
    businessAnalysis: {
      content: businessAnalysisContent,
      status: 'DRAFT',
      flags: [],
    },
    review: {
      content: reviewContent || existingDocument?.review?.content || '',
      status: 'DRAFT',
      flags: [],
    },
    artifactMeta: {
      revisionId,
      parentRevisionId: existingDocument?.artifactMeta?.revisionId,
      sourceMessageIds: Array.from(new Set([
        ...(existingDocument?.artifactMeta?.sourceMessageIds || []),
        input.messageId,
      ])).slice(-20),
      changeSummary: existingDocument
        ? 'AI BA analiz dokümanını güncelledi'
        : 'AI BA analiz dokümanını oluşturdu',
      changedSections,
      updatedAt: new Date().toISOString(),
    },
  };

  const persistence = await saveDocumentAndVersion(
    input.workspaceId,
    input.messageId,
    document,
    {
      changeSource: 'AI',
      changeSummary: document.artifactMeta?.changeSummary,
      changedSections,
      provider: input.provider,
      model: input.model,
      idempotencyKey: `assistant-document-${input.messageId}`,
    },
  );

  if (!persistence.ok) {
    throw new Error(persistence.error || 'BA analiz dokümanı kaydedilemedi.');
  }

  useDocumentStore.getState().setDocumentContent(document);
  return { document, versionNumber: persistence.versionNumber };
}
