import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../supabase';

export interface CompleteOnboardingInput {
  username: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface UpdateUserProfileInput {
  firstName: string;
  lastName: string;
  role: string;
  color?: string;
}

export async function completeUserOnboarding(
  input: CompleteOnboardingInput,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client.rpc('complete_user_onboarding', {
    p_username: input.username,
    p_name: input.firstName,
    p_surname: input.lastName,
    p_role: input.role,
  });

  if (error) throw error;
}

export async function updateUserProfile(
  input: UpdateUserProfileInput,
  client: SupabaseClient = supabase,
): Promise<void> {
  const { error } = await client.rpc('update_user_profile', {
    p_name: input.firstName,
    p_surname: input.lastName,
    p_role: input.role,
    p_color: input.color ?? null,
  });

  if (error) throw error;
}
