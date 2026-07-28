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

  it('treats a plain-text reply after a model question as discovery input', () => {
    const result = computeDiscoverySignals(
      '10.000 TL altını ekip lideri, üstünü finans yöneticisi onaylayacak.',
      [
        { id: 'u1', role: 'user', text: 'Bir onay akışı tasarlayalım.', createdAt: 1 },
        { id: 'm1', role: 'model', text: 'Onaylayan roller ve eşikler neler?', createdAt: 2 },
      ],
      null,
    );

    expect(result.isAnsweringDiscovery).toBe(true);
    expect(result.mustGenerateNow).toBe(true);
  });

  it('detaches an explicit new topic from the current artifact', () => {
    const result = computeDiscoverySignals(
      'Yeni konu: tedarikçi sözleşme yenileme sürecini analiz etmek istiyorum.',
      [],
      {
        businessAnalysis: { content: 'Eski iade süreci', status: 'DRAFT', flags: [] },
      },
    );

    expect(result.newStandaloneRequest).toBe(true);
    expect(result.mustGenerateNow).toBe(false);
  });
});
