import { createClient, type Session } from '@supabase/supabase-js';
import { createAuthBootstrapCoordinator } from './services/authState';
import { createAuthSessionFastPath } from './services/authSessionFastPath';

const viteEnv = (import.meta as any).env
  || (typeof process !== 'undefined' ? process.env : {})
  || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const originalGetSession = supabase.auth.getSession.bind(supabase.auth);
const authSessionFastPath = createAuthSessionFastPath<Session>(originalGetSession);

// getSession is called from the assistant runtime before every request. Supabase
// already delivers the active/refreshed session through onAuthStateChange, so
// reuse that in-memory session and only enter the auth lock when the cache is
// missing or close to expiry. The fallback read is single-flight as well.
(supabase.auth as typeof supabase.auth & { getSession: typeof originalGetSession }).getSession = authSessionFastPath.getSession as typeof originalGetSession;

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
  const coordinator = createAuthBootstrapCoordinator<AuthUser>(callback);

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    authSessionFastPath.remember(session);
    coordinator.handleAuthEvent(normalizeAuthUser(session?.user || null));
  });

  supabase.auth
    .getSession()
    .then(({ data: { session } }) => {
      authSessionFastPath.remember(session);
      coordinator.handleSessionSnapshot(normalizeAuthUser(session?.user || null));
    })
    .catch((error) => {
      // Do not convert a bootstrap read failure into a fake signed-out event.
      // The realtime auth callback remains authoritative and useAuth owns timeout UX.
      console.error('Failed to read auth session:', error);
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
  authSessionFastPath.clear();
};

export const signInWithEmailAndPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  authSessionFastPath.remember(data.session);
  return data;
};

export const createUserWithEmailAndPassword = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  authSessionFastPath.remember(data.session);
  return data;
};

export const signInAnonymously = async () => {
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  authSessionFastPath.remember(data.session);
  return data;
};

export const signInWithUsernameOrEmail = async (input: string, password: string) => {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  let email = input;
  if (!isEmail) {
    const { data, error } = await supabase.rpc('resolve_login_email', { p_username: input });
    if (error || !data) throw new Error('Kullanıcı adı bulunamadı.');
    email = data;
  }
  return signInWithEmailAndPassword(email, password);
};
