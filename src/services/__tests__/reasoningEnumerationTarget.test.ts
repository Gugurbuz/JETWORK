import { describe, expect, it } from 'vitest';
import { SEMANTIC_PLAN_END, SEMANTIC_PLAN_START, semanticPlanFromMessage } from '../../../supabase/functions/_shared/reasoningEngine';

describe('reasoning enumeration target', () => {
  it('preserves inventory target and rejected scopes through the core semantic-plan parser', () => {
    const payload = {
      intent: 'analysis', complexity: 'low', goal: 'class envanteri', knowledgeRequired: true,
      webMode: 'none', verificationRequired: false, creativeMode: false, evidenceQueries: [], steps: [],
      executionMode: 'knowledge',
      enumerationTarget: { tool: 'list_class_inventory', objectType: 'class', prefix: null, cursor: null },
      conversationState: {
        continuation: true, topic: 'class envanteri', userMove: 'correction', priorIntent: 'analysis',
        rejectedHypotheses: [], rejectedScopes: ['zcrmcost'], retainedContext: [], openQuestions: [],
      },
      orchestratorVersion: 'test',
    };
    const parsed = semanticPlanFromMessage(`x\n${SEMANTIC_PLAN_START}\n${JSON.stringify(payload)}\n${SEMANTIC_PLAN_END}`);
    expect(parsed?.enumerationTarget).toEqual(payload.enumerationTarget);
    expect(parsed?.conversationState?.rejectedScopes).toEqual(['zcrmcost']);
  });
});
