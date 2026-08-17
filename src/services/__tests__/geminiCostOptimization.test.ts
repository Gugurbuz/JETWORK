import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);

describe('Gemini cost optimization routing', () => {
  it('offloads non-final Gemini agent work to Flash-Lite while preserving the requested model for strong final synthesis', () => {
    expect(providerSource).toContain('const useCostGuardAgentModel = !requestedModelIsLite && (effectiveAllowTools || directLiteFinal)');
    expect(providerSource).toContain('const executionModel = useCostGuardAgentModel ? GEMINI_AGENT_MODEL : requestedModel');
    expect(providerSource).toContain('model: executionModel');
    expect(providerSource).toContain("'[JETWORK COST GUARD FINAL SYNTHESIS]'");
    expect(providerSource).toContain('model: requestedModel');
    expect(providerSource).toContain('cost_guard_final_synthesis_calls: 1');
  });

  it('caps enterprise knowledge loops at two rounds for normal work and three for high complexity', () => {
    expect(providerSource).toContain("const hardCap = plan?.complexity === 'high' ? 3 : 2");
    expect(providerSource).toContain('Math.min(plannedBudget, hardCap)');
    expect(providerSource).toContain('countExecutedKnowledgeToolCalls');
    expect(providerSource).toContain('cost_guard_knowledge_budget_exhausted');
  });

  it('does not let the knowledge budget disable procedural skill and artifact tools', () => {
    expect(providerSource).toContain("input.tools.filter(tool => !KNOWLEDGE_TOOL_NAMES.has(String(tool.name || '')))");
    expect(providerSource).toContain('const effectiveTools = directLiteFinal ? [] : budgetFilteredTools');
  });

  it('allows only low-complexity source-free simple answers to finish directly on the cheap model', () => {
    expect(providerSource).toContain("plan.intent === 'simple_answer'");
    expect(providerSource).toContain("plan.complexity === 'low'");
    expect(providerSource).toContain("plan.webMode === 'none'");
    expect(providerSource).toContain('plan.verificationRequired !== true');
    expect(providerSource).toContain('cost_guard_lite_direct_final_calls');
  });

  it('suppresses cheap-agent draft streaming before a strong final answer', () => {
    expect(providerSource).toContain('onText: useCostGuardAgentModel ? () => {} : input.onText');
    expect(providerSource).toContain('if (useCostGuardAgentModel && agentDraft) input.onText(agentDraft)');
  });
});
