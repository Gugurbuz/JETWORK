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
import { buildDeepBaActInstructions, parseClassifierQuestion } from '../modules/deep-ba-assistant';

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

function buildRecentSubject(input: SingleChatInput): string {
  return [
    input.history.slice(-6).map((item) => item.parts[0]?.text || '').join('\n'),
    input.userMessage,
  ].filter(Boolean).join('\n');
}

async function runChatOnly(input: SingleChatInput, classification: IntentClassification): Promise<SingleChatResult> {
  input.onPhase('ACT', 'YanÄ±t hazÄ±rlanÄ±yor...');
  let raw = '';
  let thinking = '';
  let tokens = 0;
  let lastParts: { message: string; questions?: Question[]; actionSummary?: string } = { message: '' };
  const sys = `${input.systemInstruction}

${DRAFT_FIRST_SYSTEM_RULE}

Bu tur SADECE sohbet cevabÄ±. DokÃ¼manÄ± deÄŸiÅŸtirme, uzun analiz Ã¼retme.

Ã‡IKTI FORMATI (zorunlu JSON):
{ "message": "kullanÄ±cÄ±ya gÃ¶sterilecek kÄ±sa doÄŸal dil/Markdown",
  "questions": [ { "id": "q1", "text": "...", "options": ["..."] } ],
  "actionSummary": "opsiyonel iÃ§ Ã¶zet" }

- Uzun dokÃ¼man Ã¼retme; sadece konuÅŸma cevabÄ± ver.
- NetleÅŸtirici soru soracaksan questions alanÄ±nÄ± doldur (2-4 seÃ§enek).`;
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
  input.onPhase('ACT', 'NetleÅŸtirici sorular hazÄ±rlanÄ±yor...');

  // If the classifier already provided good questions, use them directly.
  if (classification.clarificationQuestions && classification.clarificationQuestions.length > 0) {
    const questions: Question[] = classification.clarificationQuestions
      .slice(0, 4)
      .map((text, i) => parseClassifierQuestion(text, i));
    const msg = code === 'MISSING_SELECTION'
      ? 'SeÃ§ili metin gÃ¶remedim. DokÃ¼mandan ilgili kÄ±smÄ± seÃ§ip tekrar dener misin?'
      : 'Devam etmeden Ã¶nce ÅŸu noktalarÄ± netleÅŸtirmem gerekiyor.';
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
  const sys = `Sen JetWork AI'sÄ±n. KullanÄ±cÄ±nÄ±n isteÄŸini netleÅŸtirmek iÃ§in EN FAZLA 4 hÄ±zlÄ± cevaplanabilir soru Ã¼ret.

Ã‡IKTI JSON:
{ "message": "kÄ±sa aÃ§Ä±klayÄ±cÄ± giriÅŸ",
  "questions": [ { "id": "q1", "text": "...", "options": ["seÃ§enek 1", "seÃ§enek 2", "seÃ§enek 3"] } ] }

- Her soruda 2-4 seÃ§enek olmalÄ±.
- DokÃ¼manÄ± deÄŸiÅŸtirme.`;
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
    text: finalParts.message || 'BirkaÃ§ netleÅŸtirici sorum var.',
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
  input.onPhase('ACT', 'SeÃ§ili metin gÃ¼ncelleniyor...');
  const section: DocumentSectionKey =
    (classification.targetSection as DocumentSectionKey) ||
    (input.selectedSection as DocumentSectionKey) ||
    'businessAnalysis';

  const editSystem = `KullanÄ±cÄ±nÄ±n talep ettiÄŸi ÅŸekilde SADECE aÅŸaÄŸÄ±daki seÃ§ili metni yeniden yaz.
Sonucu dÃ¼z metin/Markdown olarak dÃ¶ndÃ¼r, baÅŸka yorum EKLEME.

[SEÃ‡Ä°LÄ° METÄ°N]
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
  const summary = `SeÃ§ili metni "${section}" bÃ¶lÃ¼mÃ¼nde gÃ¼ncelledim.`;
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
  input.onPhase('RESEARCH', 'Kurumsal hafÄ±za taranÄ±yor...');
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
    ? `**Kurumsal HafÄ±za (${query}):**\n\n${hits.map((h, i) => `${i + 1}. ${h.content}`).join('\n\n')}`
    : `"${query}" iÃ§in kurumsal hafÄ±zada kayÄ±t bulunamadÄ±.`;
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
  input.onPhase('RESEARCH', 'Web kaynaklarÄ± taranÄ±yor...');
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
    ? '\n\n[ODAK] Test stratejisi, UAT ve kabul senaryolarÄ±nÄ± BA Analiz iÃ§inde detaylÄ± alt baÅŸlÄ±k olarak yaz; ayrÄ± test sekmesi Ã¼retmeye zorlama.'
    : focus === 'flow'
      ? '\n\n[ODAK] SÃ¼reÃ§ akÄ±ÅŸÄ±nÄ± BA Analiz iÃ§inde metinsel/Mermaid taslak olarak yaz; ayrÄ± bpmn sekmesi Ã¼retmeye zorlama.'
      : focus === 'technical_analysis'
        ? '\n\n[ODAK] Teknik analiz, API, veri modeli ve entegrasyon mimarisini BA Analiz iÃ§inde kavramsal tasarÄ±m alt baÅŸlÄ±klarÄ± olarak yaz.'
        : focus === 'review'
          ? '\n\n[ODAK] "review" bÃ¶lÃ¼mÃ¼nde riskler, aÃ§Ä±k sorular ve kalite gÃ¶zden geÃ§irmesi Ã¼ret.'
          : target
            ? `\n\n[ODAK] Ã–zellikle "${target}" bÃ¶lÃ¼mÃ¼nÃ¼ gÃ¼ncelle; diÄŸer bÃ¶lÃ¼mleri koru.`
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
    input.onPhase('ACT', 'Taslak zorla Ã¼retiliyor...');
    try {
      const fallbackSystem = `${input.systemInstruction}

${DRAFT_FIRST_SYSTEM_RULE}

[ZORUNLU DERÄ°N BA DOKÃœMAN ÃœRETÄ°MÄ° - SON Ã‡AÄRI]
Ã–nceki adÄ±mda \`document\` alanÄ± dolmadÄ±. Åimdi SADECE dokÃ¼manÄ± Ã¼retmen gerekiyor.
- \`questions\` alanÄ± BOÅ olmalÄ±.
- \`document\` alanÄ± zorunlu: businessAnalysis ve review bÃ¶lÃ¼mlerini doldur.
- Teknik analiz, test ve sÃ¼reÃ§ akÄ±ÅŸÄ±nÄ± businessAnalysis iÃ§inde alt baÅŸlÄ±k olarak yaz; code/test/bpmn alanlarÄ±nÄ± zorunlu Ã¼retme.
- Eksik bilgileri "[VARSAYIM]" etiketi ile dokÃ¼man iÃ§inde iÅŸaretle.
- Belirsizlikleri review.content iÃ§inde "## AÃ§Ä±k Sorular" baÅŸlÄ±ÄŸÄ± altÄ±nda listele.
- Mesaj 2-3 cÃ¼mleyi geÃ§mesin; detaylar dokÃ¼mana yazÄ±lsÄ±n.

${buildDeepBaActInstructions(buildRecentSubject(input))}`;

      const fallbackContents: any[] = [
        ...input.history,
        {
          role: 'user',
          parts: [{ text: `KullanÄ±cÄ± talebi ve konuÅŸma geÃ§miÅŸindeki kararlara dayanarak ÅÄ°MDÄ° dokÃ¼manÄ± Ã¼ret. Son kullanÄ±cÄ± mesajÄ±: "${input.userMessage}"` }],
        },
      ];
      if (input.documentContent) {
        const first = fallbackContents[0]?.parts?.[0];
        if (first && 'text' in first) {
          first.text = `Mevcut DokÃ¼man (varsa geniÅŸlet):\n${JSON.stringify(input.documentContent, null, 2)}\n\n${first.text}`;
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
        // noop â€” handled by honesty guard below
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
  const claimsUpdate = /(dokÃ¼man|saÄŸ panel).{0,40}(gÃ¼ncellen|oluÅŸturul|iÅŸlendi|eklen|aktarÄ±l)/i.test(finalText || '');
  if (claimsUpdate && !finalDocument) {
    finalText = 'Åu an dokÃ¼man gÃ¼ncellemesi Ã¼retemedim. LÃ¼tfen talebi biraz daha netleÅŸtirin veya "VarsayÄ±mlarla ilerle" aksiyonunu seÃ§in; eksik alanlarÄ± varsayÄ±mla dolduracaÄŸÄ±m.';
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
    ? 'Ekip modu bu sÃ¼rÃ¼mde aktif deÄŸil. Bu talebi tekli JetWork AI modu ile analiz edip dokÃ¼mana aktarabilirim. Devam edeyim mi?'
    : code === 'AGENT_DEBATE_DISABLED'
      ? 'GÃ¶rÃ¼nÃ¼r Ã§ok ajan tartÄ±ÅŸmasÄ± MVP\'de kapalÄ±. Bu ihtiyacÄ± tekli JetWork AI ile karÅŸÄ±layabilirim.'
      : 'Bu iÅŸlemi ÅŸu an desteklemiyorum.';
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
    export_document: 'DokÃ¼manÄ± indirme iÃ§in saÄŸ panelin Ã¼st kÄ±smÄ±ndaki indir dÃ¼ÄŸmesini kullanabilirsin. DOCX/HTML Ã§Ä±kÄ±ÅŸÄ± yakÄ±nda aktif olacak.',
    export_section: 'Belirli bir sekmeyi export etmek yakÄ±nda aktif olacak. Åu an tÃ¼m dokÃ¼manÄ± indirebilirsin.',
    share_document: 'PaylaÅŸÄ±m linki Ã¶zelliÄŸi yakÄ±nda aktif olacak.',
    compare_versions: 'Versiyon karÅŸÄ±laÅŸtÄ±rma saÄŸ paneldeki version geÃ§miÅŸinden yapÄ±labilir.',
    show_change_history: 'DeÄŸiÅŸiklik geÃ§miÅŸi saÄŸ panelde versiyon listesi olarak gÃ¶rÃ¼nÃ¼r.',
    show_last_changes: 'Son deÄŸiÅŸiklikler saÄŸ paneldeki diff gÃ¶rÃ¼nÃ¼mÃ¼nde incelenebilir.',
    approve_section: 'BÃ¶lÃ¼m onaylama yakÄ±nda aktif olacak.',
    mark_needs_revision: 'Revizyon iÅŸareti yakÄ±nda aktif olacak.',
    mark_review_ready: 'Review-ready durumu yakÄ±nda aktif olacak.',
  };
  const msg = subMap[classification.subIntent] || 'Bu iÅŸ akÄ±ÅŸÄ± yakÄ±nda aktif olacak.';
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
  const msg = 'Bu bilgiyi proje hafÄ±zasÄ±na not ettim. DokÃ¼manÄ±n Review bÃ¶lÃ¼mÃ¼nde hatÄ±rlatacaÄŸÄ±m.';
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
  const msg = `Bu iÅŸlem yÃ¼ksek riskli (${classification.subIntent}). Uygulamadan Ã¶nce onayÄ±nÄ± istiyorum.

Ä°stediÄŸin deÄŸiÅŸikliÄŸi bir sonraki mesajÄ±nda "devam et" veya "uygula" diyerek onaylarsan, deÄŸiÅŸiklik saÄŸ panelde diff olarak gÃ¶sterilecek ve versiyon olarak kaydedilecek. VazgeÃ§mek istersen "iptal" yazabilirsin.`;
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
    const isCorrection = /\b(dedim|yazdÄ±m|yazdim|sÃ¶yledim|soyledim|verdim|sadece|ne sorusu|neden soru)\b/i.test(input.userMessage || '');
    const msg = isCorrection
      ? 'HaklÄ±sÄ±n, sadece selamlaÅŸtÄ±n. Ä°yiyiÅ´°Ñ—}•­¯ñÈ•‘•É¥´¸¹…±¥è•Ñµ•¬¥ÍÑ•‘§}¥¸‰¥ÈÑ…±•À½±‘×}Õ¹‘„‰ÕÉ…‘…çÅ´¸œ(€€€€€€è€5•É¡…‰„°¡…ëÅËÅ´¸¹…±¥è•Ñµ•¬¥ÍÑ•‘§}¥¸Ñ…±•‰¤å…é…‰¥±¥ÈÙ•å„µ•ÙÕĞ‰¥È‘½¯ñµ…»ÄÁ…å±‡}…‰¥±¥ÉÍ¥¸¸œì(€€€¥¹ÁÕĞ¹½¹A¡…Í” Pœ°€•Ù…À¡…ëÅÉ±…»Åå½È¸¸¸œ¤ì(€€€¥¹ÁÕĞ¹½¹MÑÉ•…´¡µÍœ°€œœ°Õ¹‘•™¥¹•°€Íµ…±±}Ñ…±­}É••Ñ¥¹œœ°€À¤ì(€€€É•ÑÕÉ¸ì(€€€€€Ñ•áĞèµÍœ°(€€€€€Ñ¡¥¹­¥¹œè€œœ°(€€€€€ÅÕ•ÍÑ¥½¹ÌèÕ¹‘•™¥¹•°(€€€€€…Ñ¥½¹MÕµµ…Éäè€Íµ…±±}Ñ…±­}É••Ñ¥¹œœ°(€€€€€¥¹Ñ•¹Ğè€¡…Ñ}½¹±äœ°(€€€€€±…ÍÍ¥™¥…Ñ¥½¸èÉ••Ñ¥¹±…ÍÍ¥™¥…Ñ¥½¸°(€€€€€Ñ½­•¹½Õ¹Ğè€À°(€€€ôì(€ô((€±•Ğ±…ÍÍ¥™¥…Ñ¥½¸€ô…İ…¥Ğ±…ÍÍ¥™å%¹Ñ•¹Ğ¡ì(€€€ÕÍ•É5•ÍÍ…”è¥¹ÁÕĞ¹ÕÍ•É5•ÍÍ…”°(€€€‘½Õµ•¹Ğè¥¹ÁÕĞ¹‘½Õµ•¹Ñ½¹Ñ•¹Ğ°(€€€Í•±•Ñ•‘Q•áĞè¥¹ÁÕĞ¹Í•±•Ñ•‘9½‘•½¹Ñ•¹Ğ€üü¹Õ±°°(€€€Í•±•Ñ•‘M•Ñ¥½¸è€¡¥¹ÁÕĞ¹Í•±•Ñ•‘M•Ñ¥½¸…Ì½Õµ•¹ÑM•Ñ¥½¹-•ä¤€üü¹Õ±°°(€€€µ½‘•°è¥¹ÁÕĞ¹µ½‘•°°(€ô¤ì((€€¼¼M¡½ÉĞµ¥ÉÕ¥Ğ€ÈèÕÍ•È•áÁ±¥¥Ñ±ä…Í­•Ñ¼•¹•É…Ñ”°½ÈÅÕ•ÍÑ¥½¸‰Õ‘•Ğ(€€¼¼¥Ì•á¡…ÕÍÑ•¸½É”„‘É…™Ğ¥¹ÍÑ•…½˜…¹½Ñ¡•ÈÅÕ•ÍÑ¥½¸É½Õ¹¸(€¥˜€¡Í¥¹…±Ì¹µÕÍÑ•¹•É…Ñ•9½Ü¤ì(€€€±…ÍÍ¥™¥…Ñ¥½¸€ôì(€€€€€€¸¸¹±…ÍÍ¥™¥…Ñ¥½¸°(€€€€€ÁÉ¥µ…Éå%¹Ñ•¹Ğè€…¹…±åÍ¥Í}•¹•É…Ñ¥½¸œ°(€€€€€ÍÕ‰%¹Ñ•¹Ğè±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€•¹•É…Ñ•}Ñ•ÍÑ}…Í•Ìœ(€€€€€€€ñğ±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€•¹•É…Ñ•}™±½İ}‘¥…É…´œ(€€€€€€€ñğ±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€•¹•É…Ñ•}‰Áµ¸œ(€€€€€€€€ü±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ(€€€€€€€€è€•¹•É…Ñ•}‰ÕÍ¥¹•ÍÍ}…¹…±åÍ¥Ìœ°(€€€€€‘½Õµ•¹Ñ%µÁ…Ğè€ÕÁ‘…Ñ•Í}‘½Õµ•¹Ğœ°(€€€€€½Á•É…Ñ¥½¸è€É•Á±…•}½É}É•…Ñ•}Í•Ñ¥½¸œ°(€€€€€Ñ…É•ÑM•Ñ¥½¸è±…ÍÍ¥™¥…Ñ¥½¸¹Ñ…É•ÑM•Ñ¥½¸ñğ€‰ÕÍ¥¹•ÍÍ¹…±åÍ¥Ìœ°(€€€€€É•ÅÕ¥É•Í±…É¥™¥…Ñ¥½¸è™…±Í”°(€€€€€±…É¥™¥…Ñ¥½¹EÕ•ÍÑ¥½¹ÌèÕ¹‘•™¥¹•°(€€€€€É•ÅÕ¥É•ÍAÉ•Ù¥•Üè™…±Í”°(€€€€€Í¡½Õ±‘IÕ¹	…•¹Ñ1½½ÀèÑÉÕ”°(€€€€€‰…•¹Ñ½ÕÌè±…ÍÍ¥™¥…Ñ¥½¸¹‰…•¹Ñ½ÕÌñğ€‰ÕÍ¥¹•ÍÍ}…¹…±åÍ¥Ìœ°(€€€€€½¹™¥‘•¹”è5…Ñ ¹µ…à¡±…ÍÍ¥™¥…Ñ¥½¸¹½¹™¥‘•¹”°€À¸àÔ¤°(€€€€€É•…Í½¸è‘¥Í½Ù•Éå}Õ…Éè‘íÍ¥¹…±Ì¹É•…Í½¹õ€°(€€€ôì(€€€¥¹ÁÕĞ¹½¹A¡…Í” Pœ°€Q…Í±…¬‘½¯ñµ…¹„—¥±¥å½È¸¸¸œ¤ì(€€€É•ÑÕÉ¸ÉÕ¹	…1½½À (€€€€€ì(€€€€€€€€¸¸¹¥¹ÁÕĞ°(€€€€€€€ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸è€‘í¥¹ÁÕĞ¹ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¹õq¹q¸‘íIQ}%IMQ}MeMQ5}IU1õq¹q¹mi=IU91TKÁ8	=/q58ƒqISÁ7Áuq¹-Õ±±…»ÅÄ€ˆ‘íÍ¥¹…±Ì¹É•…Í½¹ôˆÍ¥¹å…±¤Ù•É‘¤¸e;ÀM=ITM=I5¸•Ù…‹Å¸¡…ÑI•ÍÁ½¹Í”)M=8ƒ}•µ…ÏÅ¹‘„½±µ…³ÄÙ”q‘½Õµ•¹Ñq€…±…»Äi=IU91T½±…É…¬ŸÙËñ»ñÈƒñËñ¸çñé•å¥¹‘•­¤‹Ù³ñµ±•É¤§•Éµ•±¥‘¥Èéq¸´‰ÕÍ¥¹•ÍÍ¹…±åÍ¥Ìè	¹…±¥è€¼­…ÙÉ…µÍ…°Ñ…Í…ËÅ´§•É§}¤¸µ‡œ°­…ÁÍ…´°Á…å‘‡}±…È°Ìµ%Ì½Q¼µ	”°ÏñÉ—±•È°	H½H½9H½%9P½IAP½M•É•­Í¥¹¥µ±•È°Ù•É¤µ½‘•±¤°•¹Ñ•É…Íå½¸µ¥µ…É¥Í¤°•­É…¸½Ù…±¥‘…Íå½¸½‰¥±‘¥É¥´°¡…Ñ„çÙ¹•Ñ¥µ¤°UPÙ”­…‰Õ°­É¥Ñ•É±•É¤…å»Ä‹Ù³ñµ‘”­…É…ÈÙ•É¥±•‰¥±¥ÈÍ•Ù¥å•‘”å…ëÅ³ÅÈ¹q¸´É•Ù¥•Üè­…å¹…¬½‘¿}ÉÕ±…µ„ƒÙé•Ñ¤°É¥Í­±•È°‡ŸÅ¬Í½ÉÕ±…È°Ù…ÉÍ…çÅµ±…È°­…±¥Ñ”­…ÃÅÏÄÙ”Í½¹É…­¤…­Í¥å½¹±…È¹q¸´½‘”½Ñ•ÍĞ½‰Áµ¸…±…¹±…ËÅ»Äé½ÉÕ¹±ÔƒñÉ•Ñµ”ìÑ•­¹¥¬°Ñ•ÍĞÙ”…¯Ç|‘•Ñ…å±…ËÅ»Ä‰ÕÍ¥¹•ÍÍ¹…±åÍ¥Ì§¥¹‘”…±Ğ‰‡}³Å¬½±…É…¬å…è¹q¹­Í¥¬‰¥±¥±•É¤‘½¯ñµ…¸§¥¹‘”€‰mYIMe%5tˆ½±…É…¬§}…É•Ñ±”Ù”I•Ù¥•Ü€øŸÅ¬M½ÉÕ±…È‹Ù³ñ·ñ¹”•­±”¸qÅÕ•ÍÑ¥½¹Íq€…±…»Å»Ä	?x‹ÅÉ…¬¹q¹q¸‘í‰Õ¥±‘••Á	…Ñ%¹ÍÑÉÕÑ¥½¹Ì¡‰Õ¥±‘I••¹ÑMÕ‰©•Ğ¡¥¹ÁÕĞ¤¥õ€°(€€€€€ô°(€€€€€±…ÍÍ¥™¥…Ñ¥½¸°(€€€€€ì™½É•É…™ĞèÑÉÕ”ô°(€€€€¤ì(€ô((€½¹ÍĞ…Ñ¥½¸€ô‘•¥‘•Ñ¥½¸¡±…ÍÍ¥™¥…Ñ¥½¸°ì(€€€¡…ÍM•±•Ñ•‘Q•áĞè€„…¥¹ÁÕĞ¹Í•±•Ñ•‘9½‘•½¹Ñ•¹Ğ°(€€€é•É½Q½Õ¡¹…‰±•èQUI}1L¹iI=}Q=U °(€ô¤ì((€Íİ¥Ñ €¡…Ñ¥½¸¹ÑåÁ”¤ì(€€€…Í”€MeMQ5}5MMœè(€€€€€É•ÑÕÉ¸ÉÕ¹MåÍÑ•µ5•ÍÍ…”¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸°…Ñ¥½¸¹½‘”ñğ€U9MUAA=IQœ¤ì(€€€…Í”€M-}1I%e%9}EUMQ%=9Lœè(€€€€€É•ÑÕÉ¸ÉÕ¹Í­±…É¥™å¥¹EÕ•ÍÑ¥½¹Ì¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸°…Ñ¥½¸¹½‘”¤ì(€€€…Í”€AIY%]}=U59Q}!9œè(€€€€€É•ÑÕÉ¸ÉÕ¹AÉ•Ù¥•İI•ÅÕ¥É•¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€…Í”€!Q}=91dœè(€€€€€É•ÑÕÉ¸ÉÕ¹¡…Ñ=¹±ä¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€…Í”€UAQ}M1Q}QaPœè(€€€€€É•ÑÕÉ¸ÉÕ¹UÁ‘…Ñ•M•±•Ñ•‘Q•áĞ¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€…Í”€IU9}IMI œèì(€€€€€½¹ÍĞÉĞ€ô±…ÍÍ¥™¥…Ñ¥½¸¹É•Í•…É¡QåÁ”ì(€€€€€¥˜€¡ÉĞ€ôôô€¥¹Ñ•É¹…°œñğÉĞ€ôôô€İ½É­ÍÁ…•}¡¥ÍÑ½Éäœñğ±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€É•Í•…É¡}¥¹Ñ•É¹…±}­¹½İ±•‘”œñğ±…ÍÍ¥™¥…Ñ¥½¸¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€É•Í•…É¡}İ½É­ÍÁ…•}¡¥ÍÑ½Éäœ¤ì(€€€€€€€É•ÑÕÉ¸ÉÕ¹I•Í•…É¡%¹Ñ•É¹…°¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€€€ô(€€€€€É•ÑÕÉ¸ÉÕ¹I•Í•…É¡]•ˆ¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€ô(€€€…Í”€MUMQ}=U59Q}UAQœè(€€€€€€¼¼MÕ•ÍĞµ½¹±ä™±½ÜèÁÉ½‘Õ”…¸…¹Íİ•Èİ¥Ñ¡½ÕĞÑ½Õ¡¥¹œÑ¡”‘½Õµ•¹Ğ°(€€€€€€¼¼‰ÕĞ¥¹±Õ‘”„Q™½ÈÑ¡”ÕÍ•ÈÑ¼…ÁÁ±ä¥Ğ¸M…µ”Á…Ñ …Ì¡…Ñ}½¹±ä(€€€€€€¼¼‰ÕĞÍ••Ñ¡”ÁÉ½µÁĞİ¥Ñ „€‰ÍÕ•ÍĞ°‘½¸Ğ…ÁÁ±äˆ¡¥¹Ğ¸(€€€€€É•ÑÕÉ¸ÉÕ¹¡…Ñ=¹±ä (€€€€€€€ì€¸¸¹¥¹ÁÕĞ°ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¸è€‘í¥¹ÁÕĞ¹ÍåÍÑ•µ%¹ÍÑÉÕÑ¥½¹õq¹q¹m5=tƒY¹•É¤µ½‘Ôè‘½¯ñµ…¹„å…éµ…‘…¸¹”•­±•å•‰¥±•—}¥¹¤ƒÙé•Ñ±”Ù”Í½¹Õ¹‘„€‰½¯ñµ…¹„§}±•å•å¥´µ¤üˆ‘¥å”Í½È¹€ô°(€€€€€€€±…ÍÍ¥™¥…Ñ¥½¸°(€€€€€€¤ì(€€€…Í”€55=Ie}Q%=8œè(€€€€€É•ÑÕÉ¸ÉÕ¹5•µ½ÉåMÑÕˆ¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€…Í”€]=I-1=]}Q%=8œè(€€€€€É•ÑÕÉ¸ÉÕ¹]½É­™±½İMÑÕˆ¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸¤ì(€€€…Í”€IU9}	}9Q}1==@œè(€€€…Í”€UAQ}=U59Q}MQ%=8œè(€€€‘•™…Õ±Ğè(€€€€€€¼¼¹…±åÍ¥Ì€¼‘½Õµ•¹ĞµÕÁ‘…Ñ”Á…Ñ¡ÌµÕÍĞ1]eL•¹ÕÀİ¥Ñ „‘½Õµ•¹Ğ(€€€€€€¼¼Á…Ñ ¸™½É•É…™Ğµ…­•Ì„Í•½¹¹…ÉÉ½İ•È…±°¥˜Ñ¡”™¥ÉÍĞ…ÑÑ•µÁĞ(€€€€€€¼¼É•ÑÕÉ¹Ì¹¼‘½Õµ•¹Ñ€™¥•±¸(€€€€€É•ÑÕÉ¸ÉÕ¹	…1½½À¡¥¹ÁÕĞ°±…ÍÍ¥™¥…Ñ¥½¸°ì™½É•É…™ĞèÑÉÕ”ô¤ì(€ô)ôì()•áÁ½ÉĞ½¹ÍĞÉÕ¹M¥¹±•¡…Ñ=É¡•ÍÑÉ…Ñ½È€ô…Íå¹Œ€ (€¥¹ÁÕĞèM¥¹±•¡…Ñ%¹ÁÕĞ(¤èAÉ½µ¥Í”ñM¥¹±•¡…ÑI•ÍÕ±Ğø€ôøì(€½¹ÍĞÉ•ÍÕ±Ğ€ô…İ…¥ĞÉÕ¹M¥¹±•¡…Ñ=É¡•ÍÑÉ…Ñ½É%¹¹•È¡¥¹ÁÕĞ¤ì(€€¼¼EÕ•ÍÑ¥½¸‘½µ…¥¸Õ…ÉèÍÑÉ¥À…¹äÅÕ•ÍÑ¥½¹ÌÑ¡…Ğ‘É¥™Ñ•½ÕÑÍ¥‘”Ñ¡”(€€¼¼)•Ñ]½É¬…¹…±åÍ¥Ì‘½µ…¥¸€¡©½ˆ€¼Ñ…±•¹Ğ€¼™É••±…¹”€¼É•µ½Ñ”•ÑŒ¸¤¸(€¥˜€¡É•ÍÕ±Ğ¹ÅÕ•ÍÑ¥½¹Ì€˜˜½¹Ñ…¥¹Í	±½­•‘EÕ•ÍÑ¥½¹½µ…¥¸¡É•ÍÕ±Ğ¹ÅÕ•ÍÑ¥½¹Ì…Ì…¹ä¤¤ì(€€€É•ÑÕÉ¸ì(€€€€€€¸¸¹É•ÍÕ±Ğ°(€€€€€ÅÕ•ÍÑ¥½¹ÌèÕ¹‘•™¥¹•°(€€€€€Ñ•áĞèÉ•ÍÕ±Ğ¹Ñ•áĞ€˜˜É•ÍÕ±Ğ¹Ñ•áĞ¹ÑÉ¥´ ¤¹±•¹Ñ €ø€À(€€€€€€€€üÉ•ÍÕ±Ğ¹Ñ•áĞ(€€€€€€€€è€5•É¡…‰„°¡…ëÅËÅ´¸¹…±¥è•Ñµ•¬¥ÍÑ•‘§}¥¸Ñ…±•‰¤å…é…‰¥±¥ÈÙ•å„µ•ÙÕĞ‰¥È‘½¯ñµ…»ÄÁ…å±‡}…‰¥±¥ÉÍ¥¸¸œ°(€€€ôì(€ô(€€¼¼±Í¼Õ…ÉÍµ…±±}Ñ…±¬è¹•Ù•È±•ĞÅÕ•ÍÑ¥½¹Ì±•…¬Ñ¡É½Õ ™½ÈÁÕÉ”É••Ñ¥¹Ì°(€€¼¼…¹É•İÉ¥Ñ”…¹ä€‰	¥É­‡œÍ½ÉÔ¡…ëÅÉ±…“Å´€¼‡}‡Å‘…­¤Í½ÉÕ±…ËÄˆ±…¥µÌÍ¼Ñ¡”(€€¼¼™¥¹…°µ•ÍÍ…”ÍÑ…åÌÍ¡½ÉĞ…¹)•Ñ]½É¬µ‘½µ…¥¸…ÁÁÉ½ÁÉ¥…Ñ”¸(€¥˜€¡É•ÍÕ±Ğ¹±…ÍÍ¥™¥…Ñ¥½¸ü¹ÍÕ‰%¹Ñ•¹Ğ€ôôô€Íµ…±±}Ñ…±¬œ¤ì(€€€½¹ÍĞ±…¥µÍEÕ•ÍÑ¥½¹ÍAÉ•Á…É•€ô€¼¡Í½ÉÔ¡…ëÅÉ±…“Åµñ‰¥É­‡œ¯ÅÍ„Í½ÉÕñ‡}‡Å‘…­¤Í½ÉÕ±…ËÅñ¹•Ñ±—}Ñ¥Éµ•¬§¥¸€¸¨Í½ÉÔ¤½¤¹Ñ•ÍĞ¡É•ÍÕ±Ğ¹Ñ•áĞñğ€œœ¤ì(€€€½¹ÍĞ±•…¹Q•áĞ€ô±…¥µÍEÕ•ÍÑ¥½¹ÍAÉ•Á…É•ñğ€„¡É•ÍÕ±Ğ¹Ñ•áĞñğ€œœ¤¹ÑÉ¥´ ¤(€€€€€€ü€!…­³ÅÏÅ¸°Í…‘•”Í•±…µ±‡}ÓÅ¸¸ƒÁå¥å¥´°Ñ—}•­¯ñÈ•‘•É¥´¸¹…±¥è•Ñµ•¬¥ÍÑ•‘§}¥¸‰¥ÈÑ…±•À½±‘×}Õ¹‘„‰ÕÉ…‘…çÅ´¸œ(€€€€€€èÉ•ÍÕ±Ğ¹Ñ•áĞì(€€€É•ÑÕÉ¸ì€¸¸¹É•ÍÕ±Ğ°ÅÕ•ÍÑ¥½¹ÌèÕ¹‘•™¥¹•°Ñ•áĞè±•…¹Q•áĞôì(€ô(€É•ÑÕÉ¸É•ÍÕ±Ğì)ôì(