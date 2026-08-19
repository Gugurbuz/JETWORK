import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Gemini provider TTFT telemetry', () => {
  it('persists first-text and total provider timing into usage', () => {
    const source = fs.readFileSync(path.resolve('supabase/functions/_shared/modelProviders.ts'), 'utf8');
    expect(source).toContain('gemini_provider_first_text_ms');
    expect(source).toContain('gemini_provider_total_ms');
    expect(source).toContain('requestTimedGeminiBase');
  });
});
