import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Gemini answer provider resilience', () => {
  it('keeps explicit Pro bounded on Pro while preserving task-sensitive Flash timeouts', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain("export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'");
    expect(source).toContain('GEMINI_PRO_ATTEMPT_TIMEOUT_MS = 45_000');
    expect(source).toContain('GEMINI_TOOL_ATTEMPT_TIMEOUT_MS = 18_000');
    expect(source).toContain('GEMINI_FINAL_SYNTHESIS_TIMEOUT_MS = 45_000');
    expect(source).toContain('artifactSynthesis: boolean');
    expect(source).toContain("input.instructions.includes('Intent: document')");
    expect(source).toContain("input.instructions.includes('[JETWORK PROMPT PROFILE: artifact]')");
    expect(source).toContain('const maxAttempts = input.artifactSynthesis ? 1');
    expect(source).toContain('input.finalSynthesis || input.artifactSynthesis');
    expect(source).toContain('if (isExplicitPro && isGeminiAttemptTimeout(error))');
    expect(source).toContain('if (executionModel === GEMINI_SUBSTANTIVE_MODEL) throw error');
    expect(source).not.toContain('switching immediately to same-provider stable Flash fallback');
    expect(source).toContain('retrying the same selected model once with bounded backoff');
    expect(source).toContain('AbortError');
    expect(source).toContain('signal has been aborted');
    expect(source).toContain('if (input.signal?.aborted || streamedTextBeforeError(error)) throw error');
    expect(source).toContain('const finalSynthesis = !input.allowTools && !trivialConversation');
    expect(source).toContain("config.thinkingConfig = { thinkingLevel: 'minimal' }");
    expect(source).toContain("config.thinkingConfig = { thinkingLevel: 'low' }");
  });

  it('recovers a final answer from completed tool evidence after transient Gemini tool-loop failure', () => {
    const source = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('compactToolRecoveryItems');
    expect(source).toContain('[JETWORK_TOOL_EVIDENCE]');
    expect(source).toContain('slice(0, 14_000)');
    expect(source).toContain('Gemini tool loop exhausted transient retries; forcing one bounded no-tool recovery synthesis');
    expect(source).toContain('delete recoveryConfig.tools');
    expect(source).toContain('delete recoveryConfig.toolConfig');
    expect(source).toContain('timeoutMs: GEMINI_FINAL_SYNTHESIS_TIMEOUT_MS');
    expect(source).toContain('contents: toGeminiContents(compactToolRecoveryItems(input.items))');
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