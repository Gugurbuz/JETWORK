import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
  semanticPlanFromMessage,
} from '../../../supabase/functions/_shared/reasoningEngine';
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator';
import { toolBudgetForPlan } from '../../../supabase/functions/_shared/geminiCostGuard';
import {
  executionModelForTrivialFastPathModel,
  providerForTrivialFastPathModel,
  shouldUseTrivialAssistantFastPath,
} from '../../../supabase/functions/_shared/trivialAssistantFastPath';

const embeddedPlan = (plan: Record<string, unknown>) => [
  'kts ne demek',
  '',
  SEMANTIC_PLAN_START,
  JSON.stringify({
    intent: 'simple_answer',
    complexity: 'medium',
    executionMode: 'direct',
    goal: 'kts ne demek',
    knowledgeRequired: true,
    webMode: 'none',
    verificationRequired: false,
    creativeMode: false,
    evidenceQueries: [],
    steps: [],
    orchestratorVersion: 'semantic-orchestrator-v3.2-cost-guard',
    ...plan,
  }),
  SEMANTIC_PLAN_END,
].join('\n');

describe('production regression: trivial latency and primary-agent evidence boundaries', () => {
  it('keeps legacy evidence-required simple plans compatible with old stored turns', () => {
    const plan = semanticPlanFromMessage(embeddedPlan({}));
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      intent: 'analysis',
      executionMode: 'knowledge',
      knowledgeRequired: true,
      complexity: 'medium',
    });
    expect(toolBudgetForPlan(plan)).toBe(1);
  });

  it('does not preflight enterprise evidence for a new exact technical turn on either provider', async () => {
    const openAi = await buildSemanticExecutionPlan({
      provider: 'openai', model: 'gpt-5.6-sol', message: 'ZCRM2-545 hangi koşulda alınır?', conversation: [],
    });
    const gemini = await buildSemanticExecutionPlan({
      provider: 'gemini', model: 'gemini-3.1-pro-preview', message: 'ZCRM2-545 hangi koşulda alınır?', conversation: [],
    });

    for (const result of [openAi, gemini]) {
      expect(result.plan.knowledgeRequired).toBe(true);
      expect(result.plan.enterpriseGroundingRequired).toBe(false);
      expect(result.plan.verificationRequired).toBe(false);
      expect(result.plan.evidenceQueries).toEqual([]);
      expect(result.usage?.semantic_planner_provider_calls_avoided).toBe(1);
    }
  });

  it('keeps ordinary no-evidence legacy simple answers direct and zero-tool', () => {
    const plan = semanticPlanFromMessage(embeddedPlan({
      goal: 'Merhaba de',
      knowledgeRequired: false,
    }));
    expect(plan).toMatchObject({
      intent: 'simple_answer',
      executionMode: 'direct',
      knowledgeRequired: false,
    });
    expect(toolBudgetForPlan(plan)).toBe(0);
  });

  it('keeps an exact greeting on the cheap path for auto model and ignores stale attachment count', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'selam',
      model: 'auto',
      attachmentCount: 2,
    })).toBe(true);
    expect(providerForTrivialFastPathModel('auto')).toBe('gemini');
    expect(executionModelForTrivialFastPathModel('auto')).toBe('gemini-3.1-flash-lite');
  });

  it('does not classify an actual technical question as a trivial greeting', () => {
    expect(shouldUseTrivialAssistantFastPath({
      message: 'kts ne demek',
      model: 'auto',
      attachmentCount: 0,
    })).toBe(false);
  });
});
