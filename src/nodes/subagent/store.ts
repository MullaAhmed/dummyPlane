import { createStore, useStore } from "zustand";
import type { SubagentInfo, SubagentLine } from "./ipc";

/** Lines kept per subagent: the node shows its tail, like a terminal's scrollback. */
export const MAX_LINES = 600;

export interface SubagentEntry extends SubagentInfo {
  lines: SubagentLine[];
  /** Its node on the canvas, once placed. */
  elementId?: string;
}

export interface SubagentsState {
  /** By agent id. */
  agents: Record<string, SubagentEntry>;
  /** Agent ids whose node the user closed: never placed again. */
  dismissed: Record<string, true>;
  /** Merges what the backend knows of a subagent; a field it no longer sends is kept. */
  upsert: (info: SubagentInfo) => void;
  append: (agentId: string, lines: readonly SubagentLine[]) => void;
  setElement: (agentId: string, elementId: string) => void;
  dismiss: (agentId: string) => void;
  /** The session ended: its subagents are forgotten, and returned. */
  forgetNode: (nodeId: string) => SubagentEntry[];
}

function capped(lines: readonly SubagentLine[]): SubagentLine[] {
  return lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : [...lines];
}

export function createSubagentsStore() {
  return createStore<SubagentsState>()((set, get) => ({
    agents: {},
    dismissed: {},
    upsert: (info) =>
      set((s) => {
        const known: SubagentEntry | undefined = s.agents[info.agentId];
        const defined = Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined)) as SubagentInfo;
        return { agents: { ...s.agents, [info.agentId]: { ...(known ?? { lines: [] }), ...defined } } };
      }),
    append: (agentId, lines) =>
      set((s) => {
        const known = s.agents[agentId];
        if (!known || lines.length === 0) return s;
        return { agents: { ...s.agents, [agentId]: { ...known, lines: capped([...known.lines, ...lines]) } } };
      }),
    setElement: (agentId, elementId) =>
      set((s) => {
        const known = s.agents[agentId];
        return known ? { agents: { ...s.agents, [agentId]: { ...known, elementId } } } : s;
      }),
    dismiss: (agentId) => set((s) => ({ dismissed: { ...s.dismissed, [agentId]: true } })),
    forgetNode: (nodeId) => {
      const gone = Object.values(get().agents).filter((entry) => entry.nodeId === nodeId);
      if (gone.length === 0) return [];
      const ids = new Set(gone.map((entry) => entry.agentId));
      set((s) => ({
        agents: Object.fromEntries(Object.entries(s.agents).filter(([id]) => !ids.has(id))),
        dismissed: Object.fromEntries(Object.entries(s.dismissed).filter(([id]) => !ids.has(id))),
      }));
      return gone;
    },
  }));
}

export const subagentNodesStore = createSubagentsStore();

/** The subagent shown by the canvas element `elementId`. */
export function entryOfElement(agents: Record<string, SubagentEntry>, elementId: string): SubagentEntry | undefined {
  return Object.values(agents).find((entry) => entry.elementId === elementId);
}

export function useSubagentNode(elementId: string): SubagentEntry | undefined {
  return useStore(subagentNodesStore, (s) => entryOfElement(s.agents, elementId));
}

export function useSubagentEntry(agentId: string | undefined): SubagentEntry | undefined {
  return useStore(subagentNodesStore, (s) => (agentId ? s.agents[agentId] : undefined));
}
