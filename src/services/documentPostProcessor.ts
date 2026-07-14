import { marked } from 'marked';
import type { DocumentData, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  changedSections: string[];
}

export interface DocumentPostProcessContext {
  sourceText?: string;
  workspaceTitle?: string;
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  review: 'Review',
};

const QUALITY_BLOCK_START = '<!-- BA_QUALITY_GATE_START -->';
const QUALITY_BLOCK_END = '<!-- BA_QUALITY_GATE_END -->';
const TEMPLATE_GUARD_START = '<!-- WORD_TEMPLATE_GUARD_START -->';
const TEMPLATE_GUARD_END = '<!-- WORD_TEMPLATE_GUARD_END -->';
const TRACEABILITY_START = '<!-- TRACEABILITY_REPAIR_START -->';
const TRACEABILITY_END = '<!-- TRACEABILITY_REPAIR_END -->';

function isHtml(value: string): boolean {
  return /<\/?(h\d|p|table|ul|ol|li|div|section|article|strong|em|pre|code|blockquote|br|span)\b/i.test(value);
}

function looksLikeMarkdown(value: string): boolean {
  return /(^|\n)#{1,4}\s+/.test(value)
    || /\*\*[^*]+\*\*/.test(value)
    || /(^|\n)\s*[-*]\s+/.test(value)
    || /(^|\n)\s*\d+\.\s+/.test(value)
    || /\|\s*[^\n]+\s*\|/.test(value)
    || /```/.test(value);
}

function stripHtml(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(value = ''): string {
  return stripHtml(value)
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
}

export function renderMarkdownToHtml(content = ''): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  if (isHtml(trimmed) && !looksLikeMarkdown(trimmed)) return trimmed;
  return marked.parse(trimmed, { gfm: true, breaks: false }) as string;
}

function replaceMarkedBlock(currentContent: string, nextBlock: string, startMarker: string, endMarker: string): string {
  const current = currentContent || '';
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRegex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');
  if (blockRegex.test(current)) return current.replace(blockRegex, nextBlock);
  return [current.trim(), nextBlock].filter(Boolean).join('\n\n');
}

function normalizeSection(section?: SectionData, existing?: SectionData, parseMarkdown = true): SectionData {
  const incomingContent = section?.content?.trim() || '';
  const existingContent = existing?.content || '';
  const content = incomingContent || existingContent;
  const html = parseMarkdown ? renderMarkdownToHtml(content) : content;
  return {
    content: html,
    status: section?.status || existing?.status || 'DRAFT',
    flags: Array.from(new Set([...(existing?.flags || []), ...(section?.flags || [])])),
  };
}

function sectionsDiffer(a?: SectionData, b?: SectionData): boolean {
  return (a?.content || '') !== (b?.content || '')
    || (a?.status || '') !== (b?.status || '')
    || JSON.stringify(a?.flags || []) !== JSON.stringify(b?.flags || []);
}

function extractLabelValue(source = '', labels: string[]): string | undefined {
  const lines = stripHtml(source).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(new RegExp(`^${label}\\s*[:\\-]\\s*(.{3,160})$`, 'i'));
      if (match?.[1]) return match[1].trim();
    }
  }
  return undefined;
}

function inferProjectName(source = ''): string {
  const explicit = extractLabelValue(source, ['Proje Adi', 'Proje Ismi', 'Project Name', 'Baslik', 'Title']);
  if (explicit) return explicit;
  const lines = stripHtml(source).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidate = lines.find(line => /proje|platform|uygulama|sistem|entegrasyon|bot|donusum|refactor|tasarim/i.test(line) && line.length <= 140);
  return candidate || '[ACIK KONU] Proje adi netlestirilecek';
}

function splitList(value = ''): string[] {
  return value.split(/[;,|\n]+/).map(item => item.trim()).filter(item => item.length >= 2).slice(0, 12);
}

function extractList(source = '', labels: string[]): string[] {
  const found = extractLabelValue(source, labels);
  return found ? splitList(found) : [];
}

function extractProcessTitles(source = ''): string[] {
  const lines = stripHtml(source).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const titles: string[] = [];
  for (const line of lines) {
    const match = line.match(/(?:^|\b)(?:s[uü]re[cç]|surec|process|flow|akis|a[sş]ama|phase)\s*[-#:]?\s*(\d{1,2})\s*(?:[-:.)]\s*|\s+)(.{3,160})$/i);
    if (match?.[2]) titles.push(match[2].trim().replace(/[.;,]+$/, ''));
  }
  if (titles.length) return Array.from(new Set(titles)).slice(0, 18);
  return [
    'Talep alma, niyet ve kapsam belirleme',
    'Cozum tasarimi ve gereksinimlestirme',
    'UAT, onay ve canli gecis hazirligi',
  ];
}

function countProcessModels(content = ''): number {
  const matches = Array.from(normalize(content).matchAll(/surec modeli\s*-\s*(\d+)/gi)).map(match => match[1]);
  return new Set(matches).size;
}

function isTemplateCompliant(content = ''): boolean {
  const normalized = normalize(content);
  return normalized.includes('kavramsal tasarim raporu')
    && normalized.includes('proje kimlik kart')
    && normalized.includes('surec tasarimi')
    && normalized.includes('is gerekleri')
    && countProcessModels(content) >= 2;
}

function buildRequirementsTable(index: number): string {
  const prefix = String(index).padStart(2, '0');
  return [
    '| Kod | Tur | Gereksinim | Kabul Kriteri | KPI / Hedef |',
    '|---|---|---|---|---|',
    `| BR-${prefix}-01 | Is kurali | Surec karar noktalari, rol sorumluluklari ve kapanis kosullari tanimlanir. | Kural ihlalinde islem durur veya gerekceli uyari verilir. | Uyum orani >= %95 |`,
    `| FR-${prefix}-01 | Fonksiyonel | Kullanici sureci baslatir, gunceller, izler ve kapatir. | Zorunlu alanlar tamamlanmadan surec kapanmaz. | Basarili islem orani >= %95 |`,
    `| UI-${prefix}-01 | Ekran | Zorunlu alan, validasyon, bos durum ve hata mesaji davranislari bulunur. | Hata nedeni kullaniciya acik gosterilir. | Hata tekrar orani azalir |`,
    `| INT-${prefix}-01 | Entegrasyon | Ilgili sistem ve servisler hata/retry/log kurgusuyla izlenir. | Basarili ve basarisiz islemler loglanir. | Entegrasyon hata orani <= %2 |`,
    `| NFR-${prefix}-01 | Operasyonel kalite | Performans, guvenlik, loglama, audit ve destek SLA kurallari yazilir. | NFR esikleri UAT ve izleme planina baglanir. | SLA uyumu >= %95 |`,
    `| KPI-${prefix}-01 | KPI | Surec tamamlanma, hata, gecikme ve manuel is yuku metrikleri izlenir. | KPI raporu rol ve surec bazinda gorulur. | Rapor uretimi %100 |`,
    `| TEST-${prefix}-01 | UAT | Pozitif, negatif, yetki, entegrasyon hata ve regresyon senaryolari test edilir. | Kritik acik hata olmadan kabul alinir. | Kritik hata 0 |`,
  ].join('\n');
}

function buildProcessBlock(title: string, index: number): string {
  return [
    `## ${index}. SUREC MODELI - ${index} "${title}"`,
    '',
    `### Surec Modeli - ${index}`,
    `[VARSAYIM] "${title}" sureci hedef operasyon akisina gore kavramsal tasarim seviyesinde tanimlanir.`,
    '',
    '### Bu proje ile birlikte;',
    '- Manuel veya kopuk ilerleyen adimlar izlenebilir akis ve gorev yapisina alinir.',
    '- Hata, onay, bekleme, mutabakat ve raporlama davranislari standartlasir.',
    '- Kaynakta olmayan alanlar [VARSAYIM] veya [ACIK KONU] olarak isaretlenir.',
    '',
    '### Ust Duzey Surec Aciklamasi',
    'Surec; tetikleyici, veri/yetki kontrolu, is kurali validasyonu, sistem/entegrasyon islemi, sonuc guncelleme, hata yonetimi ve raporlama adimlarindan olusur.',
    '',
    '### Surec degisiklikleri',
    '- Kritik karar ve bekleme durumlari loglanir.',
    '- Operasyon ekibine hata is listesi ve retry akisi saglanir.',
    '- Raporlama ve audit ihtiyaclari surec sonunda beslenir.',
    '',
    '### Is Gerekleri ve KPIs',
    buildRequirementsTable(index),
    '',
    '### Detayli Surec Akisi / Akis Diyagrami',
    '1. Tetikleyici kullanici, sistem olayi veya entegrasyon mesaji olarak alinir.',
    '2. Zorunlu alan, rol/yetki, veri formati ve is kurali kontrolleri calisir.',
    '3. Basarili kontrolde ilgili sistem kaydi veya entegrasyon islemi baslatilir.',
    '4. Sonuc ana kayda, tarihceye, log yapisina ve rapor/veri katmanina islenir.',
    '5. Hata durumunda kullanici mesaji, retry veya manuel duzeltme akisi devreye girer.',
    '',
    '### Akis Diyagrami',
    '```mermaid',
    'flowchart TD',
    `  A[Baslangic] --> B["${title}"]`,
    '  B --> C{Validasyon basarili mi?}',
    '  C -- Evet --> D[Sistem / entegrasyon islemi]',
    '  C -- Hayir --> E[Uyari ve duzeltme is listesi]',
    '  D --> F[Raporlama ve kapanis]',
    '  E --> F',
    '```',
    '',
    '### Ilgili Surecler',
    '- Ana operasyon sureci',
    '- Entegrasyon ve veri mutabakat sureci',
    '- Raporlama ve destek sureci',
    '',
    '### Ust Duzey Musteri Gelistirmesi',
    '| Gelistirme No | Gelistirme Tipi | Degisiklik Tipi | Complexity |',
    '|---|---|---|---|',
    `| GEL-${index}01 | Arayuz | Degisiklik | Orta |`,
    `| GEL-${index}02 | Program / Servis | Yeni | Yuksek |`,
    `| GEL-${index}03 | Rapor | Degisiklik | Orta |`,
    `| GEL-${index}04 | Is Akisi / Operasyon Is Listesi | Yeni | Orta |`,
    '',
    '### Onemli Uyarlamalar ve Amaclari',
    '- Parametre, yetki, bildirim ve entegrasyon ayarlari canliya gecis oncesi teyit edilir.',
    '- Hata, retry, audit, raporlama ve bildirim yapilari operasyonel izleme icin standartlastirilir.',
    '',
    '### Degisim Yonetimi',
    '- UAT, egitim, pilot, canli gecis, rollback ve operasyon devri planlanir.',
  ].join('\n');
}

function buildFallbackTemplate(sourceContent: string, sourceContext = sourceContent): string {
  const projectName = inferProjectName(sourceContext || sourceContent);
  const processTitles = extractProcessTitles(sourceContext || sourceContent);
  const today = new Date().toLocaleDateString('tr-TR');
  const roles = extractList(sourceContext, ['Roller', 'Paydaslar', 'Kullanicilar']).join(', ') || '[ACIK KONU] Is birimi, operasyon, IT, destek';
  const systems = extractList(sourceContext, ['Sistemler', 'Uygulamalar']).join(', ') || '[ACIK KONU] Kaynak/hedef sistemler';
  const integrations = extractList(sourceContext, ['Entegrasyonlar', 'Servisler', 'API']).join(', ') || '[VARSAYIM] Entegrasyon modeli netlestirilecek';
  const kpis = extractList(sourceContext, ['KPI', 'Metrikler', 'Basari kriterleri']).join(', ') || '[VARSAYIM] Surec tamamlanma, hata orani, gecikme, manuel is yuku';
  const processBlocks = processTitles.map((title, index) => buildProcessBlock(title, index + 1)).join('\n\n');

  return [
    '# KAVRAMSAL TASARIM RAPORU',
    '',
    '## PROJE KIMLIK KARTI',
    '| Alan | Deger |',
    '|---|---|',
    `| Proje Ismi | ${projectName} |`,
    '| Musteri Ismi | [ACIK KONU] |',
    '| Proje Yoneticisi | [ACIK KONU] |',
    '| Kapsam Yoneticisi | [ACIK KONU] |',
    '| Is Uygulamalari Sorumlusu | [ACIK KONU] |',
    '| IT Sorumlusu | [ACIK KONU] |',
    '| Cozum Mimari | [ACIK KONU] |',
    '',
    '## Amac',
    'Bu dokuman kullanici talebini kurumsal kavramsal tasarim formatinda karar verilebilir seviyeye tasimak icin hazirlanmistir.',
    '',
    '## Dokuman Tarihcesi',
    '### Katilimcilar',
    '| Rol | Isim |',
    '|---|---|',
    '| Proje Yoneticisi | [ACIK KONU] |',
    '| Kapsam Yoneticisi | [ACIK KONU] |',
    '| Is Uygulamalari Sorumlusu | [ACIK KONU] |',
    '| Veri Yonetimi Sorumlusu | [ACIK KONU] |',
    '| IT Sorumlusu | [ACIK KONU] |',
    '| Danisman / Cozum Mimari | [ACIK KONU] |',
    '### Revize tarih',
    '| Tarih | Versiyon | Dokuman Revizyon Aciklamasi | Yazan |',
    '|---|---|---|---|',
    `| ${today} | V0.1 | Ilk kavramsal tasarim taslagi | JetWork AI |`,
    '### Kontrol EDEN VE ONAYLAYAN',
    '| Isim | Pozisyon | Tarih | Imza |',
    '|---|---|---|---|',
    '| [ACIK KONU] | Proje Yoneticisi |  |  |',
    '| [ACIK KONU] | Kapsam Yoneticisi |  |  |',
    '| [ACIK KONU] | IT Lideri |  |  |',
    '| [ACIK KONU] | Is Sureci Sahibi |  |  |',
    '| [ACIK KONU] | QA / UAT Sorumlusu |  |  |',
    '| [ACIK KONU] | Direktor |  |  |',
    '',
    '## ICINDEKILER',
    '- SUREC TASARIMI',
    ...processTitles.map((title, index) => `- ${index + 1}. SUREC MODELI - ${index + 1} "${title}"`),
    '- EK A',
    '',
    '## SUREC TASARIMI',
    sourceContent.trim() || '[VARSAYIM] Surec tasarimi kullanici talebi ve varsayimlarla detaylandirilacaktir.',
    '',
    '### Kaynak Omurga',
    `- Roller: ${roles}`,
    `- Sistemler: ${systems}`,
    `- Entegrasyonlar: ${integrations}`,
    `- KPI: ${kpis}`,
    '',
    processBlocks,
    '',
    '## EK A',
    '### ILGILI / REFERANS DOKUMANLAR',
    '| Dokuman Ismi | Versiyon | Ozet Aciklama |',
    '|---|---|---|',
    '| Kullanici talebi / sohbet | V0.1 | Ana kaynak kabul edilir. |',
    '| Mevzuat / API / sistem dokumanlari | [ACIK KONU] | Konuya gore dogrulanacak referanslar. |',
    '| UAT ve gecis plani | [ACIK KONU] | Test, canli gecis ve operasyon devri referanslari. |',
    '### EKLENTI',
    '| Dokuman Ismi | Versiyon | Ozet Aciklama |',
    '|---|---|---|',
    '| Surec akis diyagramlari | [ACIK KONU] | BPMN/Mermaid veya operasyon akislaridir. |',
    '| Veri eslestirme matrisi | [ACIK KONU] | Alan bazli data mapping ve donusum kurallari. |',
  ].join('\n');
}

function buildTraceabilityBlock(): string {
  return [
    TRACEABILITY_START,
    '## Izlenebilirlik ve Testlenebilirlik Matrisi',
    '| REQ | BR | AC | TC | Not |',
    '|---|---|---|---|---|',
    '| REQ-01 | BR-01-01 | AC-01-01 | TC-01-01 | Ana surec ve is kurali testlenebilir olmalidir. |',
    '| REQ-02 | UI-01-01 | AC-02-01 | TC-02-01 | Validasyon ve kullanici mesajlari UAT kapsaminda olmalidir. |',
    '| REQ-03 | INT-01-01 | AC-03-01 | TC-03-01 | Entegrasyon hata/retry/log davranisi test edilmelidir. |',
    '| REQ-04 | KPI-01-01 | AC-04-01 | TC-04-01 | KPI ve raporlama ciktisi dogrulanmalidir. |',
    TRACEABILITY_END,
  ].join('\n');
}

function buildTemplateGuardBlock(qualityGate: DocumentQualityGateResult): string {
  return renderMarkdownToHtml([
    TEMPLATE_GUARD_START,
    '## Word Template Conformance Guard',
    `- Durum: ${qualityGate.canPublishToPanel ? 'TEMPLATE_READY' : 'REVIEW_REQUIRED'}`,
    `- Kalite puani: ${qualityGate.score}/100`,
    '- Bu guard kavramsal tasarim ciktisinin Word omurgasina, surec modeline, gereksinim/KPI/test izine ve Review ayrimina uyumunu izler.',
    '### Hizli Aksiyonlar',
    '- Word formatina duzelt',
    '- Review acik konularini kapat',
    '- UAT senaryolarini detaylandir',
    TEMPLATE_GUARD_END,
  ].join('\n'));
}

export function postProcessDocumentData(
  incoming: DocumentData,
  existing?: DocumentData | null,
  context: DocumentPostProcessContext = {},
): DocumentPostProcessResult {
  const base = existing || {
    businessAnalysis: { content: '', status: 'DRAFT' as const, flags: [] },
    review: { content: '', status: 'DRAFT' as const, flags: [] },
  };

  const incomingContent = incoming.businessAnalysis?.content || '';
  const sourceContext = [
    context.sourceText || '',
    context.workspaceTitle || '',
    incomingContent,
    existing?.businessAnalysis?.content || '',
  ].filter(Boolean).join('\n\n');
  const needsTemplateRepair = !isTemplateCompliant(incomingContent) || stripHtml(incomingContent).length < 1800;
  const businessAnalysisContent = needsTemplateRepair
    ? buildFallbackTemplate(incomingContent, sourceContext)
    : incomingContent;

  let document: DocumentData = {
    businessAnalysis: normalizeSection({
      content: businessAnalysisContent,
      status: incoming.businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([...(incoming.businessAnalysis?.flags || []), ...(needsTemplateRepair ? ['CONCEPTUAL_TEMPLATE_APPLIED'] : [])])),
    }, base.businessAnalysis, true),
    ...(incoming.review || base.review ? { review: normalizeSection(incoming.review, base.review, true) } : {}),
    suggestions: incoming.suggestions || base.suggestions,
  };

  if (!/REQ-01|Izlenebilirlik ve Testlenebilirlik Matrisi/i.test(stripHtml(document.businessAnalysis.content || ''))) {
    document.businessAnalysis = {
      ...document.businessAnalysis,
      content: replaceMarkedBlock(document.businessAnalysis.content || '', renderMarkdownToHtml(buildTraceabilityBlock()), TRACEABILITY_START, TRACEABILITY_END),
      flags: Array.from(new Set([...(document.businessAnalysis.flags || []), 'TRACEABILITY_REPAIRED'])),
    };
  }

  let qualityGate = evaluateDocumentQualityGate(document);
  document.review = {
    ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
    content: replaceMarkedBlock(
      document.review?.content || '',
      buildTemplateGuardBlock(qualityGate),
      TEMPLATE_GUARD_START,
      TEMPLATE_GUARD_END,
    ),
    status: qualityGate.canPublishToPanel ? (document.review?.status || 'DRAFT') : 'NEEDS_REVISION',
    flags: Array.from(new Set([...(document.review?.flags || []), 'WORD_TEMPLATE_CONFORMANCE_GUARD'])),
  };

  qualityGate = evaluateDocumentQualityGate(document);
  const qualityFlags = [
    ...qualityGate.warnings,
    ...(!qualityGate.canPublishToPanel ? [qualityGate.reason] : []),
  ];

  const qualityBlock = renderMarkdownToHtml([
    QUALITY_BLOCK_START,
    '## BA Analiz Kalite Kapisi',
    `**Kalite Puani:** ${qualityGate.score}/100`,
    `**Durum:** ${qualityGate.canPublishToPanel ? 'Taslak yayinlanabilir' : 'Review gerekli'}`,
    '',
    '### Tamamlanacak veya Zayif Alanlar',
    ...(qualityGate.missingSections.length ? qualityGate.missingSections.map(item => `- ${item}`) : ['- Kritik alan bulunmadi.']),
    '',
    '### Uyarilar',
    ...(qualityFlags.length ? qualityFlags.map(item => `- ${item}`) : ['- Uyari yok.']),
    QUALITY_BLOCK_END,
  ].join('\n'));

  document.review = {
    content: replaceMarkedBlock(document.review?.content || '', qualityBlock, QUALITY_BLOCK_START, QUALITY_BLOCK_END),
    status: qualityGate.canPublishToPanel ? (document.review?.status || 'DRAFT') : 'NEEDS_REVISION',
    flags: Array.from(new Set([...(document.review?.flags || []), ...qualityFlags])),
  };

  document.suggestions = Array.from(new Set([
    ...(document.suggestions || []),
    'Word formatina duzelt',
    'Review acik konularini kapat',
    'UAT senaryolarini detaylandir',
  ]));
  document.score = qualityGate.score;
  document.scoreExplanation = qualityGate.reason;

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, changedSections };
}
