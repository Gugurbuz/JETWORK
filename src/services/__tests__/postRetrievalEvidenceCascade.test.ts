import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const providerWrapperSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProvidersAuthoritativeTerminal.ts', import.meta.url),
  'utf8',
);

describe('post-retrieval evidence cascade', () => {
  it('keeps exact single-record lookups Lite-capable and escalates multi-record enumerations to Flash', () => {
    expect(providerWrapperSource).toContain("const LITE_MODEL = 'gemini-3.5-flash-lite'");
    expect(providerWrapperSource).toContain("const FLASH_MODEL = 'gemini-3.5-flash'");
    expect(providerWrapperSource).toContain('input.model === LITE_MODEL && contract.needsFlash');
    expect(providerWrapperSource).toContain('auto_runtime_escalated_flash = 1');
    expect(providerWrapperSource).toContain('messageIdentifiers.length > 1');
  });

  it('validates evidence coverage after Flash and only then escalates to Pro', () => {
    expect(providerWrapperSource).toContain("const PRO_MODEL = 'gemini-3.1-pro-preview'");
    expect(providerWrapperSource).toContain('firstCoverage < expectedCount');
    expect(providerWrapperSource).toContain('effectiveModel === FLASH_MODEL');
    expect(providerWrapperSource).toContain('auto_runtime_flash_coverage_failed: 1');
    expect(providerWrapperSource).toContain('auto_runtime_escalated_pro: 1');
  });

  it('does not use answer-text failure phrases as the escalation signal', () => {
    expect(providerWrapperSource).not.toContain("includes('bulamadım')");
    expect(providerWrapperSource).not.toContain("includes('bulamadim')");
    expect(providerWrapperSource).toContain('STRUCTURED_EVIDENCE_COVERAGE_CONTRACT');
    expect(providerWrapperSource).toContain('expectedIdentifiers');
  });

  it('drops stale prior turn state for self-contained exact-identifier requests', () => {
    expect(providerWrapperSource).toContain('hygienicProviderItems');
    expect(providerWrapperSource).toContain('technicalIdentifiers(latestUserText)');
    expect(providerWrapperSource).toContain('return items.slice(index)');
    expect(providerWrapperSource).toContain('currentTurnItems');
  });
});
