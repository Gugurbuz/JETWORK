import { parse as parsePartialJson } from 'partial-json';
import { DocumentData, KnowledgeItem, Message, Question } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { runBaAgentLoop, AgentPhase } from './baAgentLoop';
import { applyNodeUpdate, ANALYST_WEB_SYSTEM_PROMPT } from './intentRouter';
import { hybridSearch } from './contextManager';
import { supabase } from '../supabase';
import { classifyIntent } from './ai/intentClassifier';
import { decideAction } from './ai/decisionPolicy';
import {
  IntentClassification,
  DocumentSectionKey,
  SubIntent,
} from './ai/intentTypes';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { chatResponseJsonSchema } from '../schemas';
import { computeDiscoverySignals, DRAFT_FIRST_SYSTEM_RULE, containsBlockedQuestionDomain } from './ai/discoveryPolicy';
import { buildClassification } from './ai/intentClassifier';

// Strip any partial/complete JSON the model may emit before the UI sees it.
const extractParts = (
  raw: string
): { message: string; questions?: Question[]; actionSummary?: string; thinking?: string } => {
  if (!raw) return { message: '' };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { message: raw };
  try {
    const parsed: any = parsePartialJson(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        questions: Array.isArray(parsed.questions) ? parsed.questions : undefined,
        actionSummary: typeof parsed.actionSummary === 'string' ? parsed.actionSummary : undefined,
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
      };
    }
  } catch {
    return { message: '' };
  }
  return { message: raw };
};

// Kept for backwards compatibility with useMessages / other consumers.
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
  onStream: (
    text: string,
    thinking: string | undefined,
    questions: Question[] | undefined,
    actionSummary: string | undefined,
    tokenCount: number
  ) => void;
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

// ---------------------------------------------------------------------------
// Handlers per orchestrator action
// ---------------------------------------------------------------------------

async function runChatOnly(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Yanıt hazırlanıyor...');
  let raw = '';
  let thinking = '';
  let tokens = 0;
  let lastParts: { message: string; questions?: Question[]; actionSummary?: string } = { message: '' };
  const sys = `${input.systemInstruction}

${DRAFT_FIRST_SYSTEM_RULE}

Bu tur SADECE sohbet cevabı. Dokümanı değiştirme, uzun analiz üretme.

ÇIKTI FORMATI (zorunlu JSON):
{ "message": "kullanıcıya gösterilecek kısa doğal dil/Markdown",
  "questions": [ { "id": "q1", "text": "...", "options": ["..."] } ],
  "actionSummary": "opsiyonel iç özet" }

- Uzun doküman üretme; sadece konuşma cevabı ver.
- Netleştirici soru soracaksan questions alanını doldur (2-4 seçenek).`;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      systemInstruction: sys,
      contents: [
        ...input.history,
        { role: 'user', parts: [{ text: input.userMessage }] },
      ],
      onChunk: (t, think, tk) => {
        raw = t;
        if (think) thinking = think;
        if (tk) tokens = tk;
        const parts = extractParts(raw);
        lastParts = parts;
        input.onStream(parts.message || '', thinking, parts.questions, parts.actionSummary, tokens);
      },
    })
  );
  const finalParts = extractParts(raw);
  const finalMessage = finalParts.message || lastParts.message || '';
  return {
    text: finalMessage,
    thinking,
    questions: finalParts.questions || lastParts.questions,
    actionSummary: finalParts.actionSummary || lastParts.actionSummary,
    intent: 'chat_only',
    classification,
    tokenCount: tokens,
  };
}

async function runAskClarifyingQuestions(
  input: SingleChatInput,
  classification: IntentClassification,
  code?: string
): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Netleştirici sorular hazırlanıyor...');

  // If the classifier already provided good questions, use them directly.
  if (classification.clarificationQuestions && classification.clarificationQuestions.length > 0) {
    const questions: Question[] = classification.clarificationQuestions.slice(0, 4).map((text, i) => ({
      id: `q${i + 1}`,
      text,
      options: [],
    }));
    const msg = code === 'MISSING_SELECTION'
      ? 'Seçili metin göremedim. Dokümandan ilgili kısmı seçip tekrar dener misin?'
      : 'Devam etmeden önce şu noktaları netleştirmem gerekiyor.';
    input.onStream(msg, '', questions, 'ask_clarifying_questions', 0);
    return {
      text: msg,
      thinking: '',
      questions,
      intent: 'ask_questions',
      classification,
      tokenCount: 0,
    };
  }

  // Otherwise ask the model to produce 2-4 quick-answer questions.
  let raw = '';
  let tokens = 0;
  const sys = `Sen JetWork AI'sın. Kullanıcının isteğini netleştirmek için EN FAZLA 4 hızlı cevaplanabilir soru üret.

ÇIKTI JSON:
{ "message": "kısa açıklayıcı giriş",
  "questions": [ { "id": "q1", "text": "...", "options": ["seçenek 1", "seçenek 2", "seçenek 3"] } ] }

- Her soruda 2-4 seçenek olmalı.
- Dokümanı değiştirme.`;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      systemInstruction: sys,
      contents: [
        ...input.history,
        { role: 'user', parts: [{ text: input.userMessage }] },
      ],
      onChunk: (t, _th, tk) => {
        raw = t;
        if (tk) tokens = tk;
        const parts = extractParts(raw);
        input.onStream(parts.message || '', '', parts.questions, parts.actionSummary, tokens);
      },
    })
  );
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

async function runUpdateSelectedText(
  input: SingleChatInput,
  classification: IntentClassification
): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Seçili metin güncelleniyor...');
  const section: DocumentSectionKey =
    (classification.targetSection as DocumentSectionKey) ||
    (input.selectedSection as DocumentSectionKey) ||
    'businessAnalysis';

  const editSystem = `Kullanıcının talep ettiği şekilde SADECE aşağıdaki seçili metni yeniden yaz.
Sonucu düz metin/Markdown olarak döndür, başka yorum EKLEME.

[SEÇİLİ METİN]
${input.selectedNodeContent || ''}`;
  let newContent = '';
  let thinking = '';
  let tokens = 0;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      systemInstruction: editSystem,
      contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
      onChunk: (t, think, tk) => {
        newContent = t;
        if (think) thinking = think;
        if (tk) tokens = tk;
      },
    })
  );
  const updated = input.documentContent
    ? applyNodeUpdate(input.documentContent, section, newContent)
    : undefined;
  const summary = `Seçili metni "${section}" bölümünde güncelledim.`;
  input.onStream(summary, thinking, undefined, summary, tokens);
  return {
    text: summary,
    thinking,
    actionSummary: summary,
    document: updated,
    intent: 'update_node',
    classification,
    tokenCount: tokens,
  };
}

async function runResearchInternal(
  input: SingleChatInput,
  classification: IntentClassification
): Promise<SingleChatResult> {
  input.onPhase('RESEARCH', 'Kurumsal hafıza taranıyor...');
  const query = input.userMessage;
  let hits: { content: string }[] = [];
  try {
    const { data } = await supabase.rpc('match_knowledge_text', {
      query_text: query,
      match_count: 5,
    });
    hits = data || [];
  } catch (e) {
    console.warn('match_knowledge_text failed:', e);
  }
  if (hits.length === 0) {
    hits = hybridSearch(query, input.knowledgeBase, 5).map((h) => ({ content: h.content }));
  }
  const text = hits.length > 0
    ? `**Kurumsal Hafıza (${query}):**\n\n${hits.map((h, i) => `${i + 1}. ${h.content}`).join('\n\n')}`
    : `"${query}" için kurumsal hafızada kayıt bulunamadı.`;
  input.onStream(text, '', undefined, `research_internal(${query})`, 0);
  return {
    text,
    thinking: '',
    intent: 'research_internal',
    classification,
    tokenCount: 0,
  };
}

async function runResearchWeb(
  input: SingleChatInput,
  classification: IntentClassification
): Promise<SingleChatResult> {
  input.onPhase('RESEARCH', 'Web kaynakları taranıyor...');
  let text = '';
  let grounding: { uri: string; title: string }[] = [];
  let tokens = 0;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      systemInstruction: ANALYST_WEB_SYSTEM_PROMPT,
      contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
      onChunk: (t, _th, tk) => {
        text = t;
        if (tk) tokens = tk;
        input.onStream(text, '', undefined, undefined, tokens);
      },
      onGrounding: (urls) => {
        grounding = urls;
        if (input.onGrounding) input.onGrounding(urls);
      },
    })
  );
  return {
    text,
    thinking: '',
    groundingUrls: grounding.length > 0 ? grounding : undefined,
    actionSummary: 'research_web',
    intent: 'research_web',
    classification,
    tokenCount: tokens,
  };
}

async function runBaLoop(
  input: SingleChatInput,
  classification: IntentClassification,
  opts: { forceDraft?: boolean } = {}
): Promise<SingleChatResult> {
  const focus = classification.baAgentFocus;
  const target = classification.targetSection;
  const focusHint = focus === 'test'
    ? '\n\n[ODAK] "test" bölümünü detaylı doldur; diğer bölümleri gereksizce yeniden yazma.'
    : focus === 'flow'
      ? '\n\n[ODAK] "bpmn" bölümünde süreç akışını üret.'
      : focus === 'technical_analysis'
        ? '\n\n[ODAK] "code" (teknik analiz) bölümüne odaklan.'
        : focus === 'review'
          ? '\n\n[ODAK] "review" bölümünde riskler, açık sorular ve kalite gözden geçirmesi üret.'
          : target
            ? `\n\n[ODAK] Özellikle "${target}" bölümünü güncelle; diğer bölümleri koru.`
            : '';

  const intentOut: SingleChatIntent =
    classification.subIntent === 'generate_test_cases' ? 'generate_tests'
      : classification.subIntent === 'generate_flow_diagram' || classification.subIntent === 'generate_bpmn' || classification.subIntent === 'generate_mermaid' ? 'generate_flow'
      : classification.primaryIntent === 'document_editing' ? 'revise_section'
      : 'analyze_request';

  const loopOutput = await runBaAgentLoop({
    userMessage: input.userMessage,
    history: input.history,
    documentContent: input.documentContent,
    knowledgeBase: input.knowledgeBase,
    model: input.model,
    systemInstruction: `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}${focusHint}`,
    onPhase: (phase, label) => input.onPhase(phase, label),
    onThinking: input.onThinking,
    onActStream: input.onStream,
    onGrounding: input.onGrounding,
  });

  let finalDocument = loopOutput.document;
  let finalText = loopOutput.text;
  let finalQuestions = loopOutput.questions;

  // Force-draft fallback: BA loop finished without a document even though
  // the caller required one. Make a second, narrower call that MUST return
  // the document field per schema.
  if (opts.forceDraft && !finalDocument) {
    input.onPhase('ACT', 'Taslak zorla üretiliyor...');
    try {
      const fallbackSystem = `${input.systemInstruction}

${DRAFT_FIRST_SYSTEM_RULE}

[ZORUNLU DOKÜMAN ÜRETİMİ - SON ÇAĞRI]
Önceki adımda \`document\` alanı dolmadı. Şimdi SADECE dokümanı üretmen gerekiyor.
- \`questions\` alanı BOŞ olmalı.
- \`document\` alanı zorunlu: businessAnalysis, code, test, review bölümlerini doldur.
- Eksik bilgileri "[VARSAYIM]" etiketi ile doküman içinde işaretle.
- Belirsizlikleri review.content içinde "## Açık Sorular" başlığı altında listele.
- Mesaj 2-3 cümleyi geçmesin; detaylar dokümana yazılsın.`;

      const fallbackContents: any[] = [
        ...input.history,
        {
          role: 'user',
          parts: [{ text: `Kullanıcı talebi ve konuşma geçmişindeki kararlara dayanarak ŞİMDİ dokümanı üret. Son kullanıcı mesajı: "${input.userMessage}"` }],
        },
      ];
      if (input.documentContent) {
        const first = fallbackContents[0]?.parts?.[0];
        if (first && 'text' in first) {
          first.text = `Mevcut Doküman (varsa genişlet):\n${JSON.stringify(input.documentContent, null, 2)}\n\n${first.text}`;
        }
      }

      const fallback = await callGemini({
        model: input.model,
        systemInstruction: fallbackSystem,
        contents: fallbackContents,
        responseSchema: chatResponseJsonSchema,
        onChunk: () => {},
      });

      try {
        const parsed = JSON.parse((fallback.text || '').trim());
        if (parsed && typeof parsed === 'object' && parsed.document) {
          finalDocument = parsed.document;
          if (typeof parsed.message === 'string' && parsed.message.trim()) {
            finalText = parsed.message.trim();
          }
          finalQuestions = undefined;
        }
      } catch {
        // noop — handled by honesty guard below
      }
    } catch (err) {
      console.warn('Force-draft fallback call failed:', err);
    }
  }

  // Last-resort synthesis: if the BA loop still returned no `document` but the
  // message text contains substantive analysis content, promote that text into
  // the businessAnalysis section so the right panel is not left empty.
  if (!finalDocument && opts.forceDraft && (finalText || '').trim().length > 300) {
    const base = input.documentContent || ({} as DocumentData);
    finalDocument = {
      ...(base as any),
      businessAnalysis: {
        content: finalText,
        status: 'DRAFT',
        flags: [],
      },
    } as DocumentData;
  }

  // Honesty guard: if the assistant text claims document was updated but no
  // document was actually produced, rewrite it to be truthful.
  const claimsUpdate = /(doküman|sağ panel).{0,40}(güncellen|oluşturul|işlendi|eklen|aktarıl)/i.test(finalText || '');
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

function runSystemMessage(
  input: SingleChatInput,
  classification: IntentClassification,
  code: string
): SingleChatResult {
  const msg = code === 'ZERO_TOUCH_DISABLED'
    ? 'Ekip modu bu sürümde aktif değil. Bu talebi tekli JetWork AI modu ile analiz edip dokümana aktarabilirim. Devam edeyim mi?'
    : code === 'AGENT_DEBATE_DISABLED'
      ? 'Görünür çok ajan tartışması MVP\'de kapalı. Bu ihtiyacı tekli JetWork AI ile karşılayabilirim.'
      : 'Bu işlemi şu an desteklemiyorum.';
  input.onStream(msg, '', undefined, code, 0);
  return {
    text: msg,
    thinking: '',
    intent: 'chat_only',
    classification,
    tokenCount: 0,
  };
}

function runWorkflowStub(
  input: SingleChatInput,
  classification: IntentClassification
): SingleChatResult {
  const subMap: Partial<Record<SubIntent, string>> = {
    export_document: 'Dokümanı indirme için sağ panelin üst kısmındaki indir düğmesini kullanabilirsin. DOCX/HTML çıkışı yakında aktif olacak.',
    export_section: 'Belirli bir sekmeyi export etmek yakında aktif olacak. Şu an tüm dokümanı indirebilirsin.',
    share_document: 'Paylaşım linki özelliği yakında aktif olacak.',
    compare_versions: 'Versiyon karşılaştırma sağ paneldeki version geçmişinden yapılabilir.',
    show_change_history: 'Değişiklik geçmişi sağ panelde versiyon listesi olarak görünür.',
    show_last_changes: 'Son değişiklikler sağ paneldeki diff görünümünde incelenebilir.',
    approve_section: 'Bölüm onaylama yakında aktif olacak.',
    mark_needs_revision: 'Revizyon işareti yakında aktif olacak.',
    mark_review_ready: 'Review-ready durumu yakında aktif olacak.',
  };
  const msg = subMap[classification.subIntent] || 'Bu iş akışı yakında aktif olacak.';
  input.onStream(msg, '', undefined, `workflow:${classification.subIntent}`, 0);
  return {
    text: msg,
    thinking: '',
    intent: 'workflow_action',
    classification,
    tokenCount: 0,
  };
}

function runMemoryStub(
  input: SingleChatInput,
  classification: IntentClassification
): SingleChatResult {
  const msg = 'Bu bilgiyi proje hafızasına not ettim. Dokümanın Review bölümünde hatırlatacağım.';
  input.onStream(msg, '', undefined, `memory:${classification.subIntent}`, 0);
  return {
    text: msg,
    thinking: '',
    actionSummary: `memory:${classification.subIntent}`,
    intent: 'memory_action',
    classification,
    tokenCount: 0,
  };
}

function runPreviewRequired(
  input: SingleChatInput,
  classification: IntentClassification
): SingleChatResult {
  const msg = `Bu işlem yüksek riskli (${classification.subIntent}). Uygulamadan önce onayını istiyorum.

İstediğin değişikliği bir sonraki mesajında "devam et" veya "uygula" diyerek onaylarsan, değişiklik sağ panelde diff olarak gösterilecek ve versiyon olarak kaydedilecek. Vazgeçmek istersen "iptal" yazabilirsin.`;
  input.onStream(msg, '', undefined, `preview_required:${classification.subIntent}`, 0);
  return {
    text: msg,
    thinking: '',
    actionSummary: `preview_required:${classification.subIntent}`,
    intent: 'preview_required',
    classification,
    tokenCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

const runSingleChatOrchestratorInner = async (
  input: SingleChatInput
): Promise<SingleChatResult> => {
  input.onPhase('INTENT', 'Niyet belirleniyor...');

  const signals = computeDiscoverySignals(
    input.userMessage,
    input.messageHistory || [],
    input.documentContent,
  );

  // Short-circuit 1: pure greeting / small talk. Deterministic, no LLM call,
  // no questions, no document change. Prevents the model from drifting the
  // JetWork domain into job/talent/freelance questions.
  if (signals.greetingOnly) {
    const greetingClassification = buildClassification('small_talk', {
      reason: 'greeting_detected',
    });
    const isCorrection = /\b(dedim|yazdım|yazdim|söyledim|soyledim|verdim|sadece|ne sorusu|neden soru)\b/i.test(input.userMessage || '');
    const msg = isCorrection
      ? 'Haklısın, sadece selamlaştın. İyiyim, teşekkür ederim. Analiz etmek istediğin bir talep olduğunda buradayım.'
      : 'Merhaba, hazırım. Analiz etmek istediğin talebi yazabilir veya mevcut bir dokümanı paylaşabilirsin.';
    input.onPhase('ACT', 'Cevap hazırlanıyor...');
    input.onStream(msg, '', undefined, 'small_talk_greeting', 0);
    return {
      text: msg,
      thinking: '',
      questions: undefined,
      actionSummary: 'small_talk_greeting',
      intent: 'chat_only',
      classification: greetingClassification,
      tokenCount: 0,
    };
  }

  let classification = await classifyIntent({
    userMessage: input.userMessage,
    document: input.documentContent,
    selectedText: input.selectedNodeContent ?? null,
    selectedSection: (input.selectedSection as DocumentSectionKey) ?? null,
    model: input.model,
  });

  // Short-circuit 2: user explicitly asked to generate, or question budget
  // is exhausted. Force a draft instead of another question round.
  if (signals.mustGenerateNow) {
    classification = {
      ...classification,
      primaryIntent: 'analysis_generation',
      subIntent: classification.subIntent === 'generate_test_cases'
        || classification.subIntent === 'generate_flow_diagram'
        || classification.subIntent === 'generate_bpmn'
        ? classification.subIntent
        : 'generate_business_analysis',
      documentImpact: 'updates_document',
      operation: 'replace_or_create_section',
      targetSection: classification.targetSection || 'businessAnalysis',
      requiresClarification: false,
      clarificationQuestions: undefined,
      requiresPreview: false,
      shouldRunBaAgentLoop: true,
      baAgentFocus: classification.baAgentFocus || 'business_analysis',
      confidence: Math.max(classification.confidence, 0.85),
      reason: `discovery_guard:${signals.reason}`,
    };
    input.onPhase('ACT', 'Taslak dokümana geçiliyor...');
    return runBaLoop(
      {
        ...input,
        systemInstruction: `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}\n\n[ZORUNLU DOKÜMAN ÜRETİMİ]\nKullanıcı "${signals.reason}" sinyali verdi. YENİ SORU SORMA. Cevabın chatResponse JSON şemasında olmalı ve \`document\` alanı ZORUNLU olarak şu bölümleri içermelidir:\n- businessAnalysis: BA Analiz içeriği (amaç, kapsam, paydaşlar, fonksiyonel/NFR gereksinimler, kabul kriterleri, varsayımlar).\n- code: IT / Teknik analiz (mimari, entegrasyon, veri modeli, güvenlik, loglama).\n- test: test stratejisi ve kabul kriterleri.\n- review: kararlar, riskler, açık sorular ("Açık Sorular" başlığı altında eksik bilgileri listele).\nEksik bilgileri doküman içinde "[VARSAYIM]" olarak işaretle ve Review > Açık Sorular bölümüne ekle. \`questions\` alanını BOŞ bırak.`,
      },
      classification,
      { forceDraft: true },
    );
  }

  const action = decideAction(classification, {
    hasSelectedText: !!input.selectedNodeContent,
    zeroTouchEnabled: FEATURE_FLAGS.ZERO_TOUCH,
  });

  switch (action.type) {
    case 'SYSTEM_MESSAGE':
      return runSystemMessage(input, classification, action.code || 'UNSUPPORTED');
    case 'ASK_CLARIFYING_QUESTIONS':
      return runAskClarifyingQuestions(input, classification, action.code);
    case 'PREVIEW_DOCUMENT_CHANGE':
      return runPreviewRequired(input, classification);
    case 'CHAT_ONLY':
      return runChatOnly(input, classification);
    case 'UPDATE_SELECTED_TEXT':
      return runUpdateSelectedText(input, classification);
    case 'RUN_RESEARCH': {
      const rt = classification.researchType;
      if (rt === 'internal' || rt === 'workspace_history' || classification.subIntent === 'research_internal_knowledge' || classification.subIntent === 'research_workspace_history') {
        return runResearchInternal(input, classification);
      }
      return runResearchWeb(input, classification);
    }
    case 'SUGGEST_DOCUMENT_UPDATE':
      // Suggest-only flow: produce an answer without touching the document,
      // but include a CTA for the user to apply it. Same path as chat_only
      // but seed the prompt with a "suggest, don't apply" hint.
      return runChatOnly(
        { ...input, systemInstruction: `${input.systemInstruction}\n\n[MOD] Öneri modu: dokümana yazmadan ne ekleyebileceğini özetle ve sonunda "Dokümana işleyeyim mi?" diye sor.` },
        classification,
      );
    case 'MEMORY_ACTION':
      return runMemoryStub(input, classification);
    case 'WORKFLOW_ACTION':
      return runWorkflowStub(input, classification);
    case 'RUN_BA_AGENT_LOOP':
    case 'UPDATE_DOCUMENT_SECTION':
    default:
      // Analysis / document-update paths must ALWAYS end up with a document
      // patch. forceDraft makes a second narrower call if the first attempt
      // returns no `document` field.
      return runBaLoop(input, classification, { forceDraft: true });
  }
};

export const runSingleChatOrchestrator = async (
  input: SingleChatInput
): Promise<SingleChatResult> => {
  const result = await runSingleChatOrchestratorInner(input);
  // Question domain guard: strip any questions that drifted outside the
  // JetWork analysis domain (job / talent / freelance / remote etc.).
  if (result.questions && containsBlockedQuestionDomain(result.questions as any)) {
    return {
      ...result,
      questions: undefined,
      text: result.text && result.text.trim().length > 0
        ? result.text
        : 'Merhaba, hazırım. Analiz etmek istediğin talebi yazabilir veya mevcut bir dokümanı paylaşabilirsin.',
    };
  }
  // Also guard small_talk: never let questions leak through for pure greetings,
  // and rewrite any "Birkaç soru hazırladım / aşağıdaki soruları" claims so the
  // final message stays short and JetWork-domain appropriate.
  if (result.classification?.subIntent === 'small_talk') {
    const claimsQuestionsPrepared = /(soru hazırladım|birkaç kısa soru|aşağıdaki soruları|netleştirmek için .* soru)/i.test(result.text || '');
    const cleanText = claimsQuestionsPrepared || !(result.text || '').trim()
      ? 'Haklısın, sadece selamlaştın. İyiyim, teşekkür ederim. Analiz etmek istediğin bir talep olduğunda buradayım.'
      : result.text;
    return { ...result, questions: undefined, text: cleanText };
  }
  return result;
};
