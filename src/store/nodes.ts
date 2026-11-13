import { createStore, useStore } from "zustand";
import { fromStoredKind } from "@/canvas/nodeElement";
import { saveNode, type StoredNode } from "@/ipc/db";
import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { storeMessages } from "./messages";
import { debounce, type Debounced } from "@/lib/debounce";
import { onFlushAll } from "@/lib/flush";
import { rebasePath } from "@/lib/paths";
import { MANAGER_ROLE } from "@/ipc/pty";
import {
  readFilePayload,
  readKanbanPayload,
  readOutputPayload,
  readFleetPayload,
  readNotePayload,
  readTerminalPayload,
  type FilePayload,
  type KanbanPayload,
  type FleetPayload,
  type NotePayload,
  type OutputPayload,
  type TerminalPayload,
} from "@/nodes/types";

export type NodeRecord =
  | { workspaceId: string; kind: "terminal"; payload: TerminalPayload }
  | { workspaceId: string; kind: "fleet"; payload: FleetPayload }
  | { workspaceId: string; kind: "file"; payload: FilePayload }
  | { workspaceId: string; kind: "output"; payload: OutputPayload }
  | { workspaceId: string; kind: "kanban"; payload: KanbanPayload }
  | { workspaceId: string; kind: "note"; payload: NotePayload };

export interface NodesState {
  nodes: Record<string, NodeRecord>;
  /** Adds the nodes of a workspace loaded from SQLite, keeping newer in-memory copies. */
  hydrate: (workspaceId: string, stored: StoredNode[]) => void;
  /** Adds a node and saves it at once (its row must exist before its scrollback). */
  create: (id: string, record: NodeRecord) => Promise<void>;
  /** Changes a node; the save waits 500 ms for further changes. */
  update: (
    id: string,
    patch: Partial<TerminalPayload> | Partial<FleetPayload> | Partial<KanbanPayload> | Partial<FilePayload> | Partial<OutputPayload> | Partial<NotePayload>,
  ) => void;
  /** Saves a node now, e.g. when an undo brings back a node purged from SQLite: its changes are saved again from then on. */
  persist: (id: string) => Promise<void>;
  /**
   * A node removed from the canvas: kept in memory for an undo, but none of its changes is saved until `persist`
   * brings it back. The scene's next save purges its row; a late change (its start, an agent's report) would write it back.
   */
  close: (id: string) => void;
  /** Whether `close` took the node off the canvas, and no `persist` brought it back: its record is only an undo's. */
  isClosed: (id: string) => boolean;
  /** Drops the nodes of a deleted workspace and returns their ids. */
  forgetWorkspace: (workspaceId: string) => string[];
}

const SAVE_DELAY_MS = 500;

export function createNodesStore() {
  const pendingSaves = new Map<string, Debounced<[], Promise<void> | undefined>>();
  /** The nodes removed from the canvas (`close`), until one is brought back (`persist`). */
  const closed = new Set<string>();

  const store = createStore<NodesState>()((set, get) => {
    const write = (id: string) => {
      const record = get().nodes[id];
      if (!record) return undefined;
      return saveNode(id, record.workspaceId, record.kind, JSON.stringify(record.payload));
    };

    const saveLater = (id: string) => {
      let save = pendingSaves.get(id);
      if (!save) {
        // The timer drops the result: a refused save must reach the user, not the console as an unhandled rejection.
        save = debounce(() => {
          const written = write(id);
          written?.catch((error: unknown) => toastError(messages(storeMessages).saveFailed, { error }));
          return written;
        }, SAVE_DELAY_MS);
        pendingSaves.set(id, save);
      }
      save();
    };

    const saveNow = async (id: string) => {
      closed.delete(id);
      pendingSaves.get(id)?.cancel();
      await write(id);
    };

    return {
      nodes: {},

      hydrate: (workspaceId, stored) => {
        const loaded: Record<string, NodeRecord> = {};
        for (const node of stored) {
          const record = readRecord(workspaceId, node);
          if (record) loaded[node.id] = record;
          else console.warn(`node ${node.id}: unreadable payload, skipped`);
        }
        set((s) => ({ nodes: { ...loaded, ...s.nodes } }));
      },

      create: async (id, record) => {
        set((s) => ({ nodes: { ...s.nodes, [id]: record } }));
        await saveNow(id);
      },

      update: (id, patch) => {
        const record = get().nodes[id];
        if (!record) return;
        const next = { ...record, payload: { ...record.payload, ...patch } } as NodeRecord;
        set((s) => ({ nodes: { ...s.nodes, [id]: next } }));
        if (!closed.has(id)) saveLater(id);
      },

      persist: saveNow,

      close: (id) => {
        closed.add(id);
        pendingSaves.get(id)?.cancel();
      },

      isClosed: (id) => closed.has(id),

      forgetWorkspace: (workspaceId) => {
        const ids = Object.keys(get().nodes).filter((id) => get().nodes[id].workspaceId === workspaceId);
        for (const id of ids) {
          pendingSaves.get(id)?.cancel();
          pendingSaves.delete(id);
          closed.delete(id);
        }
        set((s) => ({ nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => !ids.includes(id))) }));
        return ids;
      },
    };
  });

  const flushPending = () => Promise.all([...pendingSaves.values()].map((save) => save.flush()));
  return { store, flushPending };
}

function readRecord(workspaceId: string, node: StoredNode): NodeRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(node.payloadJson);
  } catch {
    return null;
  }
  // The one place a saved node's kind becomes the app's: a stored "orchestrator" is a fleet.
  const kind = fromStoredKind(node.kind);
  if (kind === "fleet") return { workspaceId, kind: "fleet", payload: readFleetPayload(raw) };
  if (kind === "file") {
    const file = readFilePayload(raw);
    return file ? { workspaceId, kind: "file", payload: file } : null;
  }
  if (kind === "kanban") return { workspaceId, kind: "kanban", payload: readKanbanPayload(raw) };
  if (kind === "output") {
    const output = readOutputPayload(raw);
    return output ? { workspaceId, kind: "output", payload: output } : null;
  }
  if (kind === "note") return { workspaceId, kind: "note", payload: readNotePayload(raw) };
  if (kind !== "terminal") return null;
  const payload = readTerminalPayload(raw);
  return payload ? { workspaceId, kind: "terminal", payload } : null;
}

/** The name a node shows: an agent's or a fleet's, "" for a board, a file, an output or a note. */
export function nodeNameOf(record: NodeRecord | undefined): string {
  return record?.kind === "terminal" || record?.kind === "fleet" ? record.payload.name : "";
}

/** Whether a node is a mission's Manager: the terminal that runs a Fleet's board with its team (`@/mission/manager`). */
export function isManagerRecord(record: NodeRecord | undefined): boolean {
  return record?.kind === "terminal" && record.payload.role === MANAGER_ROLE && Boolean(record.payload.fleet);
}

/** `isManagerRecord` by id, read now. */
export const isManagerNode = (nodeId: string) => isManagerRecord(nodesStore.getState().nodes[nodeId]);

/** The terminal payload of a node; undefined for a fleet or a missing node. */
export function terminalOf(record: NodeRecord | undefined): TerminalPayload | undefined {
  return record?.kind === "terminal" ? record.payload : undefined;
}

const nodes = createNodesStore();
onFlushAll(nodes.flushPending);

export const nodesStore = nodes.store;

export function useNodes<T>(selector: (state: NodesState) => T): T {
  return useStore(nodesStore, selector);
}

/** After "Change folder": terminals in memory follow the project's new folder. */
export function rebaseTerminalFolders(from: string, to: string) {
  for (const [id, node] of Object.entries(nodesStore.getState().nodes)) {
    if (node.kind === "fleet") {
      // Its Claude session and the paths of its mission follow the project too.
      const { session, mission } = node.payload;
      const cwd = session && rebasePath(session.cwd, from, to);
      const project = mission?.project && rebasePath(mission.project, from, to);
      const worktree = mission?.worktree && rebasePath(mission.worktree, from, to);
      const members = mission?.members.map((m) => ({ ...m, worktree: rebasePath(m.worktree, from, to) ?? m.worktree }));
      const patch: Partial<FleetPayload> = {};
      if (session && cwd) patch.session = { ...session, cwd };
      if (mission && (project || worktree || members?.some((m, i) => m.worktree !== mission.members[i].worktree))) {
        patch.mission = { ...mission, project: project || mission.project, worktree: worktree || mission.worktree, members: members ?? mission.members };
      }
      if (Object.keys(patch).length > 0) nodesStore.getState().update(id, patch);
      continue;
    }
    // A Kanban, a file, an output node or a note has no folder of its own.
    if (node.kind !== "terminal") continue;
    const cwd = rebasePath(node.payload.cwd, from, to);
    if (cwd) nodesStore.getState().update(id, { cwd });
  }
}

/** The Claude session of a node: a terminal's own, or a fleet's. */
export function sessionOf(record: NodeRecord | undefined): TerminalPayload | undefined {
  if (record?.kind === "terminal") return record.payload;
  return record?.kind === "fleet" ? record.payload.session : undefined;
}

/** Changes a node's session where it lives: the payload of a terminal, the `session` of a fleet. */
export function updateSession(nodeId: string, patch: Partial<TerminalPayload>) {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "terminal") nodesStore.getState().update(nodeId, patch);
  else if (record?.kind === "fleet" && record.payload.session) {
    nodesStore.getState().update(nodeId, { session: { ...record.payload.session, ...patch } });
  }
}
