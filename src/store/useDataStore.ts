import { create } from 'zustand';
import { Project, Message, ActiveUser, TypingUser } from '../types';

export interface UserShape {
  uid: string;
  name: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role: string;
  email: string | null;
  photoURL: string | null;
  onboardingCompleted: boolean;
  color?: string;
}

export interface DataState {
  user: UserShape | null;
  isAuthReady: boolean;
  setUser: (user: UserShape | null) => void;
  setIsAuthReady: (ready: boolean) => void;

  projects: Project[];
  setProjects: (projects: Project[]) => void;

  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
  isLoadingWorkspace: boolean;
  setIsLoadingWorkspace: (loading: boolean) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  selectWorkspace: (id: string) => void;
  selectProject: (id: string) => void;

  messages: Message[];
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  activeUsers: ActiveUser[];
  setActiveUsers: (users: ActiveUser[]) => void;
  typingUsers: TypingUser[];
  setTypingUsers: (users: TypingUser[] | ((prev: TypingUser[]) => TypingUser[])) => void;
}

export const useDataStore = create<DataState>((set) => ({
  user: null,
  isAuthReady: false,
  setUser: (user) => set({ user }),
  setIsAuthReady: (ready) => set({ isAuthReady: ready }),

  projects: [],
  setProjects: (projects) => set({ projects }),

  currentWorkspaceId: null,
  setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
  isLoadingWorkspace: false,
  setIsLoadingWorkspace: (loading) => set({ isLoadingWorkspace: loading }),
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  selectWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
  selectProject: (id) => set({ currentProjectId: id, currentWorkspaceId: null }),

  messages: [],
  setMessages: (messages) =>
    set((state) => ({
      messages: typeof messages === 'function' ? messages(state.messages) : messages,
    })),
  activeUsers: [],
  setActiveUsers: (users) => set({ activeUsers: users }),
  typingUsers: [],
  setTypingUsers: (users) =>
    set((state) => ({
      typingUsers: typeof users === 'function' ? users(state.typingUsers) : users,
    })),
}));
