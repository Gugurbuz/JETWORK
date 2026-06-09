import type { DocumentData, SectionData } from '../types';
import { conceptualTemplateCoverage, isConceptualTemplateCompliant } from './conceptualTemplate';

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

const hasSourceVerificationMatrix = (text = ''): boolean => (
  hasAny(text, [/kaynak/i, /kan[ıi]t/i, /dogrula/i, /do[ğg]rula/i])
  && hasAny(text, [/DOGRULANDI/i, /DO[ĞG]RULANDI/i, /dogruland/i, /do[ğg]ruland/i])
  && hasAny(text, [/VARSAYIM/i, /varsay[ıi]m/i])
  && hasAny(text, [/ACIK KONU/i, /A[ÇC]IK KONU/i, /a[çc][ıi]k konu/i])
);

const buildQualityReason = (score: number, canPublish: boolean, missingSections: string[], warnings: string[]): string => {
  const band = score >= 90 ? 'Yuksek' : score >= 70 ? 'Orta' : 'Dusuk';
  const missing = missingSections.slice(0, 5).join(', ') || 'kritik eksik yok';
  const warningText = warnings.slice(0, 2).join(' ') || 'Uyari yok.';
  const action = missingSections.length
    ? `Once su alanlari tamamla: ${missing}.`
    : 'Dokuman paylasilabilir; sonraki adim Review notlarini kapatmak.';
  return `Kalite puani ${score}/100 (${band}): ${canPublish ? 'taslak olarak gosterilebilir' : 'revizyon gerekli'}. Puanin nedeni: ${missing}. ${warningText} ${action}`;
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
  const templateCoverage = conceptualTemplateCoverage(baRaw);
  const sourceSensitive = hasAny(all, [/iys/i, /i[\. ]?y[\. ]?s/i, /mevzuat/i, /kanun/i, /api/i, /oauth/i, /entegrasyon/i]);

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
      ok: isConceptualTemplateCompliant(baRaw),
      label: `Kurumsal kavramsal tasarım şablonu (${templateCoverage.passed}/${templateCoverage.total})`,
      penalty: 24,
      warning: `Doküman paylaşılan Word kavramsal tasarım yapısına tam uymuyor. Eksik şablon başlıkları: ${templateCoverage.missing.slice(0, 6).join(', ') || 'Yok'}.`,
    },
    {
      ok: hasHeadingLikeContent(baRaw),
      label: 'Başlık yapısı',
      penalty: 8,
      warning: 'Dokümanda numaralı/formatlı başlık yapısı bulunmuyor.',
    },
    {
      ok: hasAny(ba, [/proje kimlik kart/i, /proje ad[ıi]/i, /kat[ıi]l[ıi]mc/i, /payda[şs]/i]),
      label: 'Proje kimlik kartı / katılımcılar',
      penalty: 8,
    },
    {
      ok: hasAny(ba, [/ama[çc]/i, /i[şs] de[ğg]eri/i, /beklenen fayda/i]),
      label: 'Amaç ve iş değeri',
      penalty: 7,
    },
    {
      ok: hasAny(ba, [/kapsam/i, /kapsam d[ıi][şs][ıi]/i, /varsay[ıi]m/i]),
      label: 'Kapsam ve varsayımlar',
      penalty: 7,
    },
    {
      ok: hasAny(ba, [/s[uü]re[çc] modeli/i, /s[uü]re[çc]ler/i, /i[şs] ak[ıi][şs][ıi]/i, /tetikleyici/i, /giri[şs] ko[şs]ulu/i, /[çc][ıi]k[ıi][şs] ko[şs]ulu/i]),
      label: 'Süreç modelleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /gereksinim/i, /i[şs] gere[ğg]i/i, /kabul kriter/i]),
      label: 'İş gerekleri ve kabul kriterleri',
      penalty: 12,
    },
    {
      ok: hasAny(all, [/\bKPI\b/i, /[öo]l[çc][uü]m/i, /tamamlanma oran[ıi]/i, /hedef de[ğg]er/i, /veri kayna[ğg][ıi]/i]),
      label: 'KPI ve ölçümleme',
      penalty: 10,
    },
    {
      ok: hasAny(all, [/toast/i, /validasyon/i, /modal/i, /uyar[ıi] mesaj/i, /kullan[ıi]c[ıi] mesaj/i]),
      label: 'Kullanıcı mesajları / toast / validasyon',
      penalty: 10,
    },
    {
      ok: hasAny(all, [/dok[uü]man y[oö]netimi/i, /filenet/i, /zorunlu dok[uü]man/i, /dosya t[uü]r/i]),
      label: 'Doküman yönetimi',
      penalty: 8,
    },
    {
      ok: hasAny(all, [/a[çc][ıi]k soru/i, /eksik bilgi/i, /risk/i, /review/i, /kalite/i]),
      label: 'Review / açık konular',
      penalty: 6,
    },
    {
      ok: !sourceSensitive || hasSourceVerificationMatrix(all),
      label: 'Kaynak ve dogrulama ayrimi',
      penalty: 10,
      warning: 'Mevzuat/API iceren dokumanda dogrulandi, varsayim ve acik konu ayrimi net degil.',
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
    reason: buildQualityReason(score, canPublishToPanel, missingSections, warnings),
    missingSections,
    warnings,
  };
}
