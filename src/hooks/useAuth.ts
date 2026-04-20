import { useEffect } from 'react';
import { auth, db, onAuthStateChanged, doc, getDocFromServer, setDoc, serverTimestamp } from '../db';
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
        const fallbackName = authUser.displayName || authUser.email || 'User';
        let username = fallbackName;
        let firstName = '';
        let lastName = '';
        let role = 'Kullanıcı';
        let color: string | undefined = undefined;

        try {
          const userSnap = await getDocFromServer(userRef);
          if (!userSnap.exists()) {
            const userData: any = {
              uid: authUser.uid,
              displayName: username,
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
            username = userData.displayName || username;
            firstName = userData.name || '';
            lastName = userData.surname || '';
            role = userData.role || role;
            color = userData.color;
          }
        } catch (err) {
          console.error("Error saving user to database:", err);
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
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [setUser, setIsAuthReady]);

  return { user, setUser, isAuthReady };
}
