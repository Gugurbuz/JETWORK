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
