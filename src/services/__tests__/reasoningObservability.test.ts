import { describe, expect, it } from 'vitest';
import { formatLatency, providerLabel, totalUsageTokens } from '../reasoningObservability';

describe('reasoning observability helpers', () => {
  it('normalizes token usage across OpenAI and Gemini shapes', () => {
    expect(totalUsageTokens({ total_tokens: 321 })).toBe(321);
    expect(totalUsageTokens({ input_tokens: 120, output_tokens: 45 })).toBe(165);
    expect(totalUsageTokens({ promptTokenCount: 80, candidatesTokenCount: 20 })).toBe(100);
    expect(totalUsageTokens({})).toBeUndefined();
  });

  it('formats runtime latency without pretending missing data exists', () => {
    expect(formatLatency(undefined)).toBe('—');
    expect(formatLatency(840)).toBe('840 ms');
    expect(formatLatency(2_340)).toBe('2.3 sn');
    expect(formatLatency(14_200)).toBe('14 sn');
  });

  it('derives provider labels from provider or model without exposing hidden reasoning', () => {
    expect(providerLabel('openai', 'gpt-5.6-sol')).toBe('OpenAI');
    expect(providerLabel(undefined, 'gemini-3.1-pro-preview')).toBe('Gemini');
    expect(providerLabel(undefined, undefined)).toBe('—');
  });
});
