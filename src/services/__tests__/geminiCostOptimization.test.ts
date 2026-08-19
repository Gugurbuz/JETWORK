import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
);

describe('Gemini cost optimization routing', () => {
  it('keeps the explicitly selected Gemini model for every provider call', () => {
    expect(providerSource).toContain('const requestedModel = normalizeGeminiRequestedModel(input.model)');
    expect(providerSource).toContain('model: requestedModel');
    expect(providerSource).toContain('assertExplicitGeminiModelPreserved(requestedModel, firstResponse.model)');
    expect(providerSource).not.toContain('model: GEMINI_AGENT_MODEL');
    expect(providerSource).not.toContain('buildGeminiFinalSynthesisItems');
  });

  it('compacts repeated agent context without changing the selected model', () => {
    expect(providerSource).toContain('compactGeminiAgentItems(sanitizeItems(input.items))');
    expect(providerSource).toContain('cost_guard_context_compacted_calls');
  });

  it('caps enterprise knowledge loops at two rounds for normal work and three for high complexity', () => {
    expect(providerSource).toContain("const hardCap = plan?.complexity === 'high' ? 3 : 2");
    expect(providerSource).toContain('Math.min(plannedBudget, hardCap)');
    expect(providerSource).toContain('countExecutedKnowledgeToolCalls');
    expect(providerSource).toContain('cost_guard_knowledge_budget_exhausted');
  });

  it('does not let the knowledge budget disable procedural skill and artifact tools', () => {
    expect(providerSource).toContain("input.tools.filter(tool => !KNOWLEDGE_TOOL_NAMES.has(String(tool.name || '')))");
    expect(providerSource).toContain('tools: effectiveAllowTools ? budgetFilteredTools : []');
  });

  it('stops repeated empty knowledge search after two misses', () => {
    expect(providerSource).toContain('MAX_EMPTY_KNOWLEDGE_SEARCHES = 2');
    expect(providerSource).toContain('emptyKnowledgeSearches >= MAX_EMPTY_KNOWLEDGE_SEARCHES');
    expect(providerSource).toContain('gemini_empty_knowledge_forced_synthesis');
  });

  it('stops an exact message identifier miss before a third provider call', () => {
    expect(providerSource).toContain('findEmptyExactIdentifierPair(input.items)');
    expect(providerSource).toContain('hasEmptyMessageDetailLookup(input.items)');
    expect(providerSource).toContain('jetwork-exact-id-miss:');
    expect(providerSource).toContain('cost_guard_exact_identifier_early_stop');
    expect(providerSource).toContain('deterministic_provider_calls_avoided');
  });

  it('suppresses provider web after an exact message lookup miss unless web was explicitly requested', () => {
    expect(providerSource).toContain("|| (!emptyMessageDetailLookup && (input.allowProviderWeb ?? input.allowTools))");
    expect(providerSource).toContain('cost_guard_provider_web_suppressed_after_exact_miss');
  });
});
