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

const readLocalSetting = (key: string): string | null => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  return window.localStorage.getItem(key);
};

const writeLocalSetting = (key: string, value: string) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  window.localStorage.setItem(key, value);
};

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: readLocalSetting('selected_model') || 'auto',
  setSelectedModel: (model) => {
    writeLocalSetting('selected_model', model);
    set({ selectedModel: model });
  },
  theme: (readLocalSetting('theme') as ThemeType) || 'monochrome',
  setTheme: (theme) => {
    writeLocalSetting('theme', theme);
    set({ theme });
  },
  promptSettings: null,
  setPromptSettings: (settings) => set({ promptSettings: settings }),
}));
