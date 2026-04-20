import { create } from 'zustand';
import { DocumentData, KnowledgeItem } from '../types';

export interface DocumentState {
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
  setDocumentContent: (
    content: DocumentData | null | ((prev: DocumentData | null) => DocumentData | null)
  ) => void;
  projectMemory: Record<string, string>;
  setProjectMemory: (memory: Record<string, string>) => void;
  selectedDocumentText: string;
  setSelectedDocumentText: (text: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;

  knowledgeBase: KnowledgeItem[];
  setKnowledgeBase: (items: KnowledgeItem[]) => void;
  addKnowledge: (item: KnowledgeItem) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
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
  setDocumentContent: (content) =>
    set((state) => ({
      documentContent: typeof content === 'function' ? content(state.documentContent) : content,
    })),
  projectMemory: {},
  setProjectMemory: (memory) => set({ projectMemory: memory }),
  selectedDocumentText: '',
  setSelectedDocumentText: (text) => set({ selectedDocumentText: text }),
  activeTab: 'BA Analiz',
  setActiveTab: (tab) => set({ activeTab: tab }),

  knowledgeBase: [],
  setKnowledgeBase: (items) => set({ knowledgeBase: items }),
  addKnowledge: (item) =>
    set((state) => ({ knowledgeBase: [...state.knowledgeBase, item] })),
}));
