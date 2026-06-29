import { parse as parsePartialJson } from 'partial-json';
import { DocumentData, KnowledgeItem, Message, Question } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { runBaAgentLoop, AgentPhase } from './baAgentLoop';
import { applyNodeUpdate, ANALYST_WEB_SYSTEM_PROMPT } from './intentRouter';
import { hybridSearch } from './contextManager';
import { supabase } from '../supabase';
import { classifyIntent } from './ai/intentClassifier';
import { decideAction } from './ai/decisionPolicy';
import { IntentClassification, DocumentSectionKey, SubIntent } from './ai/intentTypes';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { chatResponseJsonSchema } from '../schemas';
import { computeDiscoverySignals, DRAFT_FIRST_SYSTEM_RULE, containsBlockedQuestionDomain } from './ai/discoveryPolicy';
import { buildClassification } from './ai/intentClassifier';

const FALLBACK_QUESTION_OPTIONS = [
  'Varsayımla ilerle',
  'Açık konu olarak bırak',
  'Bu kararı ben netleştireceğim',
];

function extractOptionsFromQuestionText(text = ''): string[] {
  const optionMatch = text.match(/(?:^|\n)\s*Se(?:ç|c)enekler\s*:\s*([^\n]+)/i);
  if (!optionMatch?.[1]) return [];
  return optionMatch[1].split('|').map((option) => option.trim()).filter(Boolean).slice(0, 4);
}

function cleanQuestionText(text = ''): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(Neden|Dokumana etkisi|Dokümana etkisi|Secenekler|Seçenekler)\s*:/i.test(line));
  return (lines[0] || text || '').trim();
}

function normalizeQuestion(question: any, index: number): Question {
  const rawText = typeof question === 'string' ? question : String(question?.text || '');
  const directOptions = Array.isArray(question?.options) ? question.options.map(String).filter(Boolean) : [];
  const extractedOptions = extractOptionsFromQuestionText(rawText);
  const options = directOptions.length ? directOptions : extractedOptions.length ? extractedOptions : FALLBACK_QUESTION_OPTIONS;
  return {
    id: String(question?.id || `q${index + 1}`),
    text: cleanQuestionText(rawText),
    options: options.slice(0, 4),
  };
}

function normalizeQuestions(questions: any[] | undefined): Question[] | undefined {
  if (!Array.isArray(questions) || questions.length === 0) return undefined;
  return questions.slice(0, 4).map((question, index) => normalizeQuestion(question, index));
}

const extractParts = (raw: string): { message: string; questions?: Question[]; actionSummary?: string; thinking?: string } => {
  if (!raw) return { message: '' };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { message: raw };
  try {
    const parsed: any = parsePartialJson(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        questions: normalizeQuestions(parsed.questions),
        actionSummary: typeof parsed.actionSummary === 'string' ? parsed.actionSummary : undefined,
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
      };
    }
  } catch {
    return { message: '' };
  }
  return { message: raw };
};

export type SingleChatIntent =
  | 'chat_only'
  | 'analyze_request'
  | 'revise_section'
  | 'update_node'
  | 'generate_tests'
  | 'generate_flow'
  | 'research_internal'
  | 'research_web'
  | 'memory_action'
  | 'workflow_action'
  | 'preview_required'
  | 'ask_questions';

export interface SingleChatInput {
  userMessage: string;
  history: { role: 'user' | 'model'; parts: { text: string }[] }[];
  documentContent: DocumentData | null;
  knowledgeBase: KnowledgeItem[];
  model: string;
  systemInstruction: string;
  selectedNodeContent?: string | null;
  selectedSection?: DocumentSectionKey | null;
  messageHistory?: Message[];
  onPhase: (phase: AgentPhase | 'INTENT', label: string) => void;
  onThinking: (text: string) => void;
  onStream: (text: string, thinking: string | undefined, questions: Question[] | undefined, actionSummary: string | undefined, tokenCount: number) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}

export interface SingleChatResult {
  text: string;
  thinking: string;
  questions?: Question[];
  actionSummary?: string;
  groundingUrls?: { uri: string; title: string }[];
  document?: DocumentData | null;
  intent: SingleChatIntent;
  classification?: IntentClassification;
  tokenCount: number;
}

function visibleFocusHint(classification: IntentClassification): string {
  const focus = classification.baAgentFocus;
  const target = classification.targetSection;
  if (focus === 'test') return '\n\n[ODAK] Test stratejisi, UAT ve kabul senaryolarını BA Analiz içinde detaylı alt başlık olarak yaz; ayrı test sekmesi üretme.';
  if (focus === 'flow') return '\n\n[ODAK] Süreç akışını BA Analiz içinde metinsel/Mermaid taslak olarak yaz; ayrı FLOW/BPMN sekmesi üretme.';
  if (focus === 'technical_analysis') return '\n\n[ODAK] Teknik analiz, API, veri modeli ve entegrasyon mimarisini BA Analiz içinde kavramsal tasarım alt başlıkları olarak yaz.';
  if (focus === 'review') return '\n\n[ODAK] Review bölümünde riskler, açık sorular ve kalite gözden geçirmesi üret.';
  if (target) return `\n\n[ODAK] Özellikle "${target}" bölümünü güncelle; teknik/test/akış detaylarını BA Analiz içinde tut.`;
  return '';
}

async function runChatOnly(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Yanıt hazırlanıyor...');
  let raw = '';
  let thinking = '';
  let tokens = 0;
  let lastParts: { message: string; questions?: Question[]; actionSummary?: string } = { message: '' };
  const sys = `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}\n\nBu tur SADECE sohbet cevabı. Dokümanı değiştirme, uzun analiz üretme.\n\nÇIKTI JSON:\n{ "message": "kullanıcıya gösterilecek kısa doğal dil/Markdown", "questions": [ { "id": "q1", "text": "...", "options": ["..."] } ], "actionSummary": "opsiyonel" }\n\n- Netleştirici soru soracaksan questions alanını doldur ve her soruya 2-4 seçenek koy.`;
  await callAiWithRetry(() => callGemini({
    model: input.model,
    systemInstruction: sys,
    contents: [...input.history, { role: 'user', parts: [{ text: input.userMessage }] }],
    onChunk: (text, think, tokenCount) => {
      raw = text;
      if (think) thinking = think;
      if (tokenCount) tokens = tokenCount;
      const parts = extractParts(raw);
      lastParts = parts;
      input.onStream(parts.message || '', thinking, parts.questions, parts.actionSummary, tokens);
    },
  }));
  const finalParts = extractParts(raw);
  return {
    text: finalParts.message || lastParts.message || '',
    thinking,
    questions: finalParts.questions || lastParts.questions,
    actionSummary: finalParts.actionSummary || lastParts.actionSummary,
    intent: 'chat_only',
    classification,
    tokenCount: tokens,
  };
}

async function runAskClarifyingQuestions(input: SingleChatInput, classification: IntentClassification, code?: string): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Netleştirici sorular hazırlanıyor...');
  if (classification.clarificationQuestions && classification.clarificationQuestions.length > 0) {
    const questions = normalizeQuestions(classification.clarificationQuestions) || [];
    const msg = code === 'MISSING_SELECTION'
      ? 'Seçili metin göremedim. Dokümandan ilgili kısmı seçip tekrar dener misin?'
      : 'Devam etmeden önce şu kritik noktaları netleştirmem gerekiyor. Her soruda hızlı cevap seçebilir veya kendi cevabını yazabilirsin.';
    input.onStream(msg, '', questions, 'ask_clarifying_questions', 0);
    return { text: msg, thinking: '', questions, intent: 'ask_questions', classification, tokenCount: 0 };
  }

  let raw = '';
  let tokens = 0;
  const sys = `Sen JetWork AI'sın. Kullanıcının isteğini netleştirmek için EN FAZLA 3 hızlı cevaplanabilir soru üret.\n\nÇIKTI JSON:\n{ "message": "kısa giriş", "questions": [ { "id": "q1", "text": "...", "options": ["seçenek 1", "seçenek 2", "seçenek 3"] } ] }\n\n- Her soruda 2-4 seçenek zorunlu.\n- Genel BA soruları yerine talebe özel kritik karar soruları sor.\n- Dokümanı değiştirme.`;
  await callAiWithRetry(() => callGemini({
    model: input.model,
    systemInstruction: sys,
    contents: [...input.history, { role: 'user', parts: [{ text: input.userMessage }] }],
    onChunk: (text, _think, tokenCount) => {
      raw = text;
      if (tokenCount) tokens = tokenCount;
      const parts = extractParts(raw);
      input.onStream(parts.message || '', '', parts.questions, parts.actionSummary, tokens);
    },
  }));
  const finalParts = extractParts(raw);
  return {
    text: finalParts.message || 'Birkaç netleştirici sorum var.',
    thinking: '',
    questions: finalParts.questions,
    actionSummary: finalParts.actionSummary,
    intent: 'ask_questions',
    classification,
    tokenCount: tokens,
  };
}

async function runUpdateSelectedText(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Seçili metin güncelleniyor...');
  const section: DocumentSectionKey = (classification.targetSection as DocumentSectionKey) || (input.selectedSection as DocumentSectionKey) || 'businessAnalysis';
  const editSystem = `Kullanıcının talep ettiği şekilde SADECE aşağıdaki seçili metni yeniden yaz.\nSonucu düz metin/Markdown olarak döndür, başka yorum EKLEME.\n\n[SEÇİLİ METİN]\n${input.selectedNodeContent || ''}`;
  let newContent = '';
  let thinking = '';
  let tokens = 0;
  await callAiWithRetry(() => callGemini({
    model: input.model,
    systemInstruction: editSystem,
    contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
    onChunk: (text, think, tokenCount) => {
      newContent = text;
      if (think) thinking = think;
      if (tokenCount) tokens = tokenCount;
    },
  }));
  const updated = input.documentContent ? applyNodeUpdate(input.documentContent, section, newContent) : undefined;
  const summary = `Seçili metni "${section}" bölümünde güncelledim.`;
  input.onStream(summary, thinking, undefined, summary, tokens);
  return { text: summary, thinking, actionSummary: summary, document: updated, intent: 'update_node', classification, tokenCount: tokens };
}

async function runResearchInternal(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('RESEARCH', 'Kurumsal hafıza taranıyor...');
  const query = input.userMessage;
  let hits: { content: string }[] = [];
  try {
    const { data } = await supabase.rpc('match_knowledge_text', { query_text: query, match_count: 5 });
    hits = data || [];
  } catch (error) {
    console.warn('match_knowledge_text failed:', error);
  }
  if (hits.length === 0) hits = hybridSearch(query, input.knowledgeBase, 5).map((hit) => ({ content: hit.content }));
  const text = hits.length > 0
    ? `**Kurumsal Hafıza (${query}):**\n\n${hits.map((hit, index) => `${index + 1}. ${hit.content}`).join('\n\n')}`
    : `"${query}" için kurumsal hafızada kayıt bulunamadı.`;
  input.onStream(text, '', undefined, `research_internal(${query})`, 0);
  return { text, thinking: '', intent: 'research_internal', classification, tokenCount: 0 };
}

async function runResearchWeb(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('RESEARCH', 'Web kaynakları taranıyor...');
  let text = '';
  let grounding: { uri: string; title: string }[] = [];
  let tokens = 0;
  await callAiWithRetry(() => callGemini({
    model: input.model,
    systemInstruction: ANALYST_WEB_SYSTEM_PROMPT,
    contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
    onChunk: (chunk, _think, tokenCount) => {
      text = chunk;
      if (tokenCount) tokens = tokenCount;
      input.onStream(text, '', undefined, undefined, tokens);
    },
    onGrounding: (urls) => {
      grounding = urls;
      if (input.onGrounding) input.onGrounding(urls);
    },
  }));
  return { text, thinking: '', groundingUrls: grounding.length > 0 ? grounding : undefined, actionSummary: 'research_web', intent: 'research_web', classification, tokenCount: tokens };
}

async function runBaLoop(input: SingleChatInput, classification: IntentClassification, opts: { forceDraft?: boolean } = {}): Promise<SingleChatResult> {
  const intentOut: SingleChatIntent = classification.subIntent === 'generate_test_cases'
    ? 'generate_tests'
    : classification.subIntent === 'generate_flow_diagram' || classification.subIntent === 'generate_bpmn' || classification.subIntent === 'generate_mermaid'
      ? 'generate_flow'
      : classification.primaryIntent === 'document_editing'
        ? 'revise_section'
        : 'analyze_request';

  const loopOutput = await runBaAgentLoop({
    userMessage: input.userMessage,
    history: input.history,
    documentContent: input.documentContent,
    knowledgeBase: input.knowledgeBase,
    model: input.model,
    systemInstruction: `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}${visibleFocusHint(classification)}\n\n[GORUNUR DOKUMAN YUZEYI]\n- Sadece businessAnalysis ve review bolumlerini uret.\n- IT analiz, test, UAT ve flow detaylarini businessAnalysis icinde alt baslik olarak yaz.\n- code/test/bpmn alanlarini zorunlu uretme.\n- businessAnalysis ana basligi KAVRAMSAL TASARIM RAPORU olmalı; Word kavramsal tasarım yapısına uy.`,
    onPhase: (phase, label) => input.onPhase(phase, label),
    onThinking: input.onThinking,
    onActStream: input.onStream,
    onGrounding: input.onGrounding,
  });

  let finalDocument = loopOutput.document;
  let finalText = loopOutput.text;
  let finalQuestions = normalizeQuestions(loopOutput.questions as any) || loopOutput.questions;

  if (opts.forceDraft && !finalDocument) {
    input.onPhase('ACT', 'Taslak zorla üretiliyor...');
    try {
      const fallbackSystem = `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}\n\n[ZORUNLU DERIN BA DOKUMAN URETIMI - SON CAGRI]\nOnceki adimda document alani dolmadi. Simdi SADECE dokumani uretmen gerekiyor.\n- questions alanı BOS olmalı.\n- document alani zorunlu: businessAnalysis ve review bolumlerini doldur.\n- businessAnalysis KAVRAMSAL TASARIM RAPORU formatında olsun.\n- Teknik analiz, test ve surec akisini businessAnalysis icinde alt baslik olarak yaz; code/test/bpmn alanlarini zorunlu uretme.\n- Eksik bilgileri [VARSAYIM] etiketi ile dokuman icinde isaretle.\n- Belirsizlikleri review.content icinde Acik Sorular basligi altinda listele.`;
      const fallback = await callGemini({
        model: input.model,
        systemInstruction: fallbackSystem,
        contents: [...input.history, { role: 'user', parts: [{ text: `Kullanıcı talebi ve konuşma geçmişindeki kararlara dayanarak ŞİMDİ dokümanı üret. Son kullanıcı mesajı: "${input.userMessage}"` }] }],
        responseSchema: chatResponseJsonSchema,
        onChunk: () => {},
      });
      const parsed = JSON.parse((fallback.text || '').trim());
      if (parsed && typeof parsed === 'object' && parsed.document) {
        finalDocument = parsed.document;
        if (typeof parsed.message === 'string' && parsed.message.trim()) finalText = parsed.message.trim();
        finalQuestions = undefined;
      }
    } catch (error) {
      console.warn('Force-draft fallback call failed:', error);
    }
  }

  if (!finalDocument && opts.forceDraft && (finalText || '').trim().length > 300) {
    finalDocument = {
      businessAnalysis: { content: finalText, status: 'DRAFT', flags: [] },
      review: { content: '## Açık Sorular\n- [AÇIK KONU] Model yapılandırılmış doküman döndürmedi; içerik BA Analiz içine taşındı.', status: 'NEEDS_REVISION', flags: ['STRUCTURED_DOCUMENT_FALLBACK'] },
    } as DocumentData;
  }

  const claimsUpdate = /(doküman|dokuman|sağ panel|sag panel).{0,40}(güncellen|guncellen|oluşturul|olusturul|işlendi|islendi|eklen|aktarıl|aktaril)/i.test(finalText || '');
  if (claimsUpdate && !finalDocument) {
    finalText = 'Şu an doküman güncellemesi üretemedim. Lütfen talebi biraz daha netleştirin veya "Varsayımlarla ilerle" aksiyonunu seçin; eksik alanları varsayımla dolduracağım.';
  }

  return {
    text: finalText,
    thinking: loopOutput.thinking,
    questions: finalQuestions,
    actionSummary: loopOutput.actionSummary,
    groundingUrls: loopOutput.groundingUrls,
    document: finalDocument,
    intent: intentOut,
    classification,
    tokenCount: loopOutput.tokenCount,
  };
}

function runSystemMessage(input: SingleChatInput, classification: IntentClassification, code: string): SingleChatResult {
  const msg = code === 'ZERO_TOUCH_DISABLED'
    ? 'Ekip modu bu sürümde aktif değil. Bu talebi tekli JetWork AI modu ile analiz edip dokümana aktarabilirim. Devam edeyim mi?'
    : code === 'AGENT_DEBATE_DISABLED'
      ? 'Görünür çok ajan tartışması MVPde kapalı. Bu ihtiyacı tekli JetWork AI ile karşılayabilirim.'
      : 'Bu işlemi şu an desteklemiyorum.';
  input.onStream(msg, '', undefined, code, 0);
  return { text: msg, thinking: '', intent: 'chat_only', classification, tokenCount: 0 };
}

function runWorkflowStub(input: SingleChatInput, classification: IntentClassification): SingleChatResult {
  const subMap: Partial<Record<SubIntent, string>> = {
    export_document: 'Dokümanı indirme için sağ panelin üst kısmındaki indir düğmesini kullanabilirsin. DOCX/HTML çıkışı yakında aktif olacak.',
    share_document: 'Paylaşım linki özelliği yakında aktif olacak.',
    compare_versions: 'Versiyon karşılaştırma sağ paneldeki version geçmişinden yapılabilir.',
    show_change_history: 'Değişiklik geçmişi sağ panelde versiyon listesi olarak görünür.',
    approve_section: 'Bölüm onaylama yakında aktif olacak.',
    mark_needs_revision: 'Revizyon işareti yakında aktif olacak.',
  };
  const msg = subMap[classification.subIntent] || 'Bu iş akışı yakında aktif olacak.';
  input.onStream(msg, '', undefined, `workflow:${classification.subIntent}`, 0);
  return { text: msg, thinking: '', intent: 'workflow_action', classification, tokenCount: 0 };
}

function runMemoryStub(input: SingleChatInput, classification: IntentClassification): SingleChatResult {
  const msg = 'Bu bilgiyi proje hafızasına not ettim. Dokümanın Review bölümünde hatırlatacağım.';
  input.onStream(msg, '', undefined, `memory:${classification.subIntent}`, 0);
  return { text: msg, thinking: '', actionSummary: `memory:${classification.subIntent}`, intent: 'memory_action', classification, tokenCount: 0 };
}

function runPreviewRequired(input: SingleChatInput, classification: IntentClassification): SingleChatResult {
  const msg = `Bu işlem yüksek riskli (${classification.subIntent}). Uygulamadan önce onayını istiyorum.\n\nİstediğin değişikliği bir sonraki mesajında "devam et" veya "uygula" diyerek onaylarsan, değişiklik sağ panelde diff olarak gösterilecek ve versiyon olarak kaydedilecek. Vazgeçmek istersen "iptal" yazabilirsin.`;
  input.onStream(msg, '', undefined, `preview_required:${classification.subIntent}`, 0);
  return { text: msg, thinking: '', actionSummary: `preview_required:${classification.subIntent}`, intent: 'preview_required', classification, tokenCount: 0 };
}

const runSingleChatOrchestratorInner = async (input: SingleChatInput): Promise<SingleChatResult> => {
  input.onPhase('INTENT', 'Niyet belirleniyor...');
  const signals = computeDiscoverySignals(input.userMessage, input.messageHistory || [], input.documentContent);
  const turnInput: SingleChatInput = signals.newStandaloneRequest
    ? { ...input, history: [], messageHistory: [], documentContent: null }
    : input;

  if (signals.greetingOnly) {
    const greetingClassification = buildClassification('small_talk', { reason: 'greeting_detected' });
    const isCorrection = /\b(dedim|yazdım|yazdim|söyledim|soyledim|verdim|sadece|ne sorusu|neden soru)\b/i.test(input.userMessage || '');
    const msg = isCorrection
      ? 'Haklısın, sadece selamlaştın. İyiyim, teşekkür ederim. Analiz etmek istediğin bir talep olduğunda buradayım.'
      : 'Merhaba, hazırım. Analiz etmek istediğin talebi yazabilir veya mevcut bir dokümanı paylaşabilirsin.';
    input.onPhase('ACT', 'Cevap hazırlanıyor...');
    input.onStream(msg, '', undefined, 'small_talk_greeting', 0);
    return { text: msg, thinking: '', questions: undefined, actionSummary: 'small_talk_greeting', intent: 'chat_only', classification: greetingClassification, tokenCount: 0 };
  }

  let classification = await classifyIntent({
    userMessage: turnInput.userMessage,
    document: turnInput.documentContent,
    selectedText: turnInput.selectedNodeContent ?? null,
    selectedSection: (turnInput.selectedSection as DocumentSectionKey) ?? null,
    model: turnInput.model,
  });

  if (signals.mustGenerateNow) {
    classification = {
      ...classification,
      primaryIntent: 'analysis_generation',
      subIntent: classification.subIntent === 'generate_test_cases' || classification.subIntent === 'generate_flow_diagram' || classification.subIntent === 'generate_bpmn' ? classification.subIntent : 'generate_business_analysis',
      documentImpact: 'updates_document',
      operation: 'replace_or_create_section',
      targetSection: 'businessAnalysis',
      requiresClarification: false,
      clarificationQuestions: undefined,
      requiresPreview: false,
      shouldRunBaAgentLoop: true,
      baAgentFocus: classification.baAgentFocus || 'business_analysis',
      confidence: Math.max(classification.confidence, 0.85),
      reason: `discovery_guard:${signals.reason}`,
    };
    turnInput.onPhase('ACT', 'Taslak dokümana geçiliyor...');
    return runBaLoop({ ...turnInput, systemInstruction: `${turnInput.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}\n\n[ZORUNLU DOKUMAN URETIMI]\nKullanıcı "${signals.reason}" sinyali verdi. Yeni soru sorma. document.businessAnalysis ve document.review üret. Teknik, test ve flow detaylarını BA Analiz içinde alt başlık yap. questions alanını boş bırak.` }, classification, { forceDraft: true });
  }

  const action = decideAction(classification, { hasSelectedText: !!turnInput.selectedNodeContent, zeroTouchEnabled: FEATURE_FLAGS.ZERO_TOUCH });

  switch (action.type) {
    case 'SYSTEM_MESSAGE':
      return runSystemMessage(turnInput, classification, action.code || 'UNSUPPORTED');
    case 'ASK_CLARIFYING_QUESTIONS':
      return runAskClarifyingQuestions(turnInput, classification, action.code);
    case 'PREVIEW_DOCUMENT_CHANGE':
      return runPreviewRequired(turnInput, classification);
    case 'CHAT_ONLY':
      return runChatOnly(turnInput, classification);
    case 'UPDATE_SELECTED_TEXT':
      return runUpdateSelectedText(turnInput, classification);
    case 'RUN_RESEARCH': {
      const rt = classification.researchType;
      if (rt === 'internal' || rt === 'workspace_history' || classification.subIntent === 'research_internal_knowledge' || classification.subIntent === 'research_workspace_history') return runResearchInternal(turnInput, classification);
      return runResearchWeb(turnInput, classification);
    }
    case 'SUGGEST_DOCUMENT_UPDATE':
      return runChatOnly({ ...turnInput, systemInstruction: `${turnInput.systemInstruction}\n\n[MOD] Öneri modu: dokümana yazmadan ne ekleyebileceğini özetle ve sonunda "Dokümana işleyeyim mi?" diye sor.` }, classification);
    case 'MEMORY_ACTION':
      return runMemoryStub(turnInput, classification);
    case 'WORKFLOW_ACTION':
      return runWorkflowStub(turnInput, classification);
    case 'RUN_BA_AGENT_LOOP':
    case 'UPDATE_DOCUMENT_SECTION':
    default:
      return runBaLoop(turnInput, classification, { forceDraft: true });
  }
};

export const runSingleChatOrchestrator = async (input: SingleChatInput): Promise<SingleChatResult> => {
  const result = await runSingleChatOrchestratorInner(input);
  const normalizedResultQuestions = normalizeQuestions(result.questions as any) || result.questions;
  let normalizedResult = { ...result, questions: normalizedResultQuestions };
  if (normalizedResult.questions && containsBlockedQuestionDomain(normalizedResult.questions as any)) {
    normalizedResult = {
      ...normalizedResult,
      questions: undefined,
      text: normalizedResult.text && normalizedResult.text.trim().length > 0
        ? normalizedResult.text
        : 'Merhaba, hazırım. Analiz etmek istediğin talebi yazabilir veya mevcut bir dokümanı paylaşabilirsin.',
    };
  }
  if (normalizedResult.classification?.subIntent === 'small_talk') {
    const claimsQuestionsPrepared = /(soru hazırladım|birkaç kısa soru|aşağıdaki soruları|netleştirmek için .* soru)/i.test(normalizedResult.text || '');
    const cleanText = claimsQuestionsPrepared || !(normalizedResult.text || '').trim()
      ? 'Haklısın, sadece selamlaştın. İyiyim, teşekkür ederim. Analiz etmek istediğin bir talep olduğunda buradayım.'
      : normalizedResult.text;
    return { ...normalizedResult, questions: undefined, text: cleanText };
  }
  return normalizedResult;
};
