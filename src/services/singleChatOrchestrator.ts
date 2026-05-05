import { Type } from '@google/genai';
import { DocumentData, KnowledgeItem, Question } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { runBaAgentLoop, AgentPhase } from './baAgentLoop';
import { applyNodeUpdate, ANALYST_WEB_SYSTEM_PROMPT } from './intentRouter';
import { hybridSearch } from './contextManager';
import { supabase } from '../supabase';

export type SingleChatIntent =
  | 'chat_only'          // Pure Q&A, no doc touch
  | 'analyze_request'    // New request → BA draft (full loop)
  | 'revise_section'     // Specific section revision (full loop)
  | 'update_node'        // Surgical node-level patch
  | 'generate_tests'     // Fill Test tab (full loop)
  | 'generate_flow'      // Fill FLOW tab (full loop)
  | 'research_internal'  // RAG lookup
  | 'research_web';      // Web search

export interface SingleChatInput {
  userMessage: string;
  history: { role: 'user' | 'model'; parts: { text: string }[] }[];
  documentContent: DocumentData | null;
  knowledgeBase: KnowledgeItem[];
  model: string;
  systemInstruction: string;
  selectedNodeContent?: string | null;
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
  tokenCount: number;
}

const intentSchema = {
  type: Type.OBJECT,
  properties: {
    intent: {
      type: Type.STRING,
      enum: [
        'chat_only',
        'analyze_request',
        'revise_section',
        'update_node',
        'generate_tests',
        'generate_flow',
        'research_internal',
        'research_web',
      ],
    },
    reasoning: { type: Type.STRING },
    targetSection: {
      type: Type.STRING,
      enum: ['businessAnalysis', 'code', 'test', 'bpmn', 'review', ''],
    },
    searchQuery: { type: Type.STRING },
  },
  required: ['intent'],
};

const classifyIntent = async (
  input: SingleChatInput
): Promise<{ intent: SingleChatIntent; targetSection?: string; searchQuery?: string }> => {
  const docSummary = input.documentContent
    ? Object.entries(input.documentContent)
        .filter(([, v]: [string, any]) => v?.content)
        .map(([k, v]: [string, any]) => `${k}: ${v.status || 'DRAFT'} (${String(v.content).length} karakter)`)
        .join('; ') || 'boş'
    : 'boş';

  const selectedSnippet = input.selectedNodeContent
    ? `\n[SEÇİLİ METİN]\n"""${String(input.selectedNodeContent).slice(0, 400)}"""`
    : '';

  const system = `Kullanıcının niyetini sınıflandır. Sadece JSON döndür.

Intent kuralları:
- "chat_only": Sadece açıklama / sohbet / beyin fırtınası. Dokümana dokunma istemi yok.
- "analyze_request": Kullanıcı yeni bir talep/fikir anlatıyor ve BA/IT/Test dokümanı üretilmeli.
- "revise_section": Kullanıcı mevcut dokümanın belirli bir bölümünü yeniden yazmamı istiyor (targetSection doldur).
- "update_node": Kullanıcı seçili küçük bir metni güncelletmek istiyor. (Seçili metin varsa bu niyete öncelik ver.)
- "generate_tests": Kullanıcı test senaryosu/kabul kriteri istiyor.
- "generate_flow": Kullanıcı süreç/akış/BPMN istiyor.
- "research_internal": Kurumsal hafıza / geçmiş epic / iş kuralı araması gerekiyor.
- "research_web": Dış standart / 3rd party API / güncel veri gerekiyor.

Belirsizlikte "chat_only" seç.`;

  const prompt = `[DOKÜMAN DURUMU] ${docSummary}${selectedSnippet}

[KULLANICI MESAJI]
${input.userMessage}

JSON: { intent, reasoning, targetSection, searchQuery }`;

  try {
    const res = await callAiWithRetry(() =>
      callGemini({
        model: input.model,
        systemInstruction: system,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: intentSchema,
        onChunk: () => {},
      })
    );
    const raw = (res.text || '').trim().replace(/^```json\s*/, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(raw);
    return {
      intent: (parsed.intent as SingleChatIntent) || 'chat_only',
      targetSection: parsed.targetSection || undefined,
      searchQuery: parsed.searchQuery || undefined,
    };
  } catch (e) {
    console.warn('Intent classification failed, defaulting to analyze_request:', e);
    // Safe default: if user wrote a long message, treat as analysis request.
    return {
      intent: input.userMessage.length > 80 ? 'analyze_request' : 'chat_only',
    };
  }
};

export const runSingleChatOrchestrator = async (
  input: SingleChatInput
): Promise<SingleChatResult> => {
  input.onPhase('INTENT', 'Niyet belirleniyor...');

  const { intent, targetSection, searchQuery } = await classifyIntent(input);

  // -------- CHAT-ONLY: short reply, no document touch --------
  if (intent === 'chat_only') {
    input.onPhase('ACT', 'Yanıt hazırlanıyor...');
    let text = '';
    let thinking = '';
    let tokens = 0;
    const res = await callAiWithRetry(() =>
      callGemini({
        model: input.model,
        systemInstruction: `${input.systemInstruction}\n\nKullanıcıyla kısa, net ve yardımcı bir şekilde konuş. Dokümanı güncelleme. Uzun analiz üretme.`,
        contents: [
          ...input.history,
          { role: 'user', parts: [{ text: input.userMessage }] },
        ],
        onChunk: (t, think, tk) => {
          text = t;
          if (think) thinking = think;
          if (tk) tokens = tk;
          input.onStream(text, thinking, undefined, undefined, tokens);
        },
      })
    );
    return {
      text: res.text || text,
      thinking,
      intent,
      tokenCount: tokens,
    };
  }

  // -------- UPDATE_NODE: surgical patch via intentRouter.applyNodeUpdate --------
  if (intent === 'update_node' && input.documentContent && input.selectedNodeContent) {
    input.onPhase('ACT', 'Seçili metin güncelleniyor...');
    const editSystem = `Kullanıcının talep ettiği şekilde SADECE aşağıdaki seçili metni yeniden yaz.
Sonucu düz metin/Markdown olarak döndür, başka yorum EKLEME.

[SEÇİLİ METİN]
${input.selectedNodeContent}`;
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
    const updated = applyNodeUpdate(
      input.documentContent,
      targetSection || 'businessAnalysis',
      newContent
    );
    const summary = `Seçili metni "${targetSection || 'businessAnalysis'}" bölümünde güncelledim.`;
    input.onStream(summary, thinking, undefined, summary, tokens);
    return {
      text: summary,
      thinking,
      actionSummary: summary,
      document: updated,
      intent,
      tokenCount: tokens,
    };
  }

  // -------- RESEARCH_INTERNAL: pgvector RAG --------
  if (intent === 'research_internal') {
    input.onPhase('RESEARCH', 'Kurumsal hafıza taranıyor...');
    const query = searchQuery || input.userMessage;
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
    const text =
      hits.length > 0
        ? `**Kurumsal Hafıza (${query}):**\n\n${hits.map((h, i) => `${i + 1}. ${h.content}`).join('\n\n')}`
        : `"${query}" için kurumsal hafızada kayıt bulunamadı.`;
    input.onStream(text, '', undefined, `search_internal(${query})`, 0);
    return { text, thinking: '', intent, tokenCount: 0 };
  }

  // -------- RESEARCH_WEB: Google grounding --------
  if (intent === 'research_web') {
    input.onPhase('RESEARCH', 'Web kaynakları taranıyor...');
    const query = searchQuery || input.userMessage;
    let text = '';
    let grounding: { uri: string; title: string }[] = [];
    let tokens = 0;
    await callAiWithRetry(() =>
      callGemini({
        model: input.model,
        systemInstruction: ANALYST_WEB_SYSTEM_PROMPT,
        contents: [{ role: 'user', parts: [{ text: query }] }],
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
      actionSummary: `search_web(${query})`,
      intent,
      tokenCount: tokens,
    };
  }

  // -------- ANALYZE / REVISE / GENERATE_TESTS / GENERATE_FLOW: full BA loop --------
  const loopHint =
    intent === 'revise_section' && targetSection
      ? `\n\n[ODAK] Kullanıcı özellikle "${targetSection}" bölümünü güncellememi istiyor. Diğer bölümleri koru.`
      : intent === 'generate_tests'
      ? '\n\n[ODAK] Kullanıcı test senaryoları/kabul kriterleri istiyor. "test" bölümünü detaylı doldur; diğer bölümleri gereksizce yeniden yazma.'
      : intent === 'generate_flow'
      ? '\n\n[ODAK] Kullanıcı süreç akışı istiyor. "bpmn" veya review akış anlatımını üret.'
      : '';

  const loopOutput = await runBaAgentLoop({
    userMessage: input.userMessage,
    history: input.history,
    documentContent: input.documentContent,
    knowledgeBase: input.knowledgeBase,
    model: input.model,
    systemInstruction: input.systemInstruction + loopHint,
    onPhase: (phase, label) => input.onPhase(phase, label),
    onThinking: input.onThinking,
    onActStream: input.onStream,
    onGrounding: input.onGrounding,
  });

  return {
    text: loopOutput.text,
    thinking: loopOutput.thinking,
    questions: loopOutput.questions,
    actionSummary: loopOutput.actionSummary,
    groundingUrls: loopOutput.groundingUrls,
    document: loopOutput.document,
    intent,
    tokenCount: loopOutput.tokenCount,
  };
};
