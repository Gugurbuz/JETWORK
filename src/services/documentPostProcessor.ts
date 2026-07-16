import { marked } from 'marked';
import type { DocumentData, SectionData } from '../types';
import { evaluateDocumentQualityGate, type DocumentQualityGateResult } from './documentQualityGate';
import {
  buildBaQualityReviewMarkdown,
  evaluateBaQualityV2,
  replaceBaEngineReviewBlock,
  type BaQualityReportV2,
} from '../modules/ai-ba-engine';
import {
  analyzeSourceIntelligence,
  buildSourceIntelligenceReviewMarkdown,
  normalizeSourceText,
  type SourceIntelligenceReport,
} from './sourceIntelligence';
import { conceptualTemplateCoverage, ensureConceptualTemplateStructure } from './conceptualTemplate';
import { repairDocumentWithSelfReview } from './documentSelfReviewRepair';
import type { AiTurnDecision } from './ai/aiTurnDecision';

export interface DocumentPostProcessResult {
  document: DocumentData;
  qualityGate: DocumentQualityGateResult;
  qualityReportV2: BaQualityReportV2;
  changedSections: string[];
}

export interface DocumentPostProcessContext {
  sourceText?: string;
  workspaceTitle?: string;
  turnDecision?: AiTurnDecision;
}

const SECTION_LABELS: Record<string, string> = {
  businessAnalysis: 'BA Analiz',
  review: 'Review',
};

const LEGACY_QUALITY_BLOCK_START = '<!-- BA_QUALITY_GATE_START -->';
const LEGACY_QUALITY_BLOCK_END = '<!-- BA_QUALITY_GATE_END -->';
const SOURCE_INTELLIGENCE_BLOCK_START = '<!-- SOURCE_INTELLIGENCE_START -->';
const SOURCE_INTELLIGENCE_BLOCK_END = '<!-- SOURCE_INTELLIGENCE_END -->';
const SOURCE_FIDELITY_GUARD_START = '<!-- SOURCE_FIDELITY_GUARD_START -->';
const SOURCE_FIDELITY_GUARD_END = '<!-- SOURCE_FIDELITY_GUARD_END -->';
const SOURCE_FIDELITY_REPAIR_START = '<!-- SOURCE_FIDELITY_REPAIR_START -->';
const SOURCE_FIDELITY_REPAIR_END = '<!-- SOURCE_FIDELITY_REPAIR_END -->';
const TRACEABILITY_GUARD_START = '<!-- TRACEABILITY_GUARD_START -->';
const TRACEABILITY_GUARD_END = '<!-- TRACEABILITY_GUARD_END -->';
const TRACEABILITY_REPAIR_START = '<!-- TRACEABILITY_REPAIR_START -->';
const TRACEABILITY_REPAIR_END = '<!-- TRACEABILITY_REPAIR_END -->';
const ANALYSIS_COVERAGE_GUARD_START = '<!-- ANALYSIS_COVERAGE_GUARD_START -->';
const ANALYSIS_COVERAGE_GUARD_END = '<!-- ANALYSIS_COVERAGE_GUARD_END -->';
const ANALYSIS_COVERAGE_REPAIR_START = '<!-- ANALYSIS_COVERAGE_REPAIR_START -->';
const ANALYSIS_COVERAGE_REPAIR_END = '<!-- ANALYSIS_COVERAGE_REPAIR_END -->';
const OFFICIAL_SOURCE_GUARD_START = '<!-- OFFICIAL_SOURCE_GUARD_START -->';
const OFFICIAL_SOURCE_GUARD_END = '<!-- OFFICIAL_SOURCE_GUARD_END -->';
const WORD_TEMPLATE_GUARD_START = '<!-- WORD_TEMPLATE_GUARD_START -->';
const WORD_TEMPLATE_GUARD_END = '<!-- WORD_TEMPLATE_GUARD_END -->';
const EVIDENCE_POLICY_GUARD_START = '<!-- EVIDENCE_POLICY_GUARD_START -->';
const EVIDENCE_POLICY_GUARD_END = '<!-- EVIDENCE_POLICY_GUARD_END -->';

interface SourceFidelityFinding {
  signal: string;
  expected: string;
  missing: string[];
  action: string;
}

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

function requiresOfficialSourceGuard(sourceReport: ReturnType<typeof analyzeSourceIntelligence>): boolean {
  return sourceReport.domainHints.some(hint => ['iys', 'sap'].includes(hint))
    || sourceReport.integrations.some(item => /api|oauth|sap|iys|mevzuat|kanun|dis/i.test(item));
}

function hasOfficialSourceEvidence(text = ''): boolean {
  return /https?:\/\//i.test(text)
    || /iys\.org\.tr|ahsdocs\.iys\.org\.tr|mevzuat\.gov\.tr|ticaret\.gov\.tr|help\.sap\.com|sap\.com/i.test(text);
}

function buildOfficialSourceGuardMarkdown(): string {
  return [
    OFFICIAL_SOURCE_GUARD_START,
    '## Resmi Kaynak Guard',
    '',
    '- Durum: ACIK KONU / DOGRULAMA GEREKIR',
    '- Bu dokuman mevzuat, SAP, IYS, API veya entegrasyon hassasiyeti tasiyor.',
    '- Review veya kaynak metinde resmi/guncel kaynak kaniti bulunmadigi icin mevzuat/API/sistem limitleri DOGRULANDI sayilmamalidir.',
    '- Kullanilacak aksiyon: resmi kurum, uretici dokumantasyonu veya onayli kurum dokumani ile dogrula; dogrulanmayan maddeleri [VARSAYIM] veya [ACIK KONU] olarak tut.',
    OFFICIAL_SOURCE_GUARD_END,
  ].join('\n');
}

function hasVerifiedClaimLabel(text = ''): boolean {
  return /\bDOGRULANDI\b|\bDOĞRULANDI\b/i.test(text);
}

function shouldRenderEvidencePolicyGuard(decision?: AiTurnDecision): decision is AiTurnDecision {
  return !!decision && (
    decision.sourcePolicy.sourceSensitive
    || decision.sourcePolicy.officialSourceRequired
    || decision.sourcePolicy.requiresExternalResearch
    || !decision.sourcePolicy.canClaimVerified
  );
}

function buildEvidencePolicyGuardMarkdown(
  decision: AiTurnDecision,
  sourceReport: SourceIntelligenceReport,
  corpus = '',
): string {
  const hasOfficialEvidence = hasOfficialSourceEvidence(corpus);
  const verifiedLabelPresent = hasVerifiedClaimLabel(corpus);
  const blockedVerifiedScope = decision.sourcePolicy.officialSourceRequired
    && !decision.sourcePolicy.canClaimVerified;
  const status = blockedVerifiedScope
    ? 'OFFICIAL_EVIDENCE_REQUIRED'
    : decision.sourcePolicy.requiresExternalResearch && !hasOfficialEvidence
      ? 'EVIDENCE_REVIEW_REQUIRED'
      : 'EVIDENCE_POLICY_READY';

  const verifiedScope = decision.sourcePolicy.canClaimVerified
    ? 'DOGRULANDI etiketi kaynak veya guvenilir kanitla desteklenen maddelerde kullanilabilir.'
    : 'DOGRULANDI etiketi yalnizca kullanici kaynaginda acik gorunen is/proje bilgileri icin kullanilabilir; mevzuat/API/SAP/KKB/IYS iddialari ACIK KONU veya VARSAYIM kalmalidir.';

  return [
    EVIDENCE_POLICY_GUARD_START,
    '## Evidence Policy Guard',
    '',
    `- Durum: ${status}`,
    `- Final aksiyon: ${decision.action}`,
    `- Artifact profili: ${decision.artifactProfile.id}`,
    `- Kaynak hassasiyeti: ${decision.sourcePolicy.sourceSensitive ? 'EVET' : 'HAYIR'}`,
    `- Resmi kaynak gerekli: ${decision.sourcePolicy.officialSourceRequired ? 'EVET' : 'HAYIR'}`,
    `- DOGRULANDI iddiasi kurulabilir mi: ${decision.sourcePolicy.canClaimVerified ? 'EVET' : 'HAYIR'}`,
    `- Resmi/guncel kaynak kaniti goruldu mu: ${hasOfficialEvidence ? 'EVET' : 'HAYIR'}`,
    `- Dokumanda DOGRULANDI etiketi var mi: ${verifiedLabelPresent ? 'EVET' : 'HAYIR'}`,
    '',
    '### Uygulama Kurallari',
    `- ${verifiedScope}`,
    '- CIKARIM, modelin kaynak sinyallerinden turettigi ama kesin olmayan yorumlar icin kullanilir.',
    '- VARSAYIM, ilerlemek icin kabul edilen fakat is birimi/onayli dokuman bekleyen maddeler icin kullanilir.',
    '- ACIK KONU, karar etkisi yuksek veya resmi kaynak gerektiren dogrulanmamis maddeler icin kullanilir.',
    '',
    '| Kontrol | Sonuc | Aksiyon |',
    '|---|---|---|',
    `| Kaynak guveni | ${sourceReport.confidence}/100 | Dusuk/orta guvende kritik hukumleri Review acik konusuna bagla. |`,
    `| Resmi kaynak zorunlulugu | ${decision.sourcePolicy.officialSourceRequired ? 'EVET' : 'HAYIR'} | ${decision.sourcePolicy.officialSourceRequired ? 'Resmi kurum/uretici dokumaniyla dogrula.' : 'Genel BA varsayimlari etiketli yazilabilir.'} |`,
    `| DOGRULANDI kapsami | ${decision.sourcePolicy.canClaimVerified ? 'GENIS' : 'SINIRLI'} | ${decision.sourcePolicy.canClaimVerified ? 'Kaynakli iddialari koru.' : 'Mevzuat/API/limit/alan degerlerini ACIK KONU veya VARSAYIM yap.'} |`,
    `| Evidence ledger | ${verifiedLabelPresent || sourceReport.confidence >= 55 ? 'IZLENEBILIR' : 'GELISTIRILECEK'} | Kaynak ve Dogrulama Matrisi ile Copilot Evidence Ledger satirlarini guncelle. |`,
    EVIDENCE_POLICY_GUARD_END,
  ].join('\n');
}

function buildWordTemplateGuardMarkdown(content = ''): string {
  const coverage = conceptualTemplateCoverage(content);
  const openItems = coverage.missing.slice(0, 12);
  const status = openItems.length ? 'TEMPLATE_REPAIR_APPLIED / REVIEW_REQUIRED' : 'TEMPLATE_READY';
  return [
    WORD_TEMPLATE_GUARD_START,
    '## Word Template Conformance Guard',
    '',
    `- Durum: ${status}`,
    `- Şablon kapsama: ${coverage.passed}/${coverage.total}`,
    '- Bu guard, kavramsal tasarım çıktısının şirket Word yapısına yakınlığını ölçer: kimlik kartı, tarihçe, katılımcı/onay tabloları, süreç modeli blokları, iş gerekleri/KPI, uyarlamalar, değişim yönetimi ve EK A.',
    '',
    '| Kontrol Alanı | Durum | Aksiyon |',
    '|---|---|---|',
    ...(openItems.length
      ? openItems.map(item => `| ${escapeTableCell(item)} | REVIEW_REQUIRED | BA Analiz içinde ilgili Word şablon bölümünü tamamla. |`)
      : ['| Word kavramsal tasarım yapısı | PASS | Doküman şablon omurgasını taşıyor. |']),
    '',
    '### Hızlı Aksiyonlar',
    '- Word formatına düzelt',
    '- Şablon uyumunu tamamla',
    '- Süreç modeli bloklarını çoğalt',
    '- Onay ve doküman tarihçesi tablolarını doldur',
    WORD_TEMPLATE_GUARD_END,
  ].join('\n');
}

function importantTokens(value = ''): string[] {
  const stopWords = new Set([
    'icin',
    'ile',
    've',
    'veya',
    'bir',
    'bu',
    'the',
    'and',
    'or',
    'api',
    'servis',
    'service',
    'sistem',
    'sistemi',
    'platform',
    'uygulama',
    'proje',
    'surec',
    'modeli',
  ]);

  return Array.from(new Set(
    normalizeSourceText(value)
      .split(/[^a-z0-9]+/i)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !stopWords.has(token)),
  ));
}

function isSignalRepresented(documentText: string, signal: string, minCoverage = 0.67): boolean {
  const normalizedDocument = normalizeSourceText(documentText);
  const normalizedSignal = normalizeSourceText(signal);
  if (!normalizedSignal || normalizedSignal === '[acik konu]') return true;
  if (normalizedDocument.includes(normalizedSignal)) return true;

  const tokens = importantTokens(signal);
  if (!tokens.length) return true;
  const matched = tokens.filter(token => normalizedDocument.includes(token)).length;
  const requiredCoverage = tokens.length <= 2 ? 1 : minCoverage;
  return matched / tokens.length >= requiredCoverage;
}

function compactList(items: string[], limit = 8): string {
  const visible = items.slice(0, limit);
  const suffix = items.length > limit ? ` +${items.length - limit} tamamlanacak` : '';
  return `${visible.join(', ')}${suffix}`;
}

function escapeTableCell(value = ''): string {
  return value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function evaluateSourceFidelity(
  sourceReport: ReturnType<typeof analyzeSourceIntelligence>,
  businessAnalysisContent = '',
): SourceFidelityFinding[] {
  const findings: SourceFidelityFinding[] = [];
  const hasSourceBackbone = !!sourceReport.inferredProjectName
    || sourceReport.processes.length > 0
    || sourceReport.systems.length > 0
    || sourceReport.integrations.length > 0
    || sourceReport.roles.length > 0
    || sourceReport.uiNeeds.length > 0
    || sourceReport.kpis.length > 0;

  if (!hasSourceBackbone || !businessAnalysisContent.trim()) return findings;

  if (
    sourceReport.inferredProjectName
    && !isSignalRepresented(businessAnalysisContent, sourceReport.inferredProjectName, 0.75)
  ) {
    findings.push({
      signal: 'Proje adi / ana baglam',
      expected: sourceReport.inferredProjectName,
      missing: [sourceReport.inferredProjectName],
      action: 'BA dokumaninin Proje Kimlik Karti, amac ve kapsam bolumlerini kaynak proje adiyla yeniden kur.',
    });
  }

  const processItems = sourceReport.processes.map(process => process.title).filter(Boolean);
  const missingProcesses = processItems.filter(item => !isSignalRepresented(businessAnalysisContent, item, 0.75));
  const processThreshold = processItems.length <= 5 ? 1 : Math.ceil(processItems.length * 0.25);
  if (missingProcesses.length >= processThreshold) {
    findings.push({
      signal: 'Kaynak surec omurgasi',
      expected: `${processItems.length} surec modelinin BA dokumaninda ayri bloklar halinde yer almasi`,
      missing: missingProcesses,
      action: 'Süreçleri SUREC MODELI bloklari olarak ekle; her biri icin akis, is kurali, KPI, uyarlama ve acik konu yaz.',
    });
  }

  const groupedSignals: Array<{
    signal: string;
    expected: string;
    items: string[];
    minCoverage?: number;
    action: string;
  }> = [
    {
      signal: 'Roller / aktorler',
      expected: 'Aktorlere gore sorumluluk, yetki ve is akisi ayrimi',
      items: sourceReport.roles,
      action: 'Aktorlere gore gorev, yetki, bildirim ve onay davranislarini dokumana isle.',
    },
    {
      signal: 'Sistemler',
      expected: 'Kaynak/hedef sistemlerin kapsam, veri sahipligi ve ekran/servis etkileri',
      items: sourceReport.systems,
      minCoverage: 0.8,
      action: 'Sistemleri mimari, veri akisi, hata yonetimi ve sorumluluk tablolarina ekle.',
    },
    {
      signal: 'Entegrasyonlar',
      expected: 'Entegrasyon akisi, tetikleyici, hata/retry ve mutabakat davranisi',
      items: sourceReport.integrations,
      action: 'Her entegrasyon icin akis, veri kontrati, hata/retry ve acik konu maddelerini yaz.',
    },
    {
      signal: 'Ekran / UI ihtiyaclari',
      expected: 'Ekran, form, validasyon, mesaj ve bos/hata durumlari',
      items: sourceReport.uiNeeds,
      action: 'Ekran gereksinimlerini alan, validasyon, toast/uyari, aksiyon ve durum davranisi olarak detaylandir.',
    },
    {
      signal: 'KPI / basari olcutleri',
      expected: 'Is degeri ve olculen basari kriterleri',
      items: sourceReport.kpis,
      action: 'KPI tablosunu hedef, olcum kaynagi, siklik ve kabul esigiyle tamamla.',
    },
  ];

  for (const group of groupedSignals) {
    const items = Array.from(new Set(group.items)).filter(Boolean).slice(0, 10);
    if (!items.length) continue;
    const missing = items.filter(item => !isSignalRepresented(businessAnalysisContent, item, group.minCoverage ?? 0.67));
    const missingRatio = missing.length / items.length;
    if (missing.length === items.length || missingRatio >= 0.5) {
      findings.push({
        signal: group.signal,
        expected: group.expected,
        missing,
        action: group.action,
      });
    }
  }

  return findings.slice(0, 10);
}

function buildSourceFidelityGuardMarkdown(findings: SourceFidelityFinding[], repaired: boolean): string {
  return [
    SOURCE_FIDELITY_GUARD_START,
    '## Source Fidelity Guard',
    '',
    repaired
      ? '- Durum: AUTO_REPAIRED / KAYNAK UYUMU INCELE'
      : '- Durum: NEEDS_REVISION / KAYNAK YANSITMA ONARIMI GEREKIR',
    repaired
      ? '- Kaynak talepteki omurga sinyalleri icin otomatik onarim govdesi BA dokumanina eklendi; is birimi detaylari yine de incelenmelidir.'
      : '- Kaynak talepteki omurga sinyalleri BA dokumaninda yeterince temsil edilmiyor.',
    '- Bu blok, sabit/genel gecer dokumanlarin kullanici talebini yansitmadan basarili sayilmasini engeller.',
    '',
    '| Kaynak Sinyali | Beklenen Yansima | Tamamlanacak / Zayif Iz | Aksiyon |',
    '|---|---|---|---|',
    ...findings.map(finding => [
      escapeTableCell(finding.signal),
      escapeTableCell(finding.expected),
      escapeTableCell(compactList(finding.missing)),
      escapeTableCell(finding.action),
    ].join(' | ')).map(row => `| ${row} |`),
    SOURCE_FIDELITY_GUARD_END,
  ].join('\n');
}

function markdownList(items: string[], fallback: string): string[] {
  const values = items.length ? items : [fallback];
  return values.map(item => `- ${item}`);
}

function buildSourceFidelityRepairMarkdown(
  sourceReport: ReturnType<typeof analyzeSourceIntelligence>,
  findings: SourceFidelityFinding[],
): string {
  const processes = sourceReport.processes.length
    ? sourceReport.processes.map(process => process.title)
    : ['[ACIK KONU] Ana surec modeli is birimiyle netlestirilecek'];
  const roles = sourceReport.roles.length ? sourceReport.roles : ['[ACIK KONU] Is birimi', '[ACIK KONU] Operasyon', '[ACIK KONU] IT'];
  const systems = sourceReport.systems.length ? sourceReport.systems : ['[ACIK KONU] Kaynak sistem', '[ACIK KONU] Hedef sistem'];
  const integrations = sourceReport.integrations.length ? sourceReport.integrations : ['[ACIK KONU] Entegrasyon modeli'];
  const uiNeeds = sourceReport.uiNeeds.length ? sourceReport.uiNeeds : ['[VARSAYIM] Form, liste, validasyon, uyari ve hata durumlari'];
  const kpis = sourceReport.kpis.length ? sourceReport.kpis : ['[VARSAYIM] Surec tamamlanma suresi', '[VARSAYIM] Hata orani', '[VARSAYIM] Manuel is yuku azalimi'];
  const projectName = sourceReport.inferredProjectName || '[ACIK KONU] Proje adi netlestirilecek';
  const sourceAnchors = [
    `Proje: ${projectName}`,
    `Surecler: ${processes.join(', ')}`,
    `Roller: ${roles.join(', ')}`,
    `Sistemler: ${systems.join(', ')}`,
    `Entegrasyonlar: ${integrations.join(', ')}`,
    `Ekran/UI: ${uiNeeds.join(', ')}`,
    `KPI: ${kpis.join(', ')}`,
  ];

  const processBlocks = processes.slice(0, 12).flatMap((process, index) => {
    const code = String(index + 1).padStart(2, '0');
    return [
      '',
      `### SUREC MODELI - ${index + 1} "${process}"`,
      '',
      '#### Ust Duzey Surec Aciklamasi',
      `[VARSAYIM] ${process} sureci; ilgili roller, kaynak/hedef sistemler, veri kontrolleri, entegrasyon davranislari, hata yonetimi ve kapanis kriterleriyle birlikte tasarlanmalidir.`,
      '',
      '#### Surec degisiklikleri',
      `- Kaynak talepte gorunen "${process}" adimi kavramsal tasarimda ayri bir surec modeli olarak korunur.`,
      '- Manuel veya kopuk takip edilen adimlar izlenebilir is listesi, durum ve sorumluluk kurgusuna baglanir.',
      '- Hata, bekleme, onay, geri donus ve mutabakat durumlari operasyonel olarak takip edilir.',
      '',
      '#### Is Gerekleri ve KPIs',
      '| Kod | Gereksinim | Kaynak izi | Kabul kriteri |',
      '|---|---|---|---|',
      `| BR-${code}-01 | Surec ilerleme kurallari, rol sorumluluklari ve karar noktalarina gore calisir. | ${escapeTableCell(roles.join(', '))} | Yetkisiz veya tamamlanmamis veriyle surec ilerlemez. |`,
      `| FR-${code}-01 | Kullanici, ${escapeTableCell(process)} adimini olusturur, gunceller, izler ve kapatir. | ${escapeTableCell(process)} | Basarili islemde durum ve tarihce guncellenir. |`,
      `| UI-${code}-01 | Ilgili ekranlarda zorunlu alan, validasyon, bos durum ve hata mesaji davranislari bulunur. | ${escapeTableCell(uiNeeds.join(', '))} | Hata nedeni kullaniciya acik gosterilir. |`,
      `| INT-${code}-01 | Surece bagli sistem ve entegrasyonlar hata/retry/log kurgusuyla izlenir. | ${escapeTableCell([...systems, ...integrations].join(', '))} | Basarili/basarisiz tum islemler izlenebilir. |`,
      `| KPI-${code}-01 | Surec basarisi KPI setiyle olculur. | ${escapeTableCell(kpis.join(', '))} | KPI raporu surec ve rol bazinda filtrelenebilir. |`,
      `| TEST-${code}-01 | Pozitif, negatif, yetki, entegrasyon hatasi ve geri alma senaryolari UAT kapsaminda test edilir. | ${escapeTableCell(process)} | Kritik acik hata kalmadan kabul alinir. |`,
      '',
      '#### Detayli Surec Akisi',
      '1. Tetikleyici kullanici aksiyonu, sistem olayi veya entegrasyon mesaji olarak alinir.',
      '2. Zorunlu alan, rol/yetki, veri formati ve is kurali kontrolleri calisir.',
      '3. Basarili kontrolde ilgili sistem kaydi veya entegrasyon islemi baslatilir.',
      '4. Sonuc ana kayda, tarihceye, log yapisina ve rapor/veri katmanina islenir.',
      '5. Hata durumunda kullanici mesaji, operasyon is listesi, retry veya manuel duzeltme akisi devreye girer.',
      '',
      '#### Onemli Uyarlamalar ve Degisim Yonetimi',
      '- Parametre, yetki, bildirim ve entegrasyon ayarlari canliya gecis oncesi is birimiyle teyit edilir.',
      '- Operasyon ekipleri icin rol bazli egitim, UAT kaniti ve destek devri planlanir.',
    ];
  });

  return [
    SOURCE_FIDELITY_REPAIR_START,
    '## Kaynak Uyum Onarimi',
    '',
    'Bu bolum, ilk uretim kaynak talepteki proje/surec/sistem izlerini yeterince tasimadiginda otomatik eklenir. Amac genel gecer dokumani kaynak talebe yeniden baglamak ve sonraki model/insan revizyonuna somut bir omurga birakmaktir.',
    '',
    '### Kaynak Omurga Ozeti',
    ...markdownList(sourceAnchors, '[ACIK KONU] Kaynak omurga bulunamadi'),
    '',
    '### Onarim Gerekcesi',
    '| Tamamlanacak Alan | Beklenen Yansima | Tamamlanacak Iz |',
    '|---|---|---|',
    ...findings.map(finding => `| ${escapeTableCell(finding.signal)} | ${escapeTableCell(finding.expected)} | ${escapeTableCell(compactList(finding.missing, 6))} |`),
    ...processBlocks,
    SOURCE_FIDELITY_REPAIR_END,
  ].join('\n');
}

function hasSourceBackbone(sourceReport: SourceIntelligenceReport): boolean {
  return sourceReport.confidence >= 45
    || !!sourceReport.inferredProjectName
    || sourceReport.processes.length > 0
    || sourceReport.roles.length > 0
    || sourceReport.systems.length > 0
    || sourceReport.integrations.length > 0
    || sourceReport.uiNeeds.length > 0
    || sourceReport.kpis.length > 0;
}

function hasActionableTraceabilityMatrix(value = ''): boolean {
  const normalized = normalizeSourceText(value);
  return /traceability|izlenebilirlik/.test(normalized)
    && /\breq[-\s]?\d+/i.test(value)
    && /\bbr[-\s]?\d+/i.test(value)
    && /\bac[-\s]?\d+/i.test(value)
    && /\btc[-\s]?\d+/i.test(value);
}

function shouldEnsureTraceability(
  document: DocumentData,
  sourceReport: SourceIntelligenceReport,
): boolean {
  const baContent = document.businessAnalysis?.content || '';
  if (!baContent.trim()) return false;
  const normalizedBa = normalizeSourceText(baContent);
  return hasSourceBackbone(sourceReport)
    || /kavramsal tasarim|is analizi|ba analiz|gereksinim|surec modeli|proje/.test(normalizedBa);
}

function buildTraceabilityRows(sourceReport: SourceIntelligenceReport): string[] {
  const processes = sourceReport.processes.length
    ? sourceReport.processes.map(process => process.title)
    : [
      sourceReport.inferredProjectName
        ? `${sourceReport.inferredProjectName} ana is akisi`
        : 'Ana is sureci',
      'Kontrol, raporlama ve operasyonel takip sureci',
    ];
  const systems = sourceReport.systems.length ? sourceReport.systems : ['[ACIK KONU] Kaynak/hedef sistem'];
  const integrations = sourceReport.integrations.length ? sourceReport.integrations : ['[ACIK KONU] Entegrasyon / servis etkisi'];
  const uiNeeds = sourceReport.uiNeeds.length ? sourceReport.uiNeeds : ['[VARSAYIM] Ekran, form, validasyon ve mesaj davranisi'];
  const kpis = sourceReport.kpis.length ? sourceReport.kpis : ['[VARSAYIM] Surec tamamlanma suresi', '[VARSAYIM] Hata orani'];
  const status = sourceReport.processes.length ? 'DOGRULANDI' : 'VARSAYIM';

  return processes.slice(0, 12).map((process, index) => {
    const code = String(index + 1).padStart(2, '0');
    const sourceTrace = sourceReport.processes.length
      ? `Kaynak surec: ${process}`
      : `Varsayilan surec: ${process}`;
    const requirement = `REQ-${code}: ${process} icin karar verilebilir gereksinim seti`;
    const rule = `BR-${code}-01 / FR-${code}-01 / UI-${code}-01 / INT-${code}-01`;
    const acceptance = `AC-${code}-01: zorunlu veri, rol, durum, hata ve kapanis kriterleri basariyla dogrulanir`;
    const test = `TC-${code}-01: pozitif, negatif, yetki, entegrasyon hatasi ve regresyon UAT senaryolari`;
    const impact = [
      `Sistem: ${systems.slice(0, 3).join(', ')}`,
      `Entegrasyon: ${integrations.slice(0, 2).join(', ')}`,
      `UI: ${uiNeeds.slice(0, 2).join(', ')}`,
      `KPI: ${kpis.slice(0, 2).join(', ')}`,
    ].join(' / ');

    return `| ${requirement} | ${escapeTableCell(sourceTrace)} | ${escapeTableCell(rule)} | ${escapeTableCell(acceptance)} | ${escapeTableCell(test)} | ${escapeTableCell(impact)} | ${status} |`;
  });
}

function buildTraceabilityRepairMarkdown(sourceReport: SourceIntelligenceReport): string {
  return [
    TRACEABILITY_REPAIR_START,
    '## Izlenebilirlik ve Testlenebilirlik Matrisi',
    '',
    'Bu bolum, kavramsal tasarimdaki her ana surecin gelistirme ve UAT tarafinda takip edilebilir hale gelmesi icin otomatik uretilir. Model yuzeysel uretse bile gereksinim, is kurali, kabul kriteri ve test zinciri gorunur kalir.',
    '',
    '| Gereksinim ID | Kaynak / Problem Izi | Bagli Kural ve Fonksiyonlar | Kabul Kriteri | Test / UAT Izi | Sistem-UI-KPI Etkisi | Kanit Durumu |',
    '|---|---|---|---|---|---|---|',
    ...buildTraceabilityRows(sourceReport),
    '',
    '### Traceability Kullanma Kurali',
    '- Her yeni BR/FR/UI/INT maddesi en az bir AC ve TC ile baglanmadan tamamlandi sayilmaz.',
    '- [DOGRULANDI] satirlar kullanici kaynagi veya mevcut dokuman izinden gelir; [VARSAYIM] satirlar is birimi onayi ister.',
    '- UAT oncesinde acik konu, varsayim ve kaynak dogrulama satirlari Review tarafinda kapatilmalidir.',
    TRACEABILITY_REPAIR_END,
  ].join('\n');
}

function buildTraceabilityGuardMarkdown(sourceReport: SourceIntelligenceReport): string {
  const processCount = sourceReport.processes.length || 2;
  return [
    TRACEABILITY_GUARD_START,
    '## Traceability Guard',
    '',
    '- Durum: AUTO_REPAIRED / IZLENEBILIRLIK INCELE',
    `- BA dokumaninda gereksinimden kabul kriteri ve teste uzanan net matris guclendirildi; ${processCount} surec/surec adayi icin otomatik izlenebilirlik govdesi eklendi.`,
    '- Bu guard, genel metin ureten taslaklarin gelistirme, UAT ve onay takibine baglanmadan yeterli sayilmasini engeller.',
    '',
    '| Kontrol | Durum | Aksiyon |',
    '|---|---|---|',
    '| REQ-BR-AC-TC zinciri | AUTO_REPAIRED | Is birimi ve QA ile satirlari onayla. |',
    '| Kanit durumu | REVIEW_REQUIRED | DOGRULANDI / VARSAYIM / ACIK KONU ayrimini kapat. |',
    '| Testlenebilirlik | REVIEW_REQUIRED | Her kabul kriteri icin UAT verisi ve beklenen sonucu tamamla. |',
    TRACEABILITY_GUARD_END,
  ].join('\n');
}

interface AnalysisCoverageRow {
  dimension: string;
  status: 'COVERED' | 'PARTIAL' | 'OPEN';
  expected: string;
  evidence: string;
  repairAction: string;
}

function hasActionableAnalysisCoverageMatrix(value = ''): boolean {
  const normalized = normalizeSourceText(value);
  const hasMatrixShell = /analysis coverage matrix|coverage boyutu|coverage karar kurali/.test(normalized);
  const requiredSignals = [
    /aktor|actor|rol|paydas/,
    /happy path|ana akis/,
    /alternatif akis|alternate flow/,
    /istisna|exception|negatif/,
    /is kurali|business rule|br-/,
    /validasyon|validation/,
    /yetki|permission|authorization|sec-/,
    /veri|data/,
    /entegrasyon|integration|int-/,
    /nfr|performans|guvenlik|loglama/,
    /raporlama|report|kpi|dashboard/,
    /audit|izlenebilirlik|log/,
  ];
  const matched = requiredSignals.filter(pattern => pattern.test(normalized)).length;
  return hasMatrixShell && matched >= requiredSignals.length - 1;
}

function buildCoverageEvidence(items: string[], fallback: string): string {
  return escapeTableCell(items.length ? items.slice(0, 4).join(', ') : fallback);
}

function buildAnalysisCoverageRows(sourceReport: SourceIntelligenceReport): AnalysisCoverageRow[] {
  const processes = sourceReport.processes.map(process => process.title);
  const roles = sourceReport.roles;
  const systems = sourceReport.systems;
  const integrations = sourceReport.integrations;
  const uiNeeds = sourceReport.uiNeeds;
  const kpis = sourceReport.kpis;
  const documentRules = sourceReport.documentRules;

  return [
    {
      dimension: 'Aktor / rol / paydas',
      status: roles.length ? 'COVERED' : 'PARTIAL',
      expected: 'Her aktor icin sorumluluk, yetki, bildirim ve onay davranisi yazilir.',
      evidence: buildCoverageEvidence(roles, '[VARSAYIM] Is birimi, Operasyon, IT, Destek'),
      repairAction: 'RACI veya rol-sorumluluk tablosunu is birimiyle dogrula.',
    },
    {
      dimension: 'Happy path / ana akis',
      status: processes.length ? 'COVERED' : 'PARTIAL',
      expected: 'Ana surec tetikleyici, adim, karar, sonuc ve kapanis kriteriyle modellenir.',
      evidence: buildCoverageEvidence(processes, '[VARSAYIM] Ana is sureci ve operasyon takip sureci'),
      repairAction: 'Her surec modeli icin tetikleyici ve kapanis kriterini netlestir.',
    },
    {
      dimension: 'Alternatif akislar',
      status: 'PARTIAL',
      expected: 'Bekleyen onay, manuel duzeltme, yeniden isleme, iptal veya geri alma akislari yazilir.',
      evidence: '[VARSAYIM] Alternatif akislar kaynakta acik yazilmadiysa domain davranisindan turetilir.',
      repairAction: 'Is biriminden sik gorulen alternatif durumlari al ve surec bloklarina isle.',
    },
    {
      dimension: 'Istisna / negatif senaryolar',
      status: 'PARTIAL',
      expected: 'Tamamlanmamis veri, gecersiz durum, yetki ihlali, entegrasyon hatasi ve SLA asimi ele alinir.',
      evidence: buildCoverageEvidence([...sourceReport.risks, ...sourceReport.openTopics], '[VARSAYIM] Hata/retry/manuel duzeltme ihtiyaci'),
      repairAction: 'Negatif senaryolari UAT testleri ve operasyon hata listesine bagla.',
    },
    {
      dimension: 'Is kurallari',
      status: documentRules.length || processes.length ? 'COVERED' : 'PARTIAL',
      expected: 'BR kodlu kurallar, durdurma/devam etme kosullari ve kabul kriterleriyle yazilir.',
      evidence: buildCoverageEvidence(documentRules.length ? documentRules : processes, '[VARSAYIM] Kritik surec kapanis kurallari'),
      repairAction: 'BR maddelerini karar noktasi, hata mesaji ve AC ile bagla.',
    },
    {
      dimension: 'Validasyon ve kullanici mesajlari',
      status: uiNeeds.length ? 'COVERED' : 'PARTIAL',
      expected: 'Zorunlu alan, format, durum gecisi, toast/uyari ve bos durum davranislari tanimlanir.',
      evidence: buildCoverageEvidence(uiNeeds, '[VARSAYIM] Zorunlu alan, hata, toast ve bos durum mesajlari'),
      repairAction: 'Ekran bazli validasyon ve mesaj standardi tablosu ekle.',
    },
    {
      dimension: 'Yetki / rol bazli kontrol',
      status: roles.length ? 'PARTIAL' : 'OPEN',
      expected: 'Kritik aksiyonlar icin rol, sahiplik, onay ve erisim kisitlari yazilir.',
      evidence: buildCoverageEvidence(roles, '[ACIK KONU] Yetki rolleri net degil'),
      repairAction: 'SEC maddelerini RACI ve audit log ile iliskilendir.',
    },
    {
      dimension: 'Veri gereksinimleri',
      status: systems.length ? 'PARTIAL' : 'OPEN',
      expected: 'Ana veri sahibi, alan zorunlulugu, format, onceki/sonraki deger ve tarihce yazilir.',
      evidence: buildCoverageEvidence(systems, '[ACIK KONU] Kaynak/hedef veri sahibi net degil'),
      repairAction: 'Data mapping ve veri sahipligi tablosunu tamamla.',
    },
    {
      dimension: 'Entegrasyonlar',
      status: integrations.length ? 'COVERED' : 'PARTIAL',
      expected: 'Senkron/asenkron/batch davranisi, hata, retry, idempotency, log ve mutabakat kurgusu yazilir.',
      evidence: buildCoverageEvidence(integrations, '[VARSAYIM] Entegrasyon modeli netlestirilecek'),
      repairAction: 'INT maddelerini servis kontrati, hata listesi ve mutabakat ile bagla.',
    },
    {
      dimension: 'NFR / operasyonel kalite',
      status: 'PARTIAL',
      expected: 'Performans, loglama, guvenlik, erisilebilirlik, veri saklama ve destek SLA kurallari yazilir.',
      evidence: buildCoverageEvidence(kpis, '[VARSAYIM] SLA, hata orani, yanit suresi ve operasyonel takip'),
      repairAction: 'NFR maddelerini olculebilir esik ve izleme kaynagiyla tamamla.',
    },
    {
      dimension: 'Raporlama / KPI',
      status: kpis.length || sourceReport.dashboardNeeds.length ? 'COVERED' : 'PARTIAL',
      expected: 'Dashboard, rapor, metrik, hedef esik, veri kaynagi ve rol bazli gorunum tanimlanir.',
      evidence: buildCoverageEvidence([...sourceReport.dashboardNeeds, ...kpis], '[VARSAYIM] Surec durumu, hata, gecikme ve acik gorevler'),
      repairAction: 'RPT/KPI maddelerini hedef, periyot ve veri kaynagiyla detaylandir.',
    },
    {
      dimension: 'Audit / izlenebilirlik',
      status: 'PARTIAL',
      expected: 'Kritik aksiyonlarda kullanici, zaman, onceki/sonraki deger, sonuc ve hata kodu loglanir.',
      evidence: '[VARSAYIM] Audit log ve tarihce tum kritik aksiyonlarda tutulur.',
      repairAction: 'Audit alanlarini veri modeli ve UAT testlerine bagla.',
    },
  ];
}

function buildAnalysisCoverageRepairMarkdown(sourceReport: SourceIntelligenceReport): string {
  const rows = buildAnalysisCoverageRows(sourceReport);
  return [
    ANALYSIS_COVERAGE_REPAIR_START,
    '## Analysis Coverage Matrix',
    '',
    'Bu bolum, BA dokumaninin yalnizca metin uretmeyip is analizi kapsamini sistematik olarak kapattigini gostermek icin otomatik eklenir. Her satir gelistirme, UAT ve Review tarafinda takip edilebilir bir kontrol maddesidir.',
    '',
    '| Coverage Boyutu | Durum | Beklenen Analiz | Kaynak / Kanit | Onarim Aksiyonu |',
    '|---|---|---|---|---|',
    ...rows.map(row => `| ${escapeTableCell(row.dimension)} | ${row.status} | ${escapeTableCell(row.expected)} | ${row.evidence} | ${escapeTableCell(row.repairAction)} |`),
    '',
    '### Coverage Karar Kurali',
    '- OPEN kalan satirlar kritik karar etkisi yuksekse soru olarak sorulur; dusuk/orta etkiyse [VARSAYIM] olarak dokumanda isaretlenir.',
    '- PARTIAL satirlar taslak icin kabul edilebilir ancak UAT/canli oncesi kanit veya is birimi onayi ister.',
    '- COVERED satirlar yine de kaynak, kabul kriteri ve test iziyle korunur.',
    ANALYSIS_COVERAGE_REPAIR_END,
  ].join('\n');
}

function buildAnalysisCoverageGuardMarkdown(sourceReport: SourceIntelligenceReport): string {
  const rows = buildAnalysisCoverageRows(sourceReport);
  const openCount = rows.filter(row => row.status === 'OPEN').length;
  const partialCount = rows.filter(row => row.status === 'PARTIAL').length;
  return [
    ANALYSIS_COVERAGE_GUARD_START,
    '## Analysis Coverage Guard',
    '',
    '- Durum: AUTO_REPAIRED / KAPSAM INCELE',
    `- Coverage matrisi otomatik eklendi. ${openCount} OPEN, ${partialCount} PARTIAL alan is birimi/QA/IT tarafindan kapatilmalidir.`,
    '- Bu guard, kavramsal tasarimin sadece baslik doldurmasini degil; aktor, akis, istisna, veri, entegrasyon, NFR, raporlama ve audit seviyesinde karar verilebilir olmasini zorlar.',
    '',
    '| Kontrol | Durum | Aksiyon |',
    '|---|---|---|',
    '| Analiz coverage matrisi | AUTO_REPAIRED | OPEN/PARTIAL satirlari Review aksiyon listesine bagla. |',
    '| Kritik karar ayrimi | REVIEW_REQUIRED | Blocking bilgileri soru olarak, varsayilabilir bilgileri [VARSAYIM] olarak isaretle. |',
    '| UAT hazirligi | REVIEW_REQUIRED | Coverage satirlarini AC/TC ve UAT veri setleriyle eslestir. |',
    ANALYSIS_COVERAGE_GUARD_END,
  ].join('\n');
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
  const allowAutoRepair = context.turnDecision?.documentPolicy.allowAutoRepair ?? true;
  const allowTemplateNormalization = context.turnDecision?.documentPolicy.allowTemplateNormalization ?? true;
  const incomingWithDefaults: DocumentData = {
    ...incoming,
    businessAnalysis: incoming.businessAnalysis || base.businessAnalysis,
    review: incoming.review || base.review,
  };
  const sourceTextForAudit = [
    context.sourceText || '',
    incoming.businessAnalysis?.content || '',
    incoming.review?.content || '',
    existing?.businessAnalysis?.content || '',
    existing?.review?.content || '',
  ].filter(Boolean).join('\n\n');
  const templatedIncoming = allowTemplateNormalization
    ? ensureConceptualTemplateStructure(incomingWithDefaults, sourceTextForAudit)
    : incomingWithDefaults;

  let document: DocumentData = {
    businessAnalysis: normalizeSection(templatedIncoming.businessAnalysis, base.businessAnalysis, true),
    ...(templatedIncoming.review || base.review ? { review: normalizeSection(templatedIncoming.review, base.review, true) } : {}),
    suggestions: incoming.suggestions || base.suggestions,
  };

  const sourceReport = analyzeSourceIntelligence({
    sourceText: [
      context.sourceText || '',
      templatedIncoming.businessAnalysis?.content || '',
      templatedIncoming.review?.content || '',
      base.businessAnalysis?.content || '',
      base.review?.content || '',
    ].filter(Boolean).join('\n\n'),
    workspaceTitle: context.workspaceTitle,
  });

  if (
    sourceReport.confidence >= 45
    || sourceReport.processes.length
    || sourceReport.mismatchWarnings.length
  ) {
    const sourceReviewBlock = renderMarkdownToHtml(buildSourceIntelligenceReviewMarkdown(sourceReport));
    document.review = {
      content: replaceMarkedBlock(
        document.review?.content || '',
        sourceReviewBlock,
        SOURCE_INTELLIGENCE_BLOCK_START,
        SOURCE_INTELLIGENCE_BLOCK_END,
      ),
      status: document.review?.status || 'DRAFT',
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        ...sourceReport.mismatchWarnings,
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      ...sourceReport.quickActions,
    ]));
  }

  const templateCoverage = conceptualTemplateCoverage(document.businessAnalysis?.content || '');
  const wordTemplateGuardBlock = renderMarkdownToHtml(buildWordTemplateGuardMarkdown(document.businessAnalysis?.content || ''));
  document.review = {
    ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
    content: replaceMarkedBlock(
      document.review?.content || '',
      wordTemplateGuardBlock,
      WORD_TEMPLATE_GUARD_START,
      WORD_TEMPLATE_GUARD_END,
    ),
    status: templateCoverage.missing.length ? 'NEEDS_REVISION' : (document.review?.status || 'DRAFT'),
    flags: Array.from(new Set([
      ...(document.review?.flags || []),
      'WORD_TEMPLATE_CONFORMANCE_GUARD',
      ...(templateCoverage.missing.length ? ['WORD_TEMPLATE_REVIEW_REQUIRED'] : ['WORD_TEMPLATE_READY']),
    ])),
  };
  document.suggestions = Array.from(new Set([
    ...(document.suggestions || []),
    'Word formatına düzelt',
    'Şablon uyumunu tamamla',
    'Süreç modeli bloklarını çoğalt',
  ]));

  const sourceFidelityFindings = evaluateSourceFidelity(sourceReport, document.businessAnalysis?.content || '');
  if (allowAutoRepair && sourceFidelityFindings.length) {
    const sourceFidelityRepairBlock = renderMarkdownToHtml(buildSourceFidelityRepairMarkdown(sourceReport, sourceFidelityFindings));
    document.businessAnalysis = {
      ...(document.businessAnalysis || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.businessAnalysis?.content || '',
        sourceFidelityRepairBlock,
        SOURCE_FIDELITY_REPAIR_START,
        SOURCE_FIDELITY_REPAIR_END,
      ),
      status: document.businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([
        ...(document.businessAnalysis?.flags || []),
        'SOURCE_FIDELITY_REPAIRED',
      ])),
    };

    const remainingSourceFidelityFindings = evaluateSourceFidelity(sourceReport, document.businessAnalysis?.content || '');
    const sourceFidelityGuardBlock = renderMarkdownToHtml(buildSourceFidelityGuardMarkdown(
      remainingSourceFidelityFindings.length ? remainingSourceFidelityFindings : sourceFidelityFindings,
      !remainingSourceFidelityFindings.length,
    ));
    document.review = {
      ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.review?.content || '',
        sourceFidelityGuardBlock,
        SOURCE_FIDELITY_GUARD_START,
        SOURCE_FIDELITY_GUARD_END,
      ),
      status: 'NEEDS_REVISION',
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        'SOURCE_FIDELITY_REPAIRED',
        'SOURCE_FIDELITY_REPAIR_REQUIRED',
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      'Kaynak talep izlerini dokumana isle',
      'Kaynak uyum onarimini incele',
      'Süreç bloklarını tamamla',
      'Review acik konularini kapat',
    ]));
  }

  const officialGuardCorpus = [
    context.sourceText || '',
    document.businessAnalysis?.content || '',
    document.review?.content || '',
  ].filter(Boolean).join('\n\n');
  if (requiresOfficialSourceGuard(sourceReport) && !hasOfficialSourceEvidence(officialGuardCorpus)) {
    const officialGuardBlock = renderMarkdownToHtml(buildOfficialSourceGuardMarkdown());
    document.review = {
      ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.review?.content || '',
        officialGuardBlock,
        OFFICIAL_SOURCE_GUARD_START,
        OFFICIAL_SOURCE_GUARD_END,
      ),
      status: 'NEEDS_REVISION',
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        'OFFICIAL_SOURCE_VERIFICATION_REQUIRED',
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      'Resmi kaynaklarla dogrula',
      'Review acik konularini kapat',
    ]));
  }

  if (shouldRenderEvidencePolicyGuard(context.turnDecision)) {
    const evidencePolicyBlock = renderMarkdownToHtml(buildEvidencePolicyGuardMarkdown(
      context.turnDecision,
      sourceReport,
      officialGuardCorpus,
    ));
    const requiresEvidenceReview = context.turnDecision.sourcePolicy.officialSourceRequired
      && !context.turnDecision.sourcePolicy.canClaimVerified;
    document.review = {
      ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.review?.content || '',
        evidencePolicyBlock,
        EVIDENCE_POLICY_GUARD_START,
        EVIDENCE_POLICY_GUARD_END,
      ),
      status: requiresEvidenceReview ? 'NEEDS_REVISION' : (document.review?.status || 'DRAFT'),
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        'EVIDENCE_POLICY_GUARD',
        ...(requiresEvidenceReview ? ['OFFICIAL_EVIDENCE_REQUIRED'] : ['EVIDENCE_POLICY_READY']),
        ...(!context.turnDecision.sourcePolicy.canClaimVerified && hasVerifiedClaimLabel(officialGuardCorpus)
          ? ['VERIFIED_CLAIM_SCOPE_REVIEW']
          : []),
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      'Kaynak dogrulama matrisini guncelle',
      ...(requiresEvidenceReview ? ['Resmi kaynaklarla dogrula'] : []),
      'Review acik konularini kapat',
    ]));
  }

  if (
    allowAutoRepair
    && shouldEnsureTraceability(document, sourceReport)
    && !hasActionableTraceabilityMatrix(document.businessAnalysis?.content || '')
  ) {
    const traceabilityRepairBlock = renderMarkdownToHtml(buildTraceabilityRepairMarkdown(sourceReport));
    document.businessAnalysis = {
      ...(document.businessAnalysis || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.businessAnalysis?.content || '',
        traceabilityRepairBlock,
        TRACEABILITY_REPAIR_START,
        TRACEABILITY_REPAIR_END,
      ),
      status: document.businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([
        ...(document.businessAnalysis?.flags || []),
        'TRACEABILITY_REPAIRED',
      ])),
    };

    const traceabilityGuardBlock = renderMarkdownToHtml(buildTraceabilityGuardMarkdown(sourceReport));
    document.review = {
      ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.review?.content || '',
        traceabilityGuardBlock,
        TRACEABILITY_GUARD_START,
        TRACEABILITY_GUARD_END,
      ),
      status: 'NEEDS_REVISION',
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        'TRACEABILITY_REPAIR_REQUIRED',
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      'Traceability matrisini tamamla',
      'Kabul kriterlerini testlere bagla',
      'UAT senaryolarini netlestir',
    ]));
  }

  if (allowAutoRepair) {
    const selfReviewRepair = repairDocumentWithSelfReview(document, sourceReport);
    document = selfReviewRepair.document;
  }

  if (
    allowAutoRepair
    && shouldEnsureTraceability(document, sourceReport)
    && !hasActionableAnalysisCoverageMatrix(document.businessAnalysis?.content || '')
  ) {
    const coverageRepairBlock = renderMarkdownToHtml(buildAnalysisCoverageRepairMarkdown(sourceReport));
    document.businessAnalysis = {
      ...(document.businessAnalysis || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.businessAnalysis?.content || '',
        coverageRepairBlock,
        ANALYSIS_COVERAGE_REPAIR_START,
        ANALYSIS_COVERAGE_REPAIR_END,
      ),
      status: document.businessAnalysis?.status || 'DRAFT',
      flags: Array.from(new Set([
        ...(document.businessAnalysis?.flags || []),
        'ANALYSIS_COVERAGE_REPAIRED',
      ])),
    };

    const coverageGuardBlock = renderMarkdownToHtml(buildAnalysisCoverageGuardMarkdown(sourceReport));
    document.review = {
      ...(document.review || { content: '', status: 'DRAFT' as const, flags: [] }),
      content: replaceMarkedBlock(
        document.review?.content || '',
        coverageGuardBlock,
        ANALYSIS_COVERAGE_GUARD_START,
        ANALYSIS_COVERAGE_GUARD_END,
      ),
      status: 'NEEDS_REVISION',
      flags: Array.from(new Set([
        ...(document.review?.flags || []),
        'ANALYSIS_COVERAGE_REPAIR_REQUIRED',
      ])),
    };
    document.suggestions = Array.from(new Set([
      ...(document.suggestions || []),
      'Coverage matrisini tamamla',
      'Istisna ve negatif akislari detaylandir',
      'Yetki/veri/entegrasyon aciklarini kapat',
    ]));
  }

  const qualityGate = evaluateDocumentQualityGate(document);
  const qualityFlags = [
    ...qualityGate.warnings,
    ...(!qualityGate.canPublishToPanel ? [qualityGate.reason] : []),
  ];

  if (qualityFlags.length) {
    const legacyQualityBlock = renderMarkdownToHtml([
      LEGACY_QUALITY_BLOCK_START,
      '## BA Analiz Kalite Kapısı',
      `**Kalite Puanı:** ${qualityGate.score}/100`,
      `**Durum:** ${qualityGate.canPublishToPanel ? 'Taslak yayınlanabilir' : 'Revizyon gerekli / yüzeysel taslak'}`,
      '',
      '### Tamamlanacak veya Zayıf Alanlar',
      ...(qualityGate.missingSections.length ? qualityGate.missingSections.map(item => `- ${item}`) : ['- Kritik tamamlanacak alan bulunmadı.']),
      '',
      '### Uyarılar',
      ...(qualityFlags.length ? qualityFlags.map(item => `- ${item}`) : ['- Uyarı yok.']),
      LEGACY_QUALITY_BLOCK_END,
    ].join('\n'));

    document.review = {
      content: replaceMarkedBlock(document.review?.content || '', legacyQualityBlock, LEGACY_QUALITY_BLOCK_START, LEGACY_QUALITY_BLOCK_END),
      status: qualityGate.canPublishToPanel ? 'DRAFT' : 'NEEDS_REVISION',
      flags: Array.from(new Set([...(document.review?.flags || []), ...qualityFlags])),
    };
  }

  const qualityReportV2 = evaluateBaQualityV2(document);
  const qualityReportHtml = renderMarkdownToHtml(buildBaQualityReviewMarkdown(qualityReportV2));
  const reviewFlags = Array.from(new Set([
    ...(document.review?.flags || []),
    ...qualityReportV2.warnings,
    ...(!qualityReportV2.canPublish ? qualityReportV2.priorityFixes.slice(0, 4) : []),
  ]));

  document.review = {
    content: replaceBaEngineReviewBlock(document.review?.content || '', qualityReportHtml),
    status: qualityReportV2.canPublish ? (document.review?.status || 'DRAFT') : 'NEEDS_REVISION',
    flags: reviewFlags,
  };

  document.score = Math.min(qualityGate.score, qualityReportV2.score);
  document.scoreExplanation = [
    qualityReportV2.summary,
    qualityGate.reason,
  ].filter(Boolean).join(' ');

  const changedSections = Object.entries(SECTION_LABELS)
    .filter(([key]) => sectionsDiffer((document as any)[key], (base as any)[key]))
    .map(([, label]) => label);

  return { document, qualityGate, qualityReportV2, changedSections };
}
