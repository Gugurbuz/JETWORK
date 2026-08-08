import { useCallback, useEffect, useState } from 'react';
import { supabase, onAuthStateChanged } from '../supabase';
import { loadOrCreateAuthProfile } from '../services/authProfile';
import { useDataStore } from '../store/useDataStore';

export interface User {
  uid: string;
  name: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
  color?: string;
}

export function useAuth() {
  const user = useDataStore((state) => state.user);
  const setUser = useDataStore((state) => state.setUser);
  const isAuthReady = useDataStore((state) => state.isAuthReady);
  const setIsAuthReady = useDataStore((state) => state.setIsAuthReady);
  const [authError, setAuthError] = useState<string | null>(null);

  const retryAuth = useCallback(() => {
    setAuthError(null);
    setIsAuthReady(false);
    window.location.reload();
  }, [setIsAuthReady]);

  useEffect(() => {
    let isMounted = true;
    const timeoutId = window.setTimeout(() => {
      if (!isMounted || useDataStore.getState().isAuthReady) return;
      setAuthError('Oturum bilgileri alınırken beklenenden uzun sürdü. Bağlantınızı kontrol edip tekrar deneyin.');
    }, 10000);

    const finishAuth = () => {
      window.clearTimeout(timeoutId);
      if (isMounted) {
        setAuthError(null);
        setIsAuthReady(true);
      }
    };

    const failAuth = (message: string) => {
      window.clearTimeout(timeoutId);
      if (isMounted) {
        setAuthError(message);
        setIsAuthReady(false);
      }
    };

    const unsubscribe = onAuthStateChanged(async (authUser) => {
      if (!isMounted) return;

      if (!authUser) {
        setUser(null);
        finishAuth();
        return;
      }

      try {
        const profile = await loadOrCreateAuthProfile(supabase, authUser);
        if (!isMounted) return;

        const fullName = `${profile.firstName} ${profile.lastName}`.trim() || profile.username;

        setUser({
          uid: authUser.uid,
          name: fullName,
          username: profile.username,
          firstName: profile.firstName,
          lastName: profile.lastName,
          role: profile.role,
          email: authUser.email || null,
          photoURL: authUser.photoURL || null,
          onboardingCompleted: profile.onboardingCompleted,
        });
        finishAuth();
      } catch (err) {
        console.error('Error loading user profile:', err);
        failAuth('Profil bilgileriniz güvenli biçimde yüklenemedi. Lütfen tekrar deneyin.');
      }
    });

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [setUser, setIsAuthReady]);

  return { user, setUser, isAuthReady, authError, retryAuth };
}
