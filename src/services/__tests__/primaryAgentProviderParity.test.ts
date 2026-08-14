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

describe('primary-agent provider parity', () => {
  it('exposes Gemini native web only when provider web capability is enabled', () => {
    expect(wrapper).toContain("PROVIDER_WEB_CAPABILITY_MARKER = '[JETWORK_CAPABILITY:provider_web]'");
    expect(wrapper).toContain('allowProviderWeb?: boolean');
    expect(wrapper).toContain('const providerWebEnabled = input.allowProviderWeb ?? input.allowTools');
    expect(wrapper).toContain('providerWebEnabled ? PROVIDER_WEB_CAPABILITY_MARKER');
    expect(legacy).toContain('googleSearch: {}');
    expect(legacy).toContain("providerWebEnabled ? 'VALIDATED' : 'AUTO'");
  });

  it('does not silently promote a selected Gemini model before the primary tool loop', () => {
    expect(legacy).toContain('const executionModel = input.model');
    expect(legacy).not.toContain('input.model === GEMINI_FLASH_LITE_MODEL ? GEMINI_SUBSTANTIVE_MODEL');
    expect(wrapper).toContain('model: requestedModel');
  });
});
