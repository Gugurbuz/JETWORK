import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { auth, db, doc, getDocFromServer, setDoc, updateDoc, serverTimestamp, onAuthStateChanged, logOut } from '../db';

export const useAuth = () => {
  const { user, setUser, isAuthReady, setIsAuthReady } = useStore();

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

        setUser({ 
          uid: authUser.uid, 
          name: displayName, 
          role: role, 
          email: authUser.email || null, 
          photoURL: authUser.photoURL || null, 
          onboardingCompleted 
        });
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [setUser, setIsAuthReady]);

  const handleUpdateUser = async (updatedUser: { name: string; role: string }) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: updatedUser.name,
        role: updatedUser.role
      });
      setUser({ ...user, ...updatedUser });
    } catch (error) {
      console.error("Error updating user:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      setUser(null);
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  return { user, isAuthReady, handleUpdateUser, handleLogout };
};
