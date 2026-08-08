import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../supabase';

interface PersistedUserProfile {
  uid: string;
  username: string | null;
  name: string | null;
  surname: string | null;
  role: string | null;
  email: string | null;
  photo_url: string | null;
  onboarding_completed: boolean | null;
  color: string | null;
}

export interface LoadedAuthProfile {
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  onboardingCompleted: boolean;
  color?: string;
}

const PROFILE_COLUMNS = 'uid,username,name,surname,role,email,photo_url,onboarding_completed,color';

const readProfile = async (
  client: SupabaseClient,
  uid: string,
): Promise<PersistedUserProfile | null> => {
  const { data, error } = await client
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('uid', uid)
    .maybeSingle();

  if (error) throw error;
  return data as PersistedUserProfile | null;
};

const isUniqueViolation = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  return 'code' in error && (error as { code?: string }).code === '23505';
};

/**
 * Loads the persisted JetWork profile without ever overwriting an existing row.
 * If a transient read returns no row while the profile already exists, a plain
 * INSERT will hit the uid unique constraint and the function re-reads instead
 * of performing an UPSERT that could reset username, role or onboarding state.
 */
export async function loadOrCreateAuthProfile(
  client: SupabaseClient,
  authUser: AuthUser,
): Promise<LoadedAuthProfile> {
  let profile = await readProfile(client, authUser.uid);

  if (!profile) {
    const fallbackUsername = authUser.displayName || authUser.email || 'User';
    const insertPayload: Record<string, unknown> = {
      uid: authUser.uid,
      username: fallbackUsername,
      role: 'Kullanıcı',
      onboarding_completed: false,
    };

    if (authUser.email) insertPayload.email = authUser.email;
    if (authUser.photoURL) insertPayload.photo_url = authUser.photoURL;

    const { error: insertError } = await client.from('users').insert(insertPayload);
    if (insertError && !isUniqueViolation(insertError)) throw insertError;

    profile = await readProfile(client, authUser.uid);
    if (!profile) {
      throw new Error('Authenticated user profile could not be loaded after bootstrap.');
    }
  }

  return {
    username: profile.username || authUser.displayName || authUser.email || 'User',
    firstName: profile.name || '',
    lastName: profile.surname || '',
    role: profile.role || 'Kullanıcı',
    onboardingCompleted: !!profile.onboarding_completed,
    color: profile.color || undefined,
  };
}
