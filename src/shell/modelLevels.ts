import { createStore, useStore } from "zustand";

/** Whether "Models by level" is open: Settings opens it, its Done or Escape closes it. */
export const modelLevelsStore = createStore<{ open: boolean }>()(() => ({ open: false }));
export const useModelLevelsOpen = () => useStore(modelLevelsStore, (s) => s.open);

export function showModelLevels() {
  modelLevelsStore.setState({ open: true });
}

export function closeModelLevels() {
  modelLevelsStore.setState({ open: false });
}
