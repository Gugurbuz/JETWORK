import { describe, expect, it } from 'vitest';
import { computeDiscoverySignals, detectSignals } from '../discoveryPolicy';

describe('discoveryPolicy', () => {
  it('does not treat a sparse project idea as consent to draft a document', () => {
    const result = computeDiscoverySignals('SAP CRM AI satis botu projesi', [], null);
    expect(result.mustGenerateNow).toBe(false);
    expect(result.greetingOnly).toBe(false);
  });

  it('honors explicit consent to continue with assumptions', () => {
    const result = detectSignals('Varsayimlarla ilerle, daha fazla soru sorma.');
    expect(result.forceGenerate).toBe(true);
    expect(result.stopQuestions).toBe(true);
  });

  it('keeps greetings out of discovery', () => {
    const result = computeDiscoverySignals('merhaba', [], null);
    expect(result.greetingOnly).toBe(true);
    expect(result.mustGenerateNow).toBe(false);
  });
});
