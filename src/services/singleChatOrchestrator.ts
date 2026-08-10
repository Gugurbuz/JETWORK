import { parse as parsePartialJson } from 'partial-json';
import { DocumentData, KnowledgeItem, Message, Question } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { runBaAgentLoop, AgentPhase } from './baAgentLoop';
import { applyNodeUpdate, ANALYST_WEB_SYSTEM_PROMPT } from './intentRouter';
import { hybridSearch } from './contextManager';
import { supabase } from '../supabase';
import {
  IntentClassification,
  DocumentSectionKey,
  SubIntent,
} from './ai/intentTypes';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { chatResponseJsonSchema } from '../schemas';
import {
  CONCEPTUAL_ARTIFACT_CONTRACT_PROMPT,
  conceptualArtifactResponseJsonSchema,
  parseConceptualArtifact,
  renderConceptualArtifact,
} from './ai/conceptualArtifactContract';
import { computeDiscoverySignals, DRAFT_FIRST_SYSTEM_RULE, containsBlockedQuestionDomain } from './ai/discoveryPolicy';
import { buildClassification } from './ai/intentClassifier';
import { buildDeepBaActInstructions, parseClassifierQuestion } from '../modules/deep-ba-assistant';
import { buildBaMindsetInstruction } from './ai/baMindset';
import {
  analyzeSourceIntelligence,
  buildSourceCorpus,
  buildSourceIntelligencePrompt,
} from './sourceIntelligence';
import { extractProjectMemoryUpdates, type ProjectMemory } from './ai/projectMemoryEngine';
import {
  buildAiTurnDecisionInstruction,
  type AiTurnDecision,
} from './ai/aiTurnDecision';
import { saveProjectMemory } from './projectMemoryRepository';
import {
  cancelPendingOperation,
  confirmPendingOperation,
  createPendingOperation,
  documentsMatch,
  failPendingOperation,
  getLatestPendingOperation,
  type PendingOperation,
} from './pendingOperationRepository';
import type { AnalystTurnContext } from './analystContext';
import { planAnalystTurn, type AnalystDecision } from './ai/analystPlanner';
import { preserveArtifactDecisions } from './artifactPreservation';
import {
  createKrokiBpmnMarkdownLink,
  extractRenderableBpmnXml,
  removeKrokiLinks,
} from './ai/bpmnKroki';

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
  workspaceTitle?: string;
  workspaceId?: string;
  projectMemory?: ProjectMemory;
  analystContext?: AnalystTurnContext;
  signal?: AbortSignal;
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
  onDecision?: (decision: AnalystDecision) => void;
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
  turnDecision?: AiTurnDecision;
  pendingOperationId?: string;
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

function buildDocumentGenerationDirective(decision: AiTurnDecision, retry = false): string {
  const profile = decision.artifactProfile;
  return [
    `[DOKUMAN URETIM UYGULAMASI${retry ? ' - KONTROLLU IKINCI DENEME' : ''}]`,
    '- Bu turda document alani zorunludur; businessAnalysis ve review gorunur yuzeylerini dondur.',
    '- questions alanini bos birak ve yeni soru sorma.',
    `- Yalniz artifact profile "${profile.id}" yapisini uygula.`,
    `- Zorunlu basliklar: ${profile.requiredSections.join(' | ') || 'profilde zorunlu baslik yok'}.`,
    `- Opsiyonel basliklar: ${profile.optionalSections.join(' | ') || 'yok'}.`,
    `- Eklenmemesi gereken kaliplar: ${profile.forbiddenSections.join(' | ') || 'yok'}.`,
    '- Baska bir genel BA, teknik analiz, test veya entegrasyon sablonunu bu profile ekleme.',
    '- Kaynakta olmayan gercekleri uydurma; gerekli belirsizligi VARSAYIM veya ACIK KONU olarak ayir.',
    '- Review yalniz kanit durumunu, riskleri, celiskileri, varsayimlari ve acik kararlari raporlar.',
    '- Chat mesaji en fazla 3 cumlelik somut bir "ne yaptim" ozeti olsun.',
    ...profile.promptRules.map(rule => `- ${rule}`),
  ].join('\n');
}

function compactDocumentRevisionContext(document: DocumentData): string {
  const compact = {
    businessAnalysis: document.businessAnalysis
      ? { ...document.businessAnalysis, content: (document.businessAnalysis.content || '').slice(0, 24_000) }
      : undefined,
    review: document.review
      ? { ...document.review, content: (document.review.content || '').slice(0, 12_000) }
      : undefined,
    evidenceClaims: document.evidenceClaims,
  };
  return JSON.stringify(compact);
}
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
- Bu tur questions alanını boş bırak; kullanıcıdan yeni bilgi isteme.
- Proje/support sınıflandırmasını, kaynak dosyalarını ve iç çalışma yöntemini açıklama.`;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      signal: input.signal,
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
  code?: string,
  preferredQuestions?: Question[],
): Promise<SingleChatResult> {
  input.onPhase('ACT', 'Netleştirici sorular hazırlanıyor...');

  if (preferredQuestions && preferredQuestions.length > 0) {
    const questions = preferredQuestions.slice(0, 3);
    const msg = code === 'MISSING_SELECTION'
      ? 'Seçili metin göremedim. Dokümandan ilgili kısmı seçip tekrar dener misin?'
      : 'Talebi doğru çerçevelemek için şu noktaları netleştirelim.';
    input.onStream(msg, '', questions, 'ask_clarifying_questions_gap_matrix', 0);
    return {
      text: msg,
      thinking: '',
      questions,
      intent: 'ask_questions',
      classification,
      tokenCount: 0,
    };
  }

  // If the classifier already provided good questions, use them directly.
  if (classification.clarificationQuestions && classification.clarificationQuestions.length > 0) {
    const maxQuestions = 3;
    const questions: Question[] = classification.clarificationQuestions
      .slice(0, maxQuestions)
      .map((text, i) => parseClassifierQuestion(text, i));
    const msg = code === 'MISSING_SELECTION'
      ? 'Seçili metin göremedim. Dokümandan ilgili kısmı seçip tekrar dener misin?'
      : 'Talebi doğru çerçevelemek için şu noktaları netleştirelim.';
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

  // Otherwise ask the model to produce 2-3 quick-answer questions.
  let raw = '';
  let tokens = 0;
  const sys = `Sen JetWork AI'sın. Kullanıcının isteğini netleştirmek için EN FAZLA 3 hızlı cevaplanabilir soru üret.

ÇIKTI JSON:
{ "message": "kısa açıklayıcı giriş",
  "questions": [ { "id": "q1", "text": "...", "options": ["seçenek 1", "seçenek 2", "seçenek 3"] } ] }

- Her soruda 2-4 seçenek olmalı.
- Dokümanı değiştirme.`;
  await callAiWithRetry(() =>
    callGemini({
      model: input.model,
      signal: input.signal,
      systemInstruction: `${sys}

${buildBaMindsetInstruction({ mode: 'ask_clarifying_questions', domain: classification.baAgentFocus || 'generic_ba', depth: 'standard' })}

- En fazla 3 soru uret; 4 soru uretme.
- Soru ancak kritik karar eksigini kapatacaksa sorulur.`,
      contents: [
        ...input.history,
        { role: 'user', parts: [{ text: input.userMessage }] },
      ],
      onChunk: (t, _th, tk) => {
        raw = t;
        if (tk) tokens = tk;
        const parts = extractParts(raw);
        input.onStream(parts.message || '', '', parts.questions?.slice(0, 3), parts.actionSummary, tokens);
      },
    })
  );
  const finalParts = extractParts(raw);
  return {
    text: finalParts.message || 'Birkaç netleştirici sorum var.',
    thinking: '',
    questions: finalParts.questions?.slice(0, 3),
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
      signal: input.signal,
      systemInstruction: editSystem,
      contents: [{ role: 'user', parts: [{ text: input.userMessage }] }],
      onChunk: (t, think, tk) => {
        newContent = t;
        if (think) thinking = think;
        if (tk) tokens = tk;
      },
    })
  );
  let updated: DocumentData | undefined;
  if (input.documentContent) {
    const selected = input.selectedNodeContent || '';
    const existingSection = input.documentContent[section] as any;
    if (
      selected
      && typeof existingSection?.content === 'string'
      && existingSection.content.includes(selected)
    ) {
      updated = {
        ...input.documentContent,
        [section]: {
          ...existingSection,
          content: existingSection.content.replace(selected, newContent),
        },
      };
    } else {
      updated = applyNodeUpdate(input.documentContent, section, newContent);
    }
  }
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
      signal: input.signal,
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
  const finalText = /\b(resmi\s+kaynak|resmi\s+kaynaklardan)\b/i.test(input.userMessage)
    ? `Kullanıcı talebi: ${input.userMessage.trim()}\n\nResmi kaynak araştırması sonucu:\n\n${text}`
    : text;
  return {
    text: finalText,
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
  opts: { forceDraft?: boolean; turnDecision?: AiTurnDecision } = {}
): Promise<SingleChatResult> {
  const focus = classification.baAgentFocus;
  const target = classification.targetSection;
  const focusHint = focus === 'test'
    ? '\n\n[ODAK] Test stratejisi, UAT ve kabul senaryolarini BA Analiz icinde detayli alt baslik olarak yaz; ayri test sekmesi uretmeye zorlama.'
    : focus === 'flow'
      ? '\n\n[ODAK] Surec akisini BA Analiz icinde metinsel/Mermaid taslak olarak yaz; ayri bpmn sekmesi uretmeye zorlama.'
      : focus === 'technical_analysis'
        ? '\n\n[ODAK] Teknik analiz, API, veri modeli ve entegrasyon mimarisini BA Analiz icinde kavramsal tasarim alt basliklari olarak yaz.'
        : focus === 'review'
          ? '\n\n[ODAK] "review" bolumunde riskler, acik sorular ve kalite gozden gecirmesi uret.'
          : target
            ? `\n\n[ODAK] Ozellikle "${target}" bolumunu guncelle; diger bolumleri koru.`
            : '';
  const sourceReport = analyzeSourceIntelligence({
    sourceText: buildSourceCorpus({
      userMessage: input.userMessage,
      messages: input.messageHistory,
      document: input.documentContent,
    }),
    workspaceTitle: input.workspaceTitle,
  });
  const sourceHint = sourceReport.confidence >= 45 || sourceReport.processes.length || sourceReport.mismatchWarnings.length
    ? `\n\n${buildSourceIntelligencePrompt(sourceReport)}`
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
    signal: input.signal,
    // The concrete turn decision is added once by baAgentLoop's act context.
    // Keep this system prompt focused on stable product rules and source facts.
    systemInstruction: `${input.systemInstruction}\n\n${DRAFT_FIRST_SYSTEM_RULE}${focusHint}${sourceHint}`,
    turnDecision: opts.turnDecision,
    sourceProcessTitles: sourceReport.processes.map(process => process.title),
    currentArtifactInSystemContext: !!input.analystContext?.currentArtifact,
    onPhase: (phase, label) => input.onPhase(phase, label),
    onThinking: input.onThinking,
    onActStream: input.onStream,
    onGrounding: input.onGrounding,
  });

  let finalDocument = loopOutput.document;
  let finalText = loopOutput.text;
  let finalQuestions = loopOutput.questions;
  const forceDraftAllowed = !!opts.forceDraft
    && opts.turnDecision?.action !== 'ask_questions'
    && opts.turnDecision?.action !== 'answer_only'
    && opts.turnDecision?.action !== 'research_first';
  const generationTimedOut = /zaman asimina ugradi|timed out/i.test(finalText || '');

  // Force-draft fallback: BA loop finished without a document even though
  // the caller required one. Make a second, narrower call that MUST return
  // the document field per schema.
  if (forceDraftAllowed && !finalDocument && !generationTimedOut) {
    input.onPhase('ACT', 'Taslak zorla üretiliyor...');
    try {
      const structuredConceptualArtifact = !!opts.turnDecision?.artifactProfile.id.startsWith('conceptual_design');
      const fallbackSystem = `${input.systemInstruction}

${DRAFT_FIRST_SYSTEM_RULE}
${sourceHint}

${opts.turnDecision ? buildAiTurnDecisionInstruction(opts.turnDecision) : ''}
${opts.turnDecision ? buildDocumentGenerationDirective(opts.turnDecision, true) : ''}
${structuredConceptualArtifact ? CONCEPTUAL_ARTIFACT_CONTRACT_PROMPT : ''}

${buildDeepBaActInstructions(buildRecentSubject(input))}`;

      const fallbackContents: any[] = [
        ...input.history,
        {
          role: 'user',
          parts: [{ text: [
            input.documentContent && !input.analystContext?.currentArtifact
              ? `[MEVCUT DOKUMAN - REVIZYON BAGLAMI]\n${compactDocumentRevisionContext(input.documentContent)}`
              : '',
            `[KULLANICI TALEBI]\n${input.userMessage}`,
            'Ilk uretim document alani dondurmedi. Ayni karari yeniden yorumlamadan secili artifact profile gore document alanini uret.',
          ].filter(Boolean).join('\n\n') }],
        },
      ];

      const fallback = await callGemini({
        model: input.model,
        signal: input.signal,
        systemInstruction: fallbackSystem,
        contents: fallbackContents,
        responseSchema: structuredConceptualArtifact
          ? conceptualArtifactResponseJsonSchema
          : chatResponseJsonSchema,
        onChunk: () => {},
      });

      try {
        const parsed = JSON.parse((fallback.text || '').trim());
        const conceptualArtifact = structuredConceptualArtifact
          ? parseConceptualArtifact(parsed?.conceptualArtifact)
          : null;
        const generatedDocument = conceptualArtifact
          ? renderConceptualArtifact(conceptualArtifact)
          : parsed?.document;
        if (parsed && typeof parsed === 'object' && generatedDocument) {
          finalDocument = generatedDocument;
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

  // Honesty guard: if the assistant text claims document was updated but no
  // document was actually produced, rewrite it to be truthful.
  const claimsUpdate = /(doküman|sağ panel).{0,40}(güncellen|oluşturul|işlendi|eklen|aktarıl)/i.test(finalText || '');
  if (!finalDocument && forceDraftAllowed && (generationTimedOut || claimsUpdate || !finalText.trim())) {
    finalText = generationTimedOut
      ? 'Kavramsal doküman üretimi zaman aşımına uğradı; yarım veya doğrulanmamış içerik sağ panele uygulanmadı.'
      : 'Doküman üretimi iki kontrollü denemede de geçerli bir artifact döndürmedi; sağ panel değiştirilmedi. Talep ve mevcut içerik korundu.';
  }

  if (finalDocument) {
    finalDocument = preserveArtifactDecisions(
      input.documentContent,
      finalDocument,
      input.userMessage,
      classification.targetSection,
    );
  }

  if (finalDocument && opts.turnDecision?.artifactProfile.id === 'enerjisa_bpmn') {
    const xml = extractRenderableBpmnXml(finalDocument.businessAnalysis?.content || '');
    if (xml) {
      const link = await createKrokiBpmnMarkdownLink(xml);
      if (link) {
        finalText = `${removeKrokiLinks(finalText)}\n\n${link}`.trim();
      }
    }
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
    turnDecision: opts.turnDecision,
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

async function runMemoryAction(
  input: SingleChatInput,
  classification: IntentClassification
): Promise<SingleChatResult> {
  if (!input.workspaceId) {
    const msg = 'Hafıza isteğini algıladım; aktif çalışma alanı olmadığı için kalıcı kayıt yapılmadı.';
    input.onStream(msg, '', undefined, `memory_failed:${classification.subIntent}`, 0);
    return {
      text: msg,
      thinking: '',
      actionSummary: `memory_failed:${classification.subIntent}`,
      intent: 'memory_action',
      classification,
      tokenCount: 0,
    };
  }

  const updates = extractProjectMemoryUpdates({
    userMessage: input.userMessage,
    document: input.documentContent,
  });
  if (Object.keys(updates).length === 0) {
    const prefixByIntent: Partial<Record<SubIntent, string>> = {
      save_decision: 'decision',
      save_requirement: 'requirement',
      save_constraint: 'constraint',
      save_assumption: 'assumption',
      save_business_rule: 'business_rule',
      save_term: 'term',
    };
    const prefix = prefixByIntent[classification.subIntent] || 'fact';
    updates[`${prefix}.${Date.now()}`] = input.userMessage.trim();
  }

  const write = await saveProjectMemory(input.workspaceId, updates);
  const msg = write.ok
    ? `${write.savedCount} bilgi proje hafızasına kalıcı olarak kaydedildi.`
    : `Proje hafızasına kayıt yapılamadı: ${write.error || 'bilinmeyen hata'}`;
  input.onStream(msg, '', undefined, `memory:${classification.subIntent}`, 0);
  return {
    text: msg,
    thinking: '',
    actionSummary: `${write.ok ? 'memory_saved' : 'memory_failed'}:${classification.subIntent}`,
    intent: 'memory_action',
    classification,
    tokenCount: 0,
  };
}

async function runPreviewRequired(
  input: SingleChatInput,
  classification: IntentClassification,
  turnDecision: AiTurnDecision,
): Promise<SingleChatResult> {
  if (!input.workspaceId || !input.documentContent) {
    const protectedContent = input.documentContent?.businessAnalysis?.content
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    const msg = [
      'Bu yıkıcı değişiklik kullanıcı onayı olmadan uygulanmadı.',
      'Önizleme oluşturmak için aktif çalışma alanı ve temel doküman gerekir; mevcut doküman aynen korunuyor.',
      protectedContent ? `Korunan mevcut içerik: ${protectedContent}` : '',
    ].filter(Boolean).join('\n\n');
    input.onStream(msg, '', undefined, `preview_failed:${classification.subIntent}`, 0);
    return { text: msg, thinking: '', actionSummary: `preview_failed:${classification.subIntent}`, intent: 'preview_required', classification, turnDecision, tokenCount: 0 };
  }

  try {
    const previewClassification: IntentClassification = {
      ...classification,
      documentImpact: 'updates_document',
      riskLevel: 'medium',
      requiresPreview: false,
      requiresClarification: false,
      shouldRunBaAgentLoop: true,
    };
    const previewDecision: AiTurnDecision = {
      ...turnDecision,
      action: 'revise_document',
      documentPolicy: {
        ...turnDecision.documentPolicy,
        shouldUpdateDocument: true,
        forceDocumentGeneration: true,
      },
      executionPolicy: {
        ...turnDecision.executionPolicy,
        requiresConfirmation: false,
      },
    };
    const proposed = await runBaLoop(input, previewClassification, {
      forceDraft: true,
      turnDecision: previewDecision,
    });

    if (!proposed.document) throw new Error('AI did not produce a proposed document.');

    const pending = await createPendingOperation({
      workspaceId: input.workspaceId,
      action: turnDecision.action,
      operation: turnDecision.executionPolicy.operation,
      targetSection: turnDecision.executionPolicy.targetSection,
      baseDocument: input.documentContent,
      proposedDocument: proposed.document,
      requestText: input.userMessage,
    });
    const changed = pending.diff.changedSections.join(', ') || 'belge içeriği';
    const msg = `Önizleme oluşturuldu; değişiklik henüz uygulanmadı. İşlem: ${pending.id}. Değişecek alanlar: ${changed}. Aynı çalışma alanında "uygula" yazarak bu işlem kimliğine bağlı öneriyi onaylayabilir veya "iptal" diyebilirsin.`;
    input.onStream(msg, proposed.thinking, undefined, `preview_created:${pending.id}`, proposed.tokenCount);
    return {
      text: msg,
      thinking: proposed.thinking,
      actionSummary: `preview_created:${pending.id}`,
      intent: 'preview_required',
      classification,
      turnDecision,
      pendingOperationId: pending.id,
      tokenCount: proposed.tokenCount,
    };
  } catch (error: any) {
    const msg = `Önizleme kaydedilemedi; değişiklik uygulanmadı. ${error?.message || 'Bilinmeyen hata.'}`;
    input.onStream(msg, '', undefined, `preview_failed:${classification.subIntent}`, 0);
    return { text: msg, thinking: '', actionSummary: `preview_failed:${classification.subIntent}`, intent: 'preview_required', classification, turnDecision, tokenCount: 0 };
  }
}

function runPendingOperationMissing(input: SingleChatInput, classification: IntentClassification, turnDecision: AiTurnDecision): SingleChatResult {
  const msg = 'Bu çalışma alanında onay bekleyen geçerli bir değişiklik bulunmuyor. Hiçbir doküman değişikliği uygulanmadı.';
  input.onStream(msg, '', undefined, 'pending_operation_missing', 0);
  return { text: msg, thinking: '', actionSummary: 'pending_operation_missing', intent: 'preview_required', classification, turnDecision, tokenCount: 0 };
}

async function runCancelPendingOperation(
  input: SingleChatInput,
  classification: IntentClassification,
  turnDecision: AiTurnDecision,
  pending: PendingOperation,
): Promise<SingleChatResult> {
  const cancelled = await cancelPendingOperation(pending.id);
  const msg = cancelled
    ? `Bekleyen işlem ${pending.id} iptal edildi. Doküman değiştirilmedi.`
    : `Bekleyen işlem ${pending.id} iptal edilemedi. Doküman değiştirilmedi.`;
  input.onStream(msg, '', undefined, cancelled ? `pending_cancelled:${pending.id}` : `pending_cancel_failed:${pending.id}`, 0);
  return { text: msg, thinking: '', actionSummary: cancelled ? `pending_cancelled:${pending.id}` : `pending_cancel_failed:${pending.id}`, intent: 'preview_required', classification, turnDecision, pendingOperationId: pending.id, tokenCount: 0 };
}

async function runExecutePendingOperation(
  input: SingleChatInput,
  classification: IntentClassification,
  turnDecision: AiTurnDecision,
  pending: PendingOperation,
): Promise<SingleChatResult> {
  if (!documentsMatch(input.documentContent, pending.baseDocument)) {
    await failPendingOperation(pending.id, 'Base document changed before confirmation.');
    const msg = `Bekleyen işlem ${pending.id} uygulanmadı; temel doküman önizlemeden sonra değişmiş. Yeni bir önizleme oluşturulması gerekiyor.`;
    input.onStream(msg, '', undefined, `pending_stale:${pending.id}`, 0);
    return { text: msg, thinking: '', actionSummary: `pending_stale:${pending.id}`, intent: 'preview_required', classification, turnDecision, pendingOperationId: pending.id, tokenCount: 0 };
  }

  const confirmed = await confirmPendingOperation(pending.id);
  if (!confirmed) {
    const msg = `Bekleyen işlem ${pending.id} onay kaydıyla eşleştirilemedi; doküman değiştirilmedi.`;
    input.onStream(msg, '', undefined, `pending_confirm_failed:${pending.id}`, 0);
    return { text: msg, thinking: '', actionSummary: `pending_confirm_failed:${pending.id}`, intent: 'preview_required', classification, turnDecision, pendingOperationId: pending.id, tokenCount: 0 };
  }

  const msg = `Onay, bekleyen işlem ${pending.id} ile eşleştirildi. Kaydedilmiş öneri dokümana uygulanıyor.`;
  input.onStream(msg, '', undefined, `pending_confirmed:${pending.id}`, 0);
  return {
    text: msg,
    thinking: '',
    actionSummary: `pending_confirmed:${pending.id}`,
    document: pending.proposedDocument,
    intent: 'revise_section',
    classification,
    turnDecision,
    pendingOperationId: pending.id,
    tokenCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

function isPendingOperationControlMessage(value: string): boolean {
  const normalized = value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(devam et|uygula|onayla|onayliyorum|evet uygula|degisikligi uygula|iptal|vazgec|vazgectim|islemi iptal et|degisikligi iptal et)$/.test(normalized);
}

const runSingleChatOrchestratorInner = async (
  input: SingleChatInput
): Promise<SingleChatResult> => {
  input.onPhase('INTENT', 'Niyet belirleniyor...');

  const signals = computeDiscoverySignals(
    input.userMessage,
    input.messageHistory || [],
    input.documentContent,
  );
  const pendingOperationLookupPerformed = !!input.workspaceId && isPendingOperationControlMessage(input.userMessage);
  const turnInput: SingleChatInput = signals.newStandaloneRequest && !pendingOperationLookupPerformed
    ? {
      ...input,
      history: [],
      messageHistory: [],
      documentContent: null,
    }
    : input;
  let pendingOperation: PendingOperation | null = null;
  if (pendingOperationLookupPerformed && input.workspaceId) {
    try {
      pendingOperation = await getLatestPendingOperation(input.workspaceId);
    } catch (error: any) {
      input.onThinking(`Bekleyen işlem kaydı okunamadı: ${error?.message || 'bilinmeyen hata'}`);
    }
  }

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

  const aiDiscoverySignals = {
    mustGenerateNow: signals.mustGenerateNow,
    greetingOnly: signals.greetingOnly,
    newStandaloneRequest: signals.newStandaloneRequest,
    isAnsweringDiscovery: signals.isAnsweringDiscovery,
    reason: signals.reason,
  };
  const analystPlan = await planAnalystTurn({
    userMessage: turnInput.userMessage,
    document: turnInput.documentContent,
    selectedText: turnInput.selectedNodeContent,
    selectedSection: turnInput.selectedSection,
    model: turnInput.model,
    recentMessages: turnInput.messageHistory || [],
    recentConversationText: turnInput.history
      .slice(-6)
      .map(item => item.parts.map(part => part.text).join('\n'))
      .filter(Boolean)
      .join('\n\n'),
    workspaceTitle: turnInput.workspaceTitle,
    knowledgeBase: turnInput.knowledgeBase,
    projectMemory: turnInput.projectMemory,
    discoveryReadiness: signals.baDiscoveryReadiness,
    discoverySignals: aiDiscoverySignals,
    zeroTouchEnabled: FEATURE_FLAGS.ZERO_TOUCH,
    pendingOperation: pendingOperation ? { id: pendingOperation.id } : null,
    pendingOperationLookupPerformed,
  });
  let classification = analystPlan.classification;
  const behaviorDecision = analystPlan.behavior;
  const cognitiveFrame = analystPlan.cognitiveFrame;
  const copilotTrace = analystPlan.trace;
  const runtimeSnapshot = analystPlan.runtime;
  const aiTurnDecision = analystPlan.legacyDecision;
  const analystDecision = analystPlan.decision;
  turnInput.onDecision?.(analystDecision);
  const requestedOperation = analystDecision.requestedOperation;
  turnInput.onThinking('Talep iş analizi açısından değerlendiriliyor.');

  // Cognitive/runtime snapshots explain the decision. AiTurnDecision alone
  // controls execution so no downstream layer can reinterpret the same turn.
  const copilotFinalAction = runtimeSnapshot.finalAction;

  if (requestedOperation === 'system_message') {
    const code = classification.subIntent === 'zero_touch_requested'
      ? 'ZERO_TOUCH_DISABLED'
      : classification.subIntent === 'agent_debate_requested'
        ? 'AGENT_DEBATE_DISABLED'
        : 'UNSUPPORTED';
    return runSystemMessage(turnInput, classification, code);
  }

  if (requestedOperation === 'memory_action') {
    return runMemoryAction(turnInput, classification);
  }

  if (requestedOperation === 'workflow_action') {
    return runWorkflowStub(turnInput, classification);
  }

  if (requestedOperation === 'pending_operation_missing') {
    return runPendingOperationMissing(turnInput, classification, aiTurnDecision);
  }

  if (requestedOperation === 'cancel_pending_change' && pendingOperation) {
    return runCancelPendingOperation(turnInput, classification, aiTurnDecision, pendingOperation);
  }

  if (requestedOperation === 'execute_confirmed_change' && pendingOperation) {
    return runExecutePendingOperation(turnInput, classification, aiTurnDecision, pendingOperation);
  }

  if (requestedOperation === 'preview_change') {
    return runPreviewRequired(turnInput, classification, aiTurnDecision);
  }

  if (requestedOperation === 'update_selected_text') {
    return runUpdateSelectedText(turnInput, classification);
  }

  if (
    analystDecision.action === 'REVIEW_ARTIFACT'
    && ['draft_document', 'revise_document', 'repair_document'].includes(requestedOperation)
  ) {
    classification = {
      ...classification,
      primaryIntent: 'quality_review',
      subIntent: 'generate_review_report',
      targetSection: 'review',
      documentImpact: 'updates_document',
      operation: turnInput.documentContent ? 'append_to_section' : 'replace_or_create_section',
      requiresClarification: false,
      clarificationQuestions: undefined,
      requiresPreview: false,
      shouldRunBaAgentLoop: true,
      baAgentFocus: 'review',
      reason: `${classification.reason}; analyst_action:review_artifact_write`,
    };
    turnInput.onPhase('ACT', 'Review bölümü güncelleniyor...');
    const result = await runBaLoop(
      turnInput,
      classification,
      {
        forceDraft: aiTurnDecision.documentPolicy.forceDocumentGeneration,
        turnDecision: aiTurnDecision,
      },
    );
    return {
      ...result,
      turnDecision: aiTurnDecision,
      document: result.document,
    };
  }

  if (analystDecision.action === 'REVIEW_ARTIFACT') {
    return runChatOnly({
      ...turnInput,
      systemInstruction: `${turnInput.systemInstruction}\n\n[READ-ONLY QUALITY REVIEW]\nMevcut dokumani degerlendir; belge bolumlerini degistirme veya yeni icerik ekleme. Bulgulari kanit, etki ve onerilen aksiyon ile sohbette raporla.`,
    }, classification);
  }

  if (analystDecision.action === 'ANSWER' && requestedOperation === 'answer_only') {
    return runChatOnly(turnInput, classification);
  }

  if (requestedOperation === 'research_first') {
    const internalResearch = classification.researchType === 'internal'
      || classification.researchType === 'workspace_history'
      || classification.subIntent === 'research_internal_knowledge'
      || classification.subIntent === 'research_workspace_history';
    if (internalResearch) return runResearchInternal(turnInput, classification);
    return runResearchWeb(
      turnInput,
      {
        ...classification,
        requiresResearch: true,
        researchType: 'web',
        reason: `${classification.reason}; ai_turn_decision:${aiTurnDecision.reason}`,
      },
    );
  }

  if (analystDecision.action === 'ASK') {
    const gapQuestions = analystDecision.questions || [];
    classification = {
      ...classification,
      documentImpact: 'none',
      operation: 'none',
      requiresClarification: true,
      clarificationQuestions: gapQuestions.map(question => question.text),
      shouldRunBaAgentLoop: false,
      reason: `${classification.reason}; ai_turn_decision:${aiTurnDecision.reason}; copilot:${copilotFinalAction}; cognitive:ask_first:${cognitiveFrame.action}:${cognitiveFrame.artifactMode}:${cognitiveFrame.sourceRichness}`,
    };
    return runAskClarifyingQuestions(turnInput, classification, undefined, gapQuestions);
  }

  // Short-circuit 2: behavior engine or discovery guard decided the turn must
  // produce/update a visible document. This is now the main decision point for
  // draft-first BA work.
  if (['CREATE_ARTIFACT', 'UPDATE_ARTIFACT'].includes(analystDecision.action)
    && ['draft_document', 'revise_document', 'repair_document'].includes(requestedOperation)) {
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
      targetSection: classification.targetSection === 'review' ? 'review' : 'businessAnalysis',
      requiresClarification: false,
      clarificationQuestions: undefined,
      requiresPreview: false,
      shouldRunBaAgentLoop: true,
      baAgentFocus: classification.baAgentFocus || 'business_analysis',
      confidence: Math.max(classification.confidence, 0.85),
      reason: `${classification.reason}; ai_turn_decision:${aiTurnDecision.reason}; copilot:${copilotFinalAction}; orchestrator_behavior:${behaviorDecision.reason}; cognitive_action:${cognitiveFrame.action}; discovery_guard:${signals.reason}`,
    };
    turnInput.onPhase('ACT', 'Taslak dokümana geçiliyor...');
    const result = await runBaLoop(
      turnInput,
      classification,
      {
        forceDraft: aiTurnDecision.documentPolicy.forceDocumentGeneration,
        turnDecision: aiTurnDecision,
      },
    );
    return {
      ...result,
      turnDecision: aiTurnDecision,
      document: result.document,
    };
  }

  // Every action is handled above. This defensive fallback is read-only and
  // intentionally cannot mutate the document.
  return runChatOnly(turnInput, classification);
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
  // The public action contract is single-action-per-turn. Question cards are
  // only valid when the chosen action is actually ASK.
  if (result.intent !== 'ask_questions' && result.questions?.length) {
    return { ...result, questions: undefined };
  }
  return result;
};
