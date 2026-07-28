import type { DocumentData, KnowledgeItem, Message, Question } from '../../types';
import {
  analyzeSourceIntelligence,
  buildSourceCorpus,
  type SourceIntelligenceReport,
} from '../sourceIntelligence';
import { applyBehaviorDecisionToClassification, buildBehaviorDecision, type BehaviorDecision } from './behaviorDecision';
import { buildBaCognitiveFrame, buildBaCognitiveQuestionItems, type BaCognitiveFrame } from './baCognitiveFrame';
import { buildCopilotCognitiveTrace, type CopilotCognitiveTrace } from './copilotCognitiveArchitecture';
import { buildCopilotRuntimeSnapshot, type CopilotRuntimeSnapshot } from './copilotRuntimeState';
import { buildAiTurnDecision, type AiTurnAction, type AiTurnDecision } from './aiTurnDecision';
import { ARTIFACT_PROFILES } from './artifactProfiles';
import { buildClassification, classifyIntent } from './intentClassifier';
import type { DocumentSectionKey, IntentClassification } from './intentTypes';
import type { ProjectMemory } from './projectMemoryEngine';
import {
  decideSimpleBaTurn,
  type SimpleBaPolicyDecision,
} from './simpleBaPolicy';

export type AnalystAction =
  | 'ANSWER'
  | 'ASK'
  | 'CREATE_ARTIFACT'
  | 'UPDATE_ARTIFACT'
  | 'REVIEW_ARTIFACT';

export interface AnalystDecision {
  action: AnalystAction;
  artifactType?: 'BUSINESS_ANALYSIS' | 'REVIEW';
  questions?: Question[];
  targetSections?: DocumentSectionKey[];
  reasonCode: string;
  requiresExternalResearch: boolean;
  requiresConfirmation: boolean;
  requestedOperation: AiTurnAction;
}

export interface AnalystPlan {
  decision: AnalystDecision;
  classification: IntentClassification;
  behavior: BehaviorDecision;
  cognitiveFrame: BaCognitiveFrame;
  sourceReport: SourceIntelligenceReport;
  trace: CopilotCognitiveTrace;
  runtime: CopilotRuntimeSnapshot;
  legacyDecision: AiTurnDecision;
}

export interface AnalystPlannerInput {
  userMessage: string;
  document: DocumentData | null;
  selectedText?: string | null;
  selectedSection?: DocumentSectionKey | null;
  model: string;
  recentMessages: Message[];
  recentConversationText: string;
  workspaceTitle?: string;
  knowledgeBase: KnowledgeItem[];
  projectMemory?: ProjectMemory;
  discoveryReadiness: number;
  discoverySignals: {
    mustGenerateNow: boolean;
    greetingOnly: boolean;
    newStandaloneRequest: boolean;
    isAnsweringDiscovery: boolean;
    reason: string;
  };
  zeroTouchEnabled: boolean;
  pendingOperation?: { id: string } | null;
  pendingOperationLookupPerformed: boolean;
}

const normalizePlannerText = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0131/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

function parseBehaviorQuestion(raw: string, index: number): Question {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const optionsLine = lines.find(line => /^secenekler\s*:/i.test(normalizePlannerText(line)));
  const options = optionsLine
    ? optionsLine.replace(/^[^:]+:\s*/, '').split('|').map(option => option.trim()).filter(Boolean)
    : [];
  return {
    id: `q${index + 1}`,
    text: lines.filter(line => line !== optionsLine).join('\n'),
    options,
  };
}

function targetedPlannerQuestions(
  input: AnalystPlannerInput,
  behavior: BehaviorDecision,
  cognitiveFrame: BaCognitiveFrame,
  maxQuestions: number,
): Question[] {
  const message = normalizePlannerText(input.userMessage);
  const documentText = normalizePlannerText(
    Object.values(input.document || {})
      .map((section: any) => section?.content || '')
      .join(' '),
  );

  if (/\b(kkb|findeks|kredi skoru|kredi notu)\b/.test(message)) {
    return [
      {
        id: 'q1',
        text: 'Kullanılacak resmi doküman ve resmi API alanları doğrulanmış bir gerçek olarak mevcut mu, yoksa alanlar şimdilik varsayım mı?',
        options: ['Resmi doküman mevcut', 'KKB/Findeks erişimi bekleniyor', 'Varsayım olarak açık konu bırak'],
      },
      {
        id: 'q2',
        text: 'Kişisel veri, açık rıza/KVKK ve saklama süresi hangi onaylı kurala göre yönetilecek?',
        options: ['Hukuk onaylı politika mevcut', 'Açık rıza + sınırlı saklama', 'Doğrulama bekleyen açık konu'],
      },
      {
        id: 'q3',
        text: 'Otomatik karar hangi eşikte durup insan onayına veya manuel incelemeye devredilecek?',
        options: ['Tüm retler insan onaylı', 'Düşük güvenli kararlar devredilir', 'Eşik henüz açık konu'],
      },
    ].slice(0, maxQuestions);
  }

  if (
    /\b(manuel|elle)\b/.test(message)
    && /\b(degistirilemez|yasak|izin verilmez)\b/.test(documentText)
  ) {
    return [{
      id: 'q1',
      text: 'Mevcut “manuel değiştirilemez” kararını hangi yetkili roller için değiştirelim ve bu istisna audit loguna nasıl yazılsın?',
      options: ['Yalnız yönetici + zorunlu gerekçe', 'Belirli rol matrisi + çift onay', 'Mevcut yasak korunsun'],
    }];
  }

  if (
    /\b(is kurali|kural\w*)\b/.test(message)
    && /\b(guncelle|degistir|revize)\b/.test(message)
  ) {
    const currentRule = input.knowledgeBase[0]?.content || 'Bağlamdaki mevcut iş kuralı';
    return [{
      id: 'q1',
      text: `Mevcut kural: ${currentRule}\nYeni kural nasıl olmalı ve mevcut yasak/istisna korunacak mı?`,
      options: ['Mevcut kuralı koru', 'Manuel istisna ekle', 'Yeni kuralı serbest metinle belirt'],
    }];
  }

  if (/\btedarikci\b/.test(message) && /\bsozlesme\b/.test(message) && /\byenileme\b/.test(message)) {
    return [
      {
        id: 'q1',
        text: 'Sözleşme yenileme sürecini başlatan rol ve onaylayan roller kimler?',
        options: ['Satınalma + hukuk onayı', 'Sözleşme sahibi + yönetici onayı', 'Rol matrisi açık konu'],
      },
      {
        id: 'q2',
        text: 'Yenileme hangi süre/tetikleyiciyle başlayacak ve hangi durumda otomatik yenileme engellenecek?',
        options: ['90 gün kala + performans kontrolü', '60 gün kala manuel başlatma', 'Tetikleyici açık konu'],
      },
      {
        id: 'q3',
        text: 'Nihai yenileme onayı ve imza akışı nasıl tamamlanacak?',
        options: ['Hukuk + satınalma + e-imza', 'Tek yönetici onayı', 'Onay akışı açık konu'],
      },
    ].slice(0, maxQuestions);
  }

  const behaviorQuestions = behavior.clarificationQuestions.map(parseBehaviorQuestion);
  if (behaviorQuestions.length && behavior.domain !== 'generic_ba') {
    const ordered = behavior.domain === 'sap_crm_ai_sales_bot'
      ? [behaviorQuestions[0], behaviorQuestions[2], behaviorQuestions[3], behaviorQuestions[1]].filter(Boolean)
      : behaviorQuestions;
    return ordered.slice(0, maxQuestions);
  }

  return buildBaCognitiveQuestionItems(cognitiveFrame, maxQuestions);
}

function simpleClassification(
  input: AnalystPlannerInput,
  policy: SimpleBaPolicyDecision,
): IntentClassification {
  if (policy.action === 'ASK') {
    return buildClassification('start_new_requirement', {
      documentImpact: 'none',
      operation: 'none',
      requiresClarification: true,
      clarificationQuestions: policy.questions.map(question => question.text),
      shouldRunBaAgentLoop: false,
      baAgentFocus: policy.focus,
      confidence: 0.98,
      reason: `simple_ba:${policy.reasonCode}`,
    });
  }

  if (policy.action === 'REVIEW_ARTIFACT') {
    return buildClassification('review_document_quality', {
      targetSection: 'review',
      documentImpact: 'none',
      operation: 'none',
      requiresClarification: false,
      shouldRunBaAgentLoop: false,
      baAgentFocus: 'review',
      confidence: 0.98,
      reason: `simple_ba:${policy.reasonCode}`,
    });
  }

  if (policy.action === 'RESEARCH') {
    return buildClassification('research_web', {
      documentImpact: 'none',
      operation: 'none',
      requiresResearch: true,
      researchType: 'web',
      shouldRunBaAgentLoop: false,
      confidence: 0.98,
      reason: `simple_ba:${policy.reasonCode}`,
    });
  }

  if (policy.action === 'UPDATE_SELECTED_TEXT') {
    return buildClassification('improve_selected_text', {
      targetSection: input.selectedSection || 'businessAnalysis',
      documentImpact: 'updates_selected_text',
      operation: 'patch_selected_node',
      shouldRunBaAgentLoop: false,
      confidence: 0.98,
      reason: `simple_ba:${policy.reasonCode}`,
    });
  }

  if (policy.action === 'CREATE_ARTIFACT' || policy.action === 'UPDATE_ARTIFACT') {
    const subIntent = policy.focus === 'flow'
      ? 'generate_bpmn'
      : policy.focus === 'test'
        ? 'generate_test_cases'
        : policy.focus === 'technical_analysis'
          ? 'generate_technical_analysis'
          : policy.focus === 'review'
            ? 'generate_review_report'
            : 'generate_business_analysis';
    return buildClassification(subIntent, {
      targetSection: policy.focus === 'review' ? 'review' : 'businessAnalysis',
      documentImpact: 'updates_document',
      operation: policy.action === 'UPDATE_ARTIFACT' ? 'patch_section' : 'generate_new_artifact',
      requiresClarification: false,
      shouldRunBaAgentLoop: true,
      baAgentFocus: policy.focus,
      confidence: 0.98,
      reason: `simple_ba:${policy.reasonCode}`,
    });
  }

  return buildClassification('ask_explanation', {
    documentImpact: 'none',
    operation: 'none',
    requiresClarification: false,
    shouldRunBaAgentLoop: false,
    confidence: 0.98,
    reason: `simple_ba:${policy.reasonCode}`,
  });
}

function applySimplePolicyToTurnDecision(
  decision: AiTurnDecision,
  classification: IntentClassification,
  policy: SimpleBaPolicyDecision,
): AiTurnDecision {
  if (policy.action === 'LEGACY') return decision;

  const action: AiTurnAction = policy.action === 'ASK'
    ? 'ask_questions'
    : policy.action === 'CREATE_ARTIFACT'
      ? 'draft_document'
      : policy.action === 'UPDATE_ARTIFACT'
        ? 'revise_document'
        : policy.action === 'REVIEW_ARTIFACT'
          ? 'validate_document'
          : policy.action === 'RESEARCH'
            ? 'research_first'
            : policy.action === 'UPDATE_SELECTED_TEXT'
              ? 'update_selected_text'
              : 'answer_only';
  const writesDocument = ['draft_document', 'revise_document'].includes(action);
  const profile = writesDocument
    ? policy.focus === 'flow'
      ? ARTIFACT_PROFILES.enerjisa_bpmn
      : ARTIFACT_PROFILES.enerjisa_business_analysis
    : action === 'ask_questions'
      ? ARTIFACT_PROFILES.discovery_brief
      : ARTIFACT_PROFILES.none;
  const artifactMode = writesDocument
    ? policy.focus === 'flow'
      ? 'process_design'
      : policy.focus === 'test'
        ? 'test_scenario'
        : policy.focus === 'technical_analysis'
          ? 'technical_analysis'
          : 'conceptual_analysis'
    : 'none';
  const reason = `simple_ba:${policy.reasonCode}; case:${policy.caseType.toLowerCase()}; document_requested:${policy.documentRequested}`;

  return {
    ...decision,
    action,
    artifactMode,
    artifactProfile: profile,
    sourcePolicy: {
      ...decision.sourcePolicy,
      requiresExternalResearch: action === 'research_first',
    },
    questionPolicy: {
      shouldAsk: action === 'ask_questions',
      reason: action === 'ask_questions'
        ? 'Talebin sonucunu değiştiren kritik bilgiler eksik.'
        : 'Bu turda soru gerekmiyor.',
      maxQuestions: action === 'ask_questions' ? Math.min(3, policy.questions.length || 3) : 0,
      questionType: action === 'ask_questions' ? 'critical_only' : 'none',
    },
    documentPolicy: {
      shouldUpdateDocument: writesDocument,
      templateProfile: profile.id,
      allowAssumptions: policy.allowAssumptions,
      allowAutoRepair: false,
      allowTemplateNormalization: writesDocument,
      forceDocumentGeneration: writesDocument,
      visibleSections: ['businessAnalysis', 'review'],
    },
    executionPolicy: {
      operation: classification.operation,
      targetSection: writesDocument
        ? (classification.targetSection || 'businessAnalysis')
        : action === 'update_selected_text'
          ? (classification.targetSection || 'businessAnalysis')
          : null,
      requiresConfirmation: false,
    },
    reason,
    trace: [
      `action:${action}`,
      `profile:${profile.id}`,
      `case:${policy.caseType.toLowerCase()}`,
      `documentRequested:${policy.documentRequested}`,
    ],
  };
}

export function mapAnalystAction(
  decision: AiTurnDecision,
  document: DocumentData | null,
): AnalystAction {
  if (decision.action === 'ask_questions') return 'ASK';
  if (decision.action === 'preview_change') return 'ASK';
  if (decision.action === 'validate_document') return 'REVIEW_ARTIFACT';
  if (
    ['draft_document', 'revise_document', 'repair_document'].includes(decision.action)
    && decision.executionPolicy.targetSection === 'review'
  ) return 'REVIEW_ARTIFACT';
  if (['draft_document'].includes(decision.action)) {
    return document ? 'UPDATE_ARTIFACT' : 'CREATE_ARTIFACT';
  }
  if ([
    'revise_document',
    'repair_document',
    'preview_change',
    'update_selected_text',
    'execute_confirmed_change',
  ].includes(decision.action)) {
    return 'UPDATE_ARTIFACT';
  }
  return 'ANSWER';
}

export async function planAnalystTurn(input: AnalystPlannerInput): Promise<AnalystPlan> {
  const simplePolicy = decideSimpleBaTurn({
    userMessage: input.userMessage,
    hasDocument: !!input.document,
    hasSelectedText: !!input.selectedText,
    knowledgeItemCount: input.knowledgeBase.length,
    recentMessages: input.recentMessages,
  });
  let classification = simplePolicy.action === 'LEGACY'
    ? await classifyIntent({
      userMessage: input.userMessage,
      document: input.document,
      selectedText: input.selectedText ?? null,
      selectedSection: input.selectedSection ?? null,
      model: input.model,
    })
    : simpleClassification(input, simplePolicy);

  const behavior = buildBehaviorDecision({
    userMessage: input.userMessage,
    document: input.document,
    classification,
    discoveryReadiness: input.discoveryReadiness,
  });
  const sourceReport = analyzeSourceIntelligence({
    sourceText: buildSourceCorpus({
      userMessage: input.userMessage,
      messages: input.recentMessages,
      document: input.document,
    }),
    workspaceTitle: input.workspaceTitle,
  });
  const cognitiveFrame = buildBaCognitiveFrame({
    userMessage: input.userMessage,
    recentConversation: input.recentConversationText,
    document: input.document,
    sourceReport,
    behaviorDecision: behavior,
  });

  if (simplePolicy.action === 'LEGACY') {
    classification = applyBehaviorDecisionToClassification(
      classification,
      behavior,
      input.document,
    );
  }

  const legacyDecision = applySimplePolicyToTurnDecision(buildAiTurnDecision({
    userMessage: input.userMessage,
    document: input.document,
    classification,
    behaviorDecision: behavior,
    cognitiveFrame,
    sourceReport,
    discoverySignals: input.discoverySignals,
    hasSelectedText: !!input.selectedText,
    capabilities: { zeroTouchEnabled: input.zeroTouchEnabled },
    pendingOperation: input.pendingOperation,
    pendingOperationLookupPerformed: input.pendingOperationLookupPerformed,
  }), classification, simplePolicy);

  const trace = buildCopilotCognitiveTrace({
    userMessage: input.userMessage,
    messages: input.recentMessages,
    knowledgeBase: input.knowledgeBase,
    document: input.document,
    hasSelectedText: !!input.selectedText,
    classification,
    behaviorDecision: behavior,
    sourceReport,
    cognitiveFrame,
    turnDecision: legacyDecision,
    discoverySignals: input.discoverySignals,
  });
  const runtime = buildCopilotRuntimeSnapshot({
    userMessage: input.userMessage,
    messages: input.recentMessages,
    knowledgeBase: input.knowledgeBase,
    document: input.document,
    workspaceTitle: input.workspaceTitle,
    projectMemory: input.projectMemory,
    sourceReport,
    trace,
  });

  const action = mapAnalystAction(legacyDecision, input.document);
  const targetSection = legacyDecision.executionPolicy.targetSection
    || classification.targetSection
    || (action === 'REVIEW_ARTIFACT' ? 'review' : undefined);
  const questions = action === 'ASK'
    ? simplePolicy.action === 'ASK'
      ? simplePolicy.questions.slice(0, 3)
      : targetedPlannerQuestions(
        input,
        behavior,
        cognitiveFrame,
        Math.min(3, legacyDecision.questionPolicy.maxQuestions || 3),
      )
    : undefined;

  return {
    decision: {
      action,
      artifactType: action === 'REVIEW_ARTIFACT' ? 'REVIEW' : (
        ['CREATE_ARTIFACT', 'UPDATE_ARTIFACT'].includes(action) ? 'BUSINESS_ANALYSIS' : undefined
      ),
      questions,
      targetSections: targetSection ? [targetSection] : undefined,
      reasonCode: legacyDecision.reason,
      requiresExternalResearch: legacyDecision.sourcePolicy.requiresExternalResearch,
      requiresConfirmation: legacyDecision.executionPolicy.requiresConfirmation,
      requestedOperation: legacyDecision.action,
    },
    classification,
    behavior,
    cognitiveFrame,
    sourceReport,
    trace,
    runtime,
    legacyDecision,
  };
}
