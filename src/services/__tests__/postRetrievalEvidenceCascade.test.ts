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

  it('finalizes complete relation evidence without reopening the same tool loop', () => {
    expect(providerWrapperSource).toContain('finalizeFromEvidence: true');
    expect(providerWrapperSource).toContain('input.allowTools && !contract.finalizeFromEvidence');
    expect(providerWrapperSource).toContain('auto_runtime_evidence_finalized_without_more_tools = 1');
    expect(providerWrapperSource).toContain('do not call additional tools just to reconfirm the same identifiers');
  });

  it('places verified evidence before the real latest user request', () => {
    expect(providerWrapperSource).toContain('compactVerifiedEvidenceRecords');
    expect(providerWrapperSource).toContain('const evidenceItem = {');
    expect(providerWrapperSource).toContain("role: 'user'");
    expect(providerWrapperSource).toContain('[JETWORK_VERIFIED_KNOWLEDGE_EVIDENCE]');
    expect(providerWrapperSource).toContain('const userIndex = latestUserIndex(baseItems)');
    expect(providerWrapperSource).toContain('...baseItems.slice(0, userIndex)');
    expect(providerWrapperSource).toContain('evidenceItem');
    expect(providerWrapperSource).toContain('...baseItems.slice(userIndex)');
    expect(providerWrapperSource).toContain('The actual latest user message appears after the JETWORK_VERIFIED_KNOWLEDGE_EVIDENCE context block');
    expect(providerWrapperSource).toContain("!['function_call', 'function_call_output'].includes");
  });

  it('enforces a generic single-function relation response boundary', () => {
    expect(providerWrapperSource).toContain('shouldFocusSingleRelation');
    expect(providerWrapperSource).toContain('contract.expectedIdentifiers.length !== 1');
    expect(providerWrapperSource).toContain('FUNCTION_RELATION_INTENT.test(latestUserText)');
    expect(providerWrapperSource).toContain('focusSingleRelationText');
    expect(providerWrapperSource).toContain('sentences.find(sentence => sentence.toLocaleUpperCase');
    expect(providerWrapperSource).toContain('withResponseText');
    expect(providerWrapperSource).toContain('focusedFirstText');
  });

  it('keeps single-relation follow-ups concise instead of replaying prior enumerations', () => {
    expect(providerWrapperSource).toContain('answer that relation directly in at most two short sentences');
    expect(providerWrapperSource).toContain('do not repeat earlier enumerations, parameter lists, conditions');
  });

  it('validates evidence coverage after Flash and only then escalates to Pro with the same evidence packet', () => {
    expect(providerWrapperSource).toContain("const PRO_MODEL = 'gemini-3.1-pro-preview'");
    expect(providerWrapperSource).toContain('firstCoverage < expectedCount');
    expect(providerWrapperSource).toContain('effectiveModel === FLASH_MODEL');
    expect(providerWrapperSource).toContain('auto_runtime_flash_coverage_failed: 1');
    expect(providerWrapperSource).toContain('auto_runtime_escalated_pro: 1');
    expect(providerWrapperSource).toContain('callModel(PRO_MODEL, false, finalizationItems)');
  });

  it('does not use answer-text failure phrases as the escalation signal', () => {
    expect(providerWrapperSource).not.toContain("includes('bulamadım')");
    expect(providerWrapperSource).not.toContain("includes('bulamadim')");
    expect(providerWrapperSource).toContain('STRUCTURED_EVIDENCE_COVERAGE_CONTRACT');
    expect(providerWrapperSource).toContain('expectedIdentifiers');
  });

  it('drops stale state for self-contained identifiers and bounds contextual follow-ups to the latest technical anchor', () => {
    expect(providerWrapperSource).toContain('hygienicProviderItems');
    expect(providerWrapperSource).toContain('technicalIdentifiers(latestUserText)');
    expect(providerWrapperSource).toContain('return items.slice(index)');
    expect(providerWrapperSource).toContain('for (let previous = index - 1; previous >= 0; previous -= 1)');
    expect(providerWrapperSource).toContain('return items.slice(previous)');
    expect(providerWrapperSource).toContain('currentTurnItems');
  });
});