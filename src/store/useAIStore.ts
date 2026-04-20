import { create } from 'zustand';
import { DocumentData } from '../types';

interface AIState {
  isGenerating: boolean;
  isAiActive: boolean;
  aiHandRaised: string | null;
  activeTab: string;

  setIsGenerating: (generating: boolean) => void;
  setIsAiActive: (active: boolean) => void;
  setAiHandRaised: (role: string | null) => void;
  setActiveTab: (tab: string) => void;
}

export const useAIStore = create<AIState>((set) => ({
  isGenerating: false,
  isAiActive: false,
  aiHandRaised: null,
  activeTab: 'BA Analiz',

  setIsGenerating: (generating) => set({ isGenerating: generating }),
  setIsAiActive: (active) => set({ isAiActive: active }),
  setAiHandRaised: (role) => set({ aiHandRaised: role }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
