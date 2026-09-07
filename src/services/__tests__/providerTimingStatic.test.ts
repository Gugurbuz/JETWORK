import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Gemini provider TTFT telemetry', () => {
  it('persists first-text and total provider timing from the active GA Interactions stream', () => {
    const source = fs.readFileSync(path.resolve('supabase/functions/_shared/geminiInteractionsTransportGA.ts'), 'utf8');
    expect(source).toContain('gemini_provider_first_text_ms');
    expect(source).toContain('gemini_provider_total_ms');
    expect(source).toContain('gemini_previous_interaction_used');
    expect(source).toContain('gemini_interactions_ga_v1');
    expect(source).toContain('normalizeUsageWithTiming');
    expect(source).toContain('firstTextAt = performance.now()');
  });
});
