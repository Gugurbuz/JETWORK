import type { DocumentData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';
import { deriveProcessCandidates } from './sourceDrivenInference';

export interface SourceIntelligenceReport {
  inferredProjectName?: string;
  domainHints: string[];
  processes: Array<{ id?: string; title: string; sourceNumber?: number }>;
  roles: string[];
  systems: string[];
  integrations: string[];
  documentRules: string[];
  dashboardNeeds: string[];
  uiNeeds: string[];
  kpis: string[];
  risks: string[];
  openTopics: string[];
  mismatchWarnings: string[];
  quickActions: string[];
  confidence: number;
}

export interface DocumentSelfReviewRepairResult {
  document: DocumentData;
  before: DocumentQualityGateResult;
  appliedRepairs: string[];
}

const REPAIR_START = '<!-- AI_SELF_REVIEW_REPAIR_START -->';
const REPAIR_END = '<!-- AI_SELF_REVIEW_REPAIR_END -->';
const DEEPENING_START = '<!-- AI_MINIMUM_BA_DEEPENING_START -->';
const DEEPENING_END = '<!-- AI_MINIMUM_BA_DEEPENING_END -->';
const REVIEW_START = '<!-- AI_SELF_REVIEW_REPAIR_REVIEW_START -->';
const REVIEW_END = '<!-- AI_SELF_REVIEW_REPAIR_REVIEW_END -->';

function escapeHtml(value = ''): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

function replaceMarkedBlock(content: string, block: string, startMarker: string, endMarker: string): string {
  const current = content || '';
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) return current.replace(blockRegex, block);
  return [current.trim(), block].filter(Boolean).join('\n\n');
}

function cell(value: string): string {
  return `<td>${escapeHtml(value || '[ACIK KONU]')}</td>`;
}

function table(headers: string[], rows: string[][]): string {
  return [
    '<table>',
    `<thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>`,
    '<tbody>',
    ...rows.map(row => `<tr>${row.map(cell).join('')}</tr>`),
    '</tbody>',
    '</table>',
  ].join('');
}

function list(items: string[], fallback = '[ACIK KONU]'): string {
  const values = items.length ? items : [fallback];
  return `<ul>${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function sourceSummary(report: SourceIntelligenceReport): string {
  return uniq([
    report.inferredProjectName || '',
    ...report.processes.map(process => process.title),
    ...report.systems,
    ...report.integrations,
    ...report.roles,
  ]).slice(0, 12).join(' | ') || '[ACIK KONU] Kaynak omurgasi zayif.';
}

function projectName(report: SourceIntelligenceReport): string {
  return report.inferredProjectName || '[ACIK KONU] Proje adi is birimiyle netlestirilmeli';
}

function processCandidates(report: SourceIntelligenceReport): string[] {
  if (report.processes.length) return report.processes.map(process => process.title);
  return deriveProcessCandidates({
    roles: report.roles,
    systems: report.systems,
    integrations: report.integrations,
    documentRules: report.documentRules,
    dashboardNeeds: report.dashboardNeeds,
    uiNeeds: report.uiNeeds,
    kpis: report.kpis,
    openTopics: report.openTopics,
    minCount: report.integrations.length || report.systems.length ? 3 : 2,
  });
}

function actorCandidates(report: SourceIntelligenceReport): string[] {
  return report.roles.length ? report.roles : ['[VARSAYIM] Is birimi', '[VARSAYIM] Operasyon', '[VARSAYIM] IT', '[VARSAYIM] Destek ekibi'];
}

function systemCandidates(report: SourceIntelligenceReport): string[] {
  return report.systems.length ? report.systems : ['[ACIK KONU] Kaynak sistem', '[ACIK KONU] Hedef sistem'];
}

function buildIdentityRows(report: SourceIntelligenceReport): string[][] {
  return [
    ['Proje Ismi', projectName(report)],
    ['Musteri Ismi', '[ACIK KONU]'],
    ['Proje Yoneticisi', '[ACIK KONU]'],
    ['Kapsam Yoneticisi', '[ACIK KONU]'],
    ['Is Uygulamalari Sorumlusu', '[ACIK KONU]'],
    ['IT Sorumlusu', '[ACIK KONU]'],
    ['Cozum Mimari', '[ACIK KONU]'],
    ['Kaynak Omurgasi', sourceSummary(report)],
  ];
}

function buildScopeRows(report: SourceIntelligenceReport): string[][] {
  return [
    ['Kapsam ici', uniq([...processCandidates(report), ...systemCandidates(report), ...report.integrations, ...report.uiNeeds]).join(' | ')],
    ['Kapsam disi', '[ACIK KONU] Ilk surum disinda kalacak ekran, entegrasyon, rapor ve operasyon aksiyonlari is birimiyle netlestirilmelidir.'],
    ['Varsayimlar', uniq([
      !report.processes.length ? '[VARSAYIM] Surec omurgasi domain sinyallerinden turetilmistir.' : '',
      !report.roles.length ? '[VARSAYIM] Rol/RACI taslak olarak verilmistir.' : '',
      !report.kpis.length ? '[VARSAYIM] KPI hedefleri taslak metrik olarak yazilmistir.' : '',
    ]).join(' | ') || 'Kaynak sinyalleri yeterli; varsayimlar review bolumunde ayrica izlenir.'],
  ];
}

function buildRequirementRows(report: SourceIntelligenceReport): string[][] {
  const processes = processCandidates(report);
  const systems = systemCandidates(report);
  const integrations = report.integrations.length ? report.integrations : ['[ACIK KONU] Entegrasyon modeli netlestirilmeli'];
  const uiNeeds = report.uiNeeds.length ? report.uiNeeds : ['[VARSAYIM] Zorunlu alan, hata, toast ve bilgi mesajlari tasarlanacak'];
  const docs = report.documentRules.length ? report.documentRules : ['[ACIK KONU] Zorunlu dokuman/evrak matrisi netlestirilmeli'];
  return [
    ['BR-01', 'Is kurali', `Surec kapanisi icin kritik is kurallari tanimli olmalidir: ${docs.join(' | ')}.`, 'Yuksek', 'Kural ihlalinde islem durur veya gerekceli uyari verilir.'],
    ['FR-01', 'Fonksiyonel', `Kullanici ana surecleri sistemde baslatabilir, takip edebilir ve kapatabilir: ${processes.join(' | ')}.`, 'Yuksek', 'Her surec icin tetikleyici, adim, sorumlu ve kapanis kriteri gorunur.'],
    ['INT-01', 'Entegrasyon', `Sistemler arasi veri ve statu akisi tasarlanmalidir: ${uniq([...systems, ...integrations]).join(' | ')}.`, 'Yuksek', 'Basarili ve hatali aktarimlar izlenebilir olur.'],
    ['UI-01', 'Ekran/UX', `Ekran davranislari ve mesajlar tanimli olmalidir: ${uiNeeds.join(' | ')}.`, 'Orta', 'Kullanici eksik veya hatali islemde anlasilir mesaj gorur.'],
    ['VAL-01', 'Validasyon', 'Zorunlu alan, format, durum gecisi ve belge kontrol validasyonlari uygulanmalidir.', 'Yuksek', 'Eksik veri veya gecersiz durumla surec ilerlemez.'],
    ['SEC-01', 'Yetki', `Rol bazli yetki ve erisim kurali tanimlanmalidir: ${actorCandidates(report).join(' | ')}.`, 'Yuksek', 'Yetkisiz kullanici kritik aksiyon alamaz.'],
    ['DATA-01', 'Veri', 'Ana veri sahibi, alan zorunlulugu, veri tipi ve audit ihtiyaci belirtilmelidir.', 'Yuksek', 'Her kritik alan icin sahiplik ve dogrulama kuralı olur.'],
    ['NFR-01', 'NFR', 'Performans, loglama, audit, guvenlik, retry ve erisilebilirlik beklentileri yazilmalidir.', 'Orta', 'Operasyonel takip ve hata cozumu SLA icinde yapilabilir.'],
    ['RPT-01', 'Raporlama', `Dashboard/KPI ihtiyaci raporlanmalidir: ${uniq([...report.dashboardNeeds, ...report.kpis]).join(' | ') || '[VARSAYIM] surec durumu, hata, gecikme ve acik gorevler'}.`, 'Orta', 'Rapor kullanicisi acik isleri, gecikmeleri ve KPI durumunu gorur.'],
    ['TEST-01', 'UAT/Test', 'Pozitif, negatif, yetki, entegrasyon hata ve regresyon senaryolari UAT kapsaminda test edilmelidir.', 'Yuksek', 'Kritik senaryolar basariyla tamamlanmadan onay verilmez.'],
    ['OPS-01', 'Operasyon', 'Canli sonrasi destek, hata is listesi, sorumlu ekip ve geri alma/rollback plani tanimlanmalidir.', 'Orta', 'Canli sonrasi acik hata ve operasyon devri izlenebilir olur.'],
    ['KPI-01', 'KPI', report.kpis.length ? report.kpis.join(' | ') : '[VARSAYIM] Surec tamamlanma suresi, hata orani, manuel is yuku, SLA uyumu ve acik konu kapanma suresi izlenir.', 'Orta', 'KPI panosu veya periyodik raporla olcum yapilir.'],
  ];
}

function buildKpiRows(report: SourceIntelligenceReport): string[][] {
  const kpis = report.kpis.length ? report.kpis : [
    '[VARSAYIM] Surec tamamlanma suresi',
    '[VARSAYIM] Hata orani',
    '[VARSAYIM] Manuel mudahale sayisi',
    '[VARSAYIM] Acik konu kapanma suresi',
    '[VARSAYIM] SLA uyum orani',
  ];
  return kpis.slice(0, 8).map((kpi, index) => [
    `KPI-${String(index + 1).padStart(2, '0')}`,
    kpi,
    '[ACIK KONU] Hedef esik is birimiyle netlestirilmeli',
    '[VARSAYIM] Sistem raporu / dashboard / operasyon kaydi',
  ]);
}

function buildProcessDeepeningSections(report: SourceIntelligenceReport): string {
  return processCandidates(report).slice(0, 6).map((process, index) => [
    `<h3>SUREC MODELI - ${index + 1} "${escapeHtml(process)}"</h3>`,
    table(['Baslik', 'Tasarim Notu'], [
      ['Ust Duzey Surec Aciklamasi', `${process} kapsaminda aktor, tetikleyici, veri, belge, kontrol, entegrasyon ve kapanis kriteri birlikte tasarlanir.`],
      ['Tetikleyici', '[ACIK KONU] Sureci baslatan olay, kullanici aksiyonu veya sistem tetikleyicisi netlestirilmelidir.'],
      ['Happy path / ana akis', 'Kayit/talep alinir, zorunlu kontroller uygulanir, ilgili rol veya sistem aksiyon alir, sonuc kayit altina alinir.'],
      ['Alternatif akis', '[VARSAYIM] Eksik veri, bekleyen onay, manuel duzeltme veya yeniden isleme gerektiren durumlarda alternatif akis calisir.'],
      ['Istisna / negatif senaryo', '[VARSAYIM] Yetkisiz islem, eksik belge, hatali veri, entegrasyon hatasi veya SLA asimi durumunda islem durdurulur ve kullanici/operasyon bilgilendirilir.'],
      ['Cikis kosulu', 'Sorumlu rol, zorunlu veri, belge ve kontrol kriterlerini tamamladiginda surec kapanir veya sonraki surece aktarilir.'],
    ]),
  ].join('\n')).join('\n');
}

function buildMinimumBaDeepeningBlock(report: SourceIntelligenceReport, before: DocumentQualityGateResult): string {
  return [
    DEEPENING_START,
    '<section>',
    '<h2>AI Minimum BA Derinlestirme Govdesi</h2>',
    '<p>Bu govde, ilk uretim yeterince karar verilebilir degilse otomatik eklenir. Amac sadece kalite notu yazmak degil, ana BA dokumanina uygulanabilir bir iskelet ve gereksinim omurgasi kazandirmaktir.</p>',
    `<p><strong>Repair oncesi kalite:</strong> ${before.score}/100</p>`,
    '<h3>PROJE KIMLIK KARTI</h3>',
    table(['Alan', 'Deger'], buildIdentityRows(report)),
    '<h3>Amac ve Beklenen Fayda</h3>',
    '<p>Beklenen fayda; is surecinin izlenebilir, test edilebilir, rol ve sistem sorumluluklari belirli, operasyonel olarak takip edilebilir bir hedef tasarima donusmesidir. Kaynakta dogrulanmayan maddeler [VARSAYIM] veya [ACIK KONU] olarak ayrilir.</p>',
    '<h3>Kapsam, Kapsam Disi ve Varsayimlar</h3>',
    table(['Alan', 'Deger'], buildScopeRows(report)),
    '<h3>Paydas / Rol Adaylari</h3>',
    table(['Rol', 'Sorumluluk', 'Kaynak Durumu'], actorCandidates(report).map(role => [role, 'Surec aksiyonu, karar, onay, takip veya destek sorumlulugu netlestirilmelidir.', role.includes('[VARSAYIM]') ? 'VARSAYIM' : 'CIKARIM'])),
    '<h3>As-Is / To-Be Fark Analizi</h3>',
    table(['Boyut', 'Mevcut Durum / As-Is', 'Hedef Durum / To-Be'], [
      ['Surec', sourceSummary(report), 'Her ana surec icin tetikleyici, aktor, adim, karar, istisna ve kapanis kriteri yazilir.'],
      ['Veri', systemCandidates(report).join(' | '), 'Ana veri sahibi, alan zorunlulugu, format ve audit ihtiyaci netlestirilir.'],
      ['Operasyon', report.dashboardNeeds.join(' | ') || '[ACIK KONU] Operasyon takip ihtiyaci net degil.', 'Dashboard, acik is listesi, SLA, hata listesi ve sorumlu ekip gorunur olur.'],
      ['Kontrol', report.documentRules.join(' | ') || '[ACIK KONU] Kontrol ve belge kurallari net degil.', 'Is kurali, validasyon, yetki ve belge kapanis kurallari uygulanir.'],
    ]),
    '<h3>Surec Modeli Bloklari</h3>',
    buildProcessDeepeningSections(report),
    '<h3>Is Gerekleri ve KPIs</h3>',
    table(['Kod', 'Tur', 'Aciklama', 'Oncelik', 'Kabul Kriteri'], buildRequirementRows(report)),
    '<h3>KPI ve Olcumleme</h3>',
    table(['Kod', 'Metrik', 'Hedef', 'Veri Kaynagi'], buildKpiRows(report)),
    '<h3>Ekran, Validasyon ve Kullanici Mesajlari</h3>',
    table(['Alan', 'Beklenen Davranis'], [
      ['Zorunlu alan', 'Eksik kritik veri varsa kullaniciya acik mesaj verilir ve islem ilerletilmez.'],
      ['Toast / uyari mesaj', 'Basarili kayit, eksik bilgi, entegrasyon hatasi ve yetki ihlali icin ayri mesajlar tasarlanir.'],
      ['Bos durum', 'Liste veya dashboardda veri yoksa kullaniciya sonraki aksiyon gosterilir.'],
      ['Hata durumu', 'Teknik hata kullaniciya sade, operasyona izlenebilir hata kodu/log ile aktarilir.'],
    ]),
    '<h3>Entegrasyon, Hata Yonetimi ve Audit</h3>',
    table(['Konu', 'Kural'], [
      ['Entegrasyon modeli', report.integrations.join(' | ') || '[ACIK KONU] Senkron/asenkron/batch karari netlestirilmelidir.'],
      ['Retry ve hata is listesi', '[VARSAYIM] Gecici hatalar tekrar denenir; kalici hatalar operasyon is listesine duser.'],
      ['Audit log', '[VARSAYIM] Kritik aksiyonlarda kullanici, zaman, onceki/sonraki deger ve sonuc loglanir.'],
      ['Guvenlik', '[VARSAYIM] Rol bazli yetki, hassas veri maskeleme ve erisim kaydi uygulanir.'],
    ]),
    '<h3>Dokuman Yonetimi ve Zorunlu Belgeler</h3>',
    table(['Konu', 'Beklenen Kural'], [
      ['Zorunlu dokuman matrisi', report.documentRules.join(' | ') || '[ACIK KONU] Hangi belge/dokuman olmadan surecin ilerleyemeyecegi netlestirilmelidir.'],
      ['Dosya turu ve boyut', '[ACIK KONU] Kabul edilen dosya turleri, maksimum boyut, versiyonlama ve arsiv kurallari belirlenmelidir.'],
      ['Belge validasyonu', '[VARSAYIM] Eksik, suresi gecmis veya hatali belge yuklendiginde kullanici uyarilir ve kritik surec kapanisi engellenir.'],
      ['Erisim ve saklama', '[VARSAYIM] Belge erisimi rol bazli olur; saklama suresi ve audit ihtiyaci kurum politikalarina gore uygulanir.'],
    ]),
    '<h3>Test / UAT ve Kabul Kriterleri</h3>',
    table(['Senaryo', 'Beklenen Sonuc'], [
      ['Pozitif ana akis', 'Kullanici gerekli veri ve belgelerle sureci baslatir, ilerletir ve kapatir.'],
      ['Negatif validasyon', 'Eksik veya hatali veri ile islem ilerlemez, kullanici anlasilir uyari gorur.'],
      ['Yetki testi', 'Yetkisiz rol kritik aksiyon alamaz; deneme audit loga yansir.'],
      ['Entegrasyon hata testi', 'Hata durumunda retry, hata listesi ve operasyon bildirimi calisir.'],
      ['Raporlama testi', 'Dashboard/KPI verileri beklenen filtre ve durumlarla gorunur.'],
    ]),
    '<h3>Degisim Yonetimi</h3>',
    list([
      '[VARSAYIM] UAT onayi alinmadan canli gecis yapilmaz.',
      '[VARSAYIM] Is birimi, IT, operasyon ve destek ekipleri icin egitim ve duyuru plani hazirlanir.',
      '[VARSAYIM] Pilot kullanim, canli gecis, rollback ve operasyon devri sorumlularla tanimlanir.',
      '[ACIK KONU] Onaylayan kisiler, canli gecis tarihi ve destek modeli netlestirilmelidir.',
    ]),
    '</section>',
    DEEPENING_END,
  ].join('\n');
}

function problemRows(report: SourceIntelligenceReport): string[][] {
  const processNames = report.processes.map(process => process.title);
  const signals = uniq([
    ...report.documentRules,
    ...report.dashboardNeeds,
    ...report.uiNeeds,
    ...report.integrations,
  ]);

  return [
    [
      'Is problemi / ihtiyac',
      report.inferredProjectName
        ? `${report.inferredProjectName} kapsaminda surec, rol, belge, ekran, veri ve takip kurallari karar verilebilir seviyede modellenmeli.`
        : '[ACIK KONU] Kullanici talebi cozum ifadesi olabilir; asil is problemi netlestirilmelidir.',
      report.inferredProjectName ? 'CIKARIM' : 'ACIK KONU',
    ],
    [
      'Mevcut durum / As-Is',
      processNames.length || report.systems.length
        ? `Kaynak izleri: ${uniq([...processNames, ...report.systems]).join(' | ')}.`
        : '[ACIK KONU] Mevcut akis, kullanilan sistemler ve operasyon sorumlulugu net degil.',
      processNames.length || report.systems.length ? 'DOGRULANDI/CIKARIM' : 'ACIK KONU',
    ],
    [
      'Hedef durum / To-Be',
      signals.length
        ? `Hedef tasarimda su izler surece baglanmali: ${signals.join(' | ')}.`
        : '[VARSAYIM] Hedef durum, surec omurgasi ve karar kurallariyla izlenebilir kavramsal tasarim olusturmaktir.',
      signals.length ? 'CIKARIM' : 'VARSAYIM',
    ],
    [
      'Basari KPI / olcum',
      report.kpis.length
        ? report.kpis.join(' | ')
        : '[VARSAYIM] Acik konu kapanma suresi, hata orani, manuel is yuku, surec tamamlanma suresi ve SLA uyumu olculmelidir.',
      report.kpis.length ? 'CIKARIM' : 'VARSAYIM',
    ],
  ];
}

function gapRows(report: SourceIntelligenceReport): string[][] {
  const rows: string[][] = [];
  if (!report.processes.length) {
    rows.push([
      'Ana surec modeli ve tetikleyici sirasi',
      'high',
      'expensive',
      'Hayir',
      'Ana surec hangi tetikleyiciyle baslar, hangi adimlardan gecer ve hangi kosulda kapanir?',
    ]);
  }
  if (!report.roles.length) {
    rows.push([
      'Rol/RACI ve karar sahipleri',
      'medium',
      'moderate',
      'Evet, isaretli varsayimla',
      'Karar veren, uygulayan, onaylayan ve izleyen roller kimlerdir?',
    ]);
  }
  if (!report.systems.length) {
    rows.push([
      'Kaynak/hedef sistemler ve veri sahipligi',
      'high',
      'expensive',
      'Hayir',
      'Kaynak sistem, hedef sistem ve ana veri sahibi hangi uygulamadir?',
    ]);
  }
  if (!report.integrations.length) {
    rows.push([
      'Entegrasyon modeli ve hata davranisi',
      'high',
      'expensive',
      'Hayir',
      'Entegrasyon senkron mu, asenkron mu, batch mi; retry ve audit sorumlulugu kimdedir?',
    ]);
  }
  if (!report.documentRules.length) {
    rows.push([
      'Zorunlu belge/dokuman kapanis kurallari',
      'high',
      'expensive',
      'Hayir',
      'Hangi belge olmadan surec ilerleyemez veya kapanamaz?',
    ]);
  }
  if (!report.uiNeeds.length) {
    rows.push([
      'Ekran davranislari, validasyon ve kullanici mesajlari',
      'medium',
      'moderate',
      'Evet, isaretli varsayimla',
      'Kullanici hangi ekranda hangi aksiyonu alacak ve hangi uyarilari gorecek?',
    ]);
  }
  if (!report.kpis.length) {
    rows.push([
      'Basari KPI ve hedef esikler',
      'medium',
      'moderate',
      'Evet, isaretli varsayimla',
      'Basari hangi metrikler ve hangi hedef esiklerle olculecek?',
    ]);
  }
  return rows.length ? rows : [[
    'Kritik eksik karar',
    'low',
    'easy',
    'Evet',
    'Kaynakta kritik bosluk gorunmuyor; detaylar UAT ve onay asamasinda netlestirilir.',
  ]];
}

function coverageRows(report: SourceIntelligenceReport): string[][] {
  const processNames = report.processes.map(process => process.title);
  const exceptionEvidence = uniq([...report.risks, ...report.openTopics]);
  return [
    ['Aktor / rol / paydas', report.roles.length ? 'partial/covered' : 'missing', report.roles.join(' | ') || '[ACIK KONU] Rol/RACI eksik.'],
    ['Happy path / ana akis', processNames.length ? 'covered' : 'missing', processNames.join(' | ') || '[ACIK KONU] Ana akis net degil.'],
    ['Alternatif akis ve istisna / negatif senaryo', exceptionEvidence.length ? 'partial' : 'missing', exceptionEvidence.join(' | ') || '[ACIK KONU] Istisna ve negatif senaryolar yazilmali.'],
    ['Is kurali', report.documentRules.length || processNames.length ? 'partial/covered' : 'missing', uniq([...report.documentRules, ...processNames]).join(' | ') || '[ACIK KONU] Is kurallari net degil.'],
    ['Validasyon ve kullanici mesaji', report.uiNeeds.length || report.documentRules.length ? 'partial' : 'missing', uniq([...report.uiNeeds, ...report.documentRules]).join(' | ') || '[ACIK KONU] Validasyon ve mesajlar eksik.'],
    ['Yetki', report.roles.length ? 'partial' : 'missing', report.roles.join(' | ') || '[ACIK KONU] Yetki matrisi eksik.'],
    ['Veri gereksinimi', report.systems.length || report.documentRules.length ? 'partial' : 'missing', uniq([...report.systems, ...report.documentRules]).join(' | ') || '[ACIK KONU] Veri sahipligi ve alanlar eksik.'],
    ['Entegrasyon', report.integrations.length ? 'covered' : 'missing', report.integrations.join(' | ') || '[ACIK KONU] Entegrasyon modeli eksik.'],
    ['NFR', report.risks.length || report.integrations.length ? 'partial' : 'missing', uniq([...report.risks, ...report.integrations]).join(' | ') || '[VARSAYIM] Performans, logging, retry, guvenlik ve erisilebilirlik yazilmali.'],
    ['Raporlama / KPI', report.dashboardNeeds.length || report.kpis.length ? 'partial/covered' : 'missing', uniq([...report.dashboardNeeds, ...report.kpis]).join(' | ') || '[VARSAYIM] Raporlama ve KPI seti taslaklanmali.'],
    ['Audit / log / izlenebilirlik', report.documentRules.length || report.risks.length ? 'partial' : 'missing', uniq([...report.documentRules, ...report.risks]).join(' | ') || '[VARSAYIM] Audit log ve izlenebilirlik gereksinimi eklenmeli.'],
  ];
}

function buildBusinessRepairBlock(report: SourceIntelligenceReport, before: DocumentQualityGateResult): string {
  return [
    REPAIR_START,
    '<section>',
    '<h2>AI Self-Review ve Repair: Problem Modeli</h2>',
    '<p>Bu blok, ilk uretimden sonra dokumanda eksik kalan dusunce omurgasini tamamlamak icin otomatik eklenmistir. Amac, dokumani sadece baslikli bir taslak olmaktan cikarip karar verilebilir analiz seviyesine yaklastirmaktir.</p>',
    `<p><strong>Kaynak ozeti:</strong> ${escapeHtml(sourceSummary(report))}</p>`,
    `<p><strong>Ilk kalite puani:</strong> ${before.score}/100. <strong>Onarim gerekcesi:</strong> ${escapeHtml(before.missingSections.slice(0, 6).join(', ') || before.reason)}</p>`,
    '<h3>Problem Modeli / As-Is / To-Be / KPI</h3>',
    table(['Alan', 'Deger', 'Kaynak Durumu'], problemRows(report)),
    '<h3>Eksik Karar ve Bilgi Boslugu Etki Matrisi</h3>',
    table(['Eksik karar', 'Etki', 'Geri donus maliyeti', 'Varsayilabilir mi?', 'Soru / Aksiyon'], gapRows(report)),
    '<h3>Analiz Coverage Kontrolu</h3>',
    table(['Kapsam', 'Durum', 'Kanıt / Eksik'], coverageRows(report)),
    '<h3>Uretim Sonrasi Zorunlu Tutarlilik Kontrolleri</h3>',
    list([
      'Her kritik iddia DOGRULANDI, CIKARIM, VARSAYIM, ACIK KONU veya CELISKI olarak ayrilmalidir.',
      'Yuksek etkili ve geri donusu pahali kararlar sessizce varsayilmamalidir.',
      'Problem, mevcut durum, hedef durum, is kurallari, validasyon, yetki, veri, entegrasyon, audit log ve UAT birbirine baglanmalidir.',
      'Kod veya teknik uygulanabilirlik iddiasi varsa build/test/log kaniti olmadan kesin ifade kullanilmamalidir.',
    ]),
    '</section>',
    REPAIR_END,
  ].join('\n');
}

function buildReviewRepairBlock(report: SourceIntelligenceReport, before: DocumentQualityGateResult, appliedRepairs: string[]): string {
  return [
    REVIEW_START,
    '<section>',
    '<h2>AI Self-Review / Repair Log</h2>',
    `<p><strong>Repair oncesi kalite:</strong> ${before.score}/100</p>`,
    '<h3>Uygulanan Onarimlar</h3>',
    list(appliedRepairs),
    '<h3>Kalan Acik Konular</h3>',
    list(uniq([
      ...report.openTopics,
      ...gapRows(report).filter(row => row[3] === 'Hayir').map(row => `${row[0]}: ${row[4]}`),
    ]), 'Kritik acik konu gorunmuyor.'),
    '<h3>EvidenceClaim Ozeti</h3>',
    table(['Iddia', 'Durum', 'Kullanim'], [
      ['Kaynak omurgasi', report.confidence >= 55 ? 'DOGRULANDI/CIKARIM' : 'ACIK KONU', sourceSummary(report)],
      ['Surec modeli', report.processes.length ? 'DOGRULANDI' : 'VARSAYIM/ACIK KONU', report.processes.map(process => process.title).join(' | ') || 'Kaynakta surec listesi yok.'],
      ['Sistem/entegrasyon', report.systems.length || report.integrations.length ? 'CIKARIM' : 'ACIK KONU', uniq([...report.systems, ...report.integrations]).join(' | ') || 'Sistem ve entegrasyon net degil.'],
      ['KPI/UI/Raporlama', report.kpis.length || report.uiNeeds.length || report.dashboardNeeds.length ? 'CIKARIM/VARSAYIM' : 'ACIK KONU', uniq([...report.kpis, ...report.uiNeeds, ...report.dashboardNeeds]).join(' | ') || 'Olcum ve ekran davranislari net degil.'],
    ]),
    '</section>',
    REVIEW_END,
  ].join('\n');
}

function shouldRepair(before: DocumentQualityGateResult): boolean {
  if (before.score < 85 || !before.canPublishToPanel) return true;
  return before.missingSections.some(item => (
    /Problem modeli|Eksik bilgi etki|Analiz coverage/i.test(item)
  ));
}

export function repairDocumentWithSelfReview(
  input: DocumentData,
  sourceReport: SourceIntelligenceReport,
): DocumentSelfReviewRepairResult {
  const before = evaluateDocumentQualityGate(input);
  if (!shouldRepair(before)) {
    return { document: input, before, appliedRepairs: [] };
  }

  const appliedRepairs = uniq([
    before.score < 85 ? 'Minimum BA derinlestirme govdesi eklendi: proje kimlik karti, kapsam, As-Is/To-Be, surec modeli, gereksinim, KPI, UI, entegrasyon, UAT ve degisim yonetimi.' : '',
    before.missingSections.includes('Problem modeli / As-Is / To-Be / KPI') ? 'ProblemFrame eklendi: is problemi, mevcut durum, hedef durum ve KPI baglandi.' : '',
    before.missingSections.includes('Eksik bilgi etki matrisi') ? 'InformationGap matrisi eklendi: etki, geri donus maliyeti, varsayilabilirlik ve kritik sorular ayrildi.' : '',
    before.missingSections.includes('Analiz coverage kontrolu') ? 'AnalysisCoverage tablosu eklendi: aktor, akis, istisna, is kurali, validasyon, yetki, veri, entegrasyon, NFR, raporlama ve audit kontrol edildi.' : '',
    before.score < 80 ? 'Dusuk kalite puani nedeniyle otomatik self-review repair uygulandi.' : '',
  ]);
  const deepenedBusinessContent = replaceMarkedBlock(
    input.businessAnalysis?.content || '',
    buildMinimumBaDeepeningBlock(sourceReport, before),
    DEEPENING_START,
    DEEPENING_END,
  );

  const document: DocumentData = {
    ...input,
    businessAnalysis: {
      ...(input.businessAnalysis || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        deepenedBusinessContent,
        buildBusinessRepairBlock(sourceReport, before),
        REPAIR_START,
        REPAIR_END,
      ),
      status: input.businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([
        ...(input.businessAnalysis?.flags || []),
        'AI_SELF_REVIEW_REPAIRED',
      ])),
    },
    review: {
      ...(input.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        input.review?.content || '',
        buildReviewRepairBlock(sourceReport, before, appliedRepairs),
        REVIEW_START,
        REVIEW_END,
      ),
      status: input.review?.status || 'NEEDS_REVISION',
      flags: Array.from(new Set([
        ...(input.review?.flags || []),
        'AI_SELF_REVIEW_REPAIRED',
      ])),
    },
    suggestions: Array.from(new Set([
      ...(input.suggestions || []),
      'AI self-review onarimini incele',
      'Eksik karar etki matrisindeki high/expensive konulari netlestir',
      'Coverage tablosundaki missing/partial alanlari tamamla',
    ])),
  };

  return { document, before, appliedRepairs };
}
