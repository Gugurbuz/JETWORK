import type { DocumentData, SectionData } from '../types';

export interface DocumentQualityGateResult {
  canPublishToPanel: boolean;
  score: number;
  reason: string;
  missingSections: string[];
  warnings: string[];
}

const stripHtml = (value = ''): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const sectionText = (section?: SectionData): string => stripHtml(section?.content || '');
const hasAny = (value: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(value));

const hasTableLikeContent = (raw = ''): boolean => (
  raw.includes('<table') ||
  /\|\s*[^\n]+\s*\|/.test(raw) ||
  /<tr[\s>]/i.test(raw)
);

const hasHeadingLikeContent = (raw = ''): boolean => (
  /<h[1-4][\s>]/i.test(raw) ||
  /^#{1,4}\s+/m.test(raw) ||
  /(^|\n)\s*\d+(\.\d+)*\s+[^\n]+/.test(raw)
);

export function evaluateDocumentQualityGate(document: DocumentData | null | undefined): DocumentQualityGateResult {
  if (!document) {
    return {
      canPublishToPanel: false,
      score: 0,
      reason: 'Yayınlanacak BA analiz dokümanı bulunmuyor.',
      missingSections: ['BA Analiz'],
      warnings: [],
    };
  }

  const baRaw = document.businessAnalysis?.content || '';
  const reviewRaw = document.review?.content || '';
  const ba = sectionText(document.businessAnalysis);
  const review = sectionText(document.review);
  const all = `${ba}\n${review}`;

  const missingSections: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const checks: Array<{ ok: boolean; label: string; penalty: number; warning?: string }> = [
    {
      ok: ba.length >= 2500,
      label: 'BA Analiz detay seviyesi',
      penalty: 20,
      warning: 'BA Analiz bölümü karar verilebilir seviyede detaylı değil.',
    },
    {
      ok: hasHeadingLikeContent(baRaw),
      label: 'Başlık yapısı',
      penalty: 8,
      warning: 'Dokümanda numaralı/formatlı başlık yapısı bulunmuyor.',
    },
    {
      ok: hasAny(ba, [/proje kimlik kart/i, /proje adı/i, /katılımc/i, /paydaş/i]),
      label: 'Proje kimlik kartı / katılımcılar',
      penalty: 8,
    },
    {
      ok: hasAny(ba, [/amaç/i, /iş değeri/i, /beklenen fayda/i]),
      label: 'Amaç ve iş değeri',
      penalty: 7,
    },
    {
      ok: hasAny(ba, [/kapsam/i, /kapsam dışı/i, /varsayım/i]),
      label: 'Kapsam ve varsayımlar',
      penalty: 7,
    },
    {
      ok: hasAny(ba, [/süreç modeli/i, /süreçler/i, /iş akışı/i, /tetikleyici/i, /giriş koşulu/i, /çıkış koşulu/i]),
      label: 'Süreç modelleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /gereksinim/i, /iş gereği/i, /kabul kriter/i]),
      label: 'İş gerekleri ve kabul kriterleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bKPI\b/i, /ölçüm/i, /tamamlanma oranı/i, /hedef değer/i, /veri kaynağı/i]),
      label: 'KPI ve ölçümleme',
      penalty: 10,
    },
    {
      ok: hasAny(all, [/toast/i, /validasyon/i, /modal/i, /uyarı mesaj/i, /kullanıcı mesaj/i]),
      label: 'Kullanıcı mesajları / toast / validasyon',
      penalty: 10,
    },
    {
      ok: hasAny(all, [/doküman yönetimi/i, /dokuman yönetimi/i, /filenet/i, /zorunlu doküman/i, /dosya tür/i]),
      label: 'Doküman yönetimi',
      penalty: 8,
    },
    {
      ok: hasAny(all, [/açık soru/i, /eksik bilgi/i, /risk/i, /review/i, /kalite/i]),
      label: 'Review / açık konular',
      penalty: 6,
    },
    {
      ok: hasTableLikeContent(baRaw) || hasTableLikeContent(reviewRaw),
      label: 'Tablo kullanımı',
      penalty: 8,
      warning: 'Doküman kurumsal analiz formatı için yeterli tablo içermiyor.',
    },
  ];

  checks.forEach(check => {
    if (!check.ok) {
      missingSections.push(check.label);
      score -= check.penalty;
      if (check.warning) warnings.push(check.warning);
    }
  });

  score = Math.max(0, Math.min(100, score));
  const canPublishToPanel = score >= 68 && missingSections.length <= 4;

  return {
    canPublishToPanel,
    score,
    reason: canPublishToPanel
      ? 'BA analiz dokümanı sağ panelde taslak olarak gösterilebilir seviyede.'
      : `BA analiz dokümanı yüzeysel. Eksik/zayıf alanlar: ${missingSections.join(', ')}.`,
    missingSections,
    warnings,
  };
}
