import { parse as parsePartialJson } from 'partial-json';
import { callGemini } from './geminiService';
import { chatResponseJsonSchema } from '../schemas';
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
  plan?: { plan: string; assumptions: string[]; needsWebSearch: boolean; searchQueries: string[]; documentGapsToCheck: string[]; clarificationsNeeded: string[] };
  research?: string;
  reflection?: { gapsFound: string[]; flagsToRaise: { section: string; reason: string }[]; criticalQuestionsForUser: string[]; readyToAct: boolean; reasoning: string };
  document?: DocumentData | null;
  tokenCount: number;
}

const ACT_TIMEOUT_MS = 90000;

const sanitizeSection = (section: any): SectionData | undefined => {
  if (!section || typeof section !== 'object') return undefined;
  const content = typeof section.content === 'string' ? section.content : '';
  if (!content.trim()) return undefined;
  const status = ['DRAFT', 'NEEDS_REVISION', 'APPROVED'].includes(section.status) ? section.status : 'DRAFT';
  const flags = Array.isArray(section.flags) ? section.flags.filter((flag: any) => typeof flag === 'string') : [];
  return { content, status, flags };
};

const emptySection = (content = ''): SectionData => ({ content, status: 'DRAFT', flags: [] });

const sanitizeDocument = (document: any): DocumentData | undefined => {
  if (!document || typeof document !== 'object') return undefined;
  const businessAnalysis = sanitizeSection(document.businessAnalysis);
  const code = sanitizeSection(document.code);
  const test = sanitizeSection(document.test);
  const bpmn = sanitizeSection(document.bpmn);
  const review = sanitizeSection(document.review);
  if (!businessAnalysis && !code && !test && !bpmn && !review) return undefined;
  return {
    businessAnalysis: businessAnalysis || emptySection(),
    code: code || emptySection('Teknik analiz, entegrasyon, veri modeli ve hata yonetimi detaylari BA Analiz icindeki ilgili bolumlerde ele alinmistir.'),
    test: test || emptySection('Test, UAT, negatif senaryo ve kabul kriterleri BA Analiz icindeki Test / UAT bolumunde ele alinmistir.'),
    ...(bpmn ? { bpmn } : {}),
    ...(review ? { review } : {}),
    suggestions: Array.isArray(document.suggestions) ? document.suggestions.filter((item: any) => typeof item === 'string') : undefined,
  };
};

const extractActParts = (raw: string): { message: string; thinking?: string; questions?: Question[]; actionSummary?: string; document?: DocumentData } => {
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
};

const buildFallbackDocument = (userMessage: string, streamedText = ''): DocumentData => {
  const summary = streamedText.trim().length > 120
    ? streamedText.trim()
    : `Kullanici talebi: ${userMessage}`;

  const businessAnalysis = [
    '# KAVRAMSAL TASARIM RAPORU',
    '',
    '## 1. Proje Kimlik Karti',
    '| Alan | Deger | Kaynak Durumu |',
    '| --- | --- | --- |',
    '| Talep | ' + userMessage.replace(/\|/g, '/') + ' | DOGRUDAN TALEP |',
    '| Dokuman Durumu | Canli guvenli taslak | VARSAYIM |',
    '| Paydaslar | Is birimi, operasyon, IT, satis/servis ekipleri, destek ve raporlama kullanicilari | VARSAYIM |',
    '',
    '## 2. Problem Modeli',
    summary,
    '',
    '## 3. As-Is / To-Be',
    '| Boyut | As-Is | To-Be |',
    '| --- | --- | --- |',
    '| Surec | Mevcut ihtiyac ayrintilari kullanicidan veya dokumandan netlestirilmelidir. | Ana surecler, aktorler, ekran davranislari, veri ve entegrasyon kurallari karar verilebilir seviyede modellenir. |',
    '| Kontrol | Eksik veya daginik takip olabilir. | Validasyon, yetki, audit, hata ve bildirim kurallari tanimlanir. |',
    '',
    '## 4. Surec Modeli Bloklari',
    '### SUREC MODELI - 1 "Talep alma ve niyet/kapsam belirleme"',
    '- Tetikleyici: Kullanici talebi veya proje dokumani.',
    '- Aktorler: Is analisti, is birimi, IT, operasyon.',
    '- Cikis: Oncelikli kapsam, acik konular ve varsayimlar.',
    '',
    '### SUREC MODELI - 2 "Cozum tasarimi ve gereksinimlestirme"',
    '- Tetikleyici: Kapsam onayi veya varsayimli ilerleme karari.',
    '- Aktorler: Is analisti, cozum mimari, uygulama ekibi.',
    '- Cikis: BR/FR/NFR/INT/UI/RPT/SEC gereksinimleri, ekran ve veri kurallari.',
    '',
    '### SUREC MODELI - 3 "UAT, onay ve canli gecis hazirligi"',
    '- Tetikleyici: Tasarim dokumani review hazir hale geldiginde.',
    '- Aktorler: Is birimi, test ekibi, operasyon, destek.',
    '- Cikis: UAT kabul, risk ve rollback plani.',
    '',
    '## 5. Is Gerekleri ve KPI',
    '| Kod | Tur | Aciklama | Kabul Kriteri |',
    '| --- | --- | --- | --- |',
    '| BR-01 | Is Kurali | Kritik kararlar [DOGRULANDI], [VARSAYIM], [ACIK KONU] olarak ayrilir. | Review bolumunde ayrim gorunur. |',
    '| FR-01 | Fonksiyonel | Kullanici ana surecleri takip edebilir ve cikti dokumani olusturabilir. | BA Analiz paneli dolu uretilir. |',
    '| UI-01 | Ekran | Eksik bilgi, hata ve basari durumlari icin kullanici mesaji tanimlanir. | Toast/validasyon mesajlari dokumanda yer alir. |',
    '| INT-01 | Entegrasyon | Harici sistem/API ihtiyaclari kaynak ve sahiplikle yazilir. | Entegrasyon kararlari acik konu veya varsayim olarak isaretlenir. |',
    '| KPI-01 | Olcum | Dokuman kapsami, acik konu sayisi, UAT basari orani ve hata orani izlenir. | KPI tablosu review ile uyumludur. |',
    '| TEST-01 | UAT | Pozitif, negatif, yetki, entegrasyon hata ve regresyon senaryolari tanimlanir. | UAT onayi olmadan canli gecis yapilmaz. |',
    '',
    '## 6. Ekran, Validasyon ve Mesajlar',
    '- Basarili islem: "Dokuman taslagi olusturuldu; Review bolumunde varsayim ve acik konulari kontrol edin."',
    '- Eksik bilgi: "Kritik karar eksik; varsayimla ilerleyebilir veya acik konu olarak birakabilirsiniz."',
    '- Hata: "Dokuman uretimi tamamlanamadi; guvenli taslak olusturuldu ve review isareti eklendi."',
    '',
    '## 7. Test / UAT ve Degisim Yonetimi',
    '- Pozitif akis, negatif validasyon, yetki, entegrasyon hata, raporlama ve regresyon senaryolari test edilir.',
    '- Pilot, egitim, canli gecis, rollback ve operasyon devri plani hazirlanir.',
    '',
    '## 8. Acik Konular',
    '- [ACIK KONU] Net kapsam, sistem sahipligi, veri alanlari, ekranlar, entegrasyonlar ve KPI hedefleri is birimiyle dogrulanmalidir.',
  ].join('\n');

  return {
    businessAnalysis: { content: businessAnalysis, status: 'DRAFT', flags: ['SAFE_FALLBACK_DOCUMENT'] },
    code: emptySection('Teknik analiz detaylari BA Analiz icinde kavramsal seviyede ele alinmistir.'),
    test: emptySection('Test ve UAT detaylari BA Analiz icindeki Test / UAT bolumunde ele alinmistir.'),
    review: {
      content: [
        '## Review',
        '- [VARSAYIM] Model cagrisi tam yapilandirilmis dokuman dondurmediyse guvenli taslak olusturuldu.',
        '- [ACIK KONU] Is birimi kapsam, ekran, veri ve entegrasyon kararlarini dogrulamalidir.',
        '- [KALITE] Sonraki aksiyon: Eksikleri tamamla, Word formatina duzelt, Review acik konularini kapat.',
      ].join('\n'),
      status: 'NEEDS_REVISION',
      flags: ['SAFE_FALLBACK_REVIEW'],
    },
    suggestions: ['Eksikleri tamamla', 'Word formatina duzelt', 'Review acik konularini kapat'],
  };
};

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const { userMessage, history, documentContent, knowledgeBase, model, systemInstruction, onPhase, onThinking, onActStream } = input;
  let totalTokens = 0;
  let finalText = '';
  let finalThinking = '';
  let finalQuestions: Question[] | undefined;
  let finalActionSummary: string | undefined;
  let finalDocument: DocumentData | undefined;

  const actionIntent = detectAiActionIntent(userMessage, []);
  const actionIntentContext = buildActionIntentContext(actionIntent);
  const memoryContext = knowledgeBase.slice(0, 6).map(item => `- ${item.content}`).join('\n') || '- Ilgili kurumsal hafiza yok.';

  onPhase('PLAN', 'Strateji belirleniyor...');
  onThinking('Talep problem, kapsam, kaynak/varsayim ayrimi, surec modeli, gereksinim, KPI ve UAT acisindan cerceveleniyor.');

  onPhase('ACT', 'Dokuman hazirlaniyor...');
  onActStream('', '', undefined, undefined, totalTokens);

  const safeSystemInstruction = [
    systemInstruction,
    '',
    '[CANLI GUVENLI BA DOKUMAN URETIMI]',
    '- Cevap chatResponse JSON semasinda olmali.',
    '- document alani zorunludur; businessAnalysis, code, test ve review alanlarini doldur.',
    '- Gorunur ana detay businessAnalysis icinde olmalidir: kavramsal tasarim, surec modelleri, is gerekleri, KPI, ekran/validasyon/toast, veri, entegrasyon, test/UAT, degisim yonetimi, acik konular.',
    '- code/test alanlari bos kalmasin ama teknik/test detaylarini businessAnalysis icinde de yaz.',
    '- Eksik bilgileri [VARSAYIM] veya [ACIK KONU] olarak isaretle.',
    '- questions alanini sadece gercekten bloklayici karar varsa doldur; varsayimla ilerleme sinyali varsa bos birak.',
    '- Mesaj kisa olsun; asil detay dokumanda olsun.',
    '',
    '[OTONOM NIYET SINYALI]',
    actionIntentContext || '- Yok.',
    '',
    '[KURUMSAL HAFIZA]',
    memoryContext,
    '',
    '[MEVCUT DOKUMAN]',
    documentContent ? JSON.stringify(documentContent).slice(0, 5000) : '- Henuz dokuman yok.',
  ].join('\n');

  try {
    const response = await callGemini({
      model,
      systemInstruction: safeSystemInstruction,
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
    console.warn('BA ACT generation failed or timed out; using safe fallback document:', error);
  }

  if (!finalDocument) {
    finalDocument = buildFallbackDocument(userMessage, finalText);
    finalText = finalText && finalText.trim().length > 80
      ? finalText
      : 'Dokuman uretim cagrisi tamamlanamadigi icin sag panelde guvenli kavramsal tasarim taslagi olusturdum; varsayim ve acik konular Review bolumunde isaretlendi.';
    finalActionSummary = finalActionSummary || 'Sag panel icin guvenli BA taslagi olusturuldu; eksikler varsayim/acik konu olarak isaretlendi.';
  }

  return {
    text: finalText,
    thinking: finalThinking,
    questions: finalQuestions,
    actionSummary: finalActionSummary,
    groundingUrls: undefined,
    plan: {
      plan: 'Talebi kavramsal tasarim dokumani olarak cercevele, eksikleri varsayim/acik konu olarak ayir, sag paneli bos birakma.',
      assumptions: [],
      needsWebSearch: false,
      searchQueries: [],
      documentGapsToCheck: ['Problem modeli', 'Surec modeli', 'Gereksinim', 'KPI', 'UAT', 'Review'],
      clarificationsNeeded: [],
    },
    research: memoryContext,
    reflection: {
      gapsFound: [],
      flagsToRaise: [],
      criticalQuestionsForUser: [],
      readyToAct: true,
      reasoning: 'Canli guvenli loop: model takilirsa fallback dokuman uretir.',
    },
    document: finalDocument,
    tokenCount: totalTokens,
  };
};
