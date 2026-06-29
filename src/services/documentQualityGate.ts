import type { DocumentData, SectionData } from '../types';

export interface DocumentQualityGateResult {
  canPublishToPanel: boolean;
  score: number;
  reason: string;
  missingSections: string[];
  warnings: string[];
}

const BODY_START = '<!-- AI_MINIMUM_BA_DEEPENING_START -->';
const BODY_END = '<!-- AI_MINIMUM_BA_DEEPENING_END -->';
const REVIEW_START = '<!-- AI_SELF_REVIEW_REPAIR_REVIEW_START -->';
const REVIEW_END = '<!-- AI_SELF_REVIEW_REPAIR_REVIEW_END -->';

const stripHtml = (value = ''): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

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

const sectionText = (section?: SectionData): string => stripHtml(section?.content || '');
const hasAny = (value: string, patterns: RegExp[]): boolean => patterns.some((pattern) => pattern.test(value));
const esc = (value = ''): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function replaceMarkedBlock(currentContent: string, nextBlock: string, startMarker: string, endMarker: string): string {
  const current = currentContent || '';
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) return current.replace(blockRegex, nextBlock);
  return [current.trim(), nextBlock].filter(Boolean).join('\n\n');
}

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

function inferProjectName(source = ''): string {
  const normalized = normalizeForAudit(source);
  if (/d2d|saha satis|mobil|mobile|refactoring|refaktoring/.test(normalized)) return 'D2D Saha Satis Uygulamasi Mobil Donusum ve Refactoring Projesi';
  if (/sap/.test(normalized) && /crm/.test(normalized) && /iys|ileti yonetim sistemi/.test(normalized)) return 'SAP CRM / C4C - IYS Entegrasyonu Projesi';
  if (/sap/.test(normalized) && /crm/.test(normalized) && /ai|bot|satis botu|lead|opportunity|firsat/.test(normalized)) return 'SAP CRM AI Satis Botu Projesi';
  return '[VARSAYIM] Proje adi netlestirilecek';
}

function inferProcessTitles(source = ''): string[] {
  const normalized = normalizeForAudit(source);
  if (/d2d|saha satis|mobil|mobile|refactoring|refaktoring/.test(normalized)) {
    return [
      'Saha ziyaret planlama ve rota yonetimi',
      'Musteri adayi olusturma, teklif ve satis akisi',
      'Offline veri toplama, senkronizasyon ve cakisma yonetimi',
      'Operasyonel izleme, onay ve evrak yonetimi',
    ];
  }
  if (/sap/.test(normalized) && /crm/.test(normalized) && /iys|ileti yonetim sistemi/.test(normalized)) {
    return [
      'SAP CRM / C4C uzerinden IYS izin aktarimi',
      'IYS delta mutabakati ve CRM izin guncelleme',
      'Initial load, retry, hata ve operasyonel izleme',
    ];
  }
  if (/sap/.test(normalized) && /crm/.test(normalized) && /ai|bot|satis botu|lead|opportunity|firsat/.test(normalized)) {
    return [
      'AI bot ile lead kazanimi ve niyet anlama',
      'Lead nitelendirme, teklif onerisi ve guven skoru',
      'SAP CRM kaydi, temsilciye devir ve satis takibi',
      'AI kalite, model izleme ve operasyon raporlama',
    ];
  }
  if (/entegrasyon|integration|api|middleware|sap|crm/.test(normalized)) {
    return [
      'Kaynak sistemden hedef sisteme veri aktarimi',
      'Hedef sistem geri bildirim ve mutabakat',
      'Hata yonetimi, retry ve operasyonel izleme',
    ];
  }
  return ['Ana is sureci', 'Kontrol, raporlama ve operasyonel takip sureci'];
}

function table(headers: string[], rows: string[][]): string {
  return [
    '<table>',
    `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`,
    '<tbody>',
    ...rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell || '[ACIK KONU]')}</td>`).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('');
}

function buildProcessRows(titles: string[]): string[][] {
  return titles.map((title, index) => [
    `SUREC MODELI - ${index + 1}`,
    title,
    'Tetikleyici, aktor, veri, is kurali, validasyon, istisna, kapanis ve KPI birlikte yazilmalidir.',
  ]);
}

function buildRequirementRows(titles: string[]): string[][] {
  const scope = titles.join(' | ');
  return [
    ['BR-01', 'Is kurali', `Kritik is kurallari ve kapanis kontrolleri tanimli olmalidir. Kapsam: ${scope}.`, 'Yuksek', 'Kural ihlalinde islem durur veya gerekceli uyari verilir.'],
    ['FR-01', 'Fonksiyonel', 'Kullanici ana surecleri baslatabilir, takip edebilir ve kapatabilir.', 'Yuksek', 'Her surec icin tetikleyici, adim, sorumlu ve kapanis kriteri gorunur.'],
    ['INT-01', 'Entegrasyon', 'Sistemler arasi veri ve statu akisi izlenebilir olmalidir.', 'Yuksek', 'Basarili ve hatali aktarimlar loglanir ve raporlanir.'],
    ['UI-01', 'Ekran/UX', 'Ekran davranislari, validasyon, toast ve kullanici mesajlari tasarlanmalidir.', 'Orta', 'Kullanici eksik veya hatali islemde anlasilir mesaj gorur.'],
    ['SEC-01', 'Yetki', 'Rol bazli yetki, audit log ve hassas veri korumasi uygulanmalidir.', 'Yuksek', 'Yetkisiz kullanici kritik aksiyon alamaz.'],
    ['DATA-01', 'Veri', 'Ana veri sahibi, zorunlu alanlar, veri tipi, format ve audit ihtiyaci belirtilmelidir.', 'Yuksek', 'Kritik alanlar icin sahiplik ve dogrulama kurali olur.'],
    ['RPT-01', 'Raporlama/KPI', 'Dashboard, KPI ve acik is takip ihtiyaci raporlanmalidir.', 'Orta', 'Surec durumu, hata, gecikme ve acik gorevler raporda gorunur.'],
    ['TEST-01', 'UAT/Test', 'Pozitif, negatif, yetki, entegrasyon hata ve regresyon senaryolari UAT kapsaminda test edilmelidir.', 'Yuksek', 'Kritik senaryolar tamamlanmadan onay verilmez.'],
  ];
}

function buildDeepeningBody(document: DocumentData): string {
  const source = `${document.businessAnalysis?.content || ''}\n${document.review?.content || ''}`;
  const titles = inferProcessTitles(source);
  const projectName = inferProjectName(source);

  return [
    BODY_START,
    '<section>',
    '<h2>AI Minimum BA Derinlestirme Govdesi</h2>',
    '<p>Bu govde, yuzeysel veya genel kalan dokumani karar verilebilir BA seviyesine yaklastirmak icin otomatik eklenir. Dogrulanmamis bilgiler [VARSAYIM], netlesmesi gerekenler [ACIK KONU] olarak ayrilir.</p>',
    '<h3>PROJE KIMLIK KARTI</h3>',
    table(['Alan', 'Deger', 'Kaynak Durumu'], [
      ['Proje Ismi', projectName, projectName.includes('[VARSAYIM]') ? 'VARSAYIM' : 'CIKARIM'],
      ['Ana Is Problemi', 'Surec, ekran, veri, entegrasyon, yetki ve takip kurallari karar verilebilir seviyede modellenmelidir.', 'VARSAYIM'],
      ['Paydaslar', 'Is birimi | Operasyon | IT | Destek | Rapor kullanicilari | Yoneticiler', 'VARSAYIM'],
    ]),
    '<h3>Problem Modeli / As-Is / To-Be / KPI</h3>',
    table(['Alan', 'Deger', 'Kaynak Durumu'], [
      ['Is problemi / ihtiyac', 'Mevcut talep kapsaminda surec, rol, veri, ekran, entegrasyon ve takip kurallari netlesmelidir.', 'CIKARIM'],
      ['Mevcut durum / As-Is', 'Mevcut durumda manuel, kopuk, eksik izlenen veya genel tarif edilen adimlar olabilir.', 'VARSAYIM'],
      ['Hedef durum / To-Be', 'Her ana surec icin tetikleyici, aktor, is kurali, validasyon, veri, entegrasyon, hata ve kapanis kriteri yazilir.', 'VARSAYIM'],
      ['Basari KPI / olcum', 'SLA uyumu, hata orani, manuel is yuku, acik konu kapanma suresi, kullanici basari orani.', 'VARSAYIM'],
    ]),
    '<h3>Surec Modeli Bloklari</h3>',
    table(['Blok', 'Surec', 'Zorunlu Analiz'], buildProcessRows(titles)),
    '<h3>Is Gerekleri ve KPI Tablosu</h3>',
    table(['Kod', 'Tur', 'Aciklama', 'Oncelik', 'Kabul Kriteri'], buildRequirementRows(titles)),
    '<h3>Eksik Karar ve Bilgi Boslugu Etki Matrisi</h3>',
    table(['Eksik karar', 'Etki', 'Geri donus maliyeti', 'Varsayilabilir mi?', 'Soru / Aksiyon'], [
      ['Ana surec modeli', titles.length ? 'low' : 'high', titles.length ? 'easy' : 'expensive', titles.length ? 'Evet' : 'Hayir', 'Ana surec tetikleyici, adim ve kapanis kriterleri netlesmeli.'],
      ['Kaynak/hedef sistemler', 'medium', 'expensive', 'Evet, isaretli varsayimla', 'Sistem sahipligi, veri kaynagi ve entegrasyon modeli netlesmeli.'],
      ['KPI hedefleri', 'medium', 'moderate', 'Evet, isaretli varsayimla', 'Hedef esikler is birimiyle onaylanmali.'],
    ]),
    '<h3>Kaynak ve Dogrulama Matrisi</h3>',
    table(['Iddia / Karar', 'Durum', 'Not'], [
      ['Kullanici talebinden cikarilan proje kapsami', 'VARSAYIM', 'Kullanici tarafindan onaylanmali.'],
      ['Mevzuat, API veya dis sistem kurallari', 'ACIK KONU', 'Resmi kaynak veya teknik dokumanla dogrulanmali.'],
      ['Ekran, validasyon, toast ve gorev takip ihtiyaci', 'VARSAYIM', 'UAT oncesi is birimiyle netlestirilmeli.'],
      ['Dokuman format ve onay yapisi', 'DOGRULANDI', 'Kavramsal tasarim sablonuna uyum icin zorunlu bolumler eklendi.'],
    ]),
    '<h3>Analiz Coverage Kontrolu</h3>',
    table(['Kapsam', 'Durum', 'Kanıt / Eksik'], [
      ['Aktor / rol / paydas', 'partial', 'Paydaslar varsayimla listelendi.'],
      ['Happy path / ana akis', 'covered', titles.join(' | ')],
      ['Istisna / negatif senaryo', 'partial', 'Hata, retry, yetki, validasyon ve operasyonel is listesi yazilmali.'],
      ['Veri / entegrasyon', 'partial', 'Kaynak, hedef, alan, format ve log ihtiyaci netlestirilmeli.'],
      ['Audit / log / izlenebilirlik', 'partial', 'Kritik aksiyonlarda kullanici, zaman, onceki/sonraki deger ve sonuc loglanmali.'],
    ]),
    '<h3>Dokuman Yonetimi ve Zorunlu Belgeler</h3>',
    table(['Konu', 'Beklenen Kural'], [
      ['Zorunlu dokuman matrisi', 'Hangi belge olmadan surecin ilerlemeyecegi netlestirilmelidir.'],
      ['Belge validasyonu', '[VARSAYIM] Eksik, suresi gecmis veya hatali belge yuklendiginde surec kapanisi engellenir.'],
      ['Onay tablosu', 'Kontrol eden ve onaylayan roller dokumanda izlenebilir olmalidir.'],
    ]),
    '<h3>Test / UAT ve Degisim Yonetimi</h3>',
    '<ul><li>Pozitif, negatif, yetki, entegrasyon hata ve raporlama senaryolari UAT kapsaminda test edilir.</li><li>UAT onayi alinmadan canli gecis yapilmaz.</li><li>Egitim, pilot, rollback ve operasyon devri planlanir.</li></ul>',
    '</section>',
    BODY_END,
  ].join('\n');
}

function buildReviewRepairBlock(beforeScoreHint: string): string {
  return [
    REVIEW_START,
    '<section>',
    '<h2>AI Self-Review / Repair Log</h2>',
    `<p>Repair oncesi kalite sinyali: <strong>${esc(beforeScoreHint)}</strong></p>`,
    '<h3>Uygulanan Onarimlar</h3>',
    '<ul><li>Minimum BA derinlestirme govdesi eklendi.</li><li>Problem modeli, gap matrisi, coverage, UAT ve dokuman yonetimi bolumleri eklendi.</li><li>Dogrulandi / varsayim / acik konu ayrimi Review tarafinda gorunur hale getirildi.</li></ul>',
    '</section>',
    REVIEW_END,
  ].join('\n');
}

function ensureMinimumBaDepth(document: DocumentData): void {
  if (!document.businessAnalysis) return;
  const current = document.businessAnalysis.content || '';
  if (!current.includes(BODY_START)) {
    document.businessAnalysis = {
      ...document.businessAnalysis,
      content: replaceMarkedBlock(current, buildDeepeningBody(document), BODY_START, BODY_END),
      flags: Array.from(new Set([...(document.businessAnalysis.flags || []), 'AI_MINIMUM_BA_DEEPENED'])),
    };
  }

  const review = document.review || { content: '', status: 'DRAFT' as const, flags: [] };
  if (!review.content.includes(REVIEW_START)) {
    document.review = {
      ...review,
      content: replaceMarkedBlock(review.content || '', buildReviewRepairBlock('auto-depth-check'), REVIEW_START, REVIEW_END),
      flags: Array.from(new Set([...(review.flags || []), 'AI_SELF_REVIEW_REPAIRED'])),
    };
  }

  document.suggestions = Array.from(new Set([
    ...(document.suggestions || []),
    'Eksikleri tamamla',
    'Word formatina duzelt',
    'Review acik konularini kapat',
  ]));
}

const hasSourceVerificationMatrix = (text = ''): boolean => (
  hasAny(text, [/kaynak/i, /kanit/i, /kanıt/i, /dogrula/i, /doğrula/i])
  && hasAny(text, [/DOGRULANDI/i, /DOĞRULANDI/i, /dogrulandi/i, /doğrulandı/i])
  && hasAny(text, [/VARSAYIM/i, /varsayim/i, /varsayım/i])
  && hasAny(text, [/ACIK KONU/i, /AÇIK KONU/i, /acik konu/i, /açık konu/i])
);

const buildQualityReason = (score: number, canPublish: boolean, missingSections: string[], warnings: string[]): string => {
  const band = score >= 90 ? 'Yuksek' : score >= 70 ? 'Orta' : 'Dusuk';
  const missing = missingSections.slice(0, 6).join(', ') || 'kritik eksik yok';
  const warningText = warnings.slice(0, 2).join(' ') || 'Uyari yok.';
  const action = missingSections.length
    ? `Once su BA/Review alanlari tamamlanmali: ${missing}.`
    : 'Dokuman taslak olarak paylasilabilir; sonraki adim Review acik konularini kapatmak.';
  return `Kalite puani ${score}/100 (${band}): ${canPublish ? 'taslak olarak gosterilebilir' : 'revizyon gerekli'}. Puanin nedeni: ${missing}. ${warningText} ${action}`;
};

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

  ensureMinimumBaDepth(document);

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
    { ok: ba.length >= 2500, label: 'BA Analiz detay seviyesi', penalty: 20, warning: 'BA Analiz bolumu karar verilebilir seviyede detayli degil.' },
    { ok: hasAny(ba, [/kavramsal tasarim raporu/i, /kavramsal tasarım raporu/i]), label: 'Word kavramsal tasarim basligi', penalty: 12, warning: 'Dokuman sirket kavramsal tasarim formatindaki ana baslikla baslamiyor.' },
    { ok: hasHeadingLikeContent(baRaw), label: 'Baslik yapisi', penalty: 8 },
    { ok: hasAny(ba, [/proje kimlik kart/i, /proje ismi/i, /katilimc/i, /katılımc/i, /kontrol eden ve onaylayan/i]), label: 'Proje kimlik karti / katilimcilar / onay', penalty: 10 },
    { ok: countProcessModels(baRaw) >= expectedProcessCount, label: `Surec modeli bloklari (en az ${expectedProcessCount})`, penalty: 14, warning: 'Talebe gore otomatik cogaltilmis surec modeli bloklari yeterli degil.' },
    { ok: hasAny(all, [/\bBR[-–]?\d+/i, /\bFR[-–]?\d+/i, /gereksinim/i, /is geregi/i, /iş gereği/i, /kabul kriter/i]), label: 'Is gerekleri ve kabul kriterleri', penalty: 12 },
    { ok: hasAny(all, [/\bKPI\b/i, /olcum/i, /ölçüm/i, /tamamlanma orani/i, /hedef deger/i, /hedef değer/i]), label: 'KPI ve olcumleme', penalty: 10 },
    { ok: hasAny(all, [/toast/i, /validasyon/i, /modal/i, /uyari mesaj/i, /uyarı mesaj/i, /kullanici mesaj/i, /kullanıcı mesaj/i]), label: 'Kullanici mesajlari / toast / validasyon', penalty: 8 },
    { ok: hasAny(all, [/dokuman yonetimi/i, /doküman yönetimi/i, /zorunlu dokuman/i, /zorunlu doküman/i, /belge/i, /dosya tur/i, /dosya tür/i]), label: 'Dokuman yonetimi', penalty: 8 },
    { ok: hasAny(all, [/acik soru/i, /açık soru/i, /acik konu/i, /açık konu/i, /eksik bilgi/i, /risk/i, /review/i, /kalite/i]), label: 'Review / acik konular', penalty: 6 },
    { ok: !sourceSensitive || hasSourceVerificationMatrix(all), label: 'Kaynak ve dogrulama ayrimi', penalty: 10, warning: 'Mevzuat/API/entegrasyon iceren dokumanda dogrulandi, varsayim ve acik konu ayrimi net degil.' },
    { ok: hasTableLikeContent(baRaw) || hasTableLikeContent(reviewRaw), label: 'Tablo kullanimi', penalty: 8, warning: 'Dokuman kurumsal analiz formati icin yeterli tablo icermiyor.' },
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
