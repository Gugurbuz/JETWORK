import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GEMINI_AGENT_MODEL,
  GEMINI_SEMANTIC_MODEL,
  buildGeminiFinalSynthesisItems,
  compactGeminiAgentItems,
  normalizeGeminiRequestedModel,
  toolBudgetForPlan,
  usageWithGeminiEstimatedCost,
} from '../../../supabase/functions/_shared/geminiCostGuard';

const providerWrapperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);
const semanticSource = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
);
const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
);
const settingsStoreSource = readFileSync(
  new URL('../../store/useSettingsStore.ts', import.meta.url),
  'utf8',
);
const liveCanaryWorkflow = readFileSync(
  new URL('../../../.github/workflows/reasoning-live-canary.yml', import.meta.url),
  'utf8',
);

describe('Gemini Cost Guard v1', () => {
  it('uses stable low-cost models for semantic planning and agent tool decisions', () => {
    expect(GEMINI_SEMANTIC_MODEL).toBe('gemini-3.1-flash-lite');
    expect(GEMINI_AGENT_MODEL).toBe('gemini-3.5-flash-lite');
    expect(normalizeGeminiRequestedModel('gemini-3.1-flash-lite-preview')).toBe('gemini-3.1-flash-lite');
    expect(settingsStoreSource).not.toContain('model === FLASH_LITE_MODEL ? GEMINI_PRO_MODEL');
    expect(settingsStoreSource).toContain("STABLE_FLASH_LITE_MODEL = 'gemini-3.5-flash-lite'");
  });

  it('forces bounded knowledge turns out of the repeated model-agent loop', () => {
    const base = {
      complexity: 'medium',
      knowledgeRequired: true,
      webMode: 'none',
      verificationRequired: false,
    } as any;
    expect(toolBudgetForPlan({ ...base, intent: 'sap_diagnosis' })).toBe(4);
    expect(toolBudgetForPlan({ ...base, intent: 'analysis' })).toBe(1);
    expect(toolBudgetForPlan({ ...base, intent: 'document' })).toBe(2);
    expect(toolBudgetForPlan({ ...base, complexity: 'high', intent: 'research' })).toBe(5);
    expect(toolBudgetForPlan({ ...base, intent: 'simple_answer', knowledgeRequired: false })).toBe(0);
    expect(providerWrapperSource).toContain('deterministic_knowledge_dispatch');
    expect(providerWrapperSource).toContain("toolName: 'search_knowledge_catalog'");
    expect(providerWrapperSource).toContain("toolName: 'get_abap_source'");
    expect(providerWrapperSource).toContain('executedTools >= toolBudget');
    expect(providerWrapperSource).toContain('cost_guard_forced_synthesis');
  });

  it('compacts repeated tool evidence before each cheap agent decision and final synthesis', () => {
    const hugeEvidence = 'E'.repeat(20_000);
    const items: Array<Record<string, unknown>> = [
      { role: 'user', content: 'Teklife cost eklerken uyumsuz hatası aldım.' },
      { type: 'function_call', call_id: 'c1', name: 'knowledge_search', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: hugeEvidence },
      { type: 'function_call', call_id: 'c2', name: 'knowledge_detail', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c2', output: hugeEvidence },
    ];

    const agentItems = compactGeminiAgentItems(items);
    const compactedOutputs = agentItems
      .filter(item => 'type' in item && item.type === 'function_call_output')
      .map(item => String('output' in item ? item.output || '' : ''));
    expect(compactedOutputs).toHaveLength(2);
    expect(Math.max(...compactedOutputs.map(value => value.length))).toBeLessThanOrEqual(4_500);

    const finalItems = buildGeminiFinalSynthesisItems(items, 'taslak');
    const finalPayload = JSON.stringify(finalItems);
    expect(finalPayload).toContain('[JETWORK_TOOL_EVIDENCE]');
    expect(finalPayload.length).toBeLessThan(24_000);
  });

  it('records a conservative Gemini cost estimate in usage metadata', () => {
    const usage = usageWithGeminiEstimatedCost('gemini-3.5-flash-lite', {
      input_tokens: 10_000,
      output_tokens: 1_000,
      reasoning_tokens: 0,
      total_tokens: 11_000,
    });
    expect(usage?.estimated_cost_usd).toBeCloseTo(0.0055, 6);
  });

  it('records agent and final usage separately for cost observability', () => {
    expect(providerWrapperSource).toContain('cost_guard_${stage}_input_tokens');
    expect(providerWrapperSource).toContain('cost_guard_${stage}_output_tokens');
    expect(providerWrapperSource).toContain('cost_guard_${stage}_reasoning_tokens');
    expect(providerWrapperSource).toContain('cost_guard_${stage}_estimated_cost_usd');
    expect(providerWrapperSource).toContain("stage: 'agent' | 'final'");
  });

  it('keeps strong synthesis separate from cheap agent calls', () => {
    expect(providerWrapperSource).toContain('model: GEMINI_AGENT_MODEL');
    expect(providerWrapperSource).toContain('buildGeminiFinalSynthesisItems');
    expect(providerWrapperSource).toContain('cost_guard_agent_calls');
    expect(providerWrapperSource).toContain('cost_guard_final_calls');
    expect(providerWrapperSource).toContain('maxOutputTokens: Math.min(input.maxOutputTokens, 900)');
  });

  it('keeps Auto on the fallback provider instead of retrying the failed provider in core', () => {
    expect(gatewaySource).toContain("DEFAULT_GEMINI_RUNTIME_MODEL = 'gemini-3.5-flash'");
    expect(gatewaySource).toContain('preferGeminiAuto');
    expect(gatewaySource).toContain('AUTO_PROVIDER_CIRCUIT_BREAKER_MS');
    expect(gatewaySource).toContain("requestedModel === 'auto' && semantic.provider === 'gemini'");
    expect(gatewaySource).toContain('? DEFAULT_GEMINI_RUNTIME_MODEL');
  });

  it('moves semantic orchestration to stable Flash-Lite with minimal thinking and a bounded structured output budget', () => {
    expect(semanticSource).toContain("GEMINI_SEMANTIC_MODEL, usageWithGeminiEstimatedCost");
    expect(semanticSource).toContain('maxOutputTokens: 1_400');
    expect(semanticSource).toContain("thinkingConfig: { thinkingLevel: 'minimal' }");
    expect(semanticSource).toContain('SEMANTIC_RETRY_DELAYS_MS = [250]');
  });

  it('never runs the paid production continuity canary automatically', () => {
    expect(liveCanaryWorkflow).toContain('workflow_dispatch:');
    expect(liveCanaryWorkflow).not.toContain('\n  push:');
  });
});