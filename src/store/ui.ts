import { createStore, useStore } from "zustand";
import type { AgentId } from "@/ipc/pty";
import type { LaunchOptions } from "@/agents/launchAgent";

/**
 * The running agents whose closing waits for confirmation, and what goes with
 * them once confirmed; `children`, the sub-agents they opened with
 * spawn_agent, go too if the user leaves "Also close" ticked.
 */
export type ClosingAgents = { agents: string[]; remove: string[]; children?: string[] };

/** An agent, or a fleet, chosen in the menu and waiting for a click on the canvas. */
export type Placement = { agent: AgentId; options: LaunchOptions } | { fleet: true };

interface UiState {
  placing: Placement | null;
  setPlacing: (placing: Placement | null) => void;
  /** The running agents whose closing waits for confirmation, and what goes with them once confirmed. */
  closing: ClosingAgents | null;
  setClosing: (closing: ClosingAgents | null) => void;
  /** The group whose closing waits for confirmation (some of its agents run). */
  closingGroup: string | null;
  setClosingGroup: (groupId: string | null) => void;
  /** The group whose label shows its name editor. */
  renamingGroup: string | null;
  setRenamingGroup: (groupId: string | null) => void;
  /** The fleet in "Relier" mode: each click wires a group or a terminal to it. */
  linking: string | null;
  setLinking: (fleetId: string | null) => void;
}

export const uiStore = createStore<UiState>()((set) => ({
  placing: null,
  setPlacing: (placing) => set({ placing }),
  closing: null,
  setClosing: (closing) => set({ closing }),
  closingGroup: null,
  setClosingGroup: (closingGroup) => set({ closingGroup }),
  renamingGroup: null,
  setRenamingGroup: (renamingGroup) => set({ renamingGroup }),
  linking: null,
  setLinking: (linking) => set({ linking }),
}));

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}
