import { useEffect } from 'react';
import { auth, db, onAuthStateChanged, doc, getDocFromServer, setDoc, serverTimestamp } from '../db';
import { useStore } from '../store/useStore';

export interface User {
  uid: string;
  name: string;
  role: string;
  email: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
}

export function useAuth() {
  const user = useStore(state => state.user);
  const setUser = useStore(state => state.setUser);
  const isAuthReady = useStore(state => state.isAuthReady);
  const setIsAuthReady = useStore(state => state.setIsAuthReady);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your database configuration.");
          }
        }

        // Save user to database
        const userRef = doc(db, 'users', authUser.uid);
        let onboardingCompleted = false;
        let displayName = authUser.displayName || authUser.email || 'User';
        let role = 'Kullanıcı';

        try {
          const userSnap = await getDocFromServer(userRef);
          if (!userSnap.exists()) {
            const userData: any = {
              uid: authUser.uid,
              displayName: displayName,
              createdAt: serverTimestamp(),
              role: role,
              onboardingCompleted: false
            };
            if (authUser.email) {
              userData.email = authUser.email;
            }
            if (authUser.photoURL) {
              userData.photoURL = authUser.photoURL;
            }
            await setDoc(userRef, userData);
          } else {
            const userData = userSnap.data();
            onboardingCompleted = userData.onboardingCompleted || false;
            displayName = userData.displayName || displayName;
            role = userData.role || role;
          }
        } catch (err) {
          console.error("Error saving user to database:", err);
        }

        setUser({ uid: authUser.uid, name: displayName, role: role, email: authUser.email || null, photoURL: authUser.photoURL || null, onboardingCompleted });
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [setUser, setIsAuthReady]);

  return { user, setUser, isAuthReady };
}
