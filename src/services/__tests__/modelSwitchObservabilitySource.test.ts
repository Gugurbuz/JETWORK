import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('primary model observability source contract', () => {
  it('keeps the requested Gemini model as the tool-decision model and records primary-agent usage', () => {
    const source = readFileSync(new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url), 'utf8');
    expect(source).toContain('const requestedModel = normalizeGeminiRequestedModel(input.model)');
    expect(source).toContain('model: requestedModel');
    expect(source).toContain('primary_llm_agent_calls');
    expect(source).toContain('primary_llm_final_calls');
    expect(source).not.toContain('cost_guard_model_switch: 1');
    expect(source).not.toContain('cost_guard_provider_model_fallback: 1');
  });
});
