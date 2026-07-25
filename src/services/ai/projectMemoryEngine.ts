import type { DocumentData } from '../../types';

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
    put(out, `decision.${slug(line) || index + 1}`, line);
  });
  extractLabeledLines(text, 'varsayim').forEach((line, index) => {
    put(out, `assumption.${slug(line) || index + 1}`, line);
  });
  extractLabeledLines(text, 'kisit').forEach((line, index) => {
    put(out, `constraint.${slug(line) || index + 1}`, line);
  });
  extractLabeledLines(text, 'acik konu').forEach((line, index) => {
    put(out, `open_question.${slug(line) || index + 1}`, line);
  });

  const rememberMatches = Array.from(text.matchAll(/(?:not et|hatirla|bundan sonra|bizim beklentimiz|kural olarak)\s*[:\-]?\s*(.{8,220})/gi));
  rememberMatches.slice(0, 8).forEach((match, index) => {
    const value = clean(match[1] || '');
    put(out, `user_memory.${slug(value) || index + 1}`, value);
  });
}

export function extractProjectMemoryUpdates(input: ProjectMemoryExtractionInput): ProjectMemory {
  const out: ProjectMemory = {};
  // Canonical memory is user-authored. Assistant prose may contain useful
  // hypotheses, but it must never silently become a locked project fact.
  extractPreferenceMemory(input.userMessage, out);
  extractExplicitMemory(input.userMessage, out);
  return out;
}

export function mergeProjectMemory(existing: ProjectMemory = {}, updates: ProjectMemory = {}): ProjectMemory {
  const merged: ProjectMemory = { ...existing, ...updates };
  const entries = Object.entries(merged).filter(([, value]) => !!clean(value));
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_MEMORY_ITEMS)));
}

export function buildProjectMemoryContext(memory: ProjectMemory = {}): string {
  const priority: Record<string, number> = {
    decision: 100,
    constraint: 95,
    requirement: 90,
    business_rule: 90,
    user_memory: 88,
    preference: 80,
    term: 70,
    open_question: 60,
    assumption: 30,
  };
  const entries = Object.entries(memory)
    .sort(([left], [right]) => (
      (priority[right.split('.')[0]] || 50) - (priority[left.split('.')[0]] || 50)
    ));
  if (!entries.length) return '';
  return [
    '[USER-SOURCED PROJECT MEMORY - ZORUNLU]',
    'Bu kayıtlar aktif workspace için kullanıcı mesajından türetilmiştir.',
    'decision/constraint/requirement kayıtları AI çıkarımı ve varsayımdan daha üstündür.',
    'Kullanıcı açıkça düzeltmedikçe kilitli kararları ve kapsamı değiştirme.',
    ...entries.slice(0, 30).map(([key, value]) => `- ${key}: ${value}`),
  ].join('\n');
}
