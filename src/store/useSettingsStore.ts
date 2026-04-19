import { create } from 'zustand';
import { PromptSettings, KnowledgeItem } from '../types';

interface SettingsState {
  selectedModel: string;
  promptSettings: PromptSettings | null;
  knowledgeBase: KnowledgeItem[];

  setSelectedModel: (model: string) => void;
  setPromptSettings: (settings: PromptSettings | null) => void;
  setKnowledgeBase: (items: KnowledgeItem[]) => void;
  addKnowledge: (item: KnowledgeItem) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: localStorage.getItem('selected_model') || 'gemini-3-flash-preview',
  promptSettings: null,
  knowledgeBase: [],

  setSelectedModel: (model) => {
    localStorage.setItem('selected_model', model);
    set({ selectedModel: model });
  },
  setPromptSettings: (settings) => set({ promptSettings: settings }),
  setKnowledgeBase: (items) => set({ knowledgeBase: items }),
  addKnowledge: (item) => set((state) => ({ knowledgeBase: [...state.knowledgeBase, item] })),
}));
