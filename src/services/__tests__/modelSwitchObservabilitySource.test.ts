import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('model switch observability source contract', () => {
  it('marks within-provider final model changes in usage', () => {
    const source = readFileSync(new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url), 'utf8');
    expect(source).toContain('actualModel === requestedModel');
    expect(source).toContain('cost_guard_model_switch: 1');
    expect(source).toContain('cost_guard_provider_model_fallback: 1');
  });
});
