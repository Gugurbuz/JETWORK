import { create } from 'zustand';
import { Project, Workspace, Message, ActiveUser, TypingUser, DocumentData } from '../types';

type ThemeType = 'light' | 'dark' | 'system';

interface AppState {
  // Auth
  user: { uid: string; name: string; role: string; email: string | null; photoURL: string | null; onboardingCompleted: boolean } | null;
  isAuthReady: boolean;
  setUser: (user: any) => void;
  setIsAuthReady: (ready: boolean) => void;

  // Modals
  showNewItemModal: boolean;
  showNewProjectModal: boolean;
  showSettingsModal: boolean;
  showManageParticipantsModal: boolean;
  editingProject: Project | null;
  editingWorkspace: Workspace | null;
  deletingProject: string | null;
  deletingWorkspace: string | null;
  setShowNewItemModal: (show: boolean) => void;
  setShowNewProjectModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowManageParticipantsModal: (show: boolean) => void;
  setEditingProject: (project: Project | null) => void;
  setEditingWorkspace: (workspace: Workspace | null) => void;
  setDeletingProject: (id: string | null) => void;
  setDeletingWorkspace: (id: string | null) => void;

  // Data
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
  isLoadingWorkspace: boolean;
  setIsLoadingWorkspace: (loading: boolean) => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;

  // Chat & Presence
  messages: Message[];
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  activeUsers: ActiveUser[];
  setActiveUsers: (users: ActiveUser[]) => void;
  typingUsers: TypingUser[];
  setTypingUsers: (users: TypingUser[]) => void;

  // AI & Document
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;
  isDiscussing: boolean;
  setIsDiscussing: (discussing: boolean) => void;
  isAiActive: boolean;
  setIsAiActive: (active: boolean) => void;
  isZeroTouchMode: boolean;
  setIsZeroTouchMode: (active: boolean) => void;
  activeZeroTouchRoles: string[];
  setActiveZeroTouchRoles: (roles: string[]) => void;
  aiHandRaised: string | null;
  setAiHandRaised: (role: string | null) => void;
  documentContent: DocumentData | null;
  setDocumentContent: (content: DocumentData | null) => void;
  projectMemory: Record<string, string>;
  setProjectMemory: (memory: Record<string, string>) => void;
  selectedDocumentText: string;
  setSelectedDocumentText: (text: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Settings
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  isAuthReady: false,
  setUser: (user) => set({ user }),
  setIsAuthReady: (ready) => set({ isAuthReady: ready }),

  showNewItemModal: false,
  showNewProjectModal: false,
  showSettingsModal: false,
  showManageParticipantsModal: false,
  editingProject: null,
  editingWorkspace: null,
  deletingProject: null,
  deletingWorkspace: null,
  setShowNewItemModal: (show) => set({ showNewItemModal: show }),
  setShowNewProjectModal: (show) => set({ showNewProjectModal: show }),
  setShowSettingsModal: (show) => set({ showSettingsModal: show }),
  setShowManageParticipantsModal: (show) => set({ showManageParticipantsModal: show }),
  setEditingProject: (project) => set({ editingProject: project }),
  setEditingWorkspace: (workspace) => set({ editingWorkspace: workspace }),
  setDeletingProject: (id) => set({ deletingProject: id }),
  setDeletingWorkspace: (id) => set({ deletingWorkspace: id }),

  projects: [],
  setProjects: (projects) => set({ projects }),
  currentWorkspaceId: null,
  setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
  isLoadingWorkspace: false,
  setIsLoadingWorkspace: (loading) => set({ isLoadingWorkspace: loading }),
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  messages: [],
  setMessages: (messages) => set((state) => ({ 
    messages: typeof messages === 'function' ? messages(state.messages) : messages 
  })),
  activeUsers: [],
  setActiveUsers: (users) => set({ activeUsers: users }),
  typingUsers: [],
  setTypingUsers: (users) => set({ typingUsers: users }),

  isGenerating: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),
  isDiscussing: false,
  setIsDiscussing: (discussing) => set({ isDiscussing: discussing }),
  isAiActive: false,
  setIsAiActive: (active) => set({ isAiActive: active }),
  isZeroTouchMode: false,
  setIsZeroTouchMode: (active) => set({ isZeroTouchMode: active }),
  activeZeroTouchRoles: ['Business Analyst', 'Software Architect', 'QA Engineer'],
  setActiveZeroTouchRoles: (roles) => set({ activeZeroTouchRoles: roles }),
  aiHandRaised: null,
  setAiHandRaised: (role) => set({ aiHandRaised: role }),
  documentContent: null,
  setDocumentContent: (content) => set({ documentContent: content }),
  projectMemory: {},
  setProjectMemory: (memory) => set({ projectMemory: memory }),
  selectedDocumentText: '',
  setSelectedDocumentText: (text) => set({ selectedDocumentText: text }),
  activeTab: 'BA Analiz',
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedModel: localStorage.getItem('selected_model') || 'gemini-2.5-flash',
  setSelectedModel: (model) => {
    localStorage.setItem('selected_model', model);
    set({ selectedModel: model });
  },
  theme: (localStorage.getItem('theme') as ThemeType) || 'system',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  }
}));
