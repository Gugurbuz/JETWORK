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
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeForAudit = (value = ''): string => stripHtml(value)
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[ıİ]/g, 'i')
  .replace(/[şŞ]/g, 's')
  .replace(/[ğĞ]/g, 'g')
  .replace(/[üÜ]/g, 'u')
  .replace(/[öÖ]/g, 'o')
  .replace(/[çÇ]/g, 'c')
  .replace(/\s+/g, ' ')
  .trim();

const sectionText = (section?: SectionData): string => stripHtml(section?.content || '');
const hasAny = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const hasTableLikeContent = (raw = ''): boolean => (
  raw.includes('<table')
  || /\|\s*[^\n]+\s*\|/.test(raw)
  || /<tr[\s>]/i.test(raw)
);

const hasHeadingLikeContent = (raw = ''): boolean => (
  /<h[1-4][\s>]/i.test(raw)
  || /^#{1,4}\s+/m.test(raw)
  || /(^|\n)\s*\d+(\.\d+)*\s+[^\n]+/.test(raw)
);

const countProcessModels = (text = ''): number => {
  const normalized = normalizeForAudit(text);
  const matches = Array.from(normalized.matchAll(/surec modeli\s*-\s*(\d+)/gi)).map((match) => match[1]);
  return new Set(matches).size;
};

const countMatches = (text: string, pattern: RegExp): number => (text.match(pattern) || []).length;

function hasSourceVerificationMatrix(text = ''): boolean {
  const normalized = normalizeForAudit(text);
  return /kaynak|kanit|dogrula|dogrulama|resmi kaynak/.test(normalized)
    && /dogrulandi/.test(normalized)
    && /varsayim/.test(normalized)
    && /acik konu/.test(normalized);
}

function hasOfficialSourceSignal(text = ''): boolean {
  const normalized = normalizeForAudit(text);
  return /https?:\/\//i.test(text)
    || /resmi kaynak|kurum dokumani|api dokumani|mevzuat|kanun|kkb|findeks|kvkk|iys/.test(normalized);
}

function isSourceSensitive(text = ''): boolean {
  const normalized = normalizeForAudit(text);
  return /kkb|findeks|kredi notu|muvafakat|kvkk|finansal veri|mevzuat|kanun|api|sap|iys|oauth|entegrasyon/.test(normalized);
}

function contaminationFindings(text = ''): string[] {
  const normalized = normalizeForAudit(text);
  const findings: string[] = [];
  const kkbContext = /kkb|findeks|kredi notu|muvafakat|finansal veri/.test(normalized);

  if (kkbContext && /ai satis botu|satis botu|lead kazanimi|lead nitelendirme|opportunity|firsat skoru/.test(normalized)) {
    findings.push('Yanlis baglam: KKB/Findeks dokumanina SAP CRM AI satis botu veya lead kalibi karismis.');
  }

  if (kkbContext && /d2d|saha satis|offline-first|rota yonetimi|mobil donusum/.test(normalized)) {
    findings.push('Yanlis baglam: KKB/Findeks dokumanina D2D veya saha satis kalibi karismis.');
  }

  if (kkbContext && /iys izin|ileti yonetim sistemi|ticari ileti|sms e-posta arama izin/.test(normalized)) {
    findings.push('Yanlis baglam: KKB/Findeks dokumanina IYS izin kalibi karismis.');
  }

  if (kkbContext && /dijital imza|otp|dijital sozlesme|sozlesme onay/.test(normalized)) {
    findings.push('Yanlis baglam: KKB/Findeks dokumanina dijital sozlesme veya OTP kalibi karismis.');
  }

  if (/ai_minimum_ba_deepening|ai minimum ba derinlestirme|minimum ba derinlestirme govdesi/.test(normalized)) {
    findings.push('Legacy repair blogu dokumanda gorunuyor; kalite kapisi dokumana icerik eklememeli.');
  }

  return findings;
}

function buildQualityReason(score: number, canPublish: boolean, issues: string[], warnings: string[]): string {
  const band = score >= 90 ? 'Yuksek' : score >= 70 ? 'Orta' : 'Dusuk';
  const issueText = issues.slice(0, 6).join(', ') || 'ana yapi kabul edilebilir';
  const warningText = warnings.slice(0, 2).join(' ') || 'Ek uyari yok.';
  const action = canPublish
    ? 'Taslak panelde gosterilebilir; dogrulama ve acik kararlar ayrica kapatilmalidir.'
    : 'Tam dokuman gibi yayinlanmadan once kapsam, kaynak, surec ve kalite bulgulari onarilmalidir.';

  return `Kalite puani ${score}/100 (${band}). Puan nedeni: ${issueText}. ${warningText} ${action}`;
}

export function evaluateDocumentQualityGate(document: DocumentData | null | undefined): DocumentQualityGateResult {
  if (!document) {
    return {
      canPublishToPanel: false,
      score: 0,
      reason: 'Yayinlanacak BA analiz dokumani bulunmuyor.',
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
  const sourceSensitive = isSourceSensitive(all);
  const contamination = contaminationFindings(all);

  if (contamination.length > 0) {
    return {
      canPublishToPanel: false,
      score: 35,
      reason: buildQualityReason(35, false, ['Yanlis baglam / sabit sablon sizintisi'], contamination),
      missingSections: ['Yanlis baglam / sabit sablon sizintisi'],
      warnings: contamination,
    };
  }

  const expectedProcessCount = hasAny(normalizedAll, [/sap/, /crm/, /kkb/, /findeks/, /entegrasyon/, /api/]) ? 3 : 2;
  const issues: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const checks: Array<{ ok: boolean; label: string; penalty: number; warning?: string }> = [
    { ok: ba.length >= 2500, label: 'BA Analiz detay seviyesi', penalty: 18, warning: 'BA Analiz karar verilebilir seviyede detayli degil.' },
    { ok: hasAny(ba, [/kavramsal tasarim raporu/i, /kavramsal tasarım raporu/i]), label: 'Kavramsal tasarim ana basligi', penalty: 10 },
    { ok: hasHeadingLikeContent(baRaw), label: 'Baslik ve bolum yapisi', penalty: 6 },
    { ok: hasAny(normalizedAll, [/proje kimlik kart/, /proje ismi/, /katilimci/, /kontrol eden ve onaylayan/, /onay tablosu/]), label: 'Proje kimlik karti / katilimci / onay', penalty: 8 },
    { ok: countProcessModels(baRaw) >= expectedProcessCount, label: `Surec modeli bloklari (en az ${expectedProcessCount})`, penalty: 12, warning: 'Talebe gore surec modeli bloklari yeterli cogaltilmamis.' },
    { ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /\bINT[-–]?\d+/i, /gereksinim/i, /is geregi/i, /iş gereği/i, /kabul kriter/i]), label: 'Kodlanmis is gerekleri ve kabul kriterleri', penalty: 12 },
    { ok: hasAny(all, [/\bKPI\b/i, /olcum/i, /ölçüm/i, /hedef deger/i, /hedef değer/i, /basari kriter/i, /başarı kriter/i]), label: 'KPI ve olcumleme', penalty: 8 },
    { ok: hasAny(all, [/as-is/i, /to-be/i, /mevcut durum/i, /hedef durum/i, /mevcut surec/i, /hedef surec/i]), label: 'As-Is / To-Be ayrimi', penalty: 8 },
    { ok: hasAny(all, [/toast/i, /validasyon/i, /uyari mesaj/i, /uyarı mesaj/i, /kullanici mesaj/i, /kullanıcı mesaj/i, /ekran davran/i, /field/i]), label: 'Ekran davranisi / validasyon / kullanici mesaji', penalty: 7 },
    { ok: hasAny(all, [/yetki/i, /rol/i, /audit/i, /log/i, /izlenebilir/i, /kvkk/i, /gizlilik/i]), label: 'Yetki / audit / veri guvenligi', penalty: 8 },
    { ok: hasAny(all, [/acik soru/i, /açık soru/i, /acik konu/i, /açık konu/i, /risk/i, /review/i, /kalite/i]), label: 'Review / risk / acik konu', penalty: 6 },
    { ok: !sourceSensitive || hasSourceVerificationMatrix(all), label: 'Kaynak ve dogrulama ayrimi', penalty: 15, warning: 'Kaynak gerektiren konuda dogrulandi, varsayim ve acik konu ayrimi net degil.' },
    { ok: !sourceSensitive || hasOfficialSourceSignal(all), label: 'Resmi kaynak sinyali', penalty: 10, warning: 'KKB/Findeks/KVKK/API gibi konularda resmi kaynak veya kurum dokumani sinyali yok.' },
    { ok: hasTableLikeContent(baRaw) || hasTableLikeContent(reviewRaw), label: 'Tablo kullanimi', penalty: 6 },
  ];

  checks.forEach((check) => {
    if (!check.ok) {
      issues.push(check.label);
      score -= check.penalty;
      if (check.warning) warnings.push(check.warning);
    }
  });

  const assumptionCount = countMatches(normalizedAll, /\bvarsayim\b/g);
  const openTopicCount = countMatches(normalizedAll, /\bacik konu\b/g) + countMatches(normalizedAll, /\bacik soru\b/g);

  if (sourceSensitive && (!hasSourceVerificationMatrix(all) || !hasOfficialSourceSignal(all))) {
    score = Math.min(score, 74);
    warnings.push('Kaynak gerektiren dokuman resmi dogrulama olmadan yuksek puan alamaz.');
  }

  if (assumptionCount + openTopicCount >= 6) {
    score = Math.min(score, 82);
    warnings.push('Dokumanda cok sayida varsayim/acik karar var; kalite puani sinirlandi.');
  }

  if (openTopicCount > 0) {
    score = Math.min(score, 88);
  }

  if (/100\s*\/\s*100/.test(all) && issues.length > 0) {
    score = Math.min(score, 79);
    warnings.push('Icerikte 100/100 ifadesi olsa bile kalite kapisi bulgulari puani dusurur.');
  }

  score = clamp(score, 0, 100);
  const canPublishToPanel = score >= 72 && issues.length <= 4 && contamination.length === 0;

  return {
    canPublishToPanel,
    score,
    reason: buildQualityReason(score, canPublishToPanel, issues, warnings),
    missingSections: issues,
    warnings,
  };
}
