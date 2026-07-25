import { buildAiTurnDecision } from '../src/services/ai/aiTurnDecision';
import { buildBaCognitiveQuestionItems } from '../src/services/ai/baCognitiveFrame';
import { postProcessDocumentData } from '../src/services/documentPostProcessor';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const baseClassification = {
  primaryIntent: 'analysis_generation',
  subIntent: 'generate_business_analysis',
  documentImpact: 'none',
  operation: 'none',
  targetSection: undefined,
  requiresClarification: false,
  clarificationQuestions: undefined,
  requiresPreview: false,
  requiresResearch: false,
  researchType: undefined,
  shouldRunBaAgentLoop: false,
  baAgentFocus: 'business_analysis',
  confidence: 0.82,
  reason: 'fixture',
} as any;

const baseBehavior = {
  mode: 'ask_clarifying_questions',
  domain: 'generic_ba',
  depth: 'deep',
  requiredTemplate: 'none',
  shouldAskQuestions: true,
  shouldUseAssumptions: false,
  shouldUseResearch: false,
  shouldUpdateDocument: false,
  questionBudget: 3,
  reason: 'fixture',
  sourceAnchoring: 'none',
  humanProfile: {},
} as any;

const baseFrame = {
  action: 'ask_first',
  artifactMode: 'conceptual_analysis',
  confidence: 80,
  informationGaps: [
    {
      topic: 'businessProblem',
      impact: 'high',
      reversibility: 'expensive',
      canAssume: false,
      question: 'Ana problem nedir?',
      reason: 'Problem net degilse dokuman yanlis amaca gore kurulur.',
    },
  ],
} as any;

const baseSourceReport = {
  confidence: 20,
  domainHints: ['sap', 'crm'],
  systems: ['SAP CRM'],
  integrations: [],
  processes: [],
  mismatchWarnings: [],
  quickActions: [],
} as any;

const existingDocument = {
  businessAnalysis: {
    content: 'KAVRAMSAL TASARIM RAPORU\nTaslak',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: 'Review',
    status: 'NEEDS_REVISION',
    flags: [],
  },
} as any;

const cases = [
  {
    name: 'sparse high-impact brief asks before drafting',
    userMessage: 'sap crm ai satış botu projesi',
    document: null,
    classification: baseClassification,
    behaviorDecision: baseBehavior,
    cognitiveFrame: baseFrame,
    expected: {
      action: 'ask_questions',
      shouldUpdateDocument: false,
      allowAutoRepair: false,
      shouldAsk: true,
    },
  },
  {
    name: 'explicit document with critical gaps still asks first',
    userMessage: 'sap crm ai satış botu projesi kavramsal tasarım dokümanı hazırla',
    document: null,
    classification: {
      ...baseClassification,
      documentImpact: 'updates_document',
      shouldRunBaAgentLoop: true,
    },
    behaviorDecision: baseBehavior,
    cognitiveFrame: baseFrame,
    expected: {
      action: 'ask_questions',
      shouldUpdateDocument: false,
      allowAutoRepair: false,
      shouldAsk: true,
    },
  },
  {
    name: 'explicit document with assumption consent drafts',
    userMessage: 'sap crm ai satış botu projesi kavramsal tasarım dokümanı hazırla varsayımlarla ilerle',
    document: null,
    classification: {
      ...baseClassification,
      documentImpact: 'updates_document',
      shouldRunBaAgentLoop: true,
    },
    behaviorDecision: {
      ...baseBehavior,
      mode: 'draft_with_marked_assumptions',
      shouldAskQuestions: false,
      shouldUseAssumptions: true,
      shouldUpdateDocument: true,
    },
    cognitiveFrame: {
      ...baseFrame,
      action: 'draft_with_assumptions',
      informationGaps: [],
    },
    expected: {
      action: 'draft_document',
      shouldUpdateDocument: true,
      allowAutoRepair: false,
      shouldAsk: false,
    },
  },
  {
    name: 'existing document quick action enters repair mode',
    userMessage: 'Word formatına düzelt ve eksikleri tamamla',
    document: existingDocument,
    classification: {
      ...baseClassification,
      documentImpact: 'updates_document',
      shouldRunBaAgentLoop: true,
    },
    behaviorDecision: {
      ...baseBehavior,
      mode: 'chat_only',
      shouldAskQuestions: false,
      shouldUseAssumptions: true,
      shouldUpdateDocument: false,
    },
    cognitiveFrame: {
      ...baseFrame,
      action: 'chat_only',
      informationGaps: [],
    },
    expected: {
      action: 'repair_document',
      shouldUpdateDocument: true,
      allowAutoRepair: true,
      shouldAsk: false,
    },
  },
] as const;

for (const item of cases) {
  const decision = buildAiTurnDecision({
    userMessage: item.userMessage,
    document: item.document,
    classification: item.classification,
    behaviorDecision: item.behaviorDecision,
    cognitiveFrame: item.cognitiveFrame,
    sourceReport: baseSourceReport,
    discoverySignals: {},
  });

  const actual = {
    action: decision.action,
    shouldUpdateDocument: decision.documentPolicy.shouldUpdateDocument,
    allowAutoRepair: decision.documentPolicy.allowAutoRepair,
    shouldAsk: decision.questionPolicy.shouldAsk,
  };

  const expected = item.expected;
  const passed = actual.action === expected.action
    && actual.shouldUpdateDocument === expected.shouldUpdateDocument
    && actual.allowAutoRepair === expected.allowAutoRepair
    && actual.shouldAsk === expected.shouldAsk;

  if (!passed) {
    throw new Error(`${item.name} failed. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const sensitiveSourceReport = {
  ...baseSourceReport,
  confidence: 35,
  domainHints: ['kkb', 'findeks'],
  systems: ['SAP CRM', 'KKB Findeks'],
  integrations: ['Findeks API'],
} as any;

const sensitiveMessage = 'sap crm musteri verisi ile KKB Findeks API entegrasyonu kavramsal dokuman hazirla varsayimlarla ilerle';
const sensitiveDecision = buildAiTurnDecision({
  userMessage: sensitiveMessage,
  document: null,
  classification: {
    ...baseClassification,
    documentImpact: 'updates_document',
    shouldRunBaAgentLoop: true,
  },
  behaviorDecision: {
    ...baseBehavior,
    mode: 'draft_with_marked_assumptions',
    shouldAskQuestions: false,
    shouldUseAssumptions: true,
    shouldUpdateDocument: true,
    shouldUseResearch: true,
  },
  cognitiveFrame: {
    ...baseFrame,
    action: 'draft_with_assumptions',
    informationGaps: [],
  },
  sourceReport: sensitiveSourceReport,
  discoverySignals: {},
});

assert(sensitiveDecision.action === 'draft_document', 'Assumption consent should allow a sensitive draft');
assert(sensitiveDecision.sourcePolicy.officialSourceRequired, 'KKB/Findeks/API should require official source verification');
assert(!sensitiveDecision.sourcePolicy.canClaimVerified, 'Sensitive low-confidence draft should not allow broad DOGRULANDI claims');

const sensitiveProcessed = postProcessDocumentData({
  businessAnalysis: {
    content: '# KAVRAMSAL TASARIM RAPORU\n\n[DOGRULANDI] KKB Findeks API ile risk skoru sorgulanir.',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: 'Kaynak matrisi taslagi.',
    status: 'DRAFT',
    flags: [],
  },
}, null, {
  sourceText: sensitiveMessage,
  workspaceTitle: '',
  turnDecision: sensitiveDecision,
});

const sensitiveReview = sensitiveProcessed.document.review?.content || '';
assert(!/Evidence Policy Guard|OFFICIAL_EVIDENCE_REQUIRED/i.test(sensitiveReview), 'Post-processing must not inject evidence prose into Review');
assert((sensitiveProcessed.document.review?.flags || []).length === 0, 'Read-only quality assessment must not mutate Review flags');
assert(!(sensitiveProcessed.document.suggestions || []).some(item => /Resmi kaynak/i.test(item)), 'Read-only quality assessment must not inject quick actions');
assert(
  (sensitiveProcessed.document.qualityAssessment?.findings || []).some(item => item.category === 'source'),
  'Sensitive unsupported claims should be reported in qualityAssessment findings',
);

const gapDrivenQuestions = buildBaCognitiveQuestionItems({
  ...baseFrame,
  informationGaps: [
    {
      topic: 'Ana surec modeli ve baslangic sirasi',
      impact: 'high',
      reversibility: 'expensive',
      canAssume: false,
      proposedAssumption: 'Domain pratiklerine gore 3-5 sureclik taslak omurga olusturulur.',
      question: 'Ana surec hangi noktadan baslar ve hangi kosulda kapanir?',
      reason: 'Surec omurgasi yanlis kurulursa gereksinim, ekran, test ve entegrasyon da yanlis sekillenir.',
    },
    {
      topic: 'Basari KPI ve olcum formulleri',
      impact: 'high',
      reversibility: 'moderate',
      canAssume: true,
      proposedAssumption: 'SLA, hata orani ve is yuku azalimi aday KPI olarak yazilir.',
      question: 'Basari hangi metriklerle olculecek?',
      reason: 'KPI olmadan is degeri ve kabul netligi zayif kalir.',
    },
  ],
} as any, 3);

assert(gapDrivenQuestions.length === 2, 'Question engine should return the ranked gap questions');
assert(gapDrivenQuestions.every(question => question.options.length >= 2 && question.options.length <= 4), 'Every gap question should expose 2-4 quick answer options');
assert(/Neden önemli/i.test(gapDrivenQuestions[0].text), 'Question text should explain why the decision matters');
assert(gapDrivenQuestions[0].options.some(option => /sistem|api|operasyon|varsayim/i.test(option)), 'Process gap should expose concrete answer options');
assert(gapDrivenQuestions[1].options.some(option => /SLA|Hata|KPI/i.test(option)), 'KPI gap should expose metric-oriented options');

const pendingConfirmDecision = buildAiTurnDecision({
  userMessage: 'uygula',
  document: existingDocument,
  classification: baseClassification,
  behaviorDecision: baseBehavior,
  cognitiveFrame: baseFrame,
  sourceReport: baseSourceReport,
  discoverySignals: {},
  pendingOperation: { id: 'operation-1' },
  pendingOperationLookupPerformed: true,
});
assert(pendingConfirmDecision.action === 'execute_confirmed_change', 'Confirmation must execute only the stored pending operation');
assert(pendingConfirmDecision.documentPolicy.shouldUpdateDocument, 'Confirmed pending operation should update the document');

const pendingCancelDecision = buildAiTurnDecision({
  userMessage: 'iptal',
  document: existingDocument,
  classification: baseClassification,
  behaviorDecision: baseBehavior,
  cognitiveFrame: baseFrame,
  sourceReport: baseSourceReport,
  discoverySignals: {},
  pendingOperation: { id: 'operation-1' },
  pendingOperationLookupPerformed: true,
});
assert(pendingCancelDecision.action === 'cancel_pending_change', 'Cancellation must target the stored pending operation');

const missingPendingDecision = buildAiTurnDecision({
  userMessage: 'uygula',
  document: existingDocument,
  classification: baseClassification,
  behaviorDecision: baseBehavior,
  cognitiveFrame: baseFrame,
  sourceReport: baseSourceReport,
  discoverySignals: {},
  pendingOperation: null,
  pendingOperationLookupPerformed: true,
});
assert(missingPendingDecision.action === 'pending_operation_missing', 'Apply without a stored operation must not mutate the document');

console.log('AI turn decision verification passed.');
