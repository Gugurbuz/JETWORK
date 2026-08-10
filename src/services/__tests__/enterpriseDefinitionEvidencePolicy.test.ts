import { describe, expect, it } from 'vitest';
import { applyConversationScopeInventoryPolicy } from '../../../supabase/functions/_shared/conversationScopePolicy';
import type { ReasoningPlan } from '../../../supabase/functions/_shared/reasoningEngine';

const directPlan = (): ReasoningPlan => ({
  intent: 'simple_answer',
  complexity: 'medium',
  executionMode: 'direct',
  goal: 'kts ne demek',
  knowledgeRequired: false,
  webMode: 'none',
  verificationRequired: false,
  creativeMode: false,
  evidenceQueries: [],
  steps: [],
  conversationState: {
    continuation: false,
    topic: 'kts',
    userMove: 'new_request',
    priorIntent: 'none',
    rejectedHypotheses: [],
    rejectedScopes: [],
    retainedContext: [],
    openQuestions: [],
  },
  orchestratorVersion: 'test',
});

describe('enterprise definition evidence policy', () => {
  it('forces a short acronym definition through knowledge and verification', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: directPlan(),
      currentMessage: 'kts ne demek',
      conversation: [],
    });

    expect(plan).toMatchObject({
      intent: 'analysis',
      complexity: 'low',
      executionMode: 'knowledge',
      knowledgeRequired: true,
      verificationRequired: true,
      webMode: 'none',
    });
    expect(plan.evidenceQueries[0]).toBe('kts');
    expect(plan.goal).toContain('kurumsal açılım uydurma');
    expect(plan.steps.map(step => step.toolHint)).toEqual(['knowledge', 'verification', 'synthesis']);
  });

  it('does not change an ordinary self-contained simple question', () => {
    const plan = applyConversationScopeInventoryPolicy({
      plan: directPlan(),
      currentMessage: 'iki artı iki kaç',
      conversation: [],
    });

    expect(plan).toMatchObject({
      intent: 'simple_answer',
      executionMode: 'direct',
      knowledgeRequired: false,
      verificationRequired: false,
    });
  });
});
