import { marked } from 'marked';
import type { DocumentData } from '../types';
import { sanitizeDocumentHtml } from '../lib/sanitizeHtml';
import { useDocumentStore } from '../store/useDocumentStore';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { ENERJISA_DOCUMENT_TEMPLATE_INSTRUCTION } from './ai/enerjisaBaInstructions';

const normalizeIntentText = (value: string): string => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
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

export const ENERJISA_REQUIRED_DOCUMENT_MARKERS = [
  'İş Analizi Dokümanı',
  'Talep Adı',
  'İçindekiler',
  '# İHTİYAÇ ANALİZİ',
  '## 1. ANALİZ KAPSAMI',
  '## 2. KISALTMALAR',
  '## 3. İŞ GEREKSİNİMLERİ',
  '## 4. FONKSİYONEL GEREKSİNİMLER (FR)',
  '## 5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)',
  '## 6. SÜREÇ RİSK ANALİZİ',
  '## 7. ONAY',
  '## 8. FONKSİYONEL TASARIM DOKÜMANLARI',
] as const;

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
    '[Sistem yönlendirmesi: Kullanıcı açıkça düzenlenebilir bir Enerjisa ihtiyaç analizi dokümanı istiyor.]',
    'Aşağıdaki Enerjisa doküman sözleşmesi zorunludur. Başlıkları, numaraları ve sıralamayı değiştirme; eş anlamlı veya alternatif başlık kullanma.',
    'Bilgi bulunmayan alanları uydurma. İlgili satırda [AÇIK KONU] yaz; yalnız kullanıcının kabul ettiği kabulleri [VARSAYIM] olarak işaretle.',
    '',
    ENERJISA_DOCUMENT_TEMPLATE_INSTRUCTION,
    '',
    '[ÇIKTI SÖZLEŞMESİ]',
    'Yanıtı yalnızca aşağıdaki iki XML-benzeri blok halinde üret. Blokların dışına sohbet açıklaması yazma.',
    '<ba_analysis>',
    'Enerjisa ihtiyaç analizi dokümanını Markdown olarak buraya yaz. Kapak tablosu, İçindekiler ve 1-8 arasındaki tüm zorunlu ana bölümler eksiksiz bulunmalıdır.',
    '</ba_analysis>',
    '<review>',
    'Yalnız dokümandan ayrı tutulması gereken riskleri, varsayımları, açık konuları ve kalite bulgularını Markdown olarak buraya yaz. Yeni iş gerçeği ekleme.',
    '</review>',
  ].join('\n');
}

export interface AssistantDocumentDraft {
  businessAnalysisMarkdown: string;
  reviewMarkdown: string;
}

export interface EnerjisaDocumentContractValidation {
  valid: boolean;
  missingMarkers: string[];
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

export function validateEnerjisaDocumentContract(
  businessAnalysisMarkdown: string,
): EnerjisaDocumentContractValidation {
  const normalizedDocument = normalizeIntentText(businessAnalysisMarkdown);
  const missingMarkers = ENERJISA_REQUIRED_DOCUMENT_MARKERS.filter(marker => (
    !normalizedDocument.includes(normalizeIntentText(marker))
  ));

  return {
    valid: missingMarkers.length === 0,
    missingMarkers: [...missingMarkers],
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
  const validation = validateEnerjisaDocumentContract(draft.businessAnalysisMarkdown);

  if (!validation.valid) {
    throw new Error(
      `Enerjisa doküman formatı tamamlanamadı. Eksik bölümler: ${validation.missingMarkers.join(', ')}. Doküman kaydedilmedi; lütfen yeniden deneyin.`,
    );
  }

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
        ? 'AI Enerjisa ihtiyaç analizi dokümanını güncelledi'
        : 'AI Enerjisa ihtiyaç analizi dokümanını oluşturdu',
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
    throw new Error(persistence.error || 'Enerjisa ihtiyaç analizi dokümanı kaydedilemedi.');
  }

  useDocumentStore.getState().setDocumentContent(document);
  return { document, versionNumber: persistence.versionNumber };
}
