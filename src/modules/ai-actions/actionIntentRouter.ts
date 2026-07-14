import type { AnalysisInputAttachment } from '../conceptual-design/conceptualDesignTypes';

export type AiActionType =
  | 'chat'
  | 'generate-conceptual-design'
  | 'revise-document'
  | 'generate-bpmn'
  | 'generate-ui-artifacts'
  | 'quality-check'
  | 'export-artifacts';

export interface AiActionIntent {
  type: AiActionType;
  confidence: number;
  reason: string;
  requiresConfirmation: boolean;
}

const CONCEPTUAL_DESIGN_PATTERNS = [
  /kavramsal tasar[ıi]m/i,
  /iş analizi|is analizi/i,
  /analiz dok[üu]man[ıi]/i,
  /dok[üu]man[ıi].*(oluştur|hazırla|yaz|güncelle)/i,
  /s[üu]reç modeli|surec modeli/i,
  /gereksinim|requirement|\bbr\b|\bfr\b|\bnfr\b/i,
];

const DOCUMENT_REVISION_PATTERNS = [
  /dok[üu]man[ıi].*(revize|d[üu]zelt|g[üu]ncelle|ekle|kald[ıi]r)/i,
  /b[öo]l[üu]m[üu].*(revize|d[üu]zelt|g[üu]ncelle|ekle|kald[ıi]r)/i,
  /başl[ıi]k|numaraland[ıi]rma|kapak|tablo stili/i,
];

const BPMN_PATTERNS = [
  /bpmn/i,
  /ak[ıi]ş diyagram[ıi]|akis diyagrami/i,
  /s[üu]reç ak[ıi]ş[ıi]|surec akisi/i,
];

const UI_ARTIFACT_PATTERNS = [
  /toast|validasyon|modal|banner|ekran g[öo]r[üu]nt[üu]s[üu]/i,
  /g[öo]rsel.*(oluştur|hazırla|üret)/i,
  /ui|ux|aray[üu]z/i,
];

const QUALITY_PATTERNS = [
  /kalite kontrol|quality check|kontrol et|eksik var m[ıi]|karş[ıi]laşt[ıi]r/i,
  /talep dok[üu]man[ıi].*karş[ıi]laşt[ıi]r/i,
];

const EXPORT_PATTERNS = [
  /indir|export|d[ıi]şa aktar|word|docx|pdf|zip/i,
];

function score(patterns: RegExp[], text: string): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}

function hasDocumentLikeAttachment(attachments: AnalysisInputAttachment[] = []): boolean {
  return attachments.some(attachment => {
    const mime = attachment.mimeType.toLowerCase();
    const name = (attachment.name || '').toLowerCase();
    return mime.startsWith('image/') || mime.includes('pdf') || mime.includes('word') || mime.includes('spreadsheet') || /\.(docx?|xlsx?|pdf|png|jpe?g)$/i.test(name);
  });
}

export function detectAiActionIntent(
  text: string,
  attachments: AnalysisInputAttachment[] = [],
): AiActionIntent {
  const normalized = text.trim();
  const documentAttachmentBoost = hasDocumentLikeAttachment(attachments) ? 1 : 0;

  const candidates: AiActionIntent[] = [
    {
      type: 'generate-conceptual-design',
      confidence: score(CONCEPTUAL_DESIGN_PATTERNS, normalized) + documentAttachmentBoost,
      reason: 'Kullanıcı kavramsal tasarım, iş analizi, süreç modeli veya gereksinim üretimi istiyor olabilir.',
      requiresConfirmation: false,
    },
    {
      type: 'revise-document',
      confidence: score(DOCUMENT_REVISION_PATTERNS, normalized),
      reason: 'Kullanıcı mevcut dokümanın bir bölümünü revize etmek istiyor olabilir.',
      requiresConfirmation: false,
    },
    {
      type: 'generate-bpmn',
      confidence: score(BPMN_PATTERNS, normalized),
      reason: 'Kullanıcı BPMN veya süreç akış diyagramı üretimi istiyor olabilir.',
      requiresConfirmation: false,
    },
    {
      type: 'generate-ui-artifacts',
      confidence: score(UI_ARTIFACT_PATTERNS, normalized) + (attachments.some(a => a.mimeType.startsWith('image/')) ? 1 : 0),
      reason: 'Kullanıcı UI/UX görsel, toast, modal veya validasyon örneği istiyor olabilir.',
      requiresConfirmation: false,
    },
    {
      type: 'quality-check',
      confidence: score(QUALITY_PATTERNS, normalized),
      reason: 'Kullanıcı kalite kontrol veya talep karşılama kontrolü istiyor olabilir.',
      requiresConfirmation: false,
    },
    {
      type: 'export-artifacts',
      confidence: score(EXPORT_PATTERNS, normalized),
      reason: 'Kullanıcı çıktı indirme veya dışa aktarma istiyor olabilir.',
      requiresConfirmation: true,
    },
  ];

  const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];

  if (!best || best.confidence <= 0) {
    return {
      type: 'chat',
      confidence: 1,
      reason: 'Mesaj genel sohbet veya açıklama talebi olarak değerlendirildi.',
      requiresConfirmation: false,
    };
  }

  return {
    ...best,
    confidence: Math.min(1, best.confidence / 3),
  };
}

export function buildActionIntentContext(intent: AiActionIntent): string {
  if (intent.type === 'chat') return '';

  return `
[OTONOM AKSİYON NİYETİ]
- Tahmin edilen kullanıcı niyeti: ${intent.type}
- Güven: ${Math.round(intent.confidence * 100)}%
- Gerekçe: ${intent.reason}

Bu bilgi sadece yönlendirme sinyalidir. Ayrı bir buton/yan akış çalıştırma. Aynı sohbet orkestrasyonunda davran:
- Kullanıcı doküman istiyorsa sağ paneldeki document alanını üret veya güncelle.
- Kullanıcı revizyon istiyorsa mevcut dokümanı koruyarak ilgili bölümü değiştir.
- Kullanıcı BPMN/akış istiyorsa ayrı FLOW/bpmn bölümü üretme; akış diyagramı, sequence veya Mermaid taslağını BA Analiz içindeki ilgili süreç modelinin altına yaz.
- Kullanıcı UI/UX/toast/validasyon istiyorsa BA Analiz ve Review içinde ekran davranışlarını ve mesaj standardını güncelle.
- Emin değilsen kısa netleştirici soru sor, ama kullanıcı açıkça oluştur/güncelle diyorsa yeni soru sormadan taslak üret.
- GUNCEL KURAL: BPMN/akis/FLOW istekleri ayri bpmn veya FLOW sekmesine yazilmaz; akis diyagrami ve Mermaid taslagi BA Analiz icinde ilgili surec modelinin altina yazilir.
`.trim();
}

export function shouldRunActionImmediately(_intent: AiActionIntent): boolean {
  // JetWork AI tek bir konuşma orkestrasyonu gibi davranmalı. Bu router artık
  // doğrudan yan pipeline başlatmaz; sadece ana single-chat orchestrator'a niyet
  // sinyali sağlar. Özel capability'ler ileride singleChatOrchestrator içinde
  // tool/handler olarak bağlanmalıdır.
  return false;
}
