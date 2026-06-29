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
const hasAny = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));

const normalizeForAudit = (value = ''): string => stripHtml(value)
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/ş/g, 's')
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/\s+/g, ' ')
  .trim();

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

const countProcessModels = (text = ''): number => {
  const normalized = normalizeForAudit(text);
  const matches = Array.from(normalized.matchAll(/surec modeli\s*-\s*(\d+)/gi)).map((match) => match[1]);
  return new Set(matches).size;
};

const hasSourceVerificationMatrix = (text = ''): boolean => (
  hasAny(text, [/kaynak/i, /kanıt/i, /kanit/i, /doğrula/i, /dogrula/i]) &&
  hasAny(text, [/DOĞRULANDI/i, /DOGRULANDI/i, /doğrulandı/i, /dogrulandi/i]) &&
  hasAny(text, [/VARSAYIM/i, /varsayım/i]) &&
  hasAny(text, [/AÇIK KONU/i, /ACIK KONU/i, /açık konu/i, /acik konu/i])
);

const buildQualityReason = (score: number, canPublish: boolean, missingSections: string[], warnings: string[]): string => {
  const band = score >= 90 ? 'Yüksek' : score >= 70 ? 'Orta' : 'Düşük';
  const missing = missingSections.slice(0, 6).join(', ') || 'kritik eksik yok';
  const warningText = warnings.slice(0, 2).join(' ') || 'Uyarı yok.';
  const action = missingSections.length
    ? `Önce şu BA/Review alanları tamamlanmalı: ${missing}.`
    : 'Doküman paylaşılabilir; sonraki adım Review açık konularını kapatmak.';
  return `Kalite puanı ${score}/100 (${band}): ${canPublish ? 'taslak olarak gösterilebilir' : 'revizyon gerekli'}. Puanın nedeni: ${missing}. ${warningText} ${action}`;
};

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
  const normalizedAll = normalizeForAudit(all);
  const sourceSensitive = hasAny(all, [/iys/i, /mevzuat/i, /kanun/i, /api/i, /oauth/i, /entegrasyon/i]);
  const expectedProcessCount = hasAny(normalizedAll, [/sap/, /crm/, /iys/, /entegrasyon/, /d2d/, /mobil/, /saha satis/, /refactoring/]) ? 3 : 2;

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
      ok: hasAny(ba, [/kavramsal tasarım raporu/i, /kavramsal tasarim raporu/i]),
      label: 'Word kavramsal tasarım başlığı',
      penalty: 12,
      warning: 'Doküman şirket kavramsal tasarım formatındaki ana başlıkla başlamıyor.',
    },
    {
      ok: hasHeadingLikeContent(baRaw),
      label: 'Başlık yapısı',
      penalty: 8,
    },
    {
      ok: hasAny(ba, [/proje kimlik kart/i, /proje ismi/i, /katılımc/i, /katilimc/i, /kontrol eden ve onaylayan/i]),
      label: 'Proje kimlik kartı / katılımcılar / onay',
      penalty: 10,
    },
    {
      ok: countProcessModels(baRaw) >= expectedProcessCount,
      label: `Süreç modeli blokları (en az ${expectedProcessCount})`,
      penalty: 14,
      warning: 'Talebe göre otomatik çoğaltılmış süreç modeli blokları yeterli değil.',
    },
    {
      ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /gereksinim/i, /iş gereği/i, /is geregi/i, /kabul kriter/i]),
      label: 'İş gerekleri ve kabul kriterleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bKPI\b/i, /ölçüm/i, /olcum/i, /tamamlanma oranı/i, /hedef değer/i, /hedef deger/i]),
      label: 'KPI ve ölçümleme',
      penalty: 10,
    },
    {
      ok: hasAny(all, [/toast/i, /validasyon/i, /modal/i, /uyarı mesaj/i, /uyari mesaj/i, /kullanıcı mesaj/i, /kullanici mesaj/i]),
      label: 'Kullanıcı mesajları / toast / validasyon',
      penalty: 8,
    },
    {
      ok: hasAny(all, [/doküman yönetimi/i, /dokuman yonetimi/i, /zorunlu doküman/i, /zorunlu dokuman/i, /belge/i, /dosya tür/i, /dosya tur/i]),
      label: 'Doküman yönetimi',
      penalty: 8,
    },
    {
      ok: hasAny(all, [/açık soru/i, /acik soru/i, /eksik bilgi/i, /risk/i, /review/i, /kalite/i]),
      label: 'Review / açık konular',
      penalty: 6,
    },
    {
      ok: !sourceSensitive || hasSourceVerificationMatrix(all),
      label: 'Kaynak ve doğrulama ayrımı',
      penalty: 10,
      warning: 'Mevzuat/API/entegrasyon içeren dokümanda doğrulandı, varsayım ve açık konu ayrımı net değil.',
    },
    {
      ok: hasTableLikeContent(baRaw) || hasTableLikeContent(reviewRaw),
      label: 'Tablo kullanımı',
      penalty: 8,
      warning: 'Doküman kurumsal analiz formatı için yeterli tablo içermiyor.',
    },
  ];

  checks.forEach((check) => {
    if (!check.ok) {
      missingSections.push(check.label);
      score -= check.penalty;
      if (check.warning) warnings.push(check.warning);
    }
  });

  score = Math.max(0, Math.min(100, score));
  const canPublishToPanel = score >= 72 && missingSections.length <= 4;

  return {
    canPublishToPanel,
    score,
    reason: buildQualityReason(score, canPublishToPanel, missingSections, warnings),
    missingSections,
    warnings,
  };
}
