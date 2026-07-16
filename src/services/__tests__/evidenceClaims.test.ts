import { describe, expect, it } from 'vitest';
import { hasValidEvidenceLedger, validateEvidenceClaim } from '../evidenceClaims';

describe('evidence claims', () => {
  it('rejects VERIFIED without a complete source record', () => {
    const result = validateEvidenceClaim({
      claimId: 'CLM-001',
      claim: 'A legal requirement applies.',
      status: 'VERIFIED',
      confidence: 0.9,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/sourceUrl|sourceTitle|retrievedAt|evidenceExcerpt/);
  });

  it('accepts a complete VERIFIED claim', () => {
    const claim = {
      claimId: 'CLM-002',
      claim: 'The API supports the documented operation.',
      status: 'VERIFIED' as const,
      sourceUrl: 'https://example.com/reference',
      sourceTitle: 'Official reference',
      retrievedAt: '2026-07-16T12:00:00.000Z',
      evidenceExcerpt: 'The operation is listed in the API reference.',
      confidence: 0.95,
    };
    expect(validateEvidenceClaim(claim).valid).toBe(true);
    expect(hasValidEvidenceLedger([claim])).toBe(true);
  });
});
