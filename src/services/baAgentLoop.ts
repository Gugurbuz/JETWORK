import { parse as parsePartialJson } from 'partial-json';
import { callGemini } from './geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { hybridSearch } from './contextManager';
import { DocumentData, KnowledgeItem, Question, SectionData } from '../types';
import {
  buildDeepBaActInstructions,
  buildDeepBaResearchPlan,
  buildDeepBaThinkingSummary,
  buildSourceVerificationPolicy,
  shouldUseDeepBaAssistant,
} from '../modules/deep-ba-assistant';
import {
  buildAiTurnDecisionInstruction,
  type AiTurnDecision,
} from './ai/aiTurnDecision';
import { sanitizeEvidenceClaims } from './evidenceClaims';
import { evaluateDocumentQualityGate } from './documentQualityGate';
import {
  CONCEPTUAL_ARTIFACT_CONTRACT_PROMPT,
  conceptualArtifactResponseJsonSchema,
  parseConceptualArtifact,
  renderConceptualArtifact,
} from './ai/conceptualArtifactContract';

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
  turnDecision?: AiTurnDecision;
  sourceProcessTitles?: string[];
  currentArtifactInSystemContext?: boolean;
  signal?: AbortSignal;
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
    evidenceClaims: sanitizeEvidenceClaims(d.evidenceClaims),
  };
};

const extractActParts = (
  raw: string,
  structuredConceptualArtifact = false,
): { message: string; thinking?: string; questions?: Question[]; actionSummary?: string; document?: DocumentData } => {
  if (!raw) return { message: '' };
  let trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) trimmed = fenceMatch[1].trim();
  if (!trimmed.startsWith('{')) return { message: raw };
  try {
    const parsed: any = parsePartialJson(trimmed);
    if (parsed && typeof parsed === 'object') {
      const conceptualArtifact = structuredConceptualArtifact
        ? parseConceptualArtifact(parsed.conceptualArtifact)
        : null;
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
        questions: Array.isArray(parsed.questions) ? parsed.questions : undefined,
        actionSummary: typeof parsed.actionSummary === 'string' ? parsed.actionSummary : undefined,
        document: conceptualArtifact
          ? renderConceptualArtifact(conceptualArtifact)
          : sanitizeDocument(parsed.document),
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

const documentRevisionContext = (doc: DocumentData | null): string => {
  if (!doc) return '(Mevcut dokuman yok.)';
  return JSON.stringify({
    businessAnalysis: doc.businessAnalysis?.content?.slice(0, 16_000) || '',
    review: doc.review?.content?.slice(0, 6_000) || '',
    evidenceClaims: doc.evidenceClaims || [],
  }, null, 2);
};

function buildFallbackPlan(userMessage: string, turnDecision?: AiTurnDecision): PlanOutput {
  const profileSections = turnDecision?.artifactProfile.requiredSections || [];
  return {
    plan: `Kullanıcının talebini ana sohbet hattında analiz et, gerekiyorsa doküman üret/güncelle: ${userMessage.slice(0, 160)}`,
    assumptions: [],
    needsWebSearch: false,
    searchQueries: [],
    documentGapsToCheck: profileSections,
    clarificationsNeeded: [],
  };
}

const DEFAULT_ACT_PHASE_TIMEOUT_MS = 60_000;
const STRUCTURED_CONCEPTUAL_TIMEOUT_MS = 120_000;

export const runBaAgentLoop = async (input: AgentLoopInput): Promise<AgentLoopOutput> => {
  const {
    userMessage,
    history,
    documentContent,
    knowledgeBase,
    model,
    systemInstruction,
    onPhase,
    onThinking,
    onActStream,
    onGrounding,
    turnDecision,
    sourceProcessTitles = [],
    currentArtifactInSystemContext = false,
    signal,
  } = input;

  let totalTokens = 0;
  const phaseTokens = new Map<string, number>();
  const recordPhaseTokens = (phase: string, tokenCount?: number): void => {
    if (!tokenCount) return;
    phaseTokens.set(phase, Math.max(phaseTokens.get(phase) || 0, tokenCount));
    totalTokens = [...phaseTokens.values()].reduce((sum, value) => sum + value, 0);
  };
  const recentConversationText = history.slice(-6).map(h => h.parts[0]?.text || '').join('\n');
  const deepBaSubject = [recentConversationText, userMessage].filter(Boolean).join('\n');
  const deepBaPlan = buildDeepBaResearchPlan(deepBaSubject);
  const sourcePolicy = buildSourceVerificationPolicy(deepBaSubject);
  const useDeepBaMode = shouldUseDeepBaAssistant(deepBaSubject);
  const turnDecisionInstruction = turnDecision ? buildAiTurnDecisionInstruction(turnDecision) : '';
  const shouldProduceDocument = turnDecision?.documentPolicy.shouldUpdateDocument ?? true;
  const forceDocumentGeneration = turnDecision?.documentPolicy.forceDocumentGeneration ?? false;
  const askOnlyMode = turnDecision?.action === 'ask_questions';
  const structuredConceptualArtifact = !!turnDecision?.artifactProfile.id.startsWith('conceptual_design');

  // ============ PHASE 1: PLAN ============
  onPhase('PLAN', 'Strateji belirleniyor...');
  const docSummary = briefDocumentSummary(documentContent);
  let plan: PlanOutput = buildFallbackPlan(userMessage, turnDecision);
  onThinking(`Deterministik plan hazırlandı: ${plan.plan}`);

  if (deepBaPlan.enabled || useDeepBaMode) {
    const profileGaps = (turnDecision?.artifactProfile.requiredSections || [])
      .map(section => `Artifact profile zorunlu basligi: ${section}`);
    plan = {
      ...plan,
      needsWebSearch: turnDecision?.sourcePolicy.requiresExternalResearch ?? deepBaPlan.enabled,
      searchQueries: Array.from(new Set([...(deepBaPlan.searchQueries || []), ...(plan.searchQueries || [])])).slice(0, 4),
      assumptions: Array.from(new Set([...(plan.assumptions || []), ...deepBaPlan.assumptions])),
      documentGapsToCheck: Array.from(new Set([
        ...(plan.documentGapsToCheck || []),
        ...deepBaPlan.documentGapsToCheck,
        ...profileGaps,
        ...(sourcePolicy.requiresSourceSeparation ? ['EvidenceClaim yapisal kanit gecerliligi'] : []),
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
        timeoutMs: 45_000,
        signal,
        onChunk: (_text, thinking, tokenCount) => {
          if (thinking) onThinking(thinking);
          recordPhaseTokens('research', tokenCount);
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
    const gate = hasDocument && documentContent
      ? evaluateDocumentQualityGate(documentContent, {
        artifactProfile: turnDecision?.artifactProfile,
        sourceSensitive: turnDecision?.sourcePolicy.sourceSensitive,
      })
      : null;
    reflection = {
      gapsFound: gate?.missingSections || plan.documentGapsToCheck || [],
      flagsToRaise: gate?.warnings.slice(0, 6).map(reason => ({ section: 'review', reason })) || [],
      criticalQuestionsForUser: plan.clarificationsNeeded || [],
      readyToAct: true,
      reasoning: gate
        ? `Deterministik kalite değerlendirmesi: ${gate.score}/100.`
        : 'Yeni doküman üretimi için plan ve kaynak kapsamı deterministik olarak değerlendirildi.',
    };
    onThinking(reflection.reasoning);
  }

  // ============ PHASE 4: ACT ============
  onPhase('ACT', 'Yanıt hazırlanıyor...');

  const actContext = `
[AJAN ÇALIŞMA DOSYASI]

[1] OTONOM NİYET SİNYALİ
${turnDecisionInstruction || '- Ana karar sözleşmesi sağlanmadı.'}

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

[4B] AI TURN DECISION - ANA KARAR SÖZLEŞMESİ
${turnDecisionInstruction || '- Ust karar sozlesmesi yok; mevcut BA agent davranisi uygulanacak.'}
- Bu sözleşme, plan/reflection ve eski doküman yazma reflekslerinden üstündür.
- shouldUpdateDocument=${shouldProduceDocument ? 'EVET' : 'HAYIR'}, forceDocumentGeneration=${forceDocumentGeneration ? 'EVET' : 'HAYIR'}, askOnlyMode=${askOnlyMode ? 'EVET' : 'HAYIR'}.

[5] AKSİYON TALİMATLARI
- Yukarıdaki araştırma ve reflection bulgularını yanıtına doğal şekilde entegre et.
- action=ask_questions ise document veya conceptualArtifact alanı üretme; sadece questions alanını ve kısa chat mesajını doldur.
- action=answer_only veya action=research_first ise dokümanı güncelledim/oluşturdum iddiası kurma.
- action=draft_document/revise_document/repair_document ise ${structuredConceptualArtifact ? 'conceptualArtifact' : 'document'} alanını seçili artifact profile ve kaynak/varsayım ayrımına göre doldur.
- ZORUNLU: Yukarıdaki "Sorulması gereken kritik sorular" listesinde bir madde varsa VEYA kullanıcıya soracağını ima ediyorsan, "questions" alanını MUTLAKA doldur.
- Her soru: { id: "q1", text: "...", options: ["seçenek 1", "seçenek 2", "seçenek 3"] } formatında, 2-4 seçenekli olmalı.
- Mesaj metninde "birkaç sorum olacak" / "şunu netleştirelim" gibi ifade kullandıysan questions alanını doldurmadan yanıt verme.
- Cevabın kullanıcıya gösterilecek chat mesajı kısa ve net olmalı; detayları yalnız ${structuredConceptualArtifact ? 'conceptualArtifact' : 'document'} alanına yaz.
- "thinking" alanında kısa çalışma özetini yaz. Özel zincir düşünce veya gizli akıl yürütme yazma.
- "actionSummary" alaninda kullanicinin gorecegi sekilde "Ne yaptim?" ozetini 1-2 cumle yaz: hangi bolumleri guncelledin, kaynakli bilgi/varsayim/acik konu ayrimini nasil isledin, sonraki hizli aksiyon ne?

${buildDeepBaActInstructions(deepBaSubject)}

[6] DOKÜMAN YAZMA KURALI
${structuredConceptualArtifact ? `- Üst karar shouldUpdateDocument=EVET ise conceptualArtifact alanını doldur; document alanı üretme.
- Markdown başlıklarını ve tabloları doğrudan yazma. Kavramsal analiz verisini yapısal alanlara yerleştir; renderer görünür businessAnalysis ve review yüzeylerini kuracak.
- Mevcut doküman varsa (${hasDocument ? 'EVET' : 'HAYIR'}), kaynakta korunması gereken kararları conceptualArtifact alanlarına eksiksiz taşı.
- Dokümanı güncellediğini yalnız conceptualArtifact alanını eksiksiz döndürdüysen söyle.` : `- Üst karar shouldUpdateDocument=HAYIR ise "document" alanı üretme. Bu durumda yalnızca cevap/questions/actionSummary üret.
- Üst karar shouldUpdateDocument=EVET ise yanıtınla birlikte "document" alanını doldur. Bu alan sağ paneldeki Çalışma Dokümanı'na yazılır.
- "document" alanı görünür ürün yüzeyinde yalnızca businessAnalysis (BA Analiz) ve opsiyonel review bölümlerini içerir.
- Teknik analiz, test ve süreç akışını ayrı code/test/bpmn alanlarına zorlama; bunları businessAnalysis içinde alt başlık olarak yaz.
- Her bölüm { content: Markdown metni, status: "DRAFT" | "NEEDS_REVISION" | "APPROVED", flags: string[] } yapısında olmalı.
- Mevcut doküman varsa (${hasDocument ? 'EVET' : 'HAYIR'}): mevcut içerikleri KORU, üstüne ekleme/güncelleme yap; boşalttığın bölüm olmasın.
- Bölümleri zengin Markdown ile yaz: numaralı başlıklar (## 1., ### 1.1.), tablolar (| Kolon | ... |), madde işaretleri, kod blokları.
- "document" alanı KURAL: Sadece AI Turn Decision doküman üretme/güncelleme kararı verdiyse doldur. Talep tanımı tek başına doküman üretme zorunluluğu değildir.
- "Dokümana aktardım / güncelledim" gibi ifadeler ancak "document" alanını doldurduysan kullanılabilir; aksi halde böyle iddia ETME.`}

[6B] YAPISAL KANIT SOZLESMESI
- Kritik iddialari ${structuredConceptualArtifact ? 'conceptualArtifact.evidenceClaims' : 'document.evidenceClaims'} alaninda kaydet.
- Her kayit claimId, claim, status ve 0-1 confidence icermelidir.
- status=VERIFIED yalniz sourceUrl (https), sourceTitle, retrievedAt ve evidenceExcerpt birlikte varsa kullanilabilir.
- Kullanici talebinde yazan fakat dis kaynaktan dogrulanmayan maddeleri INFERRED veya ASSUMPTION olarak ayir.
- Kaynagi olmayan mevzuat, API, limit, sure ve urun davranisini VERIFIED yapma; OPEN olarak tut.

${structuredConceptualArtifact ? CONCEPTUAL_ARTIFACT_CONTRACT_PROMPT : ''}

${structuredConceptualArtifact ? `[KAYNAKTA BELIRLENEN ANA SURECLER]\n${sourceProcessTitles.length > 0
    ? sourceProcessTitles.map((title, index) => `${index + 1}. ${title}`).join('\n')
    : '- Kaynakta acik bir surec adi bulunamadi; yeni surec adi uydurma.'}` : ''}
`.trim();

  const fullSystemInstruction = `${systemInstruction}\n\n${actContext}`;

  const currentTurnText = documentContent && !currentArtifactInSystemContext
    ? `[MEVCUT DOKUMAN - BU TURUN REVIZYON BAGLAMI]\n${documentRevisionContext(documentContent)}\n\n[KULLANICI TALEBI]\n${userMessage}`
    : userMessage;
  const contents = [
    ...history,
    { role: 'user' as const, parts: [{ text: currentTurnText }] },
  ];

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
      ...(useSchema ? {
        responseSchema: structuredConceptualArtifact
          ? conceptualArtifactResponseJsonSchema
          : chatResponseJsonSchema,
      } : {}),
      timeoutMs: structuredConceptualArtifact
        ? STRUCTURED_CONCEPTUAL_TIMEOUT_MS
        : DEFAULT_ACT_PHASE_TIMEOUT_MS,
      signal,
      onChunk: (text, thinking, tokenCount) => {
        const parts = extractActParts(text, structuredConceptualArtifact);
        const mergedThinking = parts.thinking || thinking;
        finalText = parts.message;
        finalThinking = mergedThinking || '';
        finalQuestions = parts.questions;
        finalActionSummary = parts.actionSummary;
        if (parts.document) finalDocument = parts.document;
        recordPhaseTokens(useSchema ? 'act' : 'act_fallback', tokenCount);
        onActStream(parts.message, mergedThinking, parts.questions, parts.actionSummary, totalTokens);
      }
    });
  };

  let actResponse: Awaited<ReturnType<typeof callGemini>> | undefined;
  let actTimedOut = false;
  try {
    actResponse = await runActCall(fullSystemInstruction, true);
  } catch (err) {
    actTimedOut = /abort|timeout|timed out/i.test(`${(err as Error)?.name || ''} ${(err as Error)?.message || err}`);
    console.warn('ACT phase failed with schema/full context:', err);
    if (!actTimedOut) {
      console.warn('Retrying ACT phase without schema.');
    finalText = '';
    finalThinking = '';
    finalQuestions = undefined;
    finalActionSummary = undefined;
    finalDocument = undefined;
    const fallbackSystem = `${systemInstruction}\n\n${actContext}\n\n[NOT] Önceki şemalı çağrı başarısız oldu. Aynı JSON yapısını düz metin olarak döndür; markdown kod bloğu kullanma.`;
    actResponse = await runActCall(fallbackSystem, false);
    }
  }

  if (actResponse) {
    const finalParts = extractActParts(actResponse.text, structuredConceptualArtifact);
    const rawTrimmed = (actResponse.text || '').trim();
    const rawLooksLikeJson = rawTrimmed.startsWith('{') || rawTrimmed.startsWith('```');
    finalText = finalParts.message || (rawLooksLikeJson ? (finalText || '') : actResponse.text);
    finalThinking = finalParts.thinking || actResponse.thinking || finalThinking;
    finalQuestions = finalParts.questions || finalQuestions;
    finalActionSummary = finalParts.actionSummary || finalActionSummary;
    if (finalParts.document) finalDocument = finalParts.document;
  } else if (actTimedOut) {
    finalText = 'Dokuman uretim cagrisi zaman asimina ugradi; bu cagridan gecerli bir artifact alinmadi.';
    finalActionSummary = 'AI uretim cagrisi zaman asimina ugradi; yarim artifact uygulanmadi.';
    finalDocument = undefined;
  }

  if (!shouldProduceDocument) {
    finalDocument = undefined;
    if (/dok[üu]man[aiı]?\s+(aktard[ıi]m|g[üu]ncelledim|olu[sş]turdum)|sa[gğ]\s*panel/i.test(finalText || '')) {
      finalText = 'Bu adımda doküman üretmedim; önce karar etkisi yüksek bilgileri netleştirmem gerekiyor.';
    }
  }

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
