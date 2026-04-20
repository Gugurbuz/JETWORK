import { useEffect } from 'react';
import { supabase, onAuthStateChanged } from '../supabase';
import { useStore } from '../store/useStore';

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
  const user = useStore((state) => state.user);
  const setUser = useStore((state) => state.setUser);
  const isAuthReady = useStore((state) => state.isAuthReady);
  const setIsAuthReady = useStore((state) => state.setIsAuthReady);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(async (authUser) => {
      if (!authUser) {
        setUser(null);
        setIsAuthReady(true);
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
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [setUser, setIsAuthReady]);

  return { user, setUser, isAuthReady };
}
