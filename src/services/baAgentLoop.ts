import { Type } from "@google/genai";
import { parse as parsePartialJson } from 'partial-json';
import { callGemini } from './geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { hybridSearch } from './contextManager';
import { DocumentData, KnowledgeItem, Question, SectionData } from '../types';
import { buildActionIntentContext, detectAiActionIntent } from '../modules/ai-actions/actionIntentRouter';
import {
  buildDeepBaActInstructions,
  buildDeepBaResearchPlan,
  buildDeepBaThinkingSummary,
  shouldUseDeepBaAssistant,
} from '../modules/deep-ba-assistant';

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
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
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
  const review = sanitizeSection(d.review);
  if (!ba && !review) return undefined;
  return {
    businessAnalysis: ba || { content: '', status: 'DRAFT', flags: [] },
    ...(review ? { review } : {}),
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
    // Streaming JSON not yet parseable; return empty so UI keeps last good state.
  }
  return { message: '' };
};

const briefDocumentSummary = (doc: DocumentData | null): string => {
  if (!doc) return "(Henüz doküman yok.)";
  const sections: string[] = [];
  const addSection = (name: string, label: string) => {
    const s = (doc as any)[name];
    if (s?.content) {
      const preview = String(s.content).slice(0, 700);
      sections.push(`### ${label} (${s.status || 'DRAFT'})\n${preview}${s.content.length > 700 ? '…' : ''}`);
    }
  };
  addSection('businessAnalysis', 'BA Analiz');
  addSection('review', 'Review');
  return sections.length > 0 ? sections.join('\n\n') : "(Doküman bölümleri boş.)";
};

const CONCEPTUAL_DESIGN_DEPTH_STANDARD = `
[6] KAVRAMSAL TASARIM / İŞ ANALİZİ DERİNLİK STANDARDI
Bu bölüm JetWork AI'ın ana çalışma standardıdır. Ayrı bir buton, ayrı yan pipeline veya ayrı doküman motoru çalıştırma; aynı sohbet orkestrasyonu içinde document alanını üret/güncelle.

Kullanıcı kavramsal tasarım, iş analizi, gereksinim, süreç modeli, ekran analizi, toast/validasyon, BPMN, doküman yönetimi, entegrasyon veya Word dokümanı istiyorsa aşağıdaki derinlikte çalış:

A) businessAnalysis.content şu yapıyı mümkün olduğunca doldurmalı:
1. Proje Kimlik Kartı
   - Proje adı, talep no, kapsam yöneticisi, proje yöneticisi, uygulama sorumlusu, paydaşlar.
2. Katılımcılar ve Roller
   - Rol, isim varsa isim, sorumluluk ve karar/yetki kapsamı.
3. Amaç ve İş Değeri
   - Projenin neden yapıldığı, hangi operasyonel problemi çözdüğü, beklenen faydalar.
4. Kapsam ve Kapsam Dışı
   - Kullanıcının verdiği bilgiye göre kapsamı yaz; belirsizleri [VARSAYIM] olarak işaretle.
5. Süreç Modelleri
   - Her süreç için: amaç, aktörler, tetikleyici, giriş/çıkış koşulları, iş kuralları, ekranlar, dokümanlar, entegrasyonlar, hata durumları.
   - P0-P8 gibi ifadeleri kalıcı ürün kuralı gibi yazma. Bunlar yalnızca mevcut örnek/MVP kodu olabilir; ürün dinamik süreç sayısını desteklemelidir.
6. İş Gerekleri ve Gereksinimler
   - Tekrarlı yazma. Gereksinimleri kodla: BR, FR, NFR, UI, INT, DOC, RPT, SEC, PERF.
   - Her gereksinimde: kod, açıklama, öncelik, kabul kriteri, ilgili ekran/süreç, veri kaynağı.
7. KPI ve Ölçümleme
   - Her süreç için en az: ilerleme oranı, açık görev sayısı, eksik doküman sayısı, gecikme göstergesi.
   - KPI formülü, veri kaynağı, hedef değer ve raporlama yeri yaz.
8. Kullanıcı Mesajları / Toast / Validasyon / Modal Standardı
   - Success, error, warning, info toast örnekleri.
   - Inline validasyon mesajları.
   - Bloklayıcı modal örnekleri.
   - Hangi durumda mesajın gösterileceğini yaz.
9. Doküman Yönetimi
   - Zorunlu/opsiyonel dokümanlar, dosya türleri, versiyonlama, FileNet/harici saklama, audit ve hata yönetimi.
10. Bildirim Yönetimi
   - Uygulama içi bildirim, e-posta, hatırlatma, okundu bilgisi, rol bazlı alıcı kuralları.
11. Yetki ve Güvenlik
   - Rol bazlı menü/işlem yetkisi, sadece görüntüleme, admin yetkileri, audit log, oturum kuralları.
12. Açık Konular ve Varsayımlar
   - Emin olmadığın her noktayı review yerine de yansıt.

B) Teknik analiz ayrı bir gizli sekmeye değil businessAnalysis.content içine yazılmalı:
- Modül mimarisi, veri modeli, entity ilişkileri, API/servis ihtiyaçları, entegrasyonlar, FileNet/SAP/Azure AD gibi sistemlerle veri alışverişi, hata/retry/audit stratejisi, güvenlik ve performans notları BA Analiz içinde alt başlık olmalı.

C) Test/kabul paketi businessAnalysis.content içinde olmalı:
- UAT senaryoları, pozitif/negatif testler, yetki testleri, entegrasyon hata testleri, doküman yükleme ve validasyon testleri BA Analiz içinde alt başlık olmalı.

D) review.content kalite raporu olmalı:
- Talep karşılanma kontrolü, eksik bilgiler, riskler, tekrar eden gereksinimler, açık sorular, sonraki aksiyonlar.

E) Süreç akışları businessAnalysis.content içinde olmalı:
- BPMN XML üretmeye zorlama. Gerekirse Mermaid veya metinsel süreç akışı BA Analiz içinde alt başlık olarak yaz; Review içinde risk/eksik kararları belirt.

F) Derinlik kuralı:
- Chat mesajı kısa özet olmalı; detaylar document alanına yazılmalı.
- Eğer kullanıcı "oluştur", "hazırla", "dokümana işle", "devam et", "varsayımlarla ilerle" diyorsa yeni soru sormadan taslak üret.
- Eksik bilgileri bahane edip boş doküman bırakma; varsayımları açıkça işaretle.
- Her bölümde yalnızca 200 karakterlik yüzeysel içerik yeterli değildir. İş analizi üretiminde her ana bölüm karar verilebilir seviyede detaylandırılmalıdır.
`.trim();

function buildFallbackPlan(userMessage: string): PlanOutput {
  return {
    plan: `Kullanıcının talebini ana sohbet hattında analiz et, gerekiyorsa doküman üret/güncelle: ${userMessage.slice(0, 160)}`,
    assumptions: [],
    needsWebSearch: false,
    searchQueries: [],
    documentGapsToCheck: ['Süreçler', 'Gereksinimler', 'KPI', 'Kullanıcı mesajları', 'Entegrasyonlar', 'Doküman yönetimi'],
    clarificationsNeeded: [],
  };
}

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const { userMessage, history, documentContent, knowledgeBase, model, systemInstruction, onPhase, onThinking, onActStream, onGrounding } = input;

  let totalTokens = 0;
  const actionIntent = detectAiActionIntent(userMessage, []);
  const actionIntentContext = buildActionIntentContext(actionIntent);
  const recentConversationText = history.slice(-6).map(h => h.parts[0].text).join('\n');
  const deepBaSubject = [recentConversationText, userMessage].filter(Boolean).join('\n');
  const deepBaPlan = buildDeepBaResearchPlan(deepBaSubject);
  const useDeepBaMode = shouldUseDeepBaAssistant(deepBaSubject);

  // ============ PHASE 1: PLAN ============
  onPhase('PLAN', 'Strateji belirleniyor...');
  const planSystem = `
Sen kıdemli bir İş Analistisin. Göreve başlamadan önce bir plan yapıyorsun.
KURALLAR:
- Önce problemi anla, sonra strateji kur.
- Varsayımlarını açıkça yaz.
- Kullanıcı doküman/tasarım/analiz istiyorsa planını doküman bölümlerine göre kur.
- Emin olmadığın konularda "needsWebSearch: true" yap.
- Belirsizlikte en kritik 1-3 soruyu netleştirmek için "clarificationsNeeded" listele.
- Ancak kullanıcı açıkça oluştur/güncelle/devam et diyorsa soru sormayı değil, varsayımlarla taslak üretmeyi tercih et.
Çıktı JSON olacak.
`.trim();

  const docSummary = briefDocumentSummary(documentContent);
  const planPrompt = `
[KULLANICI TALEBİ]
${userMessage}

[OTONOM NİYET SİNYALİ]
${actionIntentContext || 'Özel aksiyon sinyali yok.'}

[MEVCUT DOKÜMAN DURUMU]
${docSummary}

[SON KONUŞMA ÖZETİ]
${history.slice(-6).map(h => h.parts[0].text).join('\n').slice(0, 2200)}

Yukarıdaki talebe en kaliteli yanıtı vermek için stratejik planını JSON formatında çıkar.
`.trim();

  let plan: PlanOutput = buildFallbackPlan(userMessage);
  try {
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
    plan = extractJson(planResponse.text) || plan;
  } catch (e) {
    console.warn('Plan phase failed, using fallback plan:', e);
  }

  if (deepBaPlan.enabled || useDeepBaMode) {
    plan = {
      ...plan,
      needsWebSearch: true,
      searchQueries: Array.from(new Set([...(deepBaPlan.searchQueries || []), ...(plan.searchQueries || [])])).slice(0, 4),
      assumptions: Array.from(new Set([...(plan.assumptions || []), ...deepBaPlan.assumptions])),
      documentGapsToCheck: Array.from(new Set([...(plan.documentGapsToCheck || []), ...deepBaPlan.documentGapsToCheck])),
      plan: `${plan.plan}\nDeep BA Assistant v2: ${deepBaPlan.reason}`,
    };
    onThinking(buildDeepBaThinkingSummary(deepBaPlan));
  }

  // ============ PHASE 2: RESEARCH ============
  onPhase('RESEARCH', plan.needsWebSearch ? 'Kaynaklar taranıyor...' : 'Kurumsal hafıza taranıyor...');

  const kbQueries = [userMessage, ...(plan.searchQueries || [])];
  const kbHits = new Map<string, KnowledgeItem>();
  for (const q of kbQueries) {
    const hits = hybridSearch(q, knowledgeBase, 3);
    hits.forEach(h => kbHits.set(h.id, h));
  }
  const kbContext = Array.from(kbHits.values()).slice(0, 6)
    .map(k => `- ${k.content} (önem: ${k.importance}/10)`)
    .join('\n');

  let webResearch = '';
  let groundingUrls: { uri: string; title: string }[] = [];
  if (plan.needsWebSearch && plan.searchQueries && plan.searchQueries.length > 0) {
    const researchPrompt = `
Aşağıdaki konularda kısa, güncel ve güvenilir bilgi özeti çıkar. Her madde 1-2 cümle olsun.

${plan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Sadece özet ver, yorum ekleme. Kaynaklara referans ver.
`.trim();
    try {
      const researchResponse = await callGemini({
        model,
        systemInstruction: 'Sen bir araştırma asistanısın. Internetten kısa, doğru, referanslı bilgi toplarsın.',
        contents: [{ role: 'user', parts: [{ text: researchPrompt }] }],
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
      console.warn('Research phase failed:', e);
    }
  }

  const researchContext = [
    kbContext && `[KURUMSAL HAFIZA BULGULARI]\n${kbContext}`,
    webResearch && `[İNTERNET ARAŞTIRMA BULGULARI]\n${webResearch}`
  ].filter(Boolean).join('\n\n') || '(İlgili ek kaynak bulunamadı.)';

  // ============ PHASE 3: REFLECT ============
  const hasDocument = !!documentContent && Object.values(documentContent).some(
    (s: any) => s && typeof s === 'object' && typeof s.content === 'string' && s.content.trim().length > 0
  );
  const shouldReflect = hasDocument || webResearch.length > 0 || (plan.documentGapsToCheck?.length || 0) > 0;

  let reflection: ReflectOutput = {
    gapsFound: [],
    flagsToRaise: [],
    criticalQuestionsForUser: plan.clarificationsNeeded || [],
    readyToAct: true,
    reasoning: ''
  };

  if (shouldReflect) {
    onPhase('REFLECT', hasDocument ? 'Doküman gözden geçiriliyor...' : 'Bulgular değerlendiriliyor...');
    const reflectSystem = `
Sen kıdemli bir İş Analistisin. Mevcut dokümanı ve plan/araştırma bulgularını eleştirel gözle inceliyorsun.
KURALLAR:
- Eksik, çelişkili veya belirsiz noktaları tespit et.
- Hangi bölümlere "NEEDS_REVISION" flag'i gerekiyor söyle.
- Kullanıcıya sorulması kesin gereken en kritik 0-3 soruyu belirle.
- Elinde yeterli bilgi varsa "readyToAct: true" dön.
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

[1] OTONOM NİYET SİNYALİ
${actionIntentContext || '- Genel sohbet/analiz.'}

[2] STRATEJİK PLAN
${plan.plan}
${plan.assumptions?.length ? `Varsayımlar: ${plan.assumptions.join('; ')}` : ''}

[3] ARAŞTIRMA BULGULARI
${researchContext}

[4] DOKÜMAN GÖZDEN GEÇİRME
Bulunan eksikler:
${(reflection.gapsFound || []).map(g => `- ${g}`).join('\n') || '- Belirgin eksik yok.'}
Flag önerileri:
${(reflection.flagsToRaise || []).map(f => `- ${f.section}: ${f.reason}`).join('\n') || '- Flag gerekmiyor.'}
Sorulması gereken kritik sorular:
${(reflection.criticalQuestionsForUser || []).map(q => `- ${q}`).join('\n') || '- Yok.'}

[5] AKSİYON TALİMATLARI
- Yukarıdaki araştırma ve reflection bulgularını yanıtına doğal şekilde entegre et.
- ZORUNLU: Yukarıdaki "Sorulması gereken kritik sorular" listesinde bir madde varsa VEYA kullanıcıya soracağını ima ediyorsan, "questions" alanını MUTLAKA doldur.
- Her soru: { id: "q1", text: "...", options: ["seçenek 1", "seçenek 2", "seçenek 3"] } formatında, 2-4 seçenekli olmalı.
- Mesaj metninde "birkaç sorum olacak" / "şunu netleştirelim" gibi ifade kullandıysan questions alanını doldurmadan yanıt verme.
- Cevabın kullanıcıya gösterilecek chat mesajı kısa ve net olmalı; detayları document alanına yaz.
- "thinking" alanında kısa çalışma özetini yaz. Özel zincir düşünce veya gizli akıl yürütme yazma.
- "actionSummary" alanında yaptığın işi 1 cümle özetle.

${buildDeepBaActInstructions(deepBaSubject)}

[6] DOKÜMAN YAZMA KURALI
- Analiz veya araştırma yeterli olgunluğa ulaştıysa, yanıtınla birlikte "document" alanını MUTLAKA doldur. Bu alan sağ paneldeki Çalışma Dokümanı'na yazılır.
- "document" alanı görünür ürün yüzeyinde yalnızca businessAnalysis (BA Analiz) ve opsiyonel review bölümlerini içerir.
- Teknik analiz, test ve süreç akışını ayrı code/test/bpmn alanlarına zorlama; bunları businessAnalysis içinde alt başlık olarak yaz.
- Her bölüm { content: Markdown metni, status: "DRAFT" | "NEEDS_REVISION" | "APPROVED", flags: string[] } yapısında olmalı.
- Mevcut doküman varsa (${hasDocument ? 'EVET' : 'HAYIR'}): mevcut içerikleri KORU, üstüne ekleme/güncelleme yap; boşalttığın bölüm olmasın.
- Bölümleri zengin Markdown ile yaz: numaralı başlıklar (## 1., ### 1.1.), tablolar (| Kolon | ... |), madde işaretleri, kod blokları.
- "document" alanı KURAL: Eğer kullanıcı analiz / doküman / tasarım / test / akış / mimari talep ediyorsa VEYA mesajı bir talep tanımı içeriyorsa, "document" alanını MUTLAKA doldur.
- "Dokümana aktardım / güncelledim" gibi ifadeler ancak "document" alanını doldurduysan kullanılabilir; aksi halde böyle iddia ETME.

${CONCEPTUAL_DESIGN_DEPTH_STANDARD}
`.trim();

  const fullSystemInstruction = `${systemInstruction}\n\n${actContext}`;

  const contents = [
    ...history,
    { role: 'user' as const, parts: [{ text: userMessage }] }
  ];

  if (documentContent) {
    const firstPart = contents[0]?.parts?.[0];
    if (firstPart && 'text' in firstPart) {
      firstPart.text = `Mevcut Doküman:\n${JSON.stringify(documentContent, null, 2)}\n\n${firstPart.text}`;
    }
  }

  let finalText = '';
  let finalThinking = '';
  let finalQuestions: Question[] | undefined;
  let finalActionSummary: string | undefined;
  let finalDocument: DocumentData | undefined;

  onActStream('', '', undefined, undefined, totalTokens);

  const runActCall = async (sysInstruction: string, useSchema = true) => {
    return await callGemini({
      model,
      systemInstruction: sysInstruction,
      contents,
      ...(useSchema ? { responseSchema: chatResponseJsonSchema } : {}),
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
    actResponse = await runActCall(fullSystemInstruction, true);
  } catch (err) {
    console.warn('ACT phase failed with schema/full context, retrying without schema:', err);
    finalText = '';
    finalThinking = '';
    finalQuestions = undefined;
    finalActionSummary = undefined;
    finalDocument = undefined;
    const fallbackSystem = `${systemInstruction}\n\n${actContext}\n\n[NOT] Önceki şemalı çağrı başarısız oldu. Aynı JSON yapısını düz metin olarak döndür; markdown kod bloğu kullanma.`;
    actResponse = await runActCall(fallbackSystem, false);
  }

  const finalParts = extractActParts(actResponse.text);
  const rawTrimmed = (actResponse.text || '').trim();
  const rawLooksLikeJson = rawTrimmed.startsWith('{') || rawTrimmed.startsWith('```');
  finalText = finalParts.message || (rawLooksLikeJson ? (finalText || '') : actResponse.text);
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
