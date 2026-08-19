import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
);
const providerLegacySource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
  'utf8',
);
const providerImplementationSource = `${providerSource}\n${providerLegacySource}`;

describe('trivial conversation fast path', () => {
  it('recognizes only anchored conversational messages instead of broad short prompts', () => {
    expect(providerImplementationSource).toContain('TRIVIAL_CONVERSATION_PATTERN');
    expect(providerImplementationSource).toContain('isTrivialConversationalTurn');
    expect(providerImplementationSource).toContain('!input.allowTools && isTrivialConversationalTurn(input.items)');
    expect(providerImplementationSource).toMatch(/\^\(\?:selam/);
  });

  it('uses a compact prompt and output budget for trivial Gemini turns', () => {
    expect(providerImplementationSource).toContain('TRIVIAL_CONVERSATION_INSTRUCTIONS');
    expect(providerImplementationSource).toContain('compactConversationalItems(input.items)');
    expect(providerImplementationSource).toContain('Math.min(input.maxOutputTokens, 160)');
  });

  it('does not enable the fast path when tools are allowed', () => {
    expect(providerImplementationSource).toContain('const trivialConversation = !input.allowTools');
  });
});