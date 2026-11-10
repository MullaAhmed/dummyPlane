import { createStore, useStore } from "zustand";

interface ActiveTerminalState {
  id: string | null;
  set: (id: string | null) => void;
}

/**
 * The terminal the user last entered: a click that activated it, Ctrl+Tab,
 * Ctrl+P / Go to, the agents panel, or the keyboard going into its xterm.
 * Shift+Escape leaves it in place: the terminal just left is still where Send
 * goes when nothing is selected and no `@` is typed (the command bar says so).
 */
export const activeTerminalStore = createStore<ActiveTerminalState>()((set) => ({
  id: null,
  set: (id) => set((s) => (s.id === id ? s : { id })),
}));

export function setActiveTerminal(id: string | null) {
  activeTerminalStore.getState().set(id);
}

export function useActiveTerminal(): string | null {
  return useStore(activeTerminalStore, (s) => s.id);
}
