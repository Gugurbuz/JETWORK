import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Gemini answer provider resilience', () => {
  it('fails over from Pro after one transient attempt instead of exhausting retries first', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'");
    expect(source).toContain('GEMINI_PRO_ATTEMPT_TIMEOUT_MS = 10_000');
    expect(source).toContain('GEMINI_FALLBACK_ATTEMPT_TIMEOUT_MS = 18_000');
    expect(source).toContain('const maxAttempts = immediateFailoverCandidate ? 1');
    expect(source).toContain('switching immediately to same-provider stable Flash fallback');
    expect(source).toContain('retrying once with bounded backoff');
    expect(source).toContain('AbortError');
    expect(source).toContain('signal has been aborted');
    expect(source).toContain('if (input.signal?.aborted) throw error');
  });

  it('removes prior tool-call protocol items when Gemini must produce a final no-tool answer', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('compactNoToolSynthesisItems');
    expect(source).toContain("type === 'function_call' || type === 'function_call_output'");
    expect(source).toContain('input.allowTools');
    expect(source).toContain(': compactNoToolSynthesisItems(input.items)');
  });
});
