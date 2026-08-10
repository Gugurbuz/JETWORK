import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
);

describe('reasoning core deterministic enumeration wiring', () => {
  it('checks deterministic enumeration before invoking either provider', () => {
    const finalizerIndex = coreSource.indexOf('buildDeterministicEnumerationFinalization(runItems');
    const providerIndex = coreSource.indexOf('const requestActiveProvider = async () =>');
    expect(finalizerIndex).toBeGreaterThan(0);
    expect(providerIndex).toBeGreaterThan(finalizerIndex);
  });

  it('persists and streams deterministic results without another provider synthesis call', () => {
    expect(coreSource).toContain('deterministic_enumeration_finalized: 1');
    expect(coreSource).toContain('p_response_text: deterministicText');
    expect(coreSource).toContain("sendEvent(controller, encoder, 'text_delta', { type: 'text_delta', delta: deterministicText })");
    expect(coreSource).toContain('deterministicEnumeration: true');
  });

  it('records enumeration completeness in reasoning observability', () => {
    expect(coreSource).toContain('totalCount: deterministicEnumeration.totalCount');
    expect(coreSource).toContain('collectedCount: deterministicEnumeration.collectedCount');
    expect(coreSource).toContain('pageCount: deterministicEnumeration.pageCount');
    expect(coreSource).toContain('complete: deterministicEnumeration.complete');
  });
});
