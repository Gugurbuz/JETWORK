import { Type } from '@google/genai';
import { callGemini, callAiWithRetry } from './geminiService';
import { supabase } from '../supabase';
import { DocumentData, SectionData } from '../types';

// ---------------------------------------------------------------------------
// Tool declarations exposed to Gemini. These mirror the 4-tool intent engine
// defined in the blueprint:
//   1) answer_question         - plain chat reply
//   2) update_document_node    - surgical Tiptap-safe content replacement
//   3) search_internal_database- pgvector RAG over Supabase knowledge_base
//   4) search_web              - external research (Google Search grounding)
// ---------------------------------------------------------------------------

export const ANALYST_WEB_SYSTEM_PROMPT = `Sen Jetwork Blueprint'te çalışan kıdemli bir İş Analistisin. Kaynak tarayıcısı DEĞİLSİN.
Web'den topladığın bilgiyi bir analistin notu gibi, KISA ve AKSİYON ODAKLI sun.

Cevabın MUTLAKA şu 4 bölümü bu sırayla içermeli (markdown başlıklarla):

## Özet
3-5 maddelik bullet, en kritik bulgular. Uzun literatür özeti YAZMA.

## Blueprint'e Etkisi
Bu bulgunun mevcut dokümanın hangi bölümlerini (AS-IS, TO-BE, SAP Entegrasyon Gereksinimleri, Kabul Kriterleri, Riskler) nasıl etkileyebileceğini 2-4 madde halinde yaz.

## Önerilen Sonraki Adımlar
Kullanıcıya SUNDUĞUN somut aksiyonlar. Her madde bir fiille başlasın (ör. "TO-BE altına ... maddesini ekleyelim mi?", "Kabul kriterlerine ... Given-When-Then senaryosunu yazayım mı?"). 3-5 madde.

## Netleştirme Soruları
Analist olarak kullanıcıya SORMAN gereken 2-4 kritik soru (kapsam, öncelik, hedef sistem versiyonu, paydaş vb.). Soruları numaralı liste olarak yaz.

Kaynak URL'leri ayrı bölüm olarak listeleme; grounding zaten UI'da gösterilecek. Cevabın sonunda mutlaka kullanıcıya bir soru veya öneriyle bitir, havada bırakma.`;

export const INTENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'answer_question',
        description:
          "Kullanıcının niyeti sadece sohbet etmek, beyin fırtınası yapmak veya açıklama istemek olduğunda kullan. Dokümana dokunma; sadece chat paneline düz metin cevap döndür.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            reply_text: {
              type: Type.STRING,
              description: 'Kullanıcıya chat panelinde gösterilecek doğal dil cevap.',
            },
          },
          required: ['reply_text'],
        },
      },
      {
        name: 'update_document_node',
        description:
          "Kullanıcının niyeti dokümanı güncellemekse kullan. Tiptap yapısının bozulmaması için sadece belirtilen node_id'ye ait içeriği new_content ile değiştirir. node_id, 'businessAnalysis' | 'code' | 'test' | 'review' | 'bpmn' bölüm anahtarlarından biri veya Tiptap blok ID'sidir.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            node_id: {
              type: Type.STRING,
              description:
                "Güncellenecek node'un kimliği. Belge bölümü (ör. 'businessAnalysis') veya Tiptap blok id'si.",
            },
            new_content: {
              type: Type.STRING,
              description:
                "Node'un yeni içeriği. HTML veya Markdown olabilir; doküman bölümü hedefleniyorsa HTML tercih edilir.",
            },
            explanation: {
              type: Type.STRING,
              description: 'Kullanıcıya değişikliği özetleyen kısa not.',
            },
          },
          required: ['node_id', 'new_content'],
        },
      },
      {
        name: 'search_internal_database',
        description:
          'Şirket içi iş kuralı, geçmiş epic, sistem gereksinimi veya kurumsal hafıza araması için kullan (Supabase pgvector RAG).',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: 'Kurumsal hafızada aranacak doğal dil sorgusu.',
            },
            category: {
              type: Type.STRING,
              description:
                "İsteğe bağlı kategori/etiket filtresi (ör. 'SAP IS-U', 'B2B', 'Tahsilat').",
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'search_web',
        description:
          'Dış dünya standartları, rakip analizi veya 3. parti API dokümanları (Stripe, SAP, E-Devlet vb.) gerektiğinde kullan.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "Web'de aranacak sorgu.",
            },
          },
          required: ['query'],
        },
      },
    ],
  },
];

export interface IntentContext {
  userMessage: string;
  activeNodeId?: string | null;
  activeNodeContent?: string | null;
  documentContent: DocumentData | null;
  history: { role: 'user' | 'model'; parts: { text: string }[] }[];
  model: string;
}

export type IntentToolCall =
  | { name: 'answer_question'; args: { reply_text: string } }
  | { name: 'update_document_node'; args: { node_id: string; new_content: string; explanation?: string } }
  | { name: 'search_internal_database'; args: { query: string; category?: string } }
  | { name: 'search_web'; args: { query: string } };

export interface IntentResult {
  toolCall: IntentToolCall | null;
  rawText: string;
  thinking: string;
  tokenCount: number;
  groundingUrls?: { uri: string; title: string }[];
  searchHits?: { id: string; content: string; metadata: any; similarity: number }[];
  updatedDocument?: DocumentData;
}

const buildIntentSystemPrompt = (ctx: IntentContext): string => {
  const focus = ctx.activeNodeContent
    ? `Kullanıcının şu an odaklandığı Tiptap düğümü (id=${ctx.activeNodeId || 'bilinmiyor'}):\n"""\n${ctx.activeNodeContent}\n"""`
    : 'Kullanıcı şu anda doküman üzerinde belirli bir düğüme odaklanmamış.';

  return `Sen Çevik takımlar için çalışan bir Jetwork Blueprint İş Analisti asistanısın.
Görevin kullanıcının niyetini tespit edip AŞAĞIDAKİ 4 ARAÇTAN tam OLARAK BİRİNİ çağırmaktır.
Serbest metin ÜRETME. Tool çağrısı dışına çıkma.

${focus}

Karar Kuralları:
- Doküman/bölüm güncellemesi istemişse -> update_document_node
- Sohbet / açıklama / beyin fırtınası -> answer_question
- Şirket içi geçmiş / iş kuralı / kurumsal hafıza -> search_internal_database
- Dış dünya / 3rd party API / rakip / güncel standart -> search_web

Yalnızca tek bir fonksiyon çağır. Emin değilsen answer_question seç.

ANALIST TONU (answer_question veya update_document_node içindeki metin için ZORUNLU):
- Kaynak tarayıcısı/wikipedia gibi davranma; kıdemli İş Analisti gibi konuş.
- Her cevabın sonunda MUTLAKA "Önerilen Sonraki Adımlar" (3-5 somut aksiyon) ve "Netleştirme Soruları" (2-4 kritik soru) bölümleri bulunsun.
- Kullanıcıyı havada bırakma; son cümlen ya bir öneri ya da bir soru olsun.`;
};

export const routeIntent = async (ctx: IntentContext): Promise<IntentResult> => {
  let toolCall: IntentToolCall | null = null;
  let rawText = '';
  let thinking = '';
  let tokenCount = 0;

  const contents = [
    ...ctx.history,
    {
      role: 'user' as const,
      parts: [{ text: ctx.userMessage }],
    },
  ];

  await callAiWithRetry(() =>
    callGemini({
      model: ctx.model,
      systemInstruction: buildIntentSystemPrompt(ctx),
      contents,
      tools: INTENT_TOOLS,
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      onChunk: (text, think, tokens, functionCalls) => {
        rawText = text;
        if (think) thinking = think;
        if (tokens) tokenCount = tokens;
        if (functionCalls && functionCalls.length > 0 && !toolCall) {
          const fc = functionCalls[0];
          toolCall = { name: fc.name, args: fc.args || {} } as IntentToolCall;
        }
      },
    })
  );

  // Dispatch side-effects for tools that must run server/client-side.
  const result: IntentResult = { toolCall, rawText, thinking, tokenCount };

  if (toolCall?.name === 'search_internal_database') {
    const { data, error } = await supabase.rpc('match_knowledge_text', {
      query_text: toolCall.args.query,
      match_count: 5,
    });
    if (error) {
      console.warn('search_internal_database RPC failed:', error.message);
      result.searchHits = [];
    } else {
      result.searchHits = data || [];
    }
  }

  if (toolCall?.name === 'search_web') {
    let webText = '';
    let webGrounding: { uri: string; title: string }[] = [];
    const query = toolCall.args.query;
    await callAiWithRetry(() =>
      callGemini({
        model: ctx.model,
        systemInstruction: ANALYST_WEB_SYSTEM_PROMPT,
        contents: [
          {
            role: 'user',
            parts: [{ text: query }],
          },
        ],
        onChunk: (t) => {
          webText = t;
        },
        onGrounding: (urls) => {
          webGrounding = urls;
        },
      })
    );
    result.rawText = webText || result.rawText;
    result.groundingUrls = webGrounding;
  }

  if (toolCall?.name === 'update_document_node' && ctx.documentContent) {
    result.updatedDocument = applyNodeUpdate(
      ctx.documentContent,
      toolCall.args.node_id,
      toolCall.args.new_content
    );
  }

  return result;
};

const SECTION_KEYS: Array<keyof DocumentData> = [
  'businessAnalysis',
  'code',
  'test',
  'bpmn',
  'review',
];

export const applyNodeUpdate = (
  doc: DocumentData,
  nodeId: string,
  newContent: string
): DocumentData => {
  const next: DocumentData = { ...doc };

  // Whole-section update path
  if ((SECTION_KEYS as string[]).includes(nodeId)) {
    const key = nodeId as keyof DocumentData;
    const existing = (next[key] as SectionData) || {
      content: '',
      status: 'DRAFT',
      flags: [],
    };
    (next as any)[key] = {
      ...existing,
      content: newContent,
      status: existing.status || 'DRAFT',
      flags: existing.flags || [],
    };
    return next;
  }

  // Tiptap block-level update: find element with id=nodeId inside each section
  for (const key of SECTION_KEYS) {
    const section = next[key] as SectionData | undefined;
    if (!section?.content) continue;
    if (typeof section.content !== 'string') continue;
    if (!section.content.includes(`id="${nodeId}"`)) continue;

    const replaced = section.content.replace(
      new RegExp(`(<[^>]+id="${nodeId}"[^>]*>)[\\s\\S]*?(</[^>]+>)`, 'i'),
      `$1${newContent}$2`
    );
    (next as any)[key] = { ...section, content: replaced };
    return next;
  }

  return next;
};
