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

const SYSTEM_PROMPT = `Sen JETWORK Intent Classifier katmanÄ±sÄ±n. GÃ¶revin kullanÄ±cÄ± mesajÄ±nÄ± Ã¼rÃ¼n aksiyonuna Ã§evirmektir.
GÃ¶rÃ¼nÃ¼r Ã§ok ajan tartÄ±ÅŸmasÄ± baÅŸlatma. Zero-Touch MVP'de kapalÄ±dÄ±r.
Sadece geÃ§erli JSON dÃ¶ndÃ¼r. Markdown, aÃ§Ä±klama veya serbest metin yazma.

KURALLAR:
- GÃ¶rÃ¼nÃ¼r dokÃ¼man yÃ¼zeyi ÅŸimdilik sadece businessAnalysis ve review sekmeleridir. Teknik analiz, test veya flow istenirse targetSection olarak businessAnalysis ya da review seÃ§; baAgentFocus ile odaÄŸÄ± belirt.
- Teknik analiz / mimari / API / entegrasyon isteklerinde baAgentFocus = 'technical_analysis'.
- Test / UAT / kabul senaryosu isteklerinde baAgentFocus = 'test'.
- BPMN / Mermaid / sÃ¼reÃ§ akÄ±ÅŸÄ± isteklerinde baAgentFocus = 'flow'.
- Risk / kalite / review isteklerinde baAgentFocus = 'review' veya 'quality'.
- Sadece aÃ§Ä±klama isteniyorsa documentImpact = 'none'.
- DokÃ¼mana ekle/yaz/gÃ¼ncelle/Ã§Ä±kar/hazÄ±rla deniyorsa uygun targetSection belirle.
- SeÃ§ili metin varsa "bunu/ÅŸunu" Ã¶nce selectedText'e baÄŸlanÄ±r.
- Silme, komple baÅŸtan yazma, restore gibi riskli iÅŸlemlerde requiresPreview = true.
- Emin deÄŸilsen requiresClarification = true yap; dokÃ¼man gÃ¼ncelleme Ã¶nerme.
- Ancak kullanÄ±cÄ± "devam", "oluÅŸtur", "hazÄ±rla", "varsayÄ±mlarla ilerle", "bu bilgilerle" diyorsa soru sorma; analysis_generation ve shouldRunBaAgentLoop kullan.
- KullanÄ±cÄ± Ã¶nceki soru kartlarÄ±na cevap veriyorsa bunu yeni BA girdisi say; generate_business_analysis veya add_requirement_detail seÃ§.
- Bilinmeyen kurumsal bilgi varsa uydurma; assumption/open question Ã¼ret.
- KullanÄ±cÄ± bir talep/fikir/entegrasyon anlatÄ±yorsa ve boÅŸ dokÃ¼mana yazÄ±lacaksa -> generate_business_analysis (analysis_generation).
- "araÅŸtÄ±r / gÃ¼ncel bilgi / best practice" aÃ§Ä±kÃ§a geÃ§iyorsa research_* intentleri kullan.
- /ekip -> zero_touch_requested.

Ã–NEMLÄ°: YanÄ±t yalnÄ±zca ÅŸu JSON: { subIntent, targetSection, secondaryTargetSection, operation, documentImpact, confidence (0-1), riskLevel, requiresResearch, researchType, requiresClarification, clarificationQuestions, requiresPreview, shouldRunBaAgentLoop, baAgentFocus, reason }.`;

const GENERATE_WITH_ASSUMPTIONS_RE = /\b(devam|ilerle|olu[ÅŸs]tur|haz[Ä±i]rla|yaz|taslak|varsay[Ä±i]mlarla|bu bilgilerle|mevcut bilgilerle|uygula|ba[ÅŸs]la)\b/i;

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
  const normalizedText = normalizeQuestionDomainText(userMessage);
  const isSapCrmAiSalesBot = /sap\s*crm/.test(normalizedText)
    && /(ai|yapay zeka|bot|chatbot|asistan|assistant|satis|lead|opportunity|firsat|musteri)/.test(normalizedText);
  if (isSapCrmAiSalesBot) {
    return [
      formatClassifierQuestion('AI satis botu hangi kanallarda calisacak?', ['Web chat + WhatsApp', 'SAP CRM icinde temsilci asistani', 'Varsayimla coklu kanal']),
      formatClassifierQuestion('SAP CRM tarafinda hangi satis nesneleri yonetilecek?', ['Lead + Opportunity + Activity', 'Sadece lead olusturma', 'Varsayimla lead ve opportunity kapsamda']),
      formatClassifierQuestion('Bot hangi seviyede aksiyon alabilecek?', ['Sadece oneri ve ozet', 'Lead nitelendirme + CRM kaydi', 'Varsayimla kritik islemler temsilci onayli']),
      formatClassifierQuestion('Insana devir ve kalite kontrol nasil ilerlesin?', ['Dusuk guvende temsilciye devir', 'Tum satis aksiyonlari onayli', 'Varsayimla risk bazli devir modeli']),
    ];
  }
  const isSapIys = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[oÃ¶]netim sistemi|ileti yonetim sistemi/i.test(userMessage);
  if (!isSapIys) return [];

  return [
    formatClassifierQuestion('IYS izin kapsami hangi iletisim kanallarini icermeli?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayimla tum kanallar']),
    formatClassifierQuestion('Sirket IYS tarafinda tek marka kodu mu, coklu marka yapisi mi kullaniyor?', ['Tek marka kodu', 'Coklu marka', 'Varsayimla coklu marka desteklensin']),
    formatClassifierQuestion('SAP CRM ile IYS arasinda hangi ara katman varsayilsin?', ['SAP CPI', 'SAP PI/PO', 'Varsayimla CPI veya PO karari acik kalsin']),
    formatClassifierQuestion('Ilk aktarim ve gunluk mutabakat kapsami nasil ele alinsin?', ['Initial load + gunluk delta', 'Sadece gunluk delta', 'Varsayimla ikisi de kapsamda']),
  ];
}

function docSummary(doc: DocumentData | null): string {
  if (!doc) return 'boÅŸ';
  const parts = Object.entries(doc as any)
    .filter(([, v]: [string, any]) => v?.content)
    .map(([k, v]: [string, any]) => `${k}:${v.status || 'DRAFT'}(${String(v.content).length}c)`);
  return parts.length > 0 ? parts.join('; ') : 'boÅŸ';
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
  const externalKnowledgeNeeded = requiresExternalKnowledge(input.userMessage);
  const deepBaMode = shouldUseDeepBaAssistant(input.userMessage);
  let normalized: IntentClassification = {
    ...classification,
    targetSection: normalizeVisibleSection(classification.targetSection),
    secondaryTargetSection: normalizeVisibleSection(classification.secondaryTargetSection),
    baAgentFocus: classification.baAgentFocus || focusFromSubIntent(classification.subIntent),
    requiresResearch: classification.requiresResearch || externalKnowledgeNeeded,
    researchType: classification.researchType || (externalKnowledgeNeeded ? 'web' : undefined),
  };

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
    ...buildBaClarifyingQuestions(state, 4).map((question) => formatClassifierQuestion(question.text, question.options)),
  ].slice(0, 4);
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

  const discoveryState = buildBaDiscoveryState({ userMessage: input.userMessage, document: input.document });
  const selection = input.selectedText
    ? `\n[SEÃ‡Ä°LÄ° METÄ°N (${input.selectedSection || '?'})]\n"""${String(input.selectedText).slice(0, 400)}"""`
    : '';

  const prompt = `[DOKÃœMAN DURUMU] ${docSummary(input.document)}${selection}\n\n${buildBaEnginePromptContext(discoveryState)}\n\n[KULLANICI MESAJI]\n${input.userMessage}\n\nJSON ile cevapla.`;

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
  if (msg.length < 30 && /(selam|merhaba|hi|nas[Ä±i]ls[Ä±i]n|naber)/i.test(msg)) return 'small_talk';
  if (input.selectedText && /(bunu|ÅŸunu|buray[Ä±i])/i.test(msg) && /(a[Ã§c][Ä±i]kla|anlat)/i.test(msg)) return 'explain_selected_text';
  if (input.selectedText && /(bunu|ÅŸunu|buray[Ä±i])/i.test(msg)) return 'improve_selected_text';
  if (/(test|kabul kriter|uat|senaryo)/i.test(msg)) return 'generate_test_cases';
  if (/(ak[Ä±i]ÅŸ|bpmn|mermaid|flow|s[Ã¼u]re[Ã§c])/i.test(msg)) return 'generate_flow_diagram';
  if (/(api kontrat|api contract|endpoint|servis sÃ¶zleÅŸmesi|servis sozlesmesi)/i.test(msg)) return 'generate_api_contract';
  if (/(entegrasyon|integration)/i.test(msg)) return 'generate_integration_analysis';
  if (/(teknik|mimari|developer handoff|geliÅŸtirici devri|gelistirici devri)/i.test(msg)) return 'generate_technical_analysis';
  if (/(risk|eksik|review|kalite|inceleme)/i.test(msg)) return 'find_risks';
  if (/(ara[ÅŸs]t[Ä±i]r|best practice|g[Ã¼u]ncel|standart)/i.test(msg)) return 'research_web';
  if (/(indir|export|payla[ÅŸs]|versiyon)/i.test(msg)) return 'export_document';
  if (/(nedir|a[Ã§c][Ä±i]kla|anlat|nas[Ä±i]l kullan)/i.test(msg) && msg.length < 80) return 'ask_explanation';
  if (hasDoc) return 'add_requirement_detail';
  return 'generate_business_analysis';
}
