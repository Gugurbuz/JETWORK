import { describe, expect, it } from 'vitest';
import { detectDeterministicIntentProfile } from '../intentProfile';

describe('deterministic intent profile precedence', () => {
  it('does not reinterpret incidental open-topic language as a review artifact', () => {
    const profile = detectDeterministicIntentProfile({
      userMessage: [
        'KPI hedef degeri acik konu olarak kalsin.',
        'Kurumsal yapida kavramsal tasarim dokumani hazirla.',
      ].join('\n'),
      hasDocument: false,
    });

    expect(profile?.id).toBe('document_generation');
    expect(profile?.subIntent).toBe('generate_business_analysis');
    expect(profile?.baAgentFocus).toBe('business_analysis');
    expect(profile?.bypassModel).toBe(true);
  });
});
