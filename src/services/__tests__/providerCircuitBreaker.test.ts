import { describe, expect, it, vi } from 'vitest';
import {
  classifyOpenAiFailure,
  createOpenAiCircuitBreaker,
} from '../../../supabase/functions/_shared/providerCircuitBreaker';

describe('OpenAI provider circuit breaker', () => {
  it('classifies quota and billing failures as a long-lived provider outage', () => {
    expect(classifyOpenAiFailure(429, 'You exceeded your current quota: insufficient_quota')).toMatchObject({
      category: 'quota_or_billing',
      cooldownMs: 300_000,
    });
    expect(classifyOpenAiFailure(401, 'Incorrect API key')).toMatchObject({
      category: 'auth',
      cooldownMs: 300_000,
    });
    expect(classifyOpenAiFailure(429, 'Rate limit reached')).toMatchObject({
      category: 'rate_limit',
      cooldownMs: 30_000,
    });
  });

  it('fails fast on repeated OpenAI calls while allowing other providers through', async () => {
    let now = 1_000;
    const baseFetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api.openai.com')) {
        return new Response(JSON.stringify({
          error: { message: 'insufficient_quota: no credits remaining' },
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('ok', { status: 200 });
    });
    const breaker = createOpenAiCircuitBreaker(baseFetch as typeof fetch, {
      now: () => now,
      quotaCooldownMs: 60_000,
    });

    const first = await breaker.fetch('https://api.openai.com/v1/responses');
    expect(first.status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(breaker.getState()).toMatchObject({
      reason: 'quota_or_billing',
      blockedUntil: 61_000,
    });

    const second = await breaker.fetch('https://api.openai.com/v1/responses');
    expect(second.status).toBe(429);
    expect(await second.text()).toContain('provider circuit open: quota_or_billing');
    expect(baseFetch).toHaveBeenCalledTimes(1);

    const gemini = await breaker.fetch('https://generativelanguage.googleapis.com/v1beta/models');
    expect(gemini.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);

    now = 61_001;
    const afterCooldown = await breaker.fetch('https://api.openai.com/v1/responses');
    expect(afterCooldown.status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(3);
  });

  it('does not poison provider health when the caller aborts the request', async () => {
    const baseFetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const breaker = createOpenAiCircuitBreaker(baseFetch as typeof fetch);

    await expect(breaker.fetch('https://api.openai.com/v1/responses')).rejects.toThrow(/aborted/i);
    expect(breaker.getState()).toEqual({ blockedUntil: 0, reason: null });
  });

  it('bounds a hanging OpenAI attempt without poisoning provider health', async () => {
    vi.useFakeTimers();
    try {
      const baseFetch = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      const breaker = createOpenAiCircuitBreaker(baseFetch as typeof fetch, { requestTimeoutMs: 2_000 });

      const rejection = breaker.fetch('https://api.openai.com/v1/responses').catch(error => error);
      await vi.advanceTimersByTimeAsync(2_001);

      const error = await rejection;
      expect(error).toBeInstanceOf(Error);
      expect(String(error?.message || error)).toMatch(/OpenAI provider attempt timed out after 2000 ms/i);
      expect(breaker.getState()).toEqual({ blockedUntil: 0, reason: null });
      expect(baseFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
