import { create } from 'zustand';
import { PromptSettings } from '../types';

export type ThemeType = 'monochrome' | 'energetic' | 'ocean';

export interface SettingsState {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  promptSettings: PromptSettings | null;
  setPromptSettings: (settings: PromptSettings | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: localStorage.getItem('selected_model') || 'auto',
  setSelectedModel: (model) => {
    localStorage.setItem('selected_model', model);
    set({ selectedModel: model });
  },
  theme: (localStorage.getItem('theme') as ThemeType) || 'monochrome',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  promptSettings: null,
  setPromptSettings: (settings) => set({ promptSettings: settings }),
}));
