import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadOrCreateAuthProfile } from '../authProfile';
import { createAuthBootstrapCoordinator } from '../authState';

const authUser = {
  uid: 'user-1',
  email: 'gurkan.gurbuz@enerjisa.com.tr',
  displayName: 'gurkan.gurbuz@enerjisa.com.tr',
  photoURL: null,
};

const persistedProfile = {
  uid: 'user-1',
  username: 'GGURBUZ',
  name: 'gürkan',
  surname: 'gürbüz',
  role: 'Yönetici',
  email: 'gurkan.gurbuz@enerjisa.com.tr',
  photo_url: null,
  onboarding_completed: true,
  color: null,
};

function createProfileClient(
  reads: Array<{ data: unknown; error: unknown }>,
  insertResult: { error: unknown } = { error: null },
) {
  const insert = vi.fn(async () => insertResult);
  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => reads.shift() ?? { data: null, error: null }),
      })),
    })),
    insert,
  }));

  return {
    client: { from } as unknown as SupabaseClient,
    insert,
  };
}

describe('auth bootstrap hardening', () => {
  it('keeps persisted username, role and onboarding state for an existing profile', async () => {
    const { client, insert } = createProfileClient([{ data: persistedProfile, error: null }]);

    const profile = await loadOrCreateAuthProfile(client, authUser);

    expect(profile).toMatchObject({
      username: 'GGURBUZ',
      role: 'Yönetici',
      onboardingCompleted: true,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('cannot overwrite an existing profile when a transient first read looks empty', async () => {
    const { client, insert } = createProfileClient(
      [
        { data: null, error: null },
        { data: persistedProfile, error: null },
      ],
      { error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    );

    const profile = await loadOrCreateAuthProfile(client, authUser);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(profile.username).toBe('GGURBUZ');
    expect(profile.role).toBe('Yönetici');
    expect(profile.onboardingCompleted).toBe(true);
  });

  it('fails closed on profile read errors instead of creating a default profile', async () => {
    const { client, insert } = createProfileClient([
      { data: null, error: { code: '42501', message: 'profile read unavailable' } },
    ]);

    await expect(loadOrCreateAuthProfile(client, authUser)).rejects.toMatchObject({ code: '42501' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('treats realtime auth events as authoritative over a slower session snapshot', () => {
    const emitted: Array<string | null> = [];
    const coordinator = createAuthBootstrapCoordinator<{ uid: string }>((user) => {
      emitted.push(user?.uid ?? null);
    });

    coordinator.handleAuthEvent({ uid: 'user-1' });
    coordinator.handleSessionSnapshot(null);
    coordinator.handleAuthEvent({ uid: 'user-1' });
    coordinator.handleAuthEvent(null);

    expect(emitted).toEqual(['user-1', null]);
  });

  it('uses the session snapshot only when no auth event has arrived yet', () => {
    const emitted: Array<string | null> = [];
    const coordinator = createAuthBootstrapCoordinator<{ uid: string }>((user) => {
      emitted.push(user?.uid ?? null);
    });

    coordinator.handleSessionSnapshot({ uid: 'user-1' });
    coordinator.handleSessionSnapshot({ uid: 'user-1' });

    expect(emitted).toEqual(['user-1']);
  });
});
