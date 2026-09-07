import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
);

const controllerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
  'utf8',
);

describe('Gemini provider-agnostic controller routing', () => {
  it('keeps the explicitly selected Gemini model for every provider call', () => {
    expect(providerSource).toContain('const requestedModel = normalizeGeminiRequestedModel(input.model)');
    expect(providerSource).toContain('model: requestedModel');
    expect(providerSource).toContain('assertExplicitGeminiModelPreserved(requestedModel, firstResponse.model)');
    expect(providerSource).not.toContain('model: GEMINI_AGENT_MODEL');
    expect(providerSource).not.toContain('buildGeminiFinalSynthesisItems');
  });

  it('compacts repeated agent context without changing the selected model', () => {
    expect(providerSource).toContain('compactResolvedConversationItems(sanitizeItems(input.items), contextSeed)');
    expect(providerSource).toContain('compactGeminiAgentItems(compactedProviderItems)');
    expect(providerSource).toContain('agent_controller_context_compacted_calls');
    expect(providerSource).toContain('agent_controller_context_items_before');
    expect(providerSource).toContain('agent_controller_context_items_after');
  });

  it('does not impose a semantic two-or-three-call enterprise knowledge cap', () => {
    expect(providerSource).toContain('countExecutedKnowledgeToolCalls');
    expect(providerSource).not.toContain("const hardCap = plan?.complexity === 'high' ? 3 : 2");
    expect(providerSource).not.toContain('Math.min(plannedBudget, hardCap)');
    expect(providerSource).not.toContain('cost_guard_knowledge_budget_exhausted');
    expect(providerSource).not.toContain('budgetFilteredTools');
  });

  it('keeps visible capabilities as controller options rather than deterministic routes', () => {
    expect(providerSource).toContain('const providerWebEnabled = input.allowProviderWeb ?? input.allowTools');
    expect(providerSource).toContain('tools: effectiveAllowTools ? input.tools : []');
    expect(providerSource).toContain('AGENT_CONTROLLER_INSTRUCTION');
    expect(controllerSource).toContain('capability ve tool yüzeyi seçeneklerdir')
    expect(controllerSource).toContain('hangi kaynağın kullanılacağına')
  });

  it('treats empty or insufficient observations as model-owned re-plan input, not deterministic stop signals', () => {
    expect(providerSource).not.toContain('MAX_EMPTY_KNOWLEDGE_SEARCHES');
    expect(providerSource).not.toContain('emptyKnowledgeSearches >= MAX_EMPTY_KNOWLEDGE_SEARCHES');
    expect(providerSource).not.toContain('gemini_empty_knowledge_forced_synthesis');
    expect(controllerSource).toContain('Her tool observationından sonra kullanıcı hedefini yeniden değerlendir')
    expect(controllerSource).toContain('yetersizse re-plan et')
  });

  it('does not use exact-identifier misses to bypass controller reasoning', () => {
    expect(providerSource).not.toContain('findEmptyExactIdentifierPair(input.items)');
    expect(providerSource).not.toContain('jetwork-exact-id-miss:');
    expect(providerSource).not.toContain('cost_guard_exact_identifier_early_stop');
    expect(providerSource).not.toContain('deterministic_provider_calls_avoided');
  });

  it('does not suppress web merely because one exact internal lookup missed', () => {
    expect(providerSource).not.toContain('cost_guard_provider_web_suppressed_after_exact_miss');
    expect(providerSource).toContain('agent_controller_provider_web_available');
  });
});
