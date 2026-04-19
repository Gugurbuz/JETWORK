export { useAuthStore } from './useAuthStore';
export type { AuthUser } from './useAuthStore';

export { useUIStore } from './useUIStore';
export type { ThemeType } from './useUIStore';

export { useWorkspaceStore } from './useWorkspaceStore';

export { useAIStore } from './useAIStore';

export { useSettingsStore } from './useSettingsStore';

import { useAuthStore } from './useAuthStore';
import { useUIStore } from './useUIStore';
import { useWorkspaceStore } from './useWorkspaceStore';
import { useAIStore } from './useAIStore';
import { useSettingsStore } from './useSettingsStore';

type CombinedState = ReturnType<typeof useAuthStore.getState> &
  ReturnType<typeof useUIStore.getState> &
  ReturnType<typeof useWorkspaceStore.getState> &
  ReturnType<typeof useAIStore.getState> &
  ReturnType<typeof useSettingsStore.getState>;

function getCombinedState(): CombinedState {
  return {
    ...useAuthStore.getState(),
    ...useUIStore.getState(),
    ...useWorkspaceStore.getState(),
    ...useAIStore.getState(),
    ...useSettingsStore.getState(),
  };
}

function useStoreHook(): CombinedState;
function useStoreHook<T>(selector: (state: CombinedState) => T): T;
function useStoreHook<T>(selector?: (state: CombinedState) => T): CombinedState | T {
  const authState = useAuthStore();
  const uiState = useUIStore();
  const workspaceState = useWorkspaceStore();
  const aiState = useAIStore();
  const settingsState = useSettingsStore();

  const combined: CombinedState = {
    ...authState,
    ...uiState,
    ...workspaceState,
    ...aiState,
    ...settingsState,
  };

  if (!selector) {
    return combined;
  }
  return selector(combined);
}

useStoreHook.getState = getCombinedState;

export const useStore = useStoreHook;
