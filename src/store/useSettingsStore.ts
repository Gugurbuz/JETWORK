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

export const PUBLIC_GEMINI_MODEL = 'gemini-3.8-flash';

const normalizeSelectableModel = (model: string | null | undefined): string => {
  const normalized = String(model || 'auto').trim();
  if (normalized.startsWith('gemini-')) return PUBLIC_GEMINI_MODEL;
  return normalized || 'auto';
};

const readLocalSetting = (key: string): string | null => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return null;
  return window.localStorage.getItem(key);
};

const writeLocalSetting = (key: string, value: string) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
  window.localStorage.setItem(key, value);
};

export const useSettingsStore = create<SettingsState>((set) => ({
  selectedModel: normalizeSelectableModel(readLocalSetting('selected_model')),
  setSelectedModel: (model) => {
    const normalizedModel = normalizeSelectableModel(model);
    writeLocalSetting('selected_model', normalizedModel);
    set({ selectedModel: normalizedModel });
  },
  theme: (readLocalSetting('theme') as ThemeType) || 'monochrome',
  setTheme: (theme) => {
    writeLocalSetting('theme', theme);
    set({ theme });
  },
  promptSettings: null,
  setPromptSettings: (settings) => set({ promptSettings: settings }),
}));