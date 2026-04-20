import { useUIStore, UIState } from './useUIStore';
import { useDataStore, DataState } from './useDataStore';
import { useDocumentStore, DocumentState } from './useDocumentStore';
import { useSettingsStore, SettingsState } from './useSettingsStore';

export { useUIStore, useDataStore, useDocumentStore, useSettingsStore };

export type AppState = UIState & DataState & DocumentState & SettingsState;

type Selector<T> = (state: AppState) => T;

const getMergedState = (): AppState => ({
  ...useUIStore.getState(),
  ...useDataStore.getState(),
  ...useDocumentStore.getState(),
  ...useSettingsStore.getState(),
});

// Facade hook: reads from all 4 split stores so existing call sites keep working.
// New code should prefer the specific store (useUIStore, useDataStore, etc.).
function useStoreFacade(): AppState;
function useStoreFacade<T>(selector: Selector<T>): T;
function useStoreFacade<T>(selector?: Selector<T>): T | AppState {
  const ui = useUIStore((s) => s);
  const data = useDataStore((s) => s);
  const doc = useDocumentStore((s) => s);
  const settings = useSettingsStore((s) => s);
  const merged = { ...ui, ...data, ...doc, ...settings } as AppState;
  return selector ? selector(merged) : merged;
}

export const useStore = Object.assign(useStoreFacade, {
  getState: getMergedState,
});
