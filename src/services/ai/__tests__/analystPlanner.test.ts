import { describe, expect, it } from 'vitest';
import type { AiTurnDecision } from '../aiTurnDecision';
import { mapAnalystAction, planAnalystTurn } from '../analystPlanner';

const decision = (action: AiTurnDecision['action']): AiTurnDecision => ({
  action,
  artifactMode: 'none',
  artifactProfile: {
    id: 'none',
    label: 'Test',
    requiredSections: [],
    optionalSections: [],
    forbiddenSections: [],
    processModelPolicy: 'none',
    promptRules: [],
  },
  sourcePolicy: {
    requiresExternalResearch: false,
    officialSourceRequired: false,
    canClaimVerified: false,
    sourceSensitive: false,
  },
  questionPolicy: {
    shouldAsk: false,
    reason: 'test',
    maxQuestions: 0,
    questionType: 'none',
  },
  documentPolicy: {
    shouldUpdateDocument: false,
    templateProfile: 'none',
    allowAssumptions: false,
    allowAutoRepair: false,
    allowTemplateNormalization: false,
    forceDocumentGeneration: false,
    visibleSections: ['businessAnalysis', 'review'],
  },
  executionPolicy: {
    operation: 'none',
    targetSection: null,
    requiresConfirmation: false,
  },
  qualityPolicy: {
    minimumAcceptableScore: 0,
    blockOnContextLeakage: true,
    validationOnlyByDefault: true,
  },
  confidence: 1,
  reason: 'test',
  trace: [],
});

describe('AnalystPlanner action contract', () => {
  it('maps all execution paths into the five public analyst actions', () => {
    expect(mapAnalystAction(decision('ask_questions'), null)).toBe('ASK');
    expect(mapAnalystAction(decision('draft_document'), null)).toBe('CREATE_ARTIFACT');
    expect(mapAnalystAction(decision('draft_document'), {
      businessAnalysis: { content: 'x', status: 'DRAFT', flags: [] },
    })).toBe('UPDATE_ARTIFACT');
    expect(mapAnalystAction(decision('validate_document'), null)).toBe('REVIEW_ARTIFACT');
    expect(mapAnalystAction(decision('preview_change'), {
      businessAnalysis: { content: 'x', status: 'DRAFT', flags: [] },
    })).toBe('ASK');
    expect(mapAnalystAction(decision('answer_only'), null)).toBe('ANSWER');
  });

  it('maps a review-targeted write to the review artifact action', () => {
    const reviewWrite = decision('revise_document');
    reviewWrite.executionPolicy.targetSection = 'review';
    expect(mapAnalystAction(reviewWrite, {
      businessAnalysis: { content: 'x', status: 'DRAFT', flags: [] },
    })).toBe('REVIEW_ARTIFACT');
  });

  const plannerInput = (userMessage: string, overrides: Record<string, unknown> = {}) => ({
    userMessage,
    document: null,
    selectedText: null,
    selectedSection: null,
    model: 'test-model',
    recentMessages: [],
    recentConversationText: '',
    workspaceTitle: 'Test',
    knowledgeBase: [],
    projectMemory: {},
    discoveryReadiness: 0,
    discoverySignals: {
      mustGenerateNow: false,
      greetingOnly: false,
      newStandaloneRequest: false,
      isAnsweringDiscovery: false,
      reason: 'test',
    },
    zeroTouchEnabled: false,
    pendingOperation: null,
    pendingOperationLookupPerformed: false,
    ...overrides,
  });

  it('keeps an ordinary BA topic out of the document panel', async () => {
    const plan = await planAnalystTurn(plannerInput(
      'Yeni ekranda fonksiyonel gereksinimleri ve süreç akışını konuşalım',
    ));
    expect(['ANSWER', 'ASK']).toContain(plan.decision.action);
    expect(plan.legacyDecision.documentPolicy.shouldUpdateDocument).toBe(false);
  });

  it('uses the Enerjisa profile only after an explicit document request', async () => {
    const plan = await planAnalystTurn(plannerInput(
      'Bu bilgilerden iş analizi dokümanı oluştur',
      {
        knowledgeBase: [{
          id: 'k1',
          content: 'Amaç, roller, sistemler ve iş kuralları tanımlıdır.',
          keywords: ['amaç', 'roller'],
          importance: 1,
          createdAt: 1,
          projectId: 'p1',
        }],
      },
    ));
    expect(plan.decision.action).toBe('CREATE_ARTIFACT');
    expect(plan.legacyDecision.artifactProfile.id).toBe('enerjisa_business_analysis');
    expect(plan.legacyDecision.documentPolicy.shouldUpdateDocument).toBe(true);
  });

  it('routes BPMN requests to the exact BPMN profile', async () => {
    const plan = await planAnalystTurn(plannerInput(
      'Bu bilgilerle BPMN XML oluştur',
      {
        knowledgeBase: [{
          id: 'k1',
          content: 'Başlangıç, kontrol ve bitiş adımları tanımlıdır.',
          keywords: ['bpmn'],
          importance: 1,
          createdAt: 1,
          projectId: 'p1',
        }],
      },
    ));
    expect(plan.decision.action).toBe('CREATE_ARTIFACT');
    expect(plan.legacyDecision.artifactProfile.id).toBe('enerjisa_bpmn');
    expect(plan.legacyDecision.questionPolicy.maxQuestions).toBe(0);
  });
});
