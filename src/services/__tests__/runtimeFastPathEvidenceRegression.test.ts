import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_PLAN_END,
  SEMANTIC_PLAN_START,
  semanticPlanFromMessage,
} from '../../../supabase/functions/_shared/reasoningEngine';
import { applyAgentLoopPolicy } from '../../../supabase/functions/_shared/semanticOrchestrator';
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

describe('production regression: trivial latency and evidence-required short answers', () => {
  it('normalizes evidence-required simple answers into bounded knowledge analysis before Cost Guard budgeting', () => {
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

  it('keeps OpenAI bounded knowledge turns on deterministic core preflight evidence', () => {
    const plan = semanticPlanFromMessage(embeddedPlan({
      goal: 'ZCRM2-545 hangi koşulda alınır?',
      evidenceQueries: ['ZCRM2-545 hangi koşulda alınır?'],
      conversationState: {
        continuation: false,
        topic: 'ZCRM2-545',
        userMove: 'new_request',
        priorIntent: 'none',
        rejectedHypotheses: [],
        retainedContext: [],
        openQuestions: [],
        resolvedRequest: 'ZCRM2-545 hangi koşulda alınır?',
        activeEntities: ['ZCRM2-545'],
        requestedEvidence: ['trigger_rule'],
      },
    }));

    const openAiPlan = applyAgentLoopPolicy(plan!, 'openai');
    const geminiPlan = applyAgentLoopPolicy(plan!, 'gemini');

    expect(openAiPlan.evidenceQueries).toEqual(['ZCRM2-545 hangi koşulda alınır?']);
    expect(geminiPlan.evidenceQueries).toEqual([]);
  });

  it('keeps ordinary no-evidence simple answers direct and zero-tool', () => {
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