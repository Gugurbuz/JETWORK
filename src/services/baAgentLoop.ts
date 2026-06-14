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
  buildSourceVerificationPolicy,
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
[6] KAVRAMSAL TASARIM / WORD SABLONU DERINLIK STANDARDI
Bu bolum JetWork AI'in ana dokuman standardidir. Ayrı bir pipeline calistirma; ayni sohbet orkestrasyonu icinde document.businessAnalysis ve document.review alanlarini uret/guncelle.

A) businessAnalysis.content zorunlu Word yapisi:
1. KAVRAMSAL TASARIM RAPORU
2. PROJE KIMLIK KARTI
   - Proje Ismi, Musteri Ismi, Proje Yoneticisi, Kapsam Yoneticisi, Is Uygulamalari Sorumlusu, IT Sorumlusu, Cozum Mimari.
3. Amac
4. Dokuman Tarihcesi
   - Katilimcilar tablosu en az 6 rol: Proje Yoneticisi, Kapsam Yoneticisi, Is Uygulamalari, Veri Yonetimi, IT, Danisman/Cozum Mimari.
   - Revize tarih tablosu: Tarih, Versiyon, Dokuman Revizyon Aciklamasi, Yazan.
   - Kontrol EDEN VE ONAYLAYAN tablosu en az 6 satir: isim bilinmiyorsa [ACIK KONU].
5. ICINDEKILER
   - SUREC TASARIMI
   - Her surec icin: SUREC MODELI - N "<surec adi>"
   - EK A
6. SUREC TASARIMI
   - Projenin is kapsami, hedef sistemler, kanallar, aktorler, ana varsayimlar, kapsam disi ve kritik kararlar.
7. SUREC MODELI bloklari
   - Entegrasyon, CRM, SAP, IYS, dokuman yonetimi veya dijital sozlesme projelerinde en az 3 surec modeli uret.
   - Genel kavramsal tasarimlarda en az 2 surec modeli uret.
   - SAP CRM - IYS icin zorunlu adaylar: CRM'den IYS'ye izin aktarimi; IYS'den CRM'e gunluk delta/mutabakat; hata/retry/operasyon izleme ve raporlama.
8. EK A
   - ILGILI / REFERANS DOKUMANLAR tablosu.
   - EKLENTI tablosu.

B) Her SUREC MODELI blogunda ayni sira korunur:
- SUREC MODELI - N "<surec adi>"
- Surec Modeli - N
- Bu proje ile birlikte;
- Ust Duzey Surec Aciklamasi
- Surec degisiklikleri
- Is Gerekleri ve KPIs
- Detayli Surec Akisi / Akis Diyagrami
- Detayli Surec Akisi
- Akis Diyagrami
- Ilgili Surecler
- Ust Duzey Musteri Gelistirmesi
- Onemli Uyarlamalar ve Amaclari
- Degisim Yonetimi

C) Dolu uretim kurallari:
- Is Gerekleri ve KPIs tablosu toplam en az 10 satir hedefler. Kod aileleri birlikte kullanilir: BR, FR, INT, NFR, UI, RPT, SEC, KPI, TEST, OPS.
- Her gereksinimde kod, aciklama, oncelik, kabul kriteri, ilgili surec/ekran, veri kaynagi veya entegrasyon etkisi yaz.
- KPI satirlari en az 5 olmalidir: basari orani, gecikme, hata orani, mutabakat farki, manuel is yuku, raporlama SLA gibi olcumler.
- Ust Duzey Musteri Gelistirmesi tablosu en az 4 satir olmalidir: Arayuz, Program/Servis, Rapor, Is Akisi, Userexit/BAdI veya Entegrasyon.
- Onemli Uyarlamalar bolumunde parametre tablolari, validasyonlar, yetki, loglama, retry, raporlama, bildirim ve operasyonel izleme amaclari yazilir.
- Degisim Yonetimi bolumunde egitim, UAT, pilot/canli gecis, operasyon devri, rollback ve iletisim plani bulunur.
- Belirsiz veri varsa bolum atlanmaz; deger [VARSAYIM] veya [ACIK KONU] olarak yazilir.

D) Gorunur dokuman ilkesi:
- Teknik analiz, test, surec akisi ve entegrasyon detaylari ayri gizli sekmelere zorlanmaz; businessAnalysis.content icinde ilgili Word bloklarina yedirilir.
- review.content kalite raporudur: riskler, acik konular, varsayimlar, kaynak/dogrulama notu, kalite kapisi ve sonraki aksiyonlari yazar.
- Chat mesaji kisa ozet olur; asil detay document alanindadir.
- Kullanici "olustur", "hazirla", "devam et", "varsayimlarla ilerle", "daha fazla soru sorma" diyorsa yeni soru sormadan taslak uret.
`.trim();

function buildFallbackPlan(userMessage: string): PlanOutput {
  return {
    plan: `Kullanıcının talebini ana sohbet hattında analiz et, gerekiyorsa doküman üret/güncelle: ${userMessage.slice(0, 160)}`,
    assumptions: [],
    needsWebSearch: false,
    searchQueries: [],
    documentGapsToCheck: ['Word şablonu', 'Süreç modeli blokları', 'İş Gerekleri ve KPIs', 'Uyarlamalar', 'Değişim yönetimi', 'Onay tabloları', 'EK A'],
    clarificationsNeeded: [],
  };
}

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const { userMessage, history, documentContent, knowledgeBase, model, systemInstruction, onPhase, onThinking, onActStream, onGrounding } = input;

  let totalTokens = 0;
  const actionIntent = detectAiActionIntent(userMessage, []);
  const actionIntentContext = buildActionIntentContext(actionIntent);
  const recentConversationText = history.slice(-6).map(h => h.parts[0]?.text || '').join('\n');
  const deepBaSubject = [recentConversationText, userMessage].filter(Boolean).join('\n');
  const deepBaPlan = buildDeepBaResearchPlan(deepBaSubject);
  const sourcePolicy = buildSourceVerificationPolicy(deepBaSubject);
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
      documentGapsToCheck: Array.from(new Set([
        ...(plan.documentGapsToCheck || []),
        ...deepBaPlan.documentGapsToCheck,
        ...(sourcePolicy.requiresSourceSeparation ? ['Kaynak ve dogrulama matrisi', 'Dogrulandi / varsayim / acik konu ayrimi'] : []),
      ])),
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
Asagidaki konularda kisa, guncel ve guvenilir kaynak ozeti cikar.
Mevzuat/API/entegrasyon iddialarinda once resmi kaynaklari, sonra guvenilir referanslari kullan.

${plan.searchQueries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Tercih edilen kaynak turleri:
${sourcePolicy.preferredSources.map((source, i) => `${i + 1}. ${source}`).join('\n')}

Cikti formati:
[DOGRULANMIS BILGILER]
- Konu: ...
  Kaynak/Kanit: ...
  Kullanim: BA dokumaninda nasil kullanilacak?

[VARSAYIM ADAYLARI]
- Konu: ...
  Neden varsayim: ...

[ACIK KONU / DOGRULAMA GEREKIR]
- Konu: ...
  Kim/neyden dogrulanmali: ...

Kurallar:
- Kaynak veya grounding yoksa DOGRULANMIS BILGILER'e yazma.
- Resmi olmayan kaynak kullanildiysa bunu "guvenilir referans, resmi degil" diye belirt.
- Uzun yorum ekleme; karar verilebilir, kisa maddeler yaz.
`.trim();
    try {
      const researchResponse = await callGemini({
        model,
        systemInstruction: 'Sen kaynak dogrulama odakli bir arastirma asistanisin. Resmi kaynak, guvenilir referans, varsayim ve acik konuyu net ayirirsin.',
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
      webResearch = (researchResponse.text || '').slice(0, 4500);
    } catch (e) {
      console.warn('Research phase failed:', e);
    }
  }

  const researchContext = [
    kbContext && `[KURUMSAL HAFIZA BULGULARI]\n${kbContext}`,
    webResearch && `[KAYNAKLI ARASTIRMA BULGULARI - DOGRULAMA AYRIMI]\n${webResearch}`
  ].filter(Boolean).join('\n\n') || '(Ilgili ek kaynak bulunamadi.)';

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

[3B] KAYNAK DOGRULAMA POLITIKASI
- Kaynak ayrimi gerekli mi: ${sourcePolicy.requiresSourceSeparation ? 'EVET' : 'HAYIR'}
- Review durum etiketleri: ${sourcePolicy.statusLabels.join(' / ')}
- Review matrisi kolonlari: ${sourcePolicy.reviewMatrixColumns.join(' | ')}
- Tercih edilen kaynaklar: ${sourcePolicy.preferredSources.join('; ')}
- Resmi kaynakla veya guvenilir referansla desteklenmeyen mevzuat/API maddelerini DOGRULANDI yapma; VARSAYIM veya ACIK KONU olarak ayir.

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
- "actionSummary" alaninda kullanicinin gorecegi sekilde "Ne yaptim?" ozetini 1-2 cumle yaz: hangi bolumleri guncelledin, kaynakli bilgi/varsayim/acik konu ayrimini nasil isledin, sonraki hizli aksiyon ne?

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
