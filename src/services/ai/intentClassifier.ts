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
- Ancak kullanıcı "devam", "oluştur", "hazırla", "varsayımlarla ilerle", "bu bilgilerle" diyorsa soru sorma; analysis_generation ve shouldRunBaAgentLoop kullan.
- Kullanıcı önceki soru kartlarına cevap veriyorsa bunu yeni BA girdisi say; generate_business_analysis veya add_requirement_detail seç.
- Bilinmeyen kurumsal bilgi varsa uydurma; assumption/open question üret.
- Kullanıcı bir talep/fikir/entegrasyon anlatıyorsa ve boş dokümana yazılacaksa -> generate_business_analysis (analysis_generation).
- "araştır / güncel bilgi / best practice" açıkça geçiyorsa research_* intentleri kullan.
- /ekip -> zero_touch_requested.

ÖNEMLİ3�} Yanıt yalnızca şu JSON: { subIntent, targetSection, secondaryTargetSection, operation, documentImpact, confidence (0-1), riskLevel, requiresResearch, researchType, requiresClarification, clarificationQuestions, requiresPreview, shouldRunBaAgentLoop, baAgentFocus, reason }.`;

const GENERATE_WITH_ASSUMPTIONS_RE = /\b(devam|ilerle|olu[şs]tur|haz[ıi]rla|yaz|taslak|varsay[ıi]mlarla|bu bilgilerle|mevcut bilgilerle|uygula|ba[şs]la)\b/i;

function formatClassifierQuestion(text: string, options: string[] = []): string {
  return options.length > 0 ? `${text}\nSeçenekler: ${options.join(' | ')}` : text;
}

function buildContextualClarificationQuestions(userMessage: string): string[] {
  const isSapIys = /sap\s+crm/i.test(userMessage) && /iys|i[\. ]?y[\. ]?s|ileti y[o,ö]netim sistemi/i.test(userMessage);
  if (!isSapIys) return [];

  return [
    formatClassifierQuestion('İYS izin kapsamı hangi iletişim kanallarını içermeli?', ['SMS/MESAJ + EPOSTA + ARAMA', 'Sadece SMS/EPOSTA', 'Varsayımla tüm kanallar']),
    formatClassifierQuestion('Şirket İYS tarafında tek marka kodu mu, çoklu marka yapısı mı kullanıyor?', ['Tek marka kodu', 'Çoklu marka', 'Varsayımla çoklu marka desteklensin']),
    formatClassifierQuestion('SAP CRM ile İYS arasında hangi ara katman varsayılsın?', ['SAP CPI', 'SAP PI/PO', 'Varsayımla CPI veya PO kararı açık kalsın']),
    formatClassifierQuestion('İlk aktarım ve günlük mutabakat kapsamı nasıl ele alınsın?', ['Initial load + günlük delta', 'Sadece günlük delta', 'Varsayımla ikisi de kapsamda']),
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
  const normalized: IntentClassification = {
    ...classification,
    targetSection: normalizeVisibleSection(classification.targetSection),
    secondaryTargetSection: normalizeVisibleSection(classification.secondaryTargetSection),
    baAgentFocus: classification.baAgentFocus || focusFromSubIntent(classification.subIntent),
    requiresResearch: classification.requiresResearch || externalKnowledgeNeeded,
    researchType: classification.researchType || (externalKnowledgeNeeded ? 'web' : undefined),
  };

  if (!shouldApplyBaDiscovery(normalized)) return normalized;

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
    ? `\n[SEÇİLİ METİN (${input.selectedSection || '?'})]\n"""${String(input.selectedText).slice(0, 400)}"""`
    : '';

  const prompt = `[DOKÜMAN DURUMU] ${docSummary(input.document)}${selection}\n\n${buildBaEnginePromptContext(discoveryState)}\n\n[KULLANICI MESAJI]\n${input.userMessage}\n\nJSON ile cevapla.`;

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
