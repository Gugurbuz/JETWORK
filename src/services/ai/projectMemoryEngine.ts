import type { DocumentData, ProjectMemoryItem, ProjectMemoryItemType } from '../../types';

export type ProjectMemory = Record<string, string>;

export interface ProjectMemoryExtractionInput {
  userMessage: string;
  aiMessage?: string;
  document?: DocumentData | null;
}

const MAX_MEMORY_ITEMS = 60;

const normalize = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const clean = (value = ''): string => value
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[.;,]+$/, '');

const slug = (value = ''): string => normalize(value)
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 48) || 'not';

const memorySubjectSlug = (value: string, index: number): string => {
  const subject = normalize(value)
    .replace(/\b(art[ıi]k|bundan sonra|olsun|olacak|olarak|belirlendi|degisti|degissin)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)*\b/g, ' ')
    .replace(/\b(tl|try|usd|eur|yuzde)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(token => token.length > 2)
    .slice(0, 4)
    .join(' ');
  return slug(subject || `item_${index + 1}`);
};

function put(memory: ProjectMemory, key: string, value: string): void {
  const safeValue = clean(value);
  if (!safeValue || safeValue.length < 4) return;
  memory[key] = safeValue.slice(0, 280);
}

function extractLabeledLines(text: string, label: string): string[] {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*(.+)`, 'gi');
  return Array.from(text.matchAll(pattern))
    .map(match => clean(match[1] || ''))
    .filter(Boolean)
    .slice(0, 8);
}

function extractPreferenceMemory(text: string, out: ProjectMemory): void {
  const normalized = normalize(text);
  if (/derin|detayli|eksiksiz|karar verilebilir|gercek urun|mvp degil/.test(normalized)) {
    put(out, 'preference.analysis_depth', 'Ciktilar yuzeysel degil, karar verilebilir ve urun seviyesinde derin olmalidir.');
  }
  if (/word|kavramsal tasarim|birebir yapida|format/.test(normalized)) {
    put(out, 'preference.document_format', 'Kavramsal tasarim dokumanlari kurumsal Word sablonuna yakin, BA Analiz + Review yuzeyinde uretilmelidir.');
  }
  if (/soru|netlestir|insan is analisti|kritik karar/.test(normalized)) {
    put(out, 'preference.question_policy', 'AI her eksige soru sormaz; yuksek etkili ve geri donusu pahali kararlar icin hedefli soru sorar, dusuk etkili bosluklari isaretli varsayimla ilerletir.');
  }
  if (/kaynak|dogrula|resmi|api|mevzuat|varsayim|acik konu/.test(normalized)) {
    put(out, 'preference.evidence_policy', 'Kaynakli iddialar DOGRULANDI/CIKARIM/VARSAYIM/ACIK_KONU olarak ayrilmali; resmi kaynak olmadan mevzuat/API iddiasi kesin yazilmamalidir.');
  }
  if (/flow|it analiz|test|bpmn|sekme/.test(normalized)) {
    put(out, 'preference.visible_sections', 'Yeni uretimde ana gorunur yuzey BA Analiz ve Review olmalidir; teknik/test/flow detaylari BA dokumani icinde alt baslik olarak yer alir.');
  }
  if (/runtime|state machine|arac|tool|tamamlanma|completion|insan onayi|approval|calisma mantigi/.test(normalized)) {
    put(out, 'preference.runtime_policy', 'AI karar aninda state machine, kaynak envanteri, tool honesty, insan onayi ve tamamlanma kanitini ayri izlemelidir.');
  }
}

function extractExplicitMemory(text: string, out: ProjectMemory): void {
  extractLabeledLines(text, 'karar').forEach((line, index) => {
    put(out, `decision.${memorySubjectSlug(line, index)}`, line);
  });
  extractLabeledLines(text, 'varsayim').forEach((line, index) => {
    put(out, `assumption.${memorySubjectSlug(line, index)}`, line);
  });
  extractLabeledLines(text, 'kisit').forEach((line, index) => {
    put(out, `constraint.${memorySubjectSlug(line, index)}`, line);
  });
  extractLabeledLines(text, 'acik konu').forEach((line, index) => {
    put(out, `open_question.${memorySubjectSlug(line, index)}`, line);
  });

  const rememberMatches = Array.from(text.matchAll(/(?:not et|hatirla|bundan sonra|bizim beklentimiz|kural olarak)\s*[:\-]?\s*(.{8,220})/gi));
  rememberMatches.slice(0, 8).forEach((match, index) => {
    const value = clean(match[1] || '');
    put(out, `user_memory.${slug(value) || index + 1}`, value);
  });
}

export function extractProjectMemoryUpdates(input: ProjectMemoryExtractionInput): ProjectMemory {
  const out: ProjectMemory = {};
  // AI output is not evidence of a project fact. Until the structured memory
  // model carries provenance and confirmation state, persist only explicit
  // user statements.
  extractPreferenceMemory(input.userMessage, out);
  extractExplicitMemory(input.userMessage, out);
  return out;
}

const structuredTypeFromKey = (key: string): ProjectMemoryItemType => {
  const prefix = key.split('.')[0];
  const mapping: Record<string, ProjectMemoryItemType> = {
    decision: 'DECISION',
    requirement: 'REQUIREMENT',
    constraint: 'CONSTRAINT',
    assumption: 'ASSUMPTION',
    business_rule: 'BUSINESS_RULE',
    term: 'TERM',
    preference: 'PREFERENCE',
    open_question: 'OPEN_QUESTION',
  };
  return mapping[prefix] || 'FACT';
};

export function getActiveMemoryItems(items: ProjectMemoryItem[] = []): ProjectMemoryItem[] {
  const supersededIds = new Set(items.map(item => item.supersedes).filter(Boolean));
  return items.filter(item => (
    !supersededIds.has(item.id)
    && item.confirmationStatus !== 'REJECTED'
  ));
}

export function extractStructuredProjectMemory(input: {
  userMessage: string;
  sourceId: string;
  existing?: ProjectMemoryItem[];
  now?: string;
}): ProjectMemoryItem[] {
  const updates = extractProjectMemoryUpdates({ userMessage: input.userMessage });
  const existing = getActiveMemoryItems(input.existing || []);
  const now = input.now || new Date().toISOString();

  return Object.entries(updates).flatMap(([key, value]) => {
    const previous = [...existing].reverse().find(item => item.key === key);
    if (previous && normalize(previous.value) === normalize(value)) return [];

    return [{
      id: crypto.randomUUID(),
      key,
      type: structuredTypeFromKey(key),
      value,
      sourceType: 'USER' as const,
      sourceId: input.sourceId,
      confirmationStatus: 'CONFIRMED' as const,
      confidence: 1,
      validFrom: now,
      version: (previous?.version || 0) + 1,
      ...(previous ? { supersedes: previous.id } : {}),
    }];
  });
}

export function mergeStructuredProjectMemory(
  existing: ProjectMemoryItem[] = [],
  updates: ProjectMemoryItem[] = [],
): ProjectMemoryItem[] {
  const byId = new Map(existing.map(item => [item.id, item]));
  updates.forEach(item => byId.set(item.id, item));
  return [...byId.values()]
    .sort((left, right) => left.validFrom.localeCompare(right.validFrom))
    .slice(-120);
}

export function mergeProjectMemory(existing: ProjectMemory = {}, updates: ProjectMemory = {}): ProjectMemory {
  const merged: ProjectMemory = { ...existing, ...updates };
  const entries = Object.entries(merged).filter(([, value]) => !!clean(value));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_MEMORY_ITEMS)));
}

export function buildProjectMemoryContext(memory: ProjectMemory = {}): string {
  const entries = Object.entries(memory);
  if (!entries.length) return '';
  return [
    '[USER-SOURCED PROJECT MEMORY - ZORUNLU]',
    'Bu bilgiler bu workspace icin kalici tercih/karar hafizasidir. Kullanici aksini soylemedikce uygula.',
    ...entries.slice(-24).map(([key, value]) => `- ${key}: ${value}`),
  ].join('\n');
}
