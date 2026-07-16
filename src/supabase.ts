import { createClient } from '@supabase/supabase-js';

const viteEnv = (import.meta as any).env || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

const normalizeAuthUser = (sessionUser: any | null): AuthUser | null => {
  if (!sessionUser) return null;
  return {
    uid: sessionUser.id,
    email: sessionUser.email || null,
    displayName: sessionUser.user_metadata?.full_name || sessionUser.email || null,
    photoURL: sessionUser.user_metadata?.avatar_url || null,
  };
};

export const onAuthStateChanged = (callback: (user: AuthUser | null) => void) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(normalizeAuthUser(session?.user || null));
  });

  supabase.auth
    .getSession()
    .then(({ data: { session } }) => {
      callback(normalizeAuthUser(session?.user || null));
    })
    .catch((error) => {
      console.error('Failed to read auth session:', error);
      callback(null);
    });

  return () => subscription.unsubscribe();
};

export const signInWithGoogle = async () => {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
  if (error) throw error;
};

export const logOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const signInWithEmailAndPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

export const createUserWithEmailAndPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
};

export const signInAnonymously = async () => {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data;
};

export const signInWithUsernameOrEmail = async (input: string, password: string) => {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  let email = input;
  if (!isEmail) {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('username', input)
      .maybeSingle();
    if (error || !data?.email) throw new Error('Kullanıcı adı bulunamadı.');
    email = data.email;
  }
  return signInWithEmailAndPassword(email, password);
};
