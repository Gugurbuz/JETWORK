export interface ProcessCandidateInput {
  sourceText?: string;
  processes?: string[];
  roles?: string[];
  systems?: string[];
  integrations?: string[];
  documentRules?: string[];
  dashboardNeeds?: string[];
  uiNeeds?: string[];
  kpis?: string[];
  openTopics?: string[];
  minCount?: number;
  maxCount?: number;
}

const DEFAULT_MIN_PROCESS_COUNT = 2;
const DEFAULT_MAX_PROCESS_COUNT = 8;

export function stripMarkup(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeInferenceText(value = ''): string {
  return stripMarkup(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanInferenceTitle(value = ''): string {
  return stripMarkup(value)
    .replace(/^[\s\-–—:.)#0-9]+/, '')
    .replace(/^(proje\s*(adi|ismi)|project\s*name|baslik|title)\s*[:\-]\s*/i, '')
    .replace(/\b(i[cç]in|icin)\s+(kavramsal|ba analiz|fdd|brd|dok[uü]man|rapor)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;,]+$/, '')
    .trim();
}

function sourceLines(source = ''): string[] {
  return stripMarkup(source)
    .split(/\r?\n|(?<=\.)\s+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function uniq(items: string[]): string[] {
  const result: string[] = [];
  for (const item of items.map(cleanInferenceTitle).filter(Boolean)) {
    const normalized = normalizeInferenceText(item);
    if (!result.some(existing => normalizeInferenceText(existing) === normalized)) {
      result.push(item);
    }
  }
  return result;
}

export function extractExplicitProjectNameFromText(source = ''): string | undefined {
  for (const line of sourceLines(source)) {
    const match = line.match(/(?:proje\s*(?:adi|ismi)|project\s*name|baslik|title)\s*[:\-]\s*(.{3,180})$/i);
    if (match?.[1]) return cleanInferenceTitle(match[1]).slice(0, 180);
  }
  return undefined;
}

export function deriveProjectNameFromText(source = ''): string | undefined {
  const explicit = extractExplicitProjectNameFromText(source);
  if (explicit) return explicit;

  const preferred = sourceLines(source).find((line) => {
    const normalized = normalizeInferenceText(line);
    return line.length >= 8
      && line.length <= 180
      && /\b(proje\w*|project\w*|program|uygulama\w*|platform|sistem\w*|entegrasyon\w*|integration|refactor\w*|refaktoring|donusum\w*|bot\w*|asistan\w*|assistant\w*)\b/.test(normalized);
  });
  if (preferred) return cleanInferenceTitle(preferred).slice(0, 180);

  const firstMeaningful = sourceLines(source).find(line => line.length >= 12 && line.length <= 140);
  return firstMeaningful ? cleanInferenceTitle(firstMeaningful).slice(0, 180) : undefined;
}

export function extractNumberedProcessTitlesFromText(source = ''): string[] {
  const titles: string[] = [];
  const numberedLineRe = /(?:^|\b)(?:s[uü]re[cç]|surec|process|flow|ak[iı]s|akis|a[sş]ama|phase|p)\s*[-#:]?\s*(\d{1,2})\s*(?:[-:.)]\s*|\s+)(.{3,180})$/i;
  const modelLineRe = /s[uü]re[cç]\s+model[iı]\s*[-:]?\s*(\d{1,2})\s*["']?(.{3,180})?$/i;

  for (const line of sourceLines(source)) {
    const match = line.match(numberedLineRe) || line.match(modelLineRe);
    if (!match) continue;
    const title = cleanInferenceTitle(match[2] || `Surec ${match[1]}`);
    if (title) titles.push(title);
  }

  return uniq(titles);
}

function fromSignals(items: string[], suffix: string, limit: number): string[] {
  return uniq(items)
    .slice(0, limit)
    .map(item => `${item} ${suffix}`);
}

export function expectedProcessCountFromSignals(input: ProcessCandidateInput): number {
  const explicitCount = uniq([
    ...(input.processes || []),
    ...extractNumberedProcessTitlesFromText(input.sourceText || ''),
  ]).length;
  if (explicitCount >= 2) return explicitCount;

  const signalWeight = [
    input.integrations?.length || 0,
    input.systems?.length || 0,
    input.documentRules?.length || 0,
    input.uiNeeds?.length || 0,
    input.dashboardNeeds?.length || 0,
    input.kpis?.length || 0,
  ].filter(count => count > 0).length;

  return Math.max(input.minCount || DEFAULT_MIN_PROCESS_COUNT, signalWeight >= 2 ? 3 : DEFAULT_MIN_PROCESS_COUNT);
}

export function deriveProcessCandidates(input: ProcessCandidateInput): string[] {
  const minCount = Math.max(input.minCount || DEFAULT_MIN_PROCESS_COUNT, expectedProcessCountFromSignals(input));
  const maxCount = input.maxCount || DEFAULT_MAX_PROCESS_COUNT;
  const explicit = uniq([
    ...(input.processes || []),
    ...extractNumberedProcessTitlesFromText(input.sourceText || ''),
  ]);

  const derived = uniq([
    ...explicit,
    ...fromSignals(input.uiNeeds || [], 'ekran, aksiyon ve validasyon tasarimi', 2),
    ...fromSignals(input.documentRules || [], 'kontrol, belge ve kapanis kurallari', 2),
    ...fromSignals([...(input.systems || []), ...(input.integrations || [])], 'veri akisi, entegrasyon ve hata yonetimi', 3),
    ...fromSignals(input.roles || [], 'gorev, onay ve sorumluluk akisi', 2),
    ...fromSignals([...(input.dashboardNeeds || []), ...(input.kpis || [])], 'izleme, KPI ve raporlama tasarimi', 2),
    ...fromSignals(input.openTopics || [], 'karar ve dogrulama akisi', 2),
  ]).slice(0, maxCount);

  if (derived.length >= minCount) return derived.slice(0, Math.max(minCount, explicit.length));

  return uniq([
    ...derived,
    '[VARSAYIM] Talep alma, kapsamlandirma ve karar noktalarinin netlestirilmesi',
    '[VARSAYIM] Hedef surec, gereksinim ve kabul kriteri tasarimi',
    '[VARSAYIM] Operasyonel izleme, hata yonetimi ve raporlama',
  ]).slice(0, Math.max(minCount, derived.length));
}
