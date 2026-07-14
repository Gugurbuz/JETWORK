import { parse as parsePartialJson } from 'partial-json';
import { callGemini } from './geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { hybridSearch } from './contextManager';
import { DocumentData, KnowledgeItem, Question, SectionData } from '../types';
import { buildActionIntentContext, detectAiActionIntent } from '../modules/ai-actions/actionIntentRouter';

export type AgentPhase = 'PLAN' | 'RESEARCH' | 'REFLECT' | 'ACT';

export interface AgentLoopInput {
  userMessage: string;
  history: { role: 'user' | 'model'; parts: { text: string }[] }[];
  documentContent: DocumentData | null;
  knowledgeBase: KnowledgeItem[];
  model: string;
  systemInstruction: string;
  onPhase: (phase: AgentPhase, label: string) => void;
  onThinking: (text: string) => void;
  onActStream: (text: string, thinking: string | undefined, questions: Question[] | undefined, actionSummary: string | undefined, tokenCount: number) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}

export interface AgentLoopOutput {
  text: string;
  thinking: string;
  questions?: Question[];
  actionSummary?: string;
  groundingUrls?: { uri: string; title: string }[];
  plan?: PlanOutput;
  research?: string;
  reflection?: ReflectOutput;
  document?: DocumentData | null;
  tokenCount: number;
}

interface PlanOutput {
  plan: string;
  assumptions: string[];
  needsWebSearch: boolean;
  searchQueries: string[];
  documentGapsToCheck: string[];
  clarificationsNeeded: string[];
}

interface ReflectOutput {
  gapsFound: string[];
  flagsToRaise: { section: string; reason: string }[];
  criticalQuestionsForUser: string[];
  readyToAct: boolean;
  reasoning: string;
}

const ACT_TIMEOUT_MS = 90000;

function emptySection(content = ''): SectionData {
  return { content, status: 'DRAFT', flags: [] };
}

function sanitizeSection(section: any): SectionData | undefined {
  if (!section || typeof section !== 'object') return undefined;
  const content = typeof section.content === 'string' ? section.content : '';
  if (!content.trim()) return undefined;
  const status = ['DRAFT', 'NEEDS_REVISION', 'APPROVED'].includes(section.status) ? section.status : 'DRAFT';
  const flags = Array.isArray(section.flags) ? section.flags.filter((flag: any) => typeof flag === 'string') : [];
  return { content, status, flags };
}

function sanitizeDocument(document: any): DocumentData | undefined {
  if (!document || typeof document !== 'object') return undefined;
  const businessAnalysis = sanitizeSection(document.businessAnalysis);
  const review = sanitizeSection(document.review);
  if (!businessAnalysis && !review) return undefined;
  return {
    businessAnalysis: businessAnalysis || emptySection(),
    ...(review ? { review } : {}),
    suggestions: Array.isArray(document.suggestions) ? document.suggestions.filter((item: any) => typeof item === 'string') : undefined,
  };
}

function extractActParts(raw: string): { message: string; thinking?: string; questions?: Question[]; actionSummary?: string; document?: DocumentData } {
  if (!raw) return { message: '' };
  let trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) trimmed = fenceMatch[1].trim();
  if (!trimmed.startsWith('{')) return { message: raw };
  try {
    const parsed: any = parsePartialJson(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
        questions: Array.isArray(parsed.questions) ? parsed.questions : undefined,
        actionSummary: typeof parsed.actionSummary === 'string' ? parsed.actionSummary : undefined,
        document: sanitizeDocument(parsed.document),
      };
    }
  } catch {
    return { message: '' };
  }
  return { message: '' };
}

function briefDocumentSummary(document: DocumentData | null): string {
  if (!document) return '(Henuz dokuman yok.)';
  return [
    document.businessAnalysis?.content ? `BA Analiz:\n${document.businessAnalysis.content.slice(0, 1800)}` : '',
    document.review?.content ? `Review:\n${document.review.content.slice(0, 900)}` : '',
  ].filter(Boolean).join('\n\n') || '(Dokuman bolumleri bos.)';
}

function detectDocumentIntent(text = ''): boolean {
  return /dok[uü]man|kavramsal|tasar[iı]m|analiz|gereksinim|s[uü]re[cç]|flow|bpmn|test|uat|fdd|brd|rapor|haz[iı]rla|olu[sş]tur|yaz/i.test(text);
}

function buildFallbackDocument(userMessage: string, streamedText = '', existing?: DocumentData | null): DocumentData {
  const source = [userMessage, streamedText].filter(Boolean).join('\n\n').slice(0, 2400);
  const businessAnalysis = [
    '# KAVRAMSAL TASARIM RAPORU',
    '',
    '## 1. PROJE KIMLIK KARTI',
    '| Alan | Deger | Kaynak Durumu |',
    '|---|---|---|',
    `| Talep | ${userMessage.replace(/\|/g, '/')} | DOGRUDAN TALEP |`,
    '| Dokuman Durumu | Canli guvenli taslak | VARSAYIM |',
    '| Paydaslar | Is birimi, operasyon, IT, destek, raporlama kullanicilari | VARSAYIM |',
    '',
    '## 2. Amac',
    'Bu dokuman kullanici talebini karar verilebilir kavramsal tasarim seviyesine tasimak icin hazirlanmistir. Net olmayan noktalar [VARSAYIM] veya [ACIK KONU] olarak isaretlenir.',
    '',
    '## 3. Problem Modeli / As-Is / To-Be',
    '| Boyut | As-Is | To-Be |',
    '|---|---|---|',
    '| Is ihtiyaci | Kaynak talep ayrintilari sinirli veya daginik olabilir. | Problem, hedef, kapsam, aktor, ekran, veri, entegrasyon, kural ve KPI birlikte modellenir. |',
    '| Surec takibi | Manuel kararlar, kopuk takip veya genel tarif riski bulunur. | Her surec icin tetikleyici, karar, hata, kapanis ve raporlama kurali yazilir. |',
    '| Kalite | Genel taslak karar vermeye yetmeyebilir. | BR/FR/NFR/INT/UI/RPT/SEC/TEST izleriyle testlenebilir tasarim uretilir. |',
    '',
    '## 4. Kaynak Talep Ozeti',
    source || '[ACIK KONU] Kaynak talep metni bulunamadi.',
    '',
    '## 5. SUREC TASARIMI',
    '### SUREC MODELI - 1 "Talep alma, niyet ve kapsam belirleme"',
    '- Tetikleyici: Kullanici talebi, ek dokuman veya mevcut sohbet baglami.',
    '- Aktorler: Is analisti, is birimi, IT, operasyon.',
    '- Cikis: Problem cercevesi, varsayimlar, acik konular ve oncelikli kapsam.',
    '',
    '### SUREC MODELI - 2 "Cozum tasarimi ve gereksinimlestirme"',
    '- Tetikleyici: Kapsam veya varsayimli ilerleme karari.',
    '- Aktorler: Is analisti, cozum mimari, uygulama ekibi, QA.',
    '- Cikis: Surec akislari, is kurallari, ekran davranislari, veri ve entegrasyon karar noktalari.',
    '',
    '### SUREC MODELI - 3 "UAT, onay ve canli gecis hazirligi"',
    '- Tetikleyici: Tasarim dokumani review hazir hale geldiginde.',
    '- Aktorler: Is birimi, test ekibi, operasyon, destek.',
    '- Cikis: UAT kabul kriterleri, risk listesi, rollback ve operasyon devri.',
    '',
    '## 6. Is Gerekleri ve KPIs',
    '| Kod | Tur | Gereksinim | Kabul Kriteri |',
    '|---|---|---|---|',
    '| BR-01 | Is kurali | Kritik kararlar kaynak, varsayim ve acik konu olarak ayrilir. | Review bolumunde ayrim gorunur. |',
    '| FR-01 | Fonksiyonel | Kullanici talebine gore kavramsal tasarim dokumani uretilir. | Sag panelde BA Analiz dolu olusur. |',
    '| UI-01 | Ekran | Hata, uyari, basari ve eksik bilgi mesajlari tanimlanir. | Mesajlar kullanici aksiyonuna baglanir. |',
    '| INT-01 | Entegrasyon | Harici sistem/API ihtiyaclari sahiplik, hata ve retry ile yazilir. | Entegrasyon varsayimlari acikca isaretlenir. |',
    '| NFR-01 | Operasyonel kalite | Performans, loglama, audit, guvenlik ve destek ihtiyaclari yazilir. | NFR satirlari testlenebilir olur. |',
    '| KPI-01 | KPI | Surec tamamlanma, hata orani, manuel is yuku ve UAT basarisi izlenir. | KPI kaynak ve hedefleri reviewda takip edilir. |',
    '| TEST-01 | UAT | Pozitif, negatif, yetki, entegrasyon hata ve regresyon testleri tanimlanir. | Kritik UAT senaryolari onaylanmadan canli gecis olmaz. |',
    '',
    '## 7. Ekran / Validasyon / Mesaj Standardi',
    '- Basari mesaji: Dokuman taslagi olusturuldu; Review bolumunde varsayim ve acik konulari kontrol edin.',
    '- Uyari mesaji: Kritik karar net degil; varsayimla ilerleyebilir veya acik konu olarak birakabilirsiniz.',
    '- Hata mesaji: Uretim tamamlanamadi; guvenli taslak olusturuldu ve kalite notu eklendi.',
    '',
    '## 8. Test / UAT ve Degisim Yonetimi',
    '- Pozitif akis, negatif validasyon, yetki, entegrasyon hata, raporlama ve regresyon senaryolari test edilir.',
    '- Pilot, egitim, canli gecis, rollback ve operasyon devri plani hazirlanir.',
    '',
    '## EK A',
    '| Dokuman | Versiyon | Not |',
    '|---|---|---|',
    '| Kaynak talep / sohbet | V0.1 | Kullanici girdisi ana kaynak kabul edilir. |',
    '| UAT kanitlari | [ACIK KONU] | Canli gecis oncesi tamamlanir. |',
  ].join('\n');

  const review = [
    '## Review',
    '- Durum: NEEDS_REVISION / CANLI GUVENLI TASLAK',
    '- Kaynakla dogrudan dogrulanmayan kararlar [VARSAYIM] veya [ACIK KONU] olarak tutuldu.',
    '- Hızlı aksiyonlar: Word formatina duzelt, Review acik konularini kapat, UAT senaryolarini detaylandir.',
  ].join('\n');

  return {
    ...(existing || {}),
    businessAnalysis: { content: businessAnalysis, status: 'DRAFT', flags: ['SAFE_FALLBACK_DOCUMENT'] },
    review: { content: review, status: 'NEEDS_REVISION', flags: ['SAFE_FALLBACK_REVIEW'] },
    suggestions: ['Word formatina duzelt', 'Review acik konularini kapat', 'UAT senaryolarini detaylandir'],
  };
}

function buildPlan(userMessage: string): PlanOutput {
  return {
    plan: `Talebi is analizi/kavramsal tasarim bakisiyla isle: ${userMessage.slice(0, 180)}`,
    assumptions: [],
    needsWebSearch: /mevzuat|api|sap|iys|guncel|resmi kaynak/i.test(userMessage),
    searchQueries: [],
    documentGapsToCheck: ['Problem modeli', 'Surec modeli', 'Is gerekleri', 'KPI', 'Ekran/validasyon', 'UAT', 'Review'],
    clarificationsNeeded: [],
  };
}

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const { userMessage, history, documentContent, knowledgeBase, model, systemInstruction, onPhase, onThinking, onActStream } = input;
  let totalTokens = 0;
  let finalText = '';
  let finalThinking = '';
  let finalQuestions: Question[] | undefined;
  let finalActionSummary: string | undefined;
  let finalDocument: DocumentData | undefined;

  const plan = buildPlan(userMessage);
  const actionIntent = detectAiActionIntent(userMessage, []);
  const actionIntentContext = buildActionIntentContext(actionIntent);
  const docSummary = briefDocumentSummary(documentContent);
  const recentConversation = history.slice(-8).map(item => item.parts?.[0]?.text || '').filter(Boolean).join('\n').slice(0, 3000);
  const knowledgeContext = hybridSearch(userMessage, knowledgeBase, 5).map(item => `- ${item.content}`).join('\n') || '- Ilgili kurumsal hafiza bulunamadi.';
  const wantsDocument = detectDocumentIntent(userMessage);

  onPhase('PLAN', 'Strateji belirleniyor...');
  onThinking('Talep; problem, kapsam, kaynak, varsayim, surec, gereksinim, KPI ve UAT acisindan cerceveleniyor.');
  onPhase('RESEARCH', 'Kaynak ve baglam taraniyor...');
  onPhase('ACT', 'Dokuman hazirlaniyor...');
  onActStream('', '', undefined, undefined, totalTokens);

  const liveSystem = [
    systemInstruction,
    '',
    '[JETWORK CANLI BA MOTORU - ZORUNLU]',
    '- Cevap chatResponse JSON semasinda olmali.',
    '- Kullanici dokuman, kavramsal tasarim, analiz, gereksinim, surec, test veya rapor istiyorsa document alani ZORUNLUDUR.',
    '- Chat mesaji kisa olmalı; asil detay document.businessAnalysis.content icinde olmali.',
    '- document.businessAnalysis.content ana basligi KAVRAMSAL TASARIM RAPORU olmalı.',
    '- Word/kavramsal omurga zorunlu: Proje Kimlik Karti, Amac, Dokuman Tarihcesi, Surec Tasarimi, SUREC MODELI bloklari, Is Gerekleri ve KPIs, UAT, Degisim Yonetimi, EK A.',
    '- Kaynak talepte acik surec/ekran/rol/sistem/KPI varsa aynen tasinir; baska projeden SAP/IYS/D2D/dijital imza gibi sabit kalip bulastirilmaz.',
    '- Bilgi kesin degilse [VARSAYIM], karar bekliyorsa [ACIK KONU], kaynakla destekliyse [DOGRULANDI] yaz.',
    '- Yalnizca bloklayici ve geri donusu pahali karar varsa questions uret; aksi halde varsayimla dokuman uret.',
    '- Review bolumunde kalite notu, risk, varsayim, acik konu ve hizli aksiyonlari yaz.',
    '',
    '[KULLANICI TALEBI]',
    userMessage,
    '',
    '[SON KONUSMA]',
    recentConversation || '- Yok.',
    '',
    '[MEVCUT DOKUMAN]',
    docSummary,
    '',
    '[KURUMSAL HAFIZA]',
    knowledgeContext,
    '',
    '[OTONOM NIYET]',
    actionIntentContext || '- Yok.',
  ].join('\n');

  try {
    const response = await callGemini({
      model,
      systemInstruction: liveSystem,
      contents: [...history, { role: 'user', parts: [{ text: userMessage }] }],
      responseSchema: chatResponseJsonSchema,
      timeoutMs: ACT_TIMEOUT_MS,
      onChunk: (text, thinking, tokenCount) => {
        const parts = extractActParts(text);
        finalText = parts.message || finalText;
        finalThinking = parts.thinking || thinking || finalThinking;
        finalQuestions = parts.questions || finalQuestions;
        finalActionSummary = parts.actionSummary || finalActionSummary;
        finalDocument = parts.document || finalDocument;
        if (tokenCount) totalTokens = Math.max(totalTokens, tokenCount);
        onActStream(finalText, finalThinking, finalQuestions, finalActionSummary, totalTokens);
      },
    });
    const parts = extractActParts(response.text);
    const raw = (response.text || '').trim();
    const rawLooksJson = raw.startsWith('{') || raw.startsWith('```');
    finalText = parts.message || (rawLooksJson ? finalText : response.text) || finalText;
    finalThinking = parts.thinking || response.thinking || finalThinking;
    finalQuestions = parts.questions || finalQuestions;
    finalActionSummary = parts.actionSummary || finalActionSummary;
    finalDocument = parts.document || finalDocument;
    totalTokens = Math.max(totalTokens, response.tokenCount || 0);
  } catch (error) {
    console.warn('BA generation failed; using safe fallback document:', error);
  }

  if (wantsDocument && !finalDocument) {
    finalDocument = buildFallbackDocument(userMessage, finalText, documentContent);
    finalText = 'Sag panelde guvenli kavramsal tasarim taslagi olusturdum; varsayim ve acik konular Review bolumunde isaretlendi.';
    finalActionSummary = 'BA Analiz ve Review bolumleri guvenli taslak olarak guncellendi.';
  }

  return {
    text: finalText || 'Islem tamamlandi.',
    thinking: finalThinking,
    questions: finalQuestions,
    actionSummary: finalActionSummary,
    groundingUrls: undefined,
    plan,
    research: knowledgeContext,
    reflection: {
      gapsFound: [],
      flagsToRaise: [],
      criticalQuestionsForUser: [],
      readyToAct: true,
      reasoning: 'Canli hotfix: dokuman niyetinde sag panel bos kalmaz; kaynak/varsayim/acik konu ayrimi zorlanir.',
    },
    document: finalDocument,
    tokenCount: totalTokens,
  };
};
