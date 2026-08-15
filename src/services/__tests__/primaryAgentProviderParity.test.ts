import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrapper = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
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
  it('routes Gemini web research through native Google Search without OpenAI preflight semantics', () => {
    expect(semantic).toContain("const providerNativeWeb = provider === 'gemini' && inputPlan.webMode !== 'none'");
    expect(semantic).toContain("webMode: providerNativeWeb ? 'none' : inputPlan.webMode");
    expect(scopePolicy).toContain('const providerNativeWeb = explicitWebResearch && plan.goal.includes(PROVIDER_WEB_CAPABILITY_MARKER)');
    expect(scopePolicy).toContain("plan.webMode = explicitWebResearch ? (providerNativeWeb ? 'none' : 'required') : 'none'");
    expect(reasoning).toContain("const webMode: WebMode = providerWebMarker ? 'none' : rawWebMode");
    expect(reasoning).not.toContain("currentRoute.webMode !== 'none' ? currentRoute.webMode : 'required'");
  });

  it('keeps Gemini native web available after empty knowledge searches', () => {
    expect(wrapper).toContain("const providerNativeWebRequested = String(plan?.goal || '').includes(PROVIDER_WEB_CAPABILITY_MARKER)");
    expect(wrapper).toContain('&& !providerNativeWebRequested');
    expect(wrapper).toContain('const providerWebEnabled = providerNativeWebRequested || (input.allowProviderWeb ?? input.allowTools)');
    expect(legacy).toContain('googleSearch: {}');
    expect(legacy).toContain("providerWebEnabled ? 'VALIDATED' : 'AUTO'");
  });

  it('does not silently promote a selected Gemini model before the primary tool loop', () => {
    expect(legacy).toContain('const executionModel = input.model');
    expect(legacy).not.toContain('input.model === GEMINI_FLASH_LITE_MODEL ? GEMINI_SUBSTANTIVE_MODEL');
    expect(wrapper).toContain('model: requestedModel');
  });
});