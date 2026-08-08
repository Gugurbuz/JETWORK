import { describe, expect, it, vi } from 'vitest';
import { createAuthSessionFastPath } from '../authSessionFastPath';

type TestSession = {
  access_token: string;
  expires_at: number;
};

const result = (session: TestSession | null) => ({
  data: { session },
  error: null,
});

describe('auth session fast path', () => {
  it('returns the in-memory auth event session without entering the Supabase session lock', async () => {
    const readSession = vi.fn(async () => result({ access_token: 'db-token', expires_at: 2_000 }));
    const fastPath = createAuthSessionFastPath<TestSession>(readSession, {
      now: () => 1_000_000,
      minValidityMs: 30_000,
    });
    fastPath.remember({ access_token: 'cached-token', expires_at: 2_000 });

    const session = await fastPath.getSession();

    expect(session.data.session?.access_token).toBe('cached-token');
    expect(readSession).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent fallback reads when the cache is empty', async () => {
    let resolveRead: ((value: ReturnType<typeof result>) => void) | undefined;
    const readSession = vi.fn(() => new Promise<ReturnType<typeof result>>(resolve => {
      resolveRead = resolve;
    }));
    const fastPath = createAuthSessionFastPath<TestSession>(readSession, { now: () => 1_000_000 });

    const first = fastPath.getSession();
    const second = fastPath.getSession();
    expect(readSession).toHaveBeenCalledTimes(1);

    resolveRead?.(result({ access_token: 'fresh-token', expires_at: 2_000 }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.data.session?.access_token).toBe('fresh-token');
    expect(secondResult.data.session?.access_token).toBe('fresh-token');
    expect(readSession).toHaveBeenCalledTimes(1);
  });

  it('falls back to Supabase when the cached token is close to expiry and remembers the refresh', async () => {
    const readSession = vi.fn(async () => result({ access_token: 'refreshed-token', expires_at: 2_000 }));
    const fastPath = createAuthSessionFastPath<TestSession>(readSession, {
      now: () => 1_000_000,
      minValidityMs: 30_000,
    });
    fastPath.remember({ access_token: 'expiring-token', expires_at: 1_020 });

    const refreshed = await fastPath.getSession();
    const cached = await fastPath.getSession();

    expect(refreshed.data.session?.access_token).toBe('refreshed-token');
    expect(cached.data.session?.access_token).toBe('refreshed-token');
    expect(readSession).toHaveBeenCalledTimes(1);
  });
});
