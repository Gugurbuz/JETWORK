import type { DocumentData, Message } from '../types';
import {
  deriveProjectNameFromText,
  extractNumberedProcessTitlesFromText,
} from './sourceDrivenInference';
import {
  domainHintsForSource,
  getPrimaryDomainProfile,
  inferredProjectNameFromProfile,
  PEMP_PROCESS_TITLES,
  processTitlesFromProfile,
  profileSignalsForSource,
} from './domainProfiles';

export interface SourceProcess {
  id: string;
  title: string;
  sourceNumber?: number;
}

export interface SourceIntelligenceReport {
  inferredProjectName?: string;
  domainHints: string[];
  processes: SourceProcess[];
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

interface VerificationMatrixRow {
  topic: string;
  status: 'DOGRULANDI' | 'VARSAYIM' | 'ACIK KONU';
  evidence: string;
  usage: string;
  note: string;
}

const htmlToText = (value = ''): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const normalizeSourceText = (value = ''): string => htmlToText(value)
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

const uniq = (items: string[]): string[] => Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));

const hasAny = (text: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(text));

function formatList(items: string[], fallback: string): string {
  return items.length ? items.join(', ') : fallback;
}

const PEMP_TITLES = PEMP_PROCESS_TITLES;

function cleanCandidate(value = ''): string {
  return value
    .replace(/^[\s\-–—:.)0-9]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;,]+$/, '');
}

function sourceLines(source = ''): string[] {
  return htmlToText(source)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function titleFromLine(line = ''): string {
  return cleanCandidate(line)
    .replace(/^(proje adi|proje ismi|project name|baslik|title)\s*[:\-]\s*/i, '')
    .trim();
}

function splitCandidateList(value = ''): string[] {
  return value
    .split(/[,\n;|]+/)
    .map(item => cleanCandidate(item))
    .filter(item => item.length >= 2 && item.length <= 120);
}

function extractLabelValues(source: string, labelPatterns: RegExp[]): string[] {
  const rows: string[] = [];
  for (const line of sourceLines(source)) {
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      if (match?.[1]) rows.push(...splitCandidateList(match[1]));
    }
  }
  return uniq(rows).slice(0, 12);
}

function extractGenericProcesses(source = ''): SourceProcess[] {
  const processes: SourceProcess[] = [];
  const seen = new Set<string>();
  const numberedLineRe = /(?:^|\b)(?:s[uü]re[cç]|surec|process|flow|akis|akış|a[sş]ama|phase|p)\s*[-#:]?\s*(\d{1,2})\s*(?:[-:.)]\s*|\s+)(.{3,140})$/i;
  const modelLineRe = /s[uü]re[cç]\s+model[ıi]\s*[-:]?\s*(\d{1,2})\s*["“”']?(.{3,140})?$/i;

  for (const line of sourceLines(source)) {
    const match = line.match(numberedLineRe) || line.match(modelLineRe);
    if (!match) continue;
    const sourceNumber = Number(match[1]);
    const title = cleanCandidate(match[2] || `Surec ${sourceNumber}`);
    const key = `${sourceNumber}:${normalizeSourceText(title)}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    processes.push({
      id: `process-${sourceNumber}`,
      sourceNumber,
      title,
    });
  }

  return processes
    .sort((a, b) => (a.sourceNumber ?? 999) - (b.sourceNumber ?? 999))
    .slice(0, 18);
}

function extractExplicitProjectName(source = ''): string | undefined {
  for (const line of sourceLines(source)) {
    const explicit = line.match(/(?:proje\s*(?:adi|ismi)|project\s*name|baslik|title)\s*[:\-]\s*(.{3,160})$/i);
    if (explicit?.[1]) return titleFromLine(explicit[1]).slice(0, 160);
  }
  return undefined;
}

function extractHeadlineProjectName(source = ''): string | undefined {
  const headline = sourceLines(source).find(line => (
    /proje(si)?\b|project\b|program\b|uygulama(si)?\b|platform\b/i.test(line)
    && line.length >= 8
    && line.length <= 140
  ));
  return headline ? titleFromLine(headline).slice(0, 160) : undefined;
}

function extractProcesses(source = ''): SourceProcess[] {
  const genericProcesses = extractNumberedProcessTitlesFromText(source).map((title, index) => ({
    id: `process-${index + 1}`,
    sourceNumber: index + 1,
    title,
  }));
  if (genericProcesses.length) return genericProcesses.slice(0, 18);

  const normalized = normalizeSourceText(source);
  const numbers = Array.from(normalized.matchAll(/surec\s*([0-9]+)/gi))
    .map(match => Number(match[1]))
    .filter(number => Number.isInteger(number) && number >= 0 && number <= 30);
  const uniqueNumbers = Array.from(new Set(numbers)).sort((a, b) => a - b);
  const primaryProfile = getPrimaryDomainProfile(source);
  const profileProcessTitles = processTitlesFromProfile(source);

  if (primaryProfile?.id === 'project_tracking_pemp' && uniqueNumbers.length >= 4) {
    return uniqueNumbers
      .filter(number => number >= 0 && number < PEMP_TITLES.length)
      .map(number => ({
        id: `process-${number}`,
        sourceNumber: number,
        title: PEMP_TITLES[number],
      }));
  }

  if (profileProcessTitles.length) {
    return profileProcessTitles.slice(0, 18).map((title, index) => ({
      id: `process-${index + 1}`,
      sourceNumber: index + 1,
      title,
    }));
  }

  return extractGenericProcesses(source);
}

function inferProjectName(source = ''): string | undefined {
  const explicitProjectName = extractExplicitProjectName(source);
  if (explicitProjectName) return explicitProjectName;

  const sourceDrivenName = deriveProjectNameFromText(source);
  if (sourceDrivenName) return sourceDrivenName;

  const profileProjectName = inferredProjectNameFromProfile(source);
  if (profileProjectName) return profileProjectName;

  return extractHeadlineProjectName(source);
}

function extractGenericRoles(source = ''): string[] {
  const text = normalizeSourceText(source);
  return uniq([
    ...extractLabelValues(source, [
      /(?:roller|rol|payda[sş]lar|stakeholders|actors|kullanicilar|kullan[ıi]c[ıi] gruplar[ıi])\s*[:\-]\s*(.+)$/i,
    ]),
    hasAny(text, [/admin|yonetici|manager/]) ? 'Admin / Yonetici' : '',
    hasAny(text, [/operasyon|operation/]) ? 'Operasyon' : '',
    hasAny(text, [/onay|approval|approver/]) ? 'Onayci' : '',
    hasAny(text, [/musteri|customer/]) ? 'Musteri / Son kullanici' : '',
    hasAny(text, [/destek|support/]) ? 'Destek ekibi' : '',
    hasAny(text, [/finans|finance/]) ? 'Finans' : '',
    hasAny(text, [/hukuk|legal/]) ? 'Hukuk' : '',
    hasAny(text, [/it|bilgi teknolojileri|teknik ekip/]) ? 'IT / Teknik ekip' : '',
  ]);
}

function extractGenericSystems(source = ''): string[] {
  const text = normalizeSourceText(source);
  const explicit = extractLabelValues(source, [
    /(?:sistemler|sistem|uygulamalar|uygulama|platformlar|platform|applications|systems)\s*[:\-]\s*(.+)$/i,
  ]);
  const acronyms = Array.from(new Set((source.match(/\b[A-Z][A-Z0-9_+.-]{2,12}\b/g) || [])))
    .filter(item => !['API', 'KPI', 'UAT', 'NFR', 'BRD', 'FDD', 'MVP'].includes(item))
    .slice(0, 8);

  return uniq([
    ...explicit,
    ...acronyms,
    hasAny(text, [/crm/]) ? 'CRM' : '',
    hasAny(text, [/erp/]) ? 'ERP' : '',
    hasAny(text, [/mobil|mobile/]) ? 'Mobil uygulama' : '',
    hasAny(text, [/web portal|portal/]) ? 'Web Portal' : '',
    hasAny(text, [/dashboard/]) ? 'Dashboard' : '',
    hasAny(text, [/dokuman yonetimi|document management|dms/]) ? 'Dokuman Yonetimi' : '',
  ]).slice(0, 14);
}

function extractGenericIntegrations(source = ''): string[] {
  const text = normalizeSourceText(source);
  return uniq([
    ...extractLabelValues(source, [
      /(?:entegrasyonlar|entegrasyon|integrations|servisler|api|apis)\s*[:\-]\s*(.+)$/i,
    ]),
    hasAny(text, [/api|rest|soap|webhook|endpoint/]) ? 'API / servis entegrasyonu' : '',
    hasAny(text, [/batch|cron|zamanlanmis|scheduled/]) ? 'Batch / zamanlanmis aktarim' : '',
    hasAny(text, [/dosya aktarimi|file transfer|sftp|ftp/]) ? 'Dosya aktarimi' : '',
    hasAny(text, [/sso|ldap|oauth|oidc|kimlik/]) ? 'Kimlik / SSO entegrasyonu' : '',
    hasAny(text, [/bildirim|notification|mail|e-posta|sms/]) ? 'Bildirim servisi' : '',
  ]);
}

function extractGenericDocumentRules(source = ''): string[] {
  const text = normalizeSourceText(source);
  return uniq([
    ...extractLabelValues(source, [
      /(?:dokumanlar|dokuman|belgeler|belge|evrak|documents|attachments)\s*[:\-]\s*(.+)$/i,
    ]),
    hasAny(text, [/zorunlu belge|zorunlu evrak|mandatory document|required attachment/]) ? 'Zorunlu belge/evrak kontrolu' : '',
    hasAny(text, [/dosya tur|file type|pdf|excel|xlsx|docx/]) ? 'Dosya turu ve boyut kurali' : '',
    hasAny(text, [/versiyon|version|revizyon/]) ? 'Dokuman versiyonlama ve revizyon takibi' : '',
    hasAny(text, [/arsiv|archive|saklama/]) ? 'Dokuman saklama ve arsiv kurali' : '',
  ]);
}

function extractGenericUiNeeds(source = ''): string[] {
  const text = normalizeSourceText(source);
  return uniq([
    ...extractLabelValues(source, [
      /(?:ekranlar|ekran|ui|ux|formlar|form|screens|pages)\s*[:\-]\s*(.+)$/i,
    ]),
    hasAny(text, [/form|ekran|screen|page/]) ? 'Form/ekran davranislari' : '',
    hasAny(text, [/validasyon|validation|zorunlu alan|required field/]) ? 'Zorunlu alan ve validasyon mesajlari' : '',
    hasAny(text, [/toast|modal|uyari|warning|error message/]) ? 'Toast/modal/uyari mesajlari' : '',
    hasAny(text, [/liste|table|grid|filtre|filter/]) ? 'Liste, filtre ve tablo davranisi' : '',
    hasAny(text, [/bos durum|empty state/]) ? 'Bos durum ve hata durumu tasarimi' : '',
  ]);
}

function extractGenericKpis(source = ''): string[] {
  const text = normalizeSourceText(source);
  return uniq([
    ...extractLabelValues(source, [
      /(?:kpi|metrikler|metric|metrics|olcum|olcumleme|basari kriterleri|success metrics)\s*[:\-]\s*(.+)$/i,
    ]),
    hasAny(text, [/sla|deadline|gecikme|delay/]) ? 'SLA / gecikme uyum orani' : '',
    hasAny(text, [/hata orani|error rate|basarisiz/]) ? 'Hata orani' : '',
    hasAny(text, [/sure|duration|tamamlanma suresi/]) ? 'Surec tamamlanma suresi' : '',
    hasAny(text, [/manuel|manual/]) ? 'Manuel is yuku azalimi' : '',
    hasAny(text, [/donusum|conversion|satis|sales/]) ? 'Donusum / satis basari orani' : '',
  ]);
}

function buildMismatchWarnings(workspaceTitle = '', source = ''): string[] {
  if (!workspaceTitle.trim()) return [];
  const title = normalizeSourceText(workspaceTitle);
  const sourceText = normalizeSourceText(source);
  const warnings: string[] = [];

  const titleLooksSapIys = hasAny(title, [/sap/]) && hasAny(title, [/iys/, /ileti yonetim sistemi/]);
  const sourceLooksPemp = hasAny(sourceText, [/pemp-?\d+/, /musteri cozumleri proje yonetim sistemi/, /ges kabul/, /proje bazli dashboard/]);
  const titleLooksPemp = hasAny(title, [/pemp-?\d+/, /proje takip/, /proje yonetim/]);
  const sourceLooksSapIys = hasAny(sourceText, [/sap/]) && hasAny(sourceText, [/iys/, /ileti yonetim sistemi/]);

  if (titleLooksSapIys && sourceLooksPemp) {
    warnings.push('Workspace başlığı SAP CRM - İYS gibi görünüyor, ancak kaynak doküman PEMP/proje takip sistemi talebini anlatıyor. Kaynak doküman ana gerçeklik olarak kullanılmalı.');
  }
  if (titleLooksPemp && sourceLooksSapIys) {
    warnings.push('Workspace başlığı proje takip gibi görünüyor, ancak kaynak içerik SAP CRM - İYS entegrasyonu anlatıyor. Üretimden önce bağlam doğrulanmalı.');
  }
  return warnings;
}

function extractSignals(source = ''): Omit<SourceIntelligenceReport, 'inferredProjectName' | 'processes' | 'mismatchWarnings' | 'quickActions' | 'confidence'> {
  const text = normalizeSourceText(source);
  const profileSignals = profileSignalsForSource(source);
  return {
    domainHints: uniq([
      ...domainHintsForSource(source),
      hasAny(text, [/pemp-?\d+/, /musteri cozumleri proje yonetim sistemi/, /ges/]) ? 'proje_takip_pemp' : '',
      hasAny(text, [/sap/]) ? 'sap' : '',
      hasAny(text, [/iys/, /ileti yonetim sistemi/]) ? 'iys' : '',
      hasAny(text, [/ai satis botu/, /sales bot/, /lead/, /opportunity/]) ? 'ai_sales_bot' : '',
      hasAny(text, [/d2d|door to door|door-to-door|saha satis|saha sales|saha uygulama|saha mobil|offline-first|offline|refactoring|refaktoring|mobil donusum|mobile donusum/]) ? 'field_mobile_app' : '',
    ]),
    roles: uniq([
      ...extractGenericRoles(source),
      ...(profileSignals.roles || []),
      hasAny(text, [/satis/]) ? 'Satış' : '',
      hasAny(text, [/vergi/]) ? 'Vergi' : '',
      hasAny(text, [/muhasebe/]) ? 'Muhasebe' : '',
      hasAny(text, [/pmo|proje yonetimi/]) ? 'Proje Yönetimi / PMO' : '',
      hasAny(text, [/kapsam/]) ? 'Kapsam Ekibi' : '',
      hasAny(text, [/satinalma/]) ? 'Satınalma' : '',
      hasAny(text, [/alt yuklenici/]) ? 'Alt Yüklenici' : '',
      hasAny(text, [/hukuk|hukuki|dava|ihtilaf|ihtarname/]) ? 'Hukuk' : '',
    ]),
    systems: uniq([
      ...extractGenericSystems(source),
      ...(profileSignals.systems || []),
      hasAny(text, [/sap/]) ? 'SAP' : '',
      hasAny(text, [/eba/]) ? 'EBA' : '',
      hasAny(text, [/filenet/]) ? 'FileNet' : '',
      hasAny(text, [/iys/]) ? 'İYS' : '',
      hasAny(text, [/dashboard/]) ? 'Dashboard' : '',
    ]),
    integrations: uniq([
      ...extractGenericIntegrations(source),
      ...(profileSignals.integrations || []),
      hasAny(text, [/sap/]) ? 'SAP bilgi/belge ve finansal durum akışı' : '',
      hasAny(text, [/eba/]) ? 'EBA onay/görev akışı' : '',
      hasAny(text, [/mail|e-posta|eposta/]) ? 'E-posta/bildirim servisi' : '',
      hasAny(text, [/filenet|dokuman|belge|evrak/]) ? 'Doküman yönetimi entegrasyonu' : '',
      hasAny(text, [/iys|api|oauth/]) ? 'Dış API / mevzuat entegrasyonu' : '',
    ]),
    documentRules: uniq([
      ...extractGenericDocumentRules(source),
      ...(profileSignals.documentRules || []),
      hasAny(text, [/zorunlu evrak|zorunlu dokuman|belge yukleme|dokuman yukleme/]) ? 'Zorunlu evrak ve belge yükleme kontrolü' : '',
      hasAny(text, [/sozlesme/]) ? 'Sözleşme dokümanı ve imza/onay tarihçesi' : '',
      hasAny(text, [/teminat/]) ? 'Teminat mektubu ve geçerlilik tarihi kontrolü' : '',
      hasAny(text, [/kabul|tedas/]) ? 'Kabul ve resmi kurum evrakları' : '',
      hasAny(text, [/bakim/]) ? 'Bakım formu ve bakım tarihçesi' : '',
      hasAny(text, [/hukuk|hukuki|dava|ihtilaf|ihtarname/]) ? 'Hukuki evrak, ihtarname ve dava dokümanları' : '',
    ]),
    dashboardNeeds: uniq([
      ...(profileSignals.dashboardNeeds || []),
      ...extractLabelValues(source, [
        /(?:dashboard|raporlar|rapor|reports|reporting|panolar|pano)\s*[:\-]\s*(.+)$/i,
      ]),
      hasAny(text, [/genel dashboard/]) ? 'Genel Dashboard' : '',
      hasAny(text, [/proje bazli dashboard/]) ? 'Proje bazlı Dashboard' : '',
      hasAny(text, [/deadline/]) ? 'Deadline ve gecikme takibi' : '',
      hasAny(text, [/kapasite/]) ? 'Kapasite/güç görünümü' : '',
      hasAny(text, [/acik gorev|gorev/]) ? 'Açık görev listesi' : '',
    ]),
    uiNeeds: uniq([
      ...extractGenericUiNeeds(source),
      ...(profileSignals.uiNeeds || []),
      hasAny(text, [/proje kayd/]) ? 'Proje kayıt ekranı' : '',
      hasAny(text, [/dashboard/]) ? 'Dashboard filtreleri ve drill-down' : '',
      hasAny(text, [/belge|evrak|dokuman/]) ? 'Belge yükleme ve tamamlanmamış evrak uyarısı' : '',
      hasAny(text, [/bildirim|mail|e-posta|eposta/]) ? 'Bildirim ve e-posta aksiyonları' : '',
      hasAny(text, [/validasyon|zorunlu/]) ? 'Zorunlu alan ve validasyon mesajları' : '',
    ]),
    kpis: uniq([
      ...extractGenericKpis(source),
      ...(profileSignals.kpis || []),
      hasAny(text, [/deadline|gecikme/]) ? 'Deadline uyum oranı' : '',
      hasAny(text, [/gorev|acik gorev/]) ? 'Açık görev kapanma süresi' : '',
      hasAny(text, [/evrak|belge|dokuman/]) ? 'Tamamlanmamış evrak oranı' : '',
      hasAny(text, [/faturalama|odeme/]) ? 'Faturalama ve ödeme tamamlama süresi' : '',
      hasAny(text, [/bakim/]) ? 'Planlı bakım zamanında tamamlama oranı' : '',
      hasAny(text, [/hukuk|hukuki|dava|ihtilaf/]) ? 'Açık hukuki aksiyon yaşı' : '',
    ]),
    risks: uniq([
      ...extractLabelValues(source, [
        /(?:riskler|risk|varsayimlar|assumptions|dependencies|bagimliliklar)\s*[:\-]\s*(.+)$/i,
      ]),
      ...(profileSignals.risks || []),
      hasAny(text, [/sap/]) ? 'SAP veri akışı ve belge eşleşmesi netleşmezse finansal kapanış kırılabilir.' : '',
      hasAny(text, [/zorunlu evrak|belge|dokuman/]) ? 'Zorunlu evrak listesi netleşmezse süreçler hatalı tamamlanabilir.' : '',
      hasAny(text, [/dashboard/]) ? 'Dashboard metrik tanımları netleşmezse kullanıcı güveni düşer.' : '',
      hasAny(text, [/eba/]) ? 'EBA onay dönüşleri izlenmezse görevler açık kalabilir.' : '',
      hasAny(text, [/hukuk|hukuki|dava|ihtilaf/]) ? 'Hukuki durum görünürlüğü zayıfsa riskli projeler operasyon ve yönetim ekranlarında fark edilmeyebilir.' : '',
    ]),
    openTopics: uniq([
      ...extractLabelValues(source, [
        /(?:acik konular|acik konu|open topics|open questions|sorular|karar bekleyenler)\s*[:\-]\s*(.+)$/i,
      ]),
      ...(profileSignals.openTopics || []),
      hasAny(text, [/sap/]) ? 'SAP’den hangi belge ve statülerin hangi sıklıkla alınacağı netleştirilmeli.' : '',
      hasAny(text, [/eba/]) ? 'EBA süreç kodları, onay rolleri ve dönüş statüleri doğrulanmalı.' : '',
      hasAny(text, [/filenet|dokuman|belge|evrak/]) ? 'Doküman saklama sistemi, dosya tipleri ve zorunlu evrak matrisi netleştirilmeli.' : '',
      hasAny(text, [/dashboard/]) ? 'Dashboard filtreleri, rol bazlı görünüm ve KPI eşikleri iş birimiyle onaylanmalı.' : '',
      hasAny(text, [/hukuk|hukuki|dava|ihtilaf/]) ? 'Hukuki ikon, yetki, belge erişimi ve aksiyon sahibi kuralları hukuk ekibiyle netleştirilmeli.' : '',
    ]),
  };
}

export function buildSourceCorpus(input: {
  userMessage?: string;
  messages?: Message[];
  document?: DocumentData | null;
}): string {
  return [
    input.userMessage || '',
    ...(input.messages || []).slice(-12).map(message => message.text || ''),
    input.document?.businessAnalysis?.content || '',
    input.document?.review?.content || '',
  ].filter(Boolean).join('\n\n');
}

export function analyzeSourceIntelligence(input: {
  sourceText: string;
  workspaceTitle?: string;
}): SourceIntelligenceReport {
  const sourceText = input.sourceText || '';
  const processes = extractProcesses(sourceText);
  const signals = extractSignals(sourceText);
  const mismatchWarnings = buildMismatchWarnings(input.workspaceTitle, sourceText);
  const signalCount = [
    processes.length,
    signals.roles.length,
    signals.systems.length,
    signals.integrations.length,
    signals.documentRules.length,
    signals.dashboardNeeds.length,
    signals.uiNeeds.length,
  ].reduce((sum, count) => sum + Math.min(count, 4), 0);

  const quickActions = uniq([
    'Tamamlanacak alanları kapat',
    'Kaynak dogrulama matrisini guncelle',
    processes.length ? 'Süreç bloklarını tamamla' : '',
    signals.documentRules.length ? 'Zorunlu evrak matrisini doldur' : '',
    signals.dashboardNeeds.length ? 'Dashboard gereksinimlerini detaylandır' : '',
    signals.integrations.length ? 'Entegrasyon varsayımlarını doğrula' : '',
    'Review açık konularını kapat',
    'Word formatına düzelt',
  ]);

  return {
    inferredProjectName: inferProjectName(sourceText),
    processes,
    mismatchWarnings,
    quickActions,
    confidence: Math.max(15, Math.min(95, 25 + signalCount * 4 + (processes.length >= 4 ? 20 : 0))),
    ...signals,
  };
}

export function buildSourceVerificationMatrixRows(report: SourceIntelligenceReport): VerificationMatrixRow[] {
  const hasSourceBackbone = report.confidence >= 55
    || report.processes.length > 0
    || report.roles.length > 0
    || report.systems.length > 0
    || report.integrations.length > 0;
  const needsOfficialValidation = report.domainHints.includes('iys')
    || report.domainHints.includes('sap')
    || report.integrations.some(item => /api|sap|iys|dis/i.test(normalizeSourceText(item)));

  const rows: VerificationMatrixRow[] = [
    {
      topic: 'Kaynak talep omurgasi',
      status: hasSourceBackbone ? 'DOGRULANDI' : 'ACIK KONU',
      evidence: hasSourceBackbone ? 'Kullanici talebi / sohbet gecmisi / mevcut dokuman icerigi' : 'Kaynak bulunamadi',
      usage: report.inferredProjectName || 'Proje adi ve ana kapsam',
      note: hasSourceBackbone
        ? 'Dokuman uretiminde kullanici kaynagi ana gerceklik kabul edildi.'
        : 'Kullanici talebi veya ek dokuman daha net alinmali.',
    },
    {
      topic: 'Surec modeli adaylari',
      status: report.processes.length ? 'DOGRULANDI' : 'VARSAYIM',
      evidence: report.processes.length ? report.processes.map(item => item.title).join(', ') : 'Kaynakta acik surec listesi yok',
      usage: 'SUREC MODELI bloklari',
      note: report.processes.length
        ? 'Kaynakta gorunen surecler korunmali ve tamamlanacak detaylar varsayimla kapatilmalidir.'
        : 'Surecler domain kalibina gore varsayildi; is birimi teyidi gerekir.',
    },
    {
      topic: 'Sistemler ve entegrasyonlar',
      status: report.systems.length || report.integrations.length ? 'DOGRULANDI' : 'ACIK KONU',
      evidence: [
        formatList(report.systems, ''),
        formatList(report.integrations, ''),
      ].filter(Boolean).join(' | ') || 'Kaynak bulunamadi',
      usage: 'Entegrasyon, veri akisi, hata/retry ve operasyon izleme',
      note: report.systems.length || report.integrations.length
        ? 'Sistem adlari kaynak izinden geldi; servis detaylari ayrica dogrulanmali.'
        : 'Hedef/kaynak sistemler netlesmeden teknik kapsam kesinlestirilmemeli.',
    },
    {
      topic: 'KPI, UI mesajlari ve dashboard ihtiyaci',
      status: report.kpis.length || report.uiNeeds.length || report.dashboardNeeds.length ? 'VARSAYIM' : 'ACIK KONU',
      evidence: [
        formatList(report.kpis, ''),
        formatList(report.uiNeeds, ''),
        formatList(report.dashboardNeeds, ''),
      ].filter(Boolean).join(' | ') || 'Kaynak bulunamadi',
      usage: 'Is gerekleri, KPI tablolari, ekran/validasyon ve raporlama',
      note: 'Bu maddeler karar verilebilir taslak icin kullanilir; metrik esikleri is birimiyle onaylanmalidir.',
    },
    {
      topic: 'Resmi mevzuat / API bilgisi',
      status: needsOfficialValidation ? 'ACIK KONU' : 'VARSAYIM',
      evidence: needsOfficialValidation
        ? 'Resmi kaynak veya uretici API dokumani ile dogrulama gerekli'
        : 'Talepte resmi mevzuat/API zorunlulugu algilanmadi',
      usage: 'DOGRULANDI olarak yazilacak mevzuat, API alani, yasal sure ve teknik limitler',
      note: needsOfficialValidation
        ? 'Web arastirmasi veya resmi dokuman olmadan mevzuat/API iddialari kesin hukum yapilmamali.'
        : 'Genel tasarim varsayimlari olarak tutulabilir.',
    },
  ];

  if (report.openTopics.length) {
    rows.push({
      topic: 'Acik konular',
      status: 'ACIK KONU',
      evidence: report.openTopics.join(', '),
      usage: 'Review aksiyon listesi ve karar bekleyen konular',
      note: 'Kapatilmadan onayli dokuman seviyesine gecilmemeli.',
    });
  }

  return rows;
}

export function buildSourceVerificationMatrixMarkdown(report: SourceIntelligenceReport): string {
  const rows = buildSourceVerificationMatrixRows(report);
  return [
    '### Kaynak ve Dogrulama Matrisi',
    '',
    '| Konu | Durum | Kaynak / Kanit | Dokumandaki Kullanim | Not |',
    '|---|---|---|---|---|',
    ...rows.map(row => `| ${row.topic} | ${row.status} | ${row.evidence} | ${row.usage} | ${row.note} |`),
    '',
    '### Dogrulandi / Varsayim / Acik Konu Ozeti',
    `- DOGRULANDI: ${rows.filter(row => row.status === 'DOGRULANDI').map(row => row.topic).join(', ') || 'Yok'}`,
    `- VARSAYIM: ${rows.filter(row => row.status === 'VARSAYIM').map(row => row.topic).join(', ') || 'Yok'}`,
    `- ACIK KONU: ${rows.filter(row => row.status === 'ACIK KONU').map(row => row.topic).join(', ') || 'Yok'}`,
  ].join('\n');
}

export function buildSourceIntelligencePrompt(report: SourceIntelligenceReport): string {
  const processLines = report.processes.length
    ? report.processes.map((process, index) => `${index + 1}. ${process.title}${typeof process.sourceNumber === 'number' ? ` (kaynak Süreç ${process.sourceNumber})` : ''}`)
    : ['Kaynakta açık süreç listesi bulunamadı; ana süreçleri talep metninden çıkar.'];

  return [
    '[KAYNAK TALEP ZEKASI - ZORUNLU]',
    report.inferredProjectName ? `Algılanan proje: ${report.inferredProjectName}` : 'Algılanan proje: [AÇIK KONU]',
    `Güven: ${report.confidence}/100`,
    report.mismatchWarnings.length ? `Bağlam uyarıları: ${report.mismatchWarnings.join(' ')}` : 'Bağlam uyarıları: yok.',
    '',
    'Kaynak doküman, workspace başlığı veya önceki kısa sohbet özetinden daha önceliklidir.',
    'Dokümanda olmayan özel kavramları üretme; gerekiyorsa [VARSAYIM] veya [AÇIK KONU] olarak ayır.',
    '',
    'Kaynak süreç omurgası:',
    ...processLines.map(line => `- ${line}`),
    '',
    `Roller: ${report.roles.join(', ') || '[AÇIK KONU]'}`,
    `Sistemler: ${report.systems.join(', ') || '[AÇIK KONU]'}`,
    `Entegrasyonlar: ${report.integrations.join(', ') || '[AÇIK KONU]'}`,
    `Zorunlu evrak/doküman kuralları: ${report.documentRules.join(', ') || '[AÇIK KONU]'}`,
    `Dashboard/UI ihtiyaçları: ${[...report.dashboardNeeds, ...report.uiNeeds].join(', ') || '[AÇIK KONU]'}`,
    `KPI adayları: ${report.kpis.join(', ') || '[AÇIK KONU]'}`,
  ].join('\n');
}

export function buildSourceIntelligenceReviewMarkdown(report: SourceIntelligenceReport): string {
  const verificationMatrix = buildSourceVerificationMatrixMarkdown(report);
  return [
    '<!-- SOURCE_INTELLIGENCE_START -->',
    '## Kaynak Talep Zekası',
    '',
    `**Algılanan Proje:** ${report.inferredProjectName || '[AÇIK KONU]'}`,
    `**Güven:** ${report.confidence}/100`,
    '',
    '### Kaynak Kapsam Özeti',
    `- Süreç sayısı: ${report.processes.length || '[AÇIK KONU]'}`,
    `- Sistemler: ${report.systems.join(', ') || '[AÇIK KONU]'}`,
    `- Roller: ${report.roles.join(', ') || '[AÇIK KONU]'}`,
    `- Dashboard/UI: ${[...report.dashboardNeeds, ...report.uiNeeds].join(', ') || '[AÇIK KONU]'}`,
    '',
    '### Bağlam Uyarıları',
    ...(report.mismatchWarnings.length ? report.mismatchWarnings.map(item => `- ${item}`) : ['- Uyarı yok.']),
    '',
    '### Hızlı Aksiyonlar',
    ...(report.quickActions.length ? report.quickActions.map(item => `- ${item}`) : ['- Review açık konularını kapat']),
    '',
    verificationMatrix,
    '<!-- SOURCE_INTELLIGENCE_END -->',
  ].join('\n');
}
