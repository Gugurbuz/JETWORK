import { describe, expect, it } from 'vitest';
import { buildAiTurnDecision } from '../aiTurnDecision';

const baseInput: any = {
  userMessage: 'uygula',
  document: {
    businessAnalysis: { content: 'Existing document', status: 'DRAFT', flags: [] },
  },
  classification: {
    primaryIntent: 'conversation',
    subIntent: 'ask_how_to',
    documentImpact: 'none',
    operation: 'none',
    riskLevel: 'low',
    requiresClarification: false,
    requiresPreview: false,
    requiresResearch: false,
    shouldRunBaAgentLoop: false,
    confidence: 0.9,
    reason: 'fixture',
  },
  behaviorDecision: {
    mode: 'chat_only',
    domain: 'generic_ba',
    shouldUpdateDocument: false,
    shouldUseResearch: false,
  },
  cognitiveFrame: {
    action: 'answer_only',
    artifactMode: 'conceptual_analysis',
    confidence: 90,
    informationGaps: [],
  },
  sourceReport: {
    confidence: 10,
    domainHints: [],
    systems: [],
    integrations: [],
    processes: [],
  },
  discoverySignals: {},
  pendingOperationLookupPerformed: true,
};

describe('AiTurnDecision pending operation routing', () => {
  it('executes only when a pending operation exists', () => {
    const decision = buildAiTurnDecision({ ...baseInput, pendingOperation: { id: 'op-1' } });
    expect(decision.action).toBe('execute_confirmed_change');
    expect(decision.documentPolicy.shouldUpdateDocument).toBe(true);
  });

  it('does not treat a bare apply command as a new document change', () => {
    const decision = buildAiTurnDecision({ ...baseInput, pendingOperation: null });
    expect(decision.action).toBe('pending_operation_missing');
    expect(decision.documentPolicy.shouldUpdateDocument).toBe(false);
  });
});

describe('AiTurnDecision artifact precedence', () => {
  it('keeps an explicit conceptual request in the corporate profile even if upstream focus drifted to review', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: [
        'Problem: Talepler farkli kanallarda izlenemiyor.',
        'KPI: Tamamlanma suresi olculecek; hedef deger acik konu.',
        'Kurumsal yapida kavramsal tasarim dokumani hazirla.',
      ].join('\n'),
      document: null,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'quality_review',
        subIntent: 'generate_review_report',
        documentImpact: 'updates_document',
        operation: 'replace_or_create_section',
        baAgentFocus: 'review',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'draft_with_assumptions',
        shouldUpdateDocument: true,
      },
      cognitiveFrame: {
        ...baseInput.cognitiveFrame,
        action: 'draft_now',
        artifactMode: 'conceptual_analysis',
      },
      sourceReport: {
        ...baseInput.sourceReport,
        processes: ['Talebin alinmasi', 'Uygunluk kontrolu'],
      },
    });

    expect(decision.action).toBe('draft_document');
    expect(decision.artifactMode).toBe('conceptual_analysis');
    expect(decision.artifactProfile.id).toBe('conceptual_design_process_heavy');
  });
});
