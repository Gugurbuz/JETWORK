import { create } from 'zustand';
import { Project, Message, ActiveUser, TypingUser, DocumentData } from '../types';

interface WorkspaceState {
  projects: Project[];
  currentWorkspaceId: string | null;
  currentProjectId: string | null;
  isLoadingWorkspace: boolean;
  messages: Message[];
  activeUsers: ActiveUser[];
  typingUsers: TypingUser[];
  documentContent: DocumentData | null;
  projectMemory: Record<string, string>;
  selectedDocumentText: string;

  setProjects: (projects: Project[]) => void;
  setCurrentWorkspaceId: (id: string | null) => void;
  setCurrentProjectId: (id: string | null) => void;
  setIsLoadingWorkspace: (loading: boolean) => void;
  selectWorkspace: (id: string) => void;
  selectProject: (id: string) => void;
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setActiveUsers: (users: ActiveUser[]) => void;
  setTypingUsers: (users: TypingUser[] | ((prev: TypingUser[]) => TypingUser[])) => void;
  setDocumentContent: (content: DocumentData | null | ((prev: DocumentData | null) => DocumentData | null)) => void;
  setProjectMemory: (memory: Record<string, string>) => void;
  setSelectedDocumentText: (text: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  projects: [],
  currentWorkspaceId: null,
  currentProjectId: null,
  isLoadingWorkspace: false,
  messages: [],
  activeUsers: [],
  typingUsers: [],
  documentContent: null,
  projectMemory: {},
  selectedDocumentText: '',

  setProjects: (projects) => set({ projects }),
  setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setIsLoadingWorkspace: (loading) => set({ isLoadingWorkspace: loading }),
  selectWorkspace: (id) => set({ currentWorkspaceId: id, currentProjectId: null }),
  selectProject: (id) => set({ currentProjectId: id, currentWorkspaceId: null }),
  setMessages: (messages) => set((state) => ({
    messages: typeof messages === 'function' ? messages(state.messages) : messages
  })),
  setActiveUsers: (users) => set({ activeUsers: users }),
  setTypingUsers: (users) => set((state) => ({
    typingUsers: typeof users === 'function' ? users(state.typingUsers) : users
  })),
  setDocumentContent: (content) => set((state) => ({
    documentContent: typeof content === 'function' ? content(state.documentContent) : content
  })),
  setProjectMemory: (memory) => set({ projectMemory: memory }),
  setSelectedDocumentText: (text) => set({ selectedDocumentText: text }),
}));
