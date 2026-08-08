import type { DocumentData } from '../types';

const normalize = (value: string): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s.-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SECTION_MARKERS = [
  'ihtiyac analizi',
  '1. analiz kapsami',
  '2. kisaltmalar',
  '3. is gereksinimleri',
  '4. fonksiyonel gereksinimler',
  '5. fonksiyonel olmayan gereksinimler',
  '6. surec risk analizi',
  '7. onay',
  '8. fonksiyonel tasarim dokumanlari',
] as const;

export interface DerivedDocumentQuality {
  score: number;
  explanation: string;
  sectionCoverage: number;
}

const countMatches = (value: string, pattern: RegExp): number => (
  value.match(pattern)?.length || 0
);

export function deriveDocumentQuality(document: DocumentData): DerivedDocumentQuality {
  const raw = document.businessAnalysis?.content || '';
  const normalized = normalize(raw);
  if (!normalized) {
    return { score: 0, explanation: 'BA Analiz içeriği henüz oluşmadı.', sectionCoverage: 0 };
  }

  const passedSections = SECTION_MARKERS.filter(marker => normalized.includes(marker)).length;
  const sectionCoverage = Math.round((passedSections / SECTION_MARKERS.length) * 100);
  let score = Math.round((passedSections / SECTION_MARKERS.length) * 70);
  const strengths: string[] = [];

  if (/\bfr[-\s]?\d+\b/.test(normalized)) {
    score += 8;
    strengths.push('numaralı fonksiyonel gereksinimler');
  }
  if (/\bbr[-\s]?\d+\b/.test(normalized) || normalized.includes('3.1. is kurallari')) {
    score += 5;
    strengths.push('iş kuralları');
  }
  if (normalized.includes('4.2. surec akisi')) {
    score += 5;
    strengths.push('süreç akışı');
  }
  if (/rol|kullanici/.test(normalized)) {
    score += 4;
    strengths.push('rol/kullanıcı kapsamı');
  }
  if (/\bkpi\b|raporlama gereksinimleri/.test(normalized)) {
    score += 4;
    strengths.push('KPI/raporlama');
  }
  if (/guvenlik|yetkilendirme/.test(normalized)) {
    score += 4;
    strengths.push('güvenlik/yetkilendirme');
  }

  const openTopics = countMatches(normalized, /acik konu/g);
  const assumptions = countMatches(normalized, /varsayim/g);
  const openPenalty = Math.min(8, openTopics);
  const assumptionPenalty = Math.min(4, Math.floor(assumptions / 2));
  score = Math.max(0, Math.min(100, score - openPenalty - assumptionPenalty));

  const explanation = [
    `Şablon kapsamı %${sectionCoverage}.`,
    strengths.length ? `Güçlü alanlar: ${strengths.join(', ')}.` : 'Yapısal detaylandırma sınırlı.',
    openTopics ? `${openTopics} açık konu kalite puanını sınırlıyor.` : 'Açık konu bulunmuyor.',
  ].join(' ');

  return { score, explanation, sectionCoverage };
}

export function withDerivedDocumentQuality(document: DocumentData): DocumentData {
  if (Number.isFinite(document.score) && Number(document.score) > 0) return document;
  const quality = deriveDocumentQuality(document);
  return {
    ...document,
    score: quality.score,
    scoreExplanation: document.scoreExplanation || quality.explanation,
  };
}
