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

ÖNEMLİ: Varsayılan niyet "analyze_request"'tir. Kullanıcı bir ihtiyacı/talebi/projeyi anlatıyorsa analyze_request seç — bu mod zaten gerekirse web araştırması yapar VE dokümanı doldurur.

Intent kuralları:
- "analyze_request": (VARSAYILAN) Kullanıcı bir talep/fikir/entegrasyon/proje/ihtiyaç anlatıyor. Doküman üretilmeli/geliştirilmeli. Bilgi eksikse bile bu niyeti seç; sistem sorular sorar.
- "chat_only": SADECE net olarak sohbet/açıklama isteniyorsa ("nedir?", "açıkla", "selam"). Kısa (<30 karakter) küçük sohbet mesajları için.
- "revise_section": Kullanıcı AÇIKÇA mevcut dokümanın belirli bir bölümünü yeniden yazmamı istiyor ("BA analizi bölümünü güncelle", "test kısmını yeniden yaz").
- "update_node": SADECE seçili metin varsa VE kullanıcı o seçili metni değiştirmek istiyorsa.
- "generate_tests": Kullanıcı AÇIKÇA test senaryosu/kabul kriteri üretilmesini istiyor.
- "generate_flow": Kullanıcı AÇIKÇA süreç akışı/BPMN/diyagram istiyor.
- "research_internal": Kullanıcı AÇIKÇA "geçmiş projelerimde ne yapmıştık", "bizim iş kuralı ne" gibi KURUMSAL HAFIZA sorgulaması yapıyor.
- "research_web": SADECE kullanıcı AÇIKÇA "araştır", "bul", "güncel standart nedir" diyorsa. Bir talep anlattığında BU NİYETİ SEÇME — analyze_request zaten gerekirse web kullanır.

Kural: Kullanıcı bir ihtiyacı/gereksinimi anlatıyorsa ve dokümana dönüşecek içerik varsa → analyze_request.`;

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
