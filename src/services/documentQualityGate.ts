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
      reason: 'Yayınlanacak doküman bulunmuyor.',
      missingSections: ['Doküman'],
      warnings: [],
    };
  }

  const baRaw = document.businessAnalysis?.content || '';
  const itRaw = document.code?.content || '';
  const testRaw = document.test?.content || '';
  const reviewRaw = document.review?.content || '';
  const flowRaw = document.bpmn?.content || '';

  const ba = sectionText(document.businessAnalysis);
  const it = sectionText(document.code);
  const test = sectionText(document.test);
  const review = sectionText(document.review);
  const flow = stripHtml(flowRaw);
  const all = `${ba}\n${it}\n${test}\n${review}\n${flow}`;

  const missingSections: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const checks: Array<{ ok: boolean; label: string; penalty: number; warning?: string }> = [
    {
      ok: ba.length >= 2500,
      label: 'BA Analiz detay seviyesi',
      penalty: 18,
      warning: 'BA Analiz bölümü karar verilebilir seviyede detaylı değil.',
    },
    {
      ok: hasHeadingLikeContent(baRaw),
      label: 'Başlık yapısı',
      penalty: 8,
      warning: 'Dokümanda numaralı/formatlı başlık yapısı bulunmuyor.',
    },
    {
      ok: hasAny(ba, [/proje kimlik kart/i, /proje adı/i, /katılımc/i]),
      label: 'Proje kimlik kartı ve katılımcılar',
      penalty: 8,
    },
    {
      ok: hasAny(ba, [/süreç modeli/i, /süreçler/i, /akış/i, /tetikleyici/i]),
      label: 'Süreç modelleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /gereksinim/i, /iş gereği/i]),
      label: 'İş gerekleri ve gereksinimler',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bKPI\b/i, /ölçüm/i, /tamamlanma oranı/i, /hedef değer/i]),
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
      ok: it.length >= 900,
      label: 'IT Analiz',
      penalty: 10,
      warning: 'IT Analiz bölümü mimari, entegrasyon ve veri modeli açısından yetersiz.',
    },
    {
      ok: test.length >= 700,
      label: 'Test / UAT',
      penalty: 8,
      warning: 'Test bölümü UAT ve negatif senaryoları kapsayacak kadar detaylı değil.',
    },
    {
      ok: Boolean(flow.trim()) && hasAny(flow, [/bpmn/i, /mermaid/i, /start/i, /başla/i, /süreç/i, /akış/i]),
      label: 'FLOW / BPMN',
      penalty: 6,
    },
    {
      ok: hasTableLikeContent(baRaw) || hasTableLikeContent(itRaw) || hasTableLikeContent(testRaw) || hasTableLikeContent(reviewRaw),
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

  const blockingMissing = missingSections.filter(section => ![
    'Tablo kullanımı',
    'FLOW / BPMN',
  ].includes(section));

  const canPublishToPanel = score >= 62 && blockingMissing.length <= 4;

  return {
    canPublishToPanel,
    score,
    reason: canPublishToPanel
      ? 'Doküman sağ panelde taslak olarak gösterilebilir seviyede.'
      : `Doküman çok yüzeysel. Eksik/zayıf alanlar: ${missingSections.join(', ')}.`,
    missingSections,
    warnings,
  };
}
