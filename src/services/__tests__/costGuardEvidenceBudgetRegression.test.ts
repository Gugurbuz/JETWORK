import { describe, expect, it } from 'vitest';
import { toolBudgetForPlan } from '../../../supabase/functions/_shared/geminiCostGuard';

describe('Cost Guard evidence budget invariant', () => {
  it('never gives a zero tool budget to a short answer that requires corporate evidence', () => {
    const budget = toolBudgetForPlan({
      intent: 'simple_answer',
      complexity: 'medium',
      knowledgeRequired: true,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      goal: 'kts ne demek',
      evidenceQueries: [],
      steps: [],
    } as any);
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBe(1);
  });

  it('keeps genuinely evidence-free short answers at zero tools', () => {
    expect(toolBudgetForPlan({
      intent: 'simple_answer',
      complexity: 'low',
      knowledgeRequired: false,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      goal: 'selam',
      evidenceQueries: [],
      steps: [],
    } as any)).toBe(0);
  });
});