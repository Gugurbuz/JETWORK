import { describe, expect, it } from 'vitest';
import { deriveProcessCandidates, expectedProcessCountFromSignals } from '../sourceDrivenInference';

describe('sourceDrivenInference', () => {
  it('does not fabricate process blocks from systems or integrations', () => {
    const input = { systems: ['CRM'], integrations: ['External API'], roles: ['Operations'] };
    expect(expectedProcessCountFromSignals(input)).toBe(0);
    expect(deriveProcessCandidates(input)).toEqual([]);
  });

  it('preserves only explicitly supplied process titles', () => {
    expect(deriveProcessCandidates({
      processes: ['Request intake', 'Approval'],
      systems: ['CRM'],
    })).toEqual(['Request intake', 'Approval']);
  });
});
