import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { completeUserOnboarding, updateUserProfile } from '../userProfile';

function createClient(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn(async () => ({ data: result.data ?? true, error: result.error }));
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe('guarded user profile writes', () => {
  it('routes onboarding through complete_user_onboarding', async () => {
    const { client, rpc } = createClient({ error: null });

    await completeUserOnboarding({
      username: 'GGURBUZ',
      firstName: 'Gürkan',
      lastName: 'Gürbüz',
      role: 'Product Owner',
    }, client);

    expect(rpc).toHaveBeenCalledWith('complete_user_onboarding', {
      p_username: 'GGURBUZ',
      p_name: 'Gürkan',
      p_surname: 'Gürbüz',
      p_role: 'Product Owner',
    });
  });

  it('routes profile edits through update_user_profile', async () => {
    const { client, rpc } = createClient({ error: null });

    await updateUserProfile({
      firstName: 'Gürkan',
      lastName: 'Gürbüz',
      role: 'Product Owner',
      color: '#2563eb',
    }, client);

    expect(rpc).toHaveBeenCalledWith('update_user_profile', {
      p_name: 'Gürkan',
      p_surname: 'Gürbüz',
      p_role: 'Product Owner',
      p_color: '#2563eb',
    });
  });

  it('propagates guarded RPC failures', async () => {
    const rpcError = { code: '42501', message: 'profile_role_requires_rpc' };
    const { client } = createClient({ error: rpcError });

    await expect(updateUserProfile({
      firstName: 'Gürkan',
      lastName: 'Gürbüz',
      role: 'Product Owner',
    }, client)).rejects.toEqual(rpcError);
  });
});
