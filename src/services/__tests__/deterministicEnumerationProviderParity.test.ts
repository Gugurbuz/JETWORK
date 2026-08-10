import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
);

describe('deterministic enumeration provider parity', () => {
  it('runs the enumeration invariant outside provider-specific branches', () => {
    const finalizerIndex = coreSource.indexOf('const deterministicEnumeration = buildDeterministicEnumerationFinalization');
    const geminiBranchIndex = coreSource.indexOf("if (activeProvider === 'gemini')");
    const openAiRequestIndex = coreSource.indexOf('return await requestOpenAiResponse');
    expect(finalizerIndex).toBeGreaterThan(0);
    expect(geminiBranchIndex).toBeGreaterThan(finalizerIndex);
    expect(openAiRequestIndex).toBeGreaterThan(finalizerIndex);
  });
});
