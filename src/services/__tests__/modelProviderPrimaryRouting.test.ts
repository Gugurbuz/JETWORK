import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
);

describe('selected model provider routing', () => {
  it('uses OpenAI reasoning preflight only when the configured primary provider is OpenAI', () => {
    expect(coreSource).toContain("const modelReasoningUsesOpenAi = configuredProvider === 'openai'");
    expect(coreSource).toContain('apiKey: reasoningApiKey, model: reasoningModel, message,');
    expect(coreSource).toContain('apiKey: reasoningApiKey, model: reasoningModel, plan, evidence, signal: runController.signal,');
  });

  it('does not count intentional deterministic Gemini preflight as a provider fallback', () => {
    expect(coreSource).toContain('reasoningFallbackUsed ||= modelReasoningUsesOpenAi && planned.plannerFallback');
    expect(coreSource).toContain('reasoningFallbackUsed ||= modelReasoningUsesOpenAi && checked.verifierFallback');
    expect(coreSource).toContain('reasoningFallbackUsed ||= modelReasoningUsesOpenAi && rechecked.verifierFallback');
  });

  it('does not hard-wire OpenAI prompt model into planner or verifier calls', () => {
    expect(coreSource).not.toContain('apiKey: openAiApiKey || undefined, model: promptModel, message,');
    expect(coreSource).not.toContain('apiKey: openAiApiKey || undefined, model: promptModel, plan, evidence, signal: runController.signal,');
  });
});
