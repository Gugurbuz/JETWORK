import { useCallback, useEffect, useState } from 'react';
import { supabase, onAuthStateChanged } from '../supabase';
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

    const unsubscribe = onAuthStateChanged(async (authUser) => {
      if (!isMounted) return;

      if (!authUser) {
        setUser(null);
        finishAuth();
        return;
      }

      const fallbackName = authUser.displayName || authUser.email || 'User';
      let username = fallbackName;
      let firstName = '';
      let lastName = '';
      let role = 'Kullanıcı';
      let onboardingCompleted = false;
      let color: string | undefined;

      try {
        const { data: existing } = await supabase
          .from('users')
          .select('*')
          .eq('uid', authUser.uid)
          .maybeSingle();

        if (!existing) {
          const insertPayload: Record<string, any> = {
            uid: authUser.uid,
            username,
            role,
            onboarding_completed: false,
          };
          if (authUser.email) insertPayload.email = authUser.email;
          if (authUser.photoURL) insertPayload.photo_url = authUser.photoURL;
          await supabase.from('users').upsert(insertPayload);
        } else {
          username = existing.username || username;
          firstName = existing.name || '';
          lastName = existing.surname || '';
          role = existing.role || role;
          onboardingCompleted = !!existing.onboarding_completed;
          color = existing.color;
        }
      } catch (err) {
        console.error('Error loading user profile:', err);
      }

      if (!isMounted) return;

      const fullName = `${firstName} ${lastName}`.trim() || username;

      setUser({
        uid: authUser.uid,
        name: fullName,
        username,
        firstName,
        lastName,
        role,
        email: authUser.email || null,
        photoURL: authUser.photoURL || null,
        onboardingCompleted,
        color,
      });
      finishAuth();
    });

    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [setUser, setIsAuthReady]);

  return { user, setUser, isAuthReady, authError, retryAuth };
}
