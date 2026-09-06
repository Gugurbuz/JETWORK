import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrapper = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersBase.ts', import.meta.url),
  'utf8',
);
const provider = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);
const interactions = readFileSync(
  new URL('../../../supabase/functions/_shared/geminiInteractionsAgent.ts', import.meta.url),
  'utf8',
);
const legacy = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersLegacy.ts', import.meta.url),
  'utf8',
);
const semantic = readFileSync(
  new URL('../../../supabase/functions/_shared/semanticOrchestrator.ts', import.meta.url),
  'utf8',
);
const scopePolicy = readFileSync(
  new URL('../../../supabase/functions/_shared/conversationScopePolicy.ts', import.meta.url),
  'utf8',
);
const reasoning = readFileSync(
  new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url),
  'utf8',
);

describe('primary-agent provider parity', () => {
  it('keeps legacy semantic web planning isolated from the active agentic controller path', () => {
    expect(semantic).toContain("const providerNativeWeb = provider === 'gemini' && inputPlan.webMode !== 'none'");
    expect(scopePolicy).toContain('PROVIDER_WEB_CAPABILITY_MARKER');
    expect(reasoning).toContain('PROVIDER_WEB_CAPABILITY_MARKER');
  });

  it('lets the active Gemini controller select provider-native Google Search through Interactions without deterministic pre-execution', () => {
    expect(provider).not.toContain("import { runDeterministicGeminiWebResearch");
    expect(provider).not.toContain("plan?.intent === 'research' && providerWebRequested");
    expect(provider).toContain('requestGeminiInteractionsResponse');
    expect(interactions).toContain("{ type: 'google_search', search_types: ['web_search'] }");
    expect(interactions).toContain("tool_choice: 'validated'");
    expect(interactions).toContain('stream: true');
    expect(wrapper).toContain('const providerWebEnabled = input.allowProviderWeb ?? input.allowTools');
  });

  it('does not silently promote a selected Gemini model before the primary tool loop', () => {
    expect(legacy).toContain('const executionModel = input.model');
    expect(legacy).not.toContain('input.model === GEMINI_FLASH_LITE_MODEL ? GEMINI_SUBSTANTIVE_MODEL');
    expect(wrapper).toContain('model: requestedModel');
    expect(provider).toContain("PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash'");
  });
});
