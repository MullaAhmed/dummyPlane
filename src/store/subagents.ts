import { createStore, useStore } from "zustand";

/** Subagents each Claude session runs, from its hooks. */
export const subagentsStore = createStore<{ running: Record<string, number>; set: (nodeId: string, running: number) => void }>()((set) => ({
  running: {},
  set: (nodeId, running) => set((s) => ({ running: { ...s.running, [nodeId]: running } })),
}));

export function useSubagents(nodeId: string): number {
  return useStore(subagentsStore, (s) => s.running[nodeId] ?? 0);
}
