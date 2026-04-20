import { create } from 'zustand';

export interface AuthUser {
  uid: string;
  name: string;
  role: string;
  email: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
  color?: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthReady: boolean;
  setUser: (user: AuthUser | null | ((prev: AuthUser | null) => AuthUser | null)) => void;
  setIsAuthReady: (ready: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthReady: false,
  setUser: (user) => set((state) => ({
    user: typeof user === 'function' ? user(state.user) : user
  })),
  setIsAuthReady: (ready) => set({ isAuthReady: ready }),
}));
