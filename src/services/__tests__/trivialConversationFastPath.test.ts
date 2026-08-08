import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);

describe('trivial conversation fast path', () => {
  it('recognizes only anchored conversational messages instead of broad short prompts', () => {
    expect(providerSource).toContain('TRIVIAL_CONVERSATION_PATTERN');
    expect(providerSource).toContain('isTrivialConversationalTurn');
    expect(providerSource).toContain('!input.allowTools && isTrivialConversationalTurn(input.items)');
    expect(providerSource).toMatch(/\^\(\?:selam/);
  });

  it('uses a compact prompt and output budget for trivial Gemini turns', () => {
    expect(providerSource).toContain('TRIVIAL_CONVERSATION_INSTRUCTIONS');
    expect(providerSource).toContain('compactConversationalItems(input.items)');
    expect(providerSource).toContain('Math.min(input.maxOutputTokens, 160)');
  });

  it('does not enable the fast path when tools are allowed', () => {
    expect(providerSource).toContain('const trivialConversation = !input.allowTools');
  });
});
