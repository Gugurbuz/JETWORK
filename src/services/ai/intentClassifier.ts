import { Type } from '@google/genai';
import { callGemini, callAiWithRetry } from '../geminiService';
import { DocumentData } from '../../types';
import {
  IntentClassification,
  SubIntent,
  PRIMARY_BY_SUB,
  INTENT_DEFAULTS,
  ALL_SUB_INTENTS,
  SLASH_COMMAND_MAP,
  DocumentSectionKey,
  BaAgentFocus,
} from './intentTypes';
import {
  buildBaClarifyingQuestions,
  buildBaDiscoveryState,
  buildBaEnginePromptContext,
  isLikelyBaDiscoveryAnswer,
} from '../../modules/ai-ba-engine';
import {
  requiresExternalKnowledge,
  shouldUseDeepBaAssistant,
} from '../../modules/deep-ba-assistant';
import { applyBehaviorDecisionToClassification, buildBehaviorDecision } from './behaviorDecision';
import { buildContextualDiscoveryQuestions } from './baDiscoveryProfiles';
import {
  applyIntentProfileToClassification,
  buildIntentProfilePromptContext,
  detectDeterministicIntentProfile,
} from './intentProfile';

const SECTION_ENUM = ['businessAnalysis', 'review'];

const classifierSchema = {
  type: Type.OBJECT,
  properties: {
    subIntent: { type: Type.STRING, enum: [...ALL_SUB_INTENTS] },
    targetSection: { type: Type.STRING, enum: SECTION_ENUM },
    secondaryTargetSection: { type: Type.STRING, enum: SECTION_ENUM },
    operation: { type: Type.STRING },
    documentImpact: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    riskLevel: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
    requiresResearch: { type: Type.BOOLEAN },
    researchType: { type: Type.STRING, enum: ['internal', 'web', 'uploaded_files', 'workspace_history'] },
    requiresClarification: { type: Type.BOOLEAN },
    clarificationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    requiresPreview: { type: Type.BOOLEAN },
    shouldRunBaAgentLoop: { type: Type.BOOLEAN },
    baAgentFocus: { type: Type.STRING, enum: ['business_analysis', 'technical_analysis', 'test', 'flow', 'review', 'quality'] },
    reason: { type: Type.STRING },
  },
  required: ['subIntent', 'confidence', 'riskLevel', 'reason'],
};

const SYSTEM_PROMPT = `Sen JETWORK Intent Classifier katmanısın. Görevin kullanıcı mesajını ürün aksiyonuna çevirmektir.
Görünür çok ajan tartışması başlatma. Zero-Touch MVP'de kapalıdır.
Sadece geçerli JSON döndür. Markdown, açıklama veya serbest metin yazma.

KURALLAR:
- Görünür doküman yüzeyi şimdilik sadece businessAnalysis ve review sekmeleridir. Teknik analiz, test veya flow istenirse targetSection olarak businessAnalysis ya da review seç; baAgentFocus ile odağı belirt.
- Teknik analiz / mimari / API / entegrasyon isteklerinde baAgentFocus = 'technical_analysis'.
- Test / UAT / kabul senaryosu isteklerinde baAgentFocus = 'test'.
- BPMN / Mermaid / süreç akışı isteklerinde baAgentFocus = 'flow'.
- Risk / kalite / review isteklerinde baAgentFocus = 'review' veya 'quality'.
- Sadece açıklama isteniyorsa documentImpact = 'none'.
- Dokümana ekle/yaz/güncelle/çıkar/hazırla deniyorsa uygun targetSection belirle.
- Seçili metin varsa "bunu/şunu" önce selectedText'e bağlanır.
- Silme, komple baştan yazma, restore gibi riskli işlemlerde requiresPreview = true.
- Emin değilsen requiresClarification = true yap; doküman güncelleme önerme.
- Kullanici sadece "dokuman hazirla / FDD hazirla / kavramsal tasarim yaz" diyorsa bunu hedef cikti niyeti say; kritik baglam eksikse soru sorulabilir.
- Kullanici "varsayimlarla ilerle", "bu bilgilerle devam", "soru sorma", "hizli taslak", "ilk taslagi cikar", "sen yap", "devam et" diyorsa soru sorma; analysis_generation ve shouldRunBaAgentLoop kullan.
- Kullanıcı önceki soru kartlarına cevap veriyorsa bunu yeni BA girdisi say; generate_business_analysis veya add_requirement_detail seç.
- Bilinmeyen kurumsal bilgi varsa uydurma; assumption/open question üret.
- Kullanıcı bir talep/fikir/entegrasyon anlatıyorsa ve boş dokümana yazılacaksa -> generate_business_analysis (analysis_generation).
- "araştır / güncel bilgi / best practice" açıkça geçiyorsa research_* intentleri kullan.
- /ekip -> zero_touch_requested.

ÖNEMLİ: Yanıt yalnızca şu JSON: { subIntent, targetSection, secondaryTargetSection, operation, documentImpact, confidence (0-1), riskLevel, requiresResearch, researchType, requiresClarification, clarificationQuestions, requiresPreview, shouldRunBaAgentLoop, baAgentFocus, reason }.`;

const GENERATE_WITH_ASSUMPTIONS_RE = /\b(devam\s+et|durma|varsay[ıi]mlarla|varsayimlarla|bu bilgilerle|mevcut bilgilerle|h[ıi]zl[ıi]\s+taslak|hizli\s+taslak|ilk\s+tasla[ğg]?[ıi]?\s*([çc][ıi]kar|olustur|haz[ıi]rla|uret|yaz)|kabaca\s+taslak|taslakla\s+ilerle|uygula|ba[şs]la|tamam|ok|next|sen yap|ben mi yap[ıi]cam|ben mi yapacagim|soru sorma|daha fazla soru sorma)\b/i;

function formatClassifierQuestion(text: string, options: string[] = []): string {
  return options.length > 0 ? `${text}\nSecenekler: ${options.join(' | ')}` : text;
}

function normalizeQuestionDomainText(value: string): string {
  return (value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c');
}

function buildContextualClarificationQuestions(userMessage: string): string[] {
  const profiledQuestions = buildContextualDiscoveryQuestions(userMessage);
  if (profiledQuestions.length > 0) return profiledQuestions;

  const normalizedText = normalizeQuestionDomainText(userMessage);
  const isSapCrmAiSalesBot = /sap\s*crm/.test(normalizedText)
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis botu|sales bot|lead|opportunity|firsat)/.test(normalizedText);
  if (isSapCrmAiSalesBot) {
    return [
      formatClassifierQuestion('AI satis botu hangi kanallarda calisacak?', ['Web chat + WhatsApp', 'SAP CRM icinde temsilci asistani', 'Varsayimla coklu kanal']),
      formatClassifierQuestion('SAP CRM tarafinda hangi satis nesneleri yonetilecek?', ['Lead + Opportunity + Activity', 'Sadece lead olusturma', 'Varsayimla lead ve opportunity kapsamda']),
      formatClassifierQuestion('Bot hangi seviyede aksiyon alabilecek?', ['Sadece oneri ve ozet', 'Lead nitelendirme + CRM kaydi', 'Varsayimla kritik islemler temsilci onayli']),
      formatClassifierQuestion('Insana devir ve kalite kontrol nasil ilerlesin?', ['Dusuk guvende temsilciye devir', 'Tum satis aksiyonlari onayli', 'Varsayimla risk bazli devir modeli']),
    ];
  }
  const isSapIys = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oö]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  if (!isSapIys) return [];

  return [
    formatClassifierQuestion('IYS izin kapsami hangi iletisim kanallarini icermeli?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayimla tum kanallar']),
    formatClassifierQuestion('Sirket IYS tarafinda tek marka kodu mu, coklu marka yapisi mi kullaniyor?', ['Tek marka kodu', 'Coklu marka', 'Varsayimla coklu marka desteklensin']),
    formatClassifierQuestion('SAP CRM ile IYS arasinda hangi ara katman varsayilsin?', ['SAP CPI', 'SAP PI/PO', 'Varsayimla CPI veya PO karari acik kalsin']),
    formatClassifierQuestion('Ilk aktarim ve gunluk mutabakat kapsami nasil ele alinsin?', ['Initial load + gunluk delta', 'Sadece gunluk delta', 'Varsayimla ikisi de kapsamda']),
  ];
}

function docSummary(doc: DocumentData | null): string {
  if (!doc) return 'boş';
  const parts = Object.entries(doc as any)
    .filter(([, v]: [string, any]) => v?.content)
    .map(([k, v]: [string, any]) => `${k}:${v.status || 'DRAFT'}(${String(v.content).length}c)`);
  return parts.length > 0 ? parts.join('; ') : 'boş';
}

function parseSlashCommand(msg: string): IntentClassification | null {
  const trimmed = msg.trim();
  if (!trimmed.startsWith('/')) return null;
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  const map = SLASH_COMMAND_MAP[first];
  if (!map) {
    return buildClassification('invalid_command', { reason: `Bilinmeyen komut: ${first}` });
  }
  return buildClassification(map.sub, { targetSection: map.target, reason: `Slash command: ${first}` });
}

export function buildClassification(
  sub: SubIntent,
  overrides: Partial<IntentClassification> = {}
): IntentClassification {
  const defaults = INTENT_DEFAULTS[sub] || { impact: 'none' as const, operation: 'none' as const, risk: 'low' as const };
  const primary = PRIMARY_BY_SUB[sub];
  return {
    primaryIntent: primary,
    subIntent: sub,
    targetSection: overrides.targetSection ?? defaults.targetSection,
    secondaryTargetSection: overrides.secondaryTargetSection,
    operation: overrides.operation ?? defaults.operation,
    documentImpact: overrides.documentImpact ?? defaults.impact,
    confidence: overrides.confidence ?? 0.7,
    riskLevel: overrides.riskLevel ?? defaults.risk,
    requiresResearch: overrides.requiresResearch ?? false,
    researchType: overrides.researchType,
    requiresClarification: overrides.requiresClarification ?? false,
    clarificationQuestions: overrides.clarificationQuestions,
    requiresPreview: overrides.requiresPreview ?? (defaults.risk === 'high'),
    shouldRunBaAgentLoop: overrides.shouldRunBaAgentLoop ?? !!defaults.shouldRunBaAgentLoop,
    baAgentFocus: overrides.baAgentFocus ?? defaults.baAgentFocus,
    reason: overrides.reason ?? `Default mapping for ${sub}`,
  };
}

export interface ClassifyInput {
  userMessage: string;
  artifactIntentText?: string;
  document: DocumentData | null;
  selectedText?: string | null;
  selectedSection?: DocumentSectionKey | null;
  model: string;
}

function normalizeVisibleSection(section?: DocumentSectionKey): DocumentSectionKey | undefined {
  if (!section) return undefined;
  return section === 'review' ? 'review' : 'businessAnalysis';
}

function focusFromSubIntent(subIntent: SubIntent): BaAgentFocus | undefined {
  if (['generate_test_cases', 'generate_error_scenarios', 'check_testability', 'check_traceability'].includes(subIntent)) return 'test';
  if (['generate_flow_diagram', 'generate_bpmn', 'generate_mermaid'].includes(subIntent)) return 'flow';
  if (['generate_technical_analysis', 'generate_integration_analysis', 'generate_api_contract', 'generate_developer_handoff'].includes(subIntent)) return 'technical_analysis';
  if (['review_document_quality', 'score_document'].includes(subIntent)) return 'quality';
  if (['generate_review_report', 'find_risks', 'find_missing_sections', 'find_open_questions', 'prepare_review_summary', 'prepare_management_summary'].includes(subIntent)) return 'review';
  return undefined;
}

function visibleSectionForFocus(focus?: BaAgentFocus, fallback?: DocumentSectionKey): DocumentSectionKey {
  if (focus === 'review' || focus === 'quality') return 'review';
  return normalizeVisibleSection(fallback) || 'businessAnalysis';
}

function preserveGenerationSubIntent(input: ClassifyInput, normalized: IntentClassification, userIsAnswering: boolean): SubIntent {
  if (userIsAnswering) return input.document ? 'add_requirement_detail' : 'generate_business_analysis';
  if (normalized.primaryIntent === 'analysis_generation') return normalized.subIntent;
  if (normalized.baAgentFocus === 'test') return 'generate_test_cases';
  if (normalized.baAgentFocus === 'flow') return 'generate_flow_diagram';
  if (normalized.baAgentFocus === 'technical_analysis') return 'generate_technical_analysis';
  if (normalized.baAgentFocus === 'review' || normalized.baAgentFocus === 'quality') return 'generate_review_report';
  return input.document ? 'add_requirement_detail' : 'generate_business_analysis';
}

function shouldApplyBaDiscovery(classification: IntentClassification): boolean {
  return ['requirement_intake', 'analysis_generation', 'document_editing', 'quality_review'].includes(classification.primaryIntent)
    || classification.documentImpact === 'updates_document'
    || classification.shouldRunBaAgentLoop;
}

export function normalizeBaClassifierOutput(input: ClassifyInput, classification: IntentClassification): IntentClassification {
  const state = buildBaDiscoveryState({ userMessage: input.userMessage, document: input.document });
  const userForcesDraft = GENERATE_WITH_ASSUMPTIONS_RE.test(input.userMessage);
  const userIsAnswering = isLikelyBaDiscoveryAnswer(input.userMessage);
  const continuationSubject = userIsAnswering && input.artifactIntentText
    ? input.artifactIntentText
    : input.userMessage;
  const externalKnowledgeNeeded = requiresExternalKnowledge(continuationSubject);
  const deepBaMode = shouldUseDeepBaAssistant(continuationSubject);
  const intentProfile = detectDeterministicIntentProfile({
    userMessage: continuationSubject,
    hasDocument: !!input.document,
    hasSelectedText: !!input.selectedText,
  });
  let normalized: IntentClassification = {
    ...classification,
    targetSection: normalizeVisibleSection(classification.targetSection),
    secondaryTargetSection: normalizeVisibleSection(classification.secondaryTargetSection),
    baAgentFocus: classification.baAgentFocus || focusFromSubIntent(classification.subIntent),
    requiresResearch: classification.requiresResearch || externalKnowledgeNeeded,
    researchType: classification.researchType || (externalKnowledgeNeeded ? 'web' : undefined),
  };
  normalized = applyIntentProfileToClassification(normalized, intentProfile);

  if (userIsAnswering) {
    const nextSubIntent = intentProfile?.subIntent
      && ['analysis_generation', 'requirement_intake', 'document_editing'].includes(PRIMARY_BY_SUB[intentProfile.subIntent])
      ? intentProfile.subIntent
      : preserveGenerationSubIntent(input, normalized, true);
    const nextFocus = intentProfile?.baAgentFocus
      || focusFromSubIntent(nextSubIntent)
      || 'business_analysis';
    return {
      ...normalized,
      primaryIntent: 'analysis_generation',
      subIntent: nextSubIntent,
      targetSection: visibleSectionForFocus(nextFocus, intentProfile?.targetSection || normalized.targetSection),
      documentImpact: 'updates_document',
      operation: input.document ? 'append_to_section' : 'replace_or_create_section',
      requiresClarification: false,
      clarificationQuestions: undefined,
      shouldRunBaAgentLoop: true,
      baAgentFocus: nextFocus,
      confidence: Math.max(normalized.confidence, 0.9),
      requiresResearch: normalized.requiresResearch || deepBaMode,
      researchType: normalized.researchType || (deepBaMode ? 'web' : undefined),
      reason: `${normalized.reason}; ba_engine:discovery_intent_continuity; focus:${nextFocus}`,
    };
  }

  if (!shouldApplyBaDiscovery(normalized)) return normalized;

  const behaviorDecision = buildBehaviorDecision({
    userMessage: input.userMessage,
    document: input.document,
    classification: normalized,
    discoveryReadiness: state.readinessScore,
  });
  normalized = applyBehaviorDecisionToClassification(normalized, behaviorDecision, input.document);

  if (behaviorDecision.mode === 'ask_clarifying_questions' || behaviorDecision.shouldUpdateDocument || behaviorDecision.mode === 'chat_only') {
    return normalized;
  }

  if (userForcesDraft || userIsAnswering) {
    const nextSubIntent = preserveGenerationSubIntent(input, normalized, userIsAnswering);
    const nextFocus = normalized.baAgentFocus || focusFromSubIntent(nextSubIntent) || 'business_analysis';
    return {
      ...normalized,
      primaryIntent: 'analysis_generation',
      subIntent: nextSubIntent,
      targetSection: visibleSectionForFocus(nextFocus, normalized.targetSection),
      documentImpact: 'updates_document',
      operation: input.document && userIsAnswering ? 'append_to_section' : (normalized.operation === 'none' ? 'replace_or_create_section' : normalized.operation),
      requiresClarification: false,
      clarificationQuestions: undefined,
      shouldRunBaAgentLoop: true,
      baAgentFocus: nextFocus,
      confidence: Math.max(normalized.confidence, 0.82),
      requiresResearch: normalized.requiresResearch || deepBaMode,
      researchType: normalized.researchType || (deepBaMode ? 'web' : undefined),
      reason: `${normalized.reason}; ba_engine:${userIsAnswering ? 'answer_mapper' : 'force_draft'}; focus:${nextFocus}${deepBaMode ? '; deep_ba_assistant_v2' : ''}`,
    };
  }

  const criticalDiscoveryGap = !input.document && state.readinessScore < 55 && state.criticalMissing.length >= 2;
  const lowConfidence = normalized.confidence < 0.55;
  const shouldAsk = normalized.requiresClarification || lowConfidence || criticalDiscoveryGap;
  if (!shouldAsk) return normalized;

  const discoveryQuestions = [
    ...buildContextualClarificationQuestions(input.userMessage),
    ...buildBaClarifyingQuestions(state, 3).map((question) => formatClassifierQuestion(question.text, question.options)),
  ].slice(0, 3);
  if (discoveryQuestions.length === 0) return normalized;

  return {
    ...normalized,
    requiresClarification: true,
    clarificationQuestions: discoveryQuestions,
    documentImpact: 'none',
    operation: 'none',
    shouldRunBaAgentLoop: false,
    confidence: Math.max(normalized.confidence, 0.58),
    reason: `${normalized.reason}; ba_engine:missing_discovery_context`,
  };
}

export async function classifyIntent(input: ClassifyInput): Promise<IntentClassification> {
  const slash = parseSlashCommand(input.userMessage);
  if (slash) return normalizeBaClassifierOutput(input, slash);
  if (isLikelyBaDiscoveryAnswer(input.userMessage)) {
    return normalizeBaClassifierOutput(
      input,
      buildClassification('answer_clarification', {
        confidence: 0.95,
        reason: 'deterministic:structured_discovery_answer',
      }),
    );
  }

  const discoveryState = buildBaDiscoveryState({ userMessage: input.userMessage, document: input.document });
  const intentProfile = detectDeterministicIntentProfile({
    userMessage: input.userMessage,
    hasDocument: !!input.document,
    hasSelectedText: !!input.selectedText,
  });
  if (intentProfile?.bypassModel) {
    return normalizeBaClassifierOutput(
      input,
      buildClassification(intentProfile.subIntent, {
        targetSection: intentProfile.targetSection,
        secondaryTargetSection: intentProfile.secondaryTargetSection,
        operation: intentProfile.operation,
        documentImpact: intentProfile.documentImpact,
        confidence: intentProfile.confidence,
        riskLevel: intentProfile.riskLevel,
        requiresResearch: intentProfile.requiresResearch,
        researchType: intentProfile.researchType,
        requiresClarification: intentProfile.requiresClarification,
        requiresPreview: intentProfile.requiresPreview,
        shouldRunBaAgentLoop: intentProfile.shouldRunBaAgentLoop,
        baAgentFocus: intentProfile.baAgentFocus,
        reason: intentProfile.reason,
      }),
    );
  }
  const selection = input.selectedText
    ? `\n[SEÇİLİ METİN (${input.selectedSection || '?'})]\n"""${String(input.selectedText).slice(0, 400)}"""`
    : '';

  const prompt = `[DOKÜMAN DURUMU] ${docSummary(input.document)}${selection}\n\n${buildIntentProfilePromptContext(intentProfile)}\n\n${buildBaEnginePromptContext(discoveryState)}\n\n[KULLANICI MESAJI]\n${input.userMessage}\n\nJSON ile cevapla.`;

  try {
    const res = await callAiWithRetry(() =>
      callGemini({
        model: input.model,
        systemInstruction: SYSTEM_PROMPT,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: classifierSchema,
        onChunk: () => {},
      })
    );
    const raw = (res.text || '').trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    const parsed = JSON.parse(raw) as Partial<IntentClassification>;
    const sub = (parsed.subIntent && PRIMARY_BY_SUB[parsed.subIntent as SubIntent])
      ? (parsed.subIntent as SubIntent)
      : fallbackSubIntent(input);
    const classification = buildClassification(sub, {
      targetSection: (parsed.targetSection && String(parsed.targetSection).trim() ? parsed.targetSection : undefined) as DocumentSectionKey | undefined,
      secondaryTargetSection: (parsed.secondaryTargetSection && String(parsed.secondaryTargetSection).trim() ? parsed.secondaryTargetSection : undefined) as DocumentSectionKey | undefined,
      operation: parsed.operation,
      documentImpact: parsed.documentImpact,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.65,
      riskLevel: parsed.riskLevel,
      requiresResearch: parsed.requiresResearch,
      researchType: parsed.researchType,
      requiresClarification: parsed.requiresClarification,
      clarificationQuestions: parsed.clarificationQuestions,
      requiresPreview: parsed.requiresPreview,
      shouldRunBaAgentLoop: parsed.shouldRunBaAgentLoop,
      baAgentFocus: parsed.baAgentFocus,
      reason: parsed.reason || 'classifier',
    });
    return normalizeBaClassifierOutput(input, classification);
  } catch (e) {
    console.warn('Intent classifier failed, using heuristic fallback:', e);
    return normalizeBaClassifierOutput(
      input,
      buildClassification(fallbackSubIntent(input), { confidence: 0.45, reason: 'classifier_fallback' })
    );
  }
}

function fallbackSubIntent(input: ClassifyInput): SubIntent {
  const msg = input.userMessage.trim().toLowerCase();
  const hasDoc = !!(input.document && Object.values(input.document).some((s: any) => s?.content));

  if (isLikelyBaDiscoveryAnswer(input.userMessage)) return hasDoc ? 'add_requirement_detail' : 'generate_business_analysis';
  if (msg.length < 30 && /(selam|merhaba|hi|nas[ıi]ls[ıi]n|naber)/i.test(msg)) return 'small_talk';
  if (input.selectedText && /(bunu|şunu|buray[ıi])/i.test(msg) && /(a[çc][ıi]kla|anlat)/i.test(msg)) return 'explain_selected_text';
  if (input.selectedText && /(bunu|şunu|buray[ıi])/i.test(msg)) return 'improve_selected_text';
  if (/(test|kabul kriter|uat|senaryo)/i.test(msg)) return 'generate_test_cases';
  if (/(ak[ıi]ş|bpmn|mermaid|flow|s[üu]re[çc])/i.test(msg)) return 'generate_flow_diagram';
  if (/(api kontrat|api contract|endpoint|servis sözleşmesi|servis sozlesmesi)/i.test(msg)) return 'generate_api_contract';
  if (/(entegrasyon|integration)/i.test(msg)) return 'generate_integration_analysis';
  if (/(teknik|mimari|developer handoff|geliştirici devri|gelistirici devri)/i.test(msg)) return 'generate_technical_analysis';
  if (/(risk|eksik|review|kalite|inceleme)/i.test(msg)) return 'find_risks';
  if (/(ara[şs]t[ıi]r|best practice|g[üu]ncel|standart)/i.test(msg)) return 'research_web';
  if (/(indir|export|payla[şs]|versiyon)/i.test(msg)) return 'export_document';
  if (/(nedir|a[çc][ıi]kla|anlat|nas[ıi]l kullan)/i.test(msg) && msg.length < 80) return 'ask_explanation';
  if (hasDoc) return 'add_requirement_detail';
  return 'generate_business_analysis';
}
