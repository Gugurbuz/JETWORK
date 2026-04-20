import { Type } from "@google/genai";
import { parse as parsePartialJson } from 'partial-json';
import { callGemini } from './geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { hybridSearch } from './contextManager';
import { DocumentData, KnowledgeItem, Question, SectionData } from '../types';

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

const planSchema = {
  type: Type.OBJECT,
  properties: {
    plan: { type: Type.STRING, description: "Bu talebe yanıt vermek için 2-4 adımdan oluşan stratejik plan." },
    assumptions: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Yaptığın varsayımlar." },
    needsWebSearch: { type: Type.BOOLEAN, description: "Sektörel standart, güncel bilgi veya teknoloji detayı için internet araması gerekli mi?" },
    searchQueries: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Internet/knowledge base için 0-3 kısa sorgu." },
    documentGapsToCheck: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Dokümanda kontrol edilecek bölüm/konular." },
    clarificationsNeeded: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Kullanıcıya sorulması gereken kritik belirsizlikler (en fazla 3)." }
  },
  required: ["plan", "needsWebSearch", "searchQueries"]
};

const reflectSchema = {
  type: Type.OBJECT,
  properties: {
    gapsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
    flagsToRaise: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          section: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["section", "reason"]
      }
    },
    criticalQuestionsForUser: { type: Type.ARRAY, items: { type: Type.STRING } },
    readyToAct: { type: Type.BOOLEAN },
    reasoning: { type: Type.STRING }
  },
  required: ["gapsFound", "readyToAct", "reasoning"]
};

const extractJson = (raw: string): any | null => {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const sanitizeSection = (s: any): SectionData | undefined => {
  if (!s || typeof s !== 'object') return undefined;
  const content = typeof s.content === 'string' ? s.content : '';
  if (!content.trim()) return undefined;
  const status = ['DRAFT', 'NEEDS_REVISION', 'APPROVED'].includes(s.status) ? s.status : 'DRAFT';
  const flags = Array.isArray(s.flags) ? s.flags.filter((f: any) => typeof f === 'string') : [];
  return { content, status, flags };
};

const sanitizeDocument = (d: any): DocumentData | undefined => {
  if (!d || typeof d !== 'object') return undefined;
  const ba = sanitizeSection(d.businessAnalysis);
  const code = sanitizeSection(d.code);
  const test = sanitizeSection(d.test);
  const bpmn = sanitizeSection(d.bpmn);
  const review = sanitizeSection(d.review);
  if (!ba && !code && !test && !bpmn && !review) return undefined;
  return {
    businessAnalysis: ba || { content: '', status: 'DRAFT', flags: [] },
    code: code || { content: '', status: 'DRAFT', flags: [] },
    test: test || { content: '', status: 'DRAFT', flags: [] },
    ...(bpmn ? { bpmn } : {}),
    ...(review ? { review } : {}),
  };
};

const extractActParts = (raw: string): { message: string; thinking?: string; questions?: Question[]; actionSummary?: string; document?: DocumentData } => {
  if (!raw) return { message: '' };
  const trimmed = raw.trim();
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
    // Streaming JSON not yet parseable; return empty so UI keeps last good state
  }
  return { message: '' };
};

const briefDocumentSummary = (doc: DocumentData | null): string => {
  if (!doc) return "(Henüz doküman yok.)";
  const sections: string[] = [];
  const addSection = (name: string, label: string) => {
    const s = (doc as any)[name];
    if (s?.content) {
      const preview = String(s.content).slice(0, 400);
      sections.push(`### ${label} (${s.status || 'DRAFT'})\n${preview}${s.content.length > 400 ? '…' : ''}`);
    }
  };
  addSection('businessAnalysis', 'BA');
  addSection('code', 'IT');
  addSection('test', 'QA');
  addSection('review', 'Review');
  return sections.length > 0 ? sections.join('\n\n') : "(Doküman bölümleri boş.)";
};

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const { userMessage, history, documentContent, knowledgeBase, model, systemInstruction, onPhase, onThinking, onActStream, onGrounding } = input;

  let totalTokens = 0;

  // ============ PHASE 1: PLAN ============
  onPhase('PLAN', 'Strateji belirleniyor...');
  const planSystem = `
Sen kıdemli bir İş Analistisin. Göreve başlamadan önce bir plan yapıyorsun.
KURALLAR:
- Önce problemi anla, sonra strateji kur.
- Varsayımlarını açıkça yaz.
- Emin olmadığın konularda "needsWebSearch: true" yap.
- Belirsizlikte en kritik 1-3 soruyu netleştirmek için "clarificationsNeeded" listele.
- Dokümanın hangi bölümünde çalışacağını düşün.
Çıktı JSON olacak.
`.trim();

  const docSummary = briefDocumentSummary(documentContent);
  const planPrompt = `
[KULLANICI TALEBİ]
${userMessage}

[MEVCUT DOKÜMAN DURUMU]
${docSummary}

[SON KONUŞMA ÖZETİ]
${history.slice(-4).map(h => h.parts[0].text).join('\n').slice(0, 1200)}

Yukarıdaki talebe en kaliteli yanıtı vermek için stratejik planını JSON formatında çıkar.
`.trim();

  const planResponse = await callGemini({
    model,
    systemInstruction: planSystem,
    contents: [{ role: 'user', parts: [{ text: planPrompt }] }],
    responseSchema: planSchema,
    onChunk: (_text, thinking, tokenCount) => {
      if (thinking) onThinking(thinking);
      if (tokenCount) totalTokens = Math.max(totalTokens, tokenCount);
    }
  });
  const plan: PlanOutput = extractJson(planResponse.text) || {
    plan: "Doğrudan yanıt ver.",
    assumptions: [],
    needsWebSearch: false,
    searchQueries: [],
    documentGapsToCheck: [],
    clarificationsNeeded: []
  };

  // ============ PHASE 2: RESEARCH ============
  onPhase('RESEARCH', plan.needsWebSearch ? 'Kaynaklar taranıyor...' : 'Kurumsal hafıza taranıyor...');

  // Knowledge base lookup (local)
  const kbQueries = [userMessage, ...(plan.searchQueries || [])];
  const kbHits = new Map<string, KnowledgeItem>();
  for (const q of kbQueries) {
    const hits = hybridSearch(q, knowledgeBase, 3);
    hits.forEach(h => kbHits.set(h.id, h));
  }
  const kbContext = Array.from(kbHits.values()).slice(0, 6)
    .map(k => `- ${k.content} (önem: ${k.importance}/10)`)
    .join('\n');

  // Web search via Gemini googleSearch (only if plan requests it)
  let webResearch = '';
  let groundingUrls: { uri: string; title: string }[] = [];
  if (plan.needsWebSearch && plan.searchQueries && plan.searchQueries.length > 0) {
    const researchPrompt = `
Aşağıdaki konularda kısa, güncel ve güvenilir bilgi özeti çıkar (maddeler halinde, her madde 1-2 cümle):

${plan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Sadece özet ver, yorum ekleme. Kaynaklara referans ver.
`.trim();
    try {
      const researchResponse = await callGemini({
        model,
        systemInstruction: "Sen bir araştırma asistanısın. Internetten kısa, doğru, referanslı bilgi toplarsın.",
        contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
        // no responseSchema -> edge function enables googleSearch tool
        onChunk: (_text, thinking, tokenCount) => {
          if (thinking) onThinking(thinking);
          if (tokenCount) totalTokens = Math.max(totalTokens, tokenCount);
        },
        onGrounding: (urls) => {
          groundingUrls = urls;
          if (onGrounding) onGrounding(urls);
        }
      });
      webResearch = (researchResponse.text || '').slice(0, 3000);
    } catch (e) {
      console.warn("Research phase failed:", e);
    }
  }

  const researchContext = [
    kbContext && `[KURUMSAL HAFIZA BULGULARI]\n${kbContext}`,
    webResearch && `[İNTERNET ARAŞTIRMA BULGULARI]\n${webResearch}`
  ].filter(Boolean).join('\n\n') || '(İlgili ek kaynak bulunamadı.)';

  // ============ PHASE 3: REFLECT ============
  // Skip reflection when there's no document to review and no research to critique.
  const hasDocument = !!documentContent && Object.values(documentContent).some(
    (s: any) => s && typeof s === 'object' && typeof s.content === 'string' && s.content.trim().length > 0
  );
  const shouldReflect = hasDocument || webResearch.length > 0 || (plan.documentGapsToCheck?.length || 0) > 0;

  let reflection: ReflectOutput = {
    gapsFound: [],
    flagsToRaise: [],
    criticalQuestionsForUser: plan.clarificationsNeeded || [],
    readyToAct: true,
    reasoning: ""
  };

  if (shouldReflect) {
  onPhase('REFLECT', hasDocument ? 'Doküman gözden geçiriliyor...' : 'Bulgular değerlendiriliyor...');
  const reflectSystem = `
Sen kıdemli bir İş Analistisin. Mevcut dokümanı ve plan/araştırma bulgularını eleştirel gözle inceliyorsun.
KURALLAR:
- Eksik, çelişkili veya belirsiz noktaları tespit et.
- Hangi bölümlere "NEEDS_REVISION" flag'i gerekiyor söyle.
- Kullanıcıya sorulması KESİNLİKLE gereken en kritik 0-3 soruyu belirle.
- Elinde yeterli bilgi varsa "readyToAct: true" dön. Yoksa false.
Çıktı JSON olacak.
`.trim();

  const reflectPrompt = `
[PLAN]
${plan.plan}
Varsayımlar: ${(plan.assumptions || []).join('; ') || '-'}
Dokümanda kontrol edilecekler: ${(plan.documentGapsToCheck || []).join('; ') || '-'}

[ARAŞTIRMA BULGULARI]
${researchContext}

[MEVCUT DOKÜMAN]
${docSummary}

[KULLANICI TALEBİ]
${userMessage}

Yukarıdaki bağlama göre reflection çıkar.
`.trim();

  try {
    const reflectResponse = await Promise.race([
      callGemini({
        model,
        systemInstruction: reflectSystem,
        contents: [{ role: 'user', parts: [{ text: reflectPrompt }] }],
        responseSchema: reflectSchema,
        onChunk: (_text, thinking, tokenCount) => {
          if (thinking) onThinking(thinking);
          if (tokenCount) totalTokens = Math.max(totalTokens, tokenCount);
        }
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('reflect timeout')), 30000))
    ]);
    const parsedReflection = extractJson(reflectResponse.text);
    if (parsedReflection) reflection = parsedReflection;
  } catch (e) {
    console.warn('Reflect phase skipped:', e);
  }
  }

  // ============ PHASE 4: ACT ============
  onPhase('ACT', 'Yanıt hazırlanıyor...');

  const actContext = `
[AJAN ÇALIŞMA DOSYASI]

[1] STRATEJİK PLAN
${plan.plan}
${plan.assumptions?.length ? `Varsayımlar: ${plan.assumptions.join('; ')}` : ''}

[2] ARAŞTIRMA BULGULARI
${researchContext}

[3] DOKÜMAN GÖZDEN GEÇİRME
Bulunan eksikler:
${(reflection.gapsFound || []).map(g => `- ${g}`).join('\n') || '- Belirgin eksik yok.'}
Flag önerileri:
${(reflection.flagsToRaise || []).map(f => `- ${f.section}: ${f.reason}`).join('\n') || '- Flag gerekmiyor.'}
Sorulması gereken kritik sorular:
${(reflection.criticalQuestionsForUser || []).map(q => `- ${q}`).join('\n') || '- Yok.'}

[4] AKSİYON TALİMATLARI
- Yukarıdaki araştırma ve reflection bulgularını yanıtına doğal şekilde entegre et.
- EĞER kritik sorular varsa, "questions" alanını DOLDUR (her biri seçenekli 2-4 şık). Cevaplamadan varsayım yapma.
- Cevabın Markdown formatında, tablo/madde/başlık ile yapılandırılmış olmalı.
- "thinking" alanında adım adım nasıl bu sonuca vardığını yaz.
- "actionSummary" alanında yaptığın işi 1 cümle özetle.
- Eğer yeterli bilgi yoksa net soru sor, aksi halde dokümanı nasıl geliştirebileceğini açıkla.

[5] DOKÜMAN YAZMA KURALI
- Analiz veya araştırma yeterli olgunluğa ulaştıysa, yanıtınla birlikte "document" alanını MUTLAKA doldur. Bu alan sağ paneldeki Çalışma Dokümanı'na yazılır.
- "document" alanı şu bölümleri içerir: businessAnalysis (İş Analizi), code (Teknik/IT), test (Test/QA), opsiyonel review ve bpmn.
- Her bölüm { content: Markdown metni, status: "DRAFT" | "NEEDS_REVISION" | "APPROVED", flags: string[] } yapısında olmalı.
- Mevcut doküman varsa (${hasDocument ? "EVET" : "HAYIR"}): mevcut içerikleri KORU, üstüne ekleme/güncelleme yap; boşalttığın bölüm olmasın.
- Bölümleri zengin Markdown ile yaz: numaralı başlıklar (## 1., ### 1.1.), tablolar (| Kolon | ... |), madde işaretleri, kod blokları. En az 200 karakter içerik koy.
- Yalnızca sohbet yanıtı yeterliyse (örn. kullanıcıya soru soracaksan) "document" alanını boş bırak; aksi halde doldurmak ZORUNLUDUR.
- "Dokümana aktardım / güncelledim" gibi ifadeler ancak "document" alanını doldurduysan kullanılabilir; aksi halde böyle iddia ETME.
`.trim();

  const fullSystemInstruction = `${systemInstruction}\n\n${actContext}`;

  const contents = [
    ...history,
    { role: 'user' as const, parts: [{ text: userMessage }] }
  ];

  if (documentContent) {
    const firstPart = contents[0].parts[0];
    if ('text' in firstPart) {
      firstPart.text = `Mevcut Doküman:\n${JSON.stringify(documentContent, null, 2)}\n\n${firstPart.text}`;
    }
  }

  let finalText = '';
  let finalThinking = '';
  let finalQuestions: Question[] | undefined;
  let finalActionSummary: string | undefined;
  let finalDocument: DocumentData | undefined;

  // Clear any thinking leaked from earlier phases before ACT streams its own
  onActStream('', '', undefined, undefined, totalTokens);

  const runActCall = async (sysInstruction: string) => {
    return await callGemini({
      model,
      systemInstruction: sysInstruction,
      contents,
      responseSchema: chatResponseJsonSchema,
      onChunk: (text, thinking, tokenCount) => {
        const parts = extractActParts(text);
        const mergedThinking = parts.thinking || thinking;
        finalText = parts.message;
        finalThinking = mergedThinking || '';
        finalQuestions = parts.questions;
        finalActionSummary = parts.actionSummary;
        if (parts.document) finalDocument = parts.document;
        if (tokenCount) totalTokens = Math.max(totalTokens, tokenCount);
        onActStream(parts.message, mergedThinking, parts.questions, parts.actionSummary, totalTokens);
      }
    });
  };

  let actResponse;
  try {
    actResponse = await runActCall(fullSystemInstruction);
  } catch (err) {
    console.warn('ACT phase failed with full context, retrying with minimal context:', err);
    finalText = '';
    finalThinking = '';
    finalQuestions = undefined;
    finalActionSummary = undefined;
    finalDocument = undefined;
    // Fallback: retry with only the base systemInstruction (no research/reflect enrichment)
    const fallbackSystem = `${systemInstruction}\n\n[NOT] Önceki araştırma/gözden geçirme adımlarında kısıtlama oluştu; doğrudan kullanıcıya en iyi yanıtı üret, gerekirse netleştirme soruları sor.`;
    actResponse = await runActCall(fallbackSystem);
  }

  const finalParts = extractActParts(actResponse.text);
  finalText = finalParts.message || actResponse.text;
  finalThinking = finalParts.thinking || actResponse.thinking || finalThinking;
  finalQuestions = finalParts.questions || finalQuestions;
  finalActionSummary = finalParts.actionSummary || finalActionSummary;
  if (finalParts.document) finalDocument = finalParts.document;

  return {
    text: finalText,
    thinking: finalThinking,
    questions: finalQuestions,
    actionSummary: finalActionSummary,
    groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined,
    plan,
    research: researchContext,
    reflection,
    document: finalDocument,
    tokenCount: totalTokens
  };
};
