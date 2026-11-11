import { createStore, useStore } from "zustand";
import {
  createWorkspace,
  deleteWorkspace,
  getSetting,
  listWorkspaces,
  renameWorkspace,
  setSetting,
  setWorkspaceFolder,
  setWorkspacePantheon,
  type Workspace,
  type WorkspaceKind,
} from "@/ipc/db";
import { nextPantheon } from "@/agents/names";
import { messages } from "@/i18n";
import { rebasePath } from "@/lib/paths";
import { storeMessages } from "./messages";

export type { Workspace, WorkspaceKind };

/** Plan 2 kept a single active workspace; it seeds the first project opened. */
const LEGACY_ACTIVE_KEY = "ui.activeWorkspaceId";
const orderKey = (projectId: string) => `ui.workspaceOrder.${projectId}`;
const activeKey = (projectId: string) => `ui.activeWorkspaceId.${projectId}`;

export interface WorkspacesState {
  projectId: string | null;
  workspaces: Workspace[];
  activeId: string | null;
  /** The last canvas workspace on screen: where the code workspace inserts its files. */
  lastCanvasId: string | null;
  status: "loading" | "ready" | "error";
  error?: string;
  /** Loads the workspaces of a project, creating one if it has none. */
  load: (projectId: string) => Promise<void>;
  create: () => Promise<void>;
  /** Selects the project's code workspace, creating it the first time; resolves with its id. */
  openCode: () => Promise<string | null>;
  /** Selects the project's notes tab, creating it the first time; resolves with its id. */
  openNotes: () => Promise<string | null>;
  rename: (id: string, name: string) => Promise<void>;
  /** Deletes a workspace (never the last one) and selects its neighbor if it was active. */
  remove: (id: string) => Promise<void>;
  select: (id: string) => void;
  /** Puts a tab at `index` (clamped); the order is saved in the settings, per project. */
  move: (id: string, index: number) => Promise<void>;
  setPantheon: (id: string, pantheon: string) => Promise<void>;
  /**
   * Sets the folder the workspace's next terminals start in (null: the project's own). The store
   * changes at once, so the next launch sees it; a refused save puts the old folder back and throws.
   */
  setFolder: (id: string, folder: string | null) => Promise<void>;
  /**
   * The pantheon of the agents outside any group, chosen and saved on first
   * use; it avoids `taken`, the pantheons of the workspace's groups.
   */
  ensurePantheon: (id: string, taken?: readonly string[]) => Promise<string>;
}

/** Older rows (and an unknown kind) read as a canvas; one without a folder, as the project's own. */
const withKind = (w: Workspace): Workspace => ({ ...w, kind: w.kind === "code" || w.kind === "notes" ? w.kind : "canvas", folder: w.folder ?? null });

export const isCode = (w: Workspace | undefined) => w?.kind === "code";
export const isNotes = (w: Workspace | undefined) => w?.kind === "notes";
/** A free whiteboard: what holds terminals, Fleets and drawings, unlike the project's code and notes tabs. An unknown kind reads as a canvas, as the backend reads it. */
export const isCanvas = (w: Workspace | undefined): w is Workspace & { kind: "canvas" } => w !== undefined && !isCode(w) && !isNotes(w);

/** The last canvas workspace is never deleted; the code and notes tabs always may be. */
export function canRemove(workspaces: readonly Workspace[], workspace: Workspace): boolean {
  return !isCanvas(workspace) || workspaces.filter(isCanvas).length > 1;
}

/** The names the project's single tabs are created with. */
const SINGLE_NAMES: Record<Exclude<WorkspaceKind, "canvas">, string> = { code: "Code", notes: "Notes" };

/** The workspaces in the order saved for the project; unknown ids are dropped, new ones go last. */
export function inSavedOrder(workspaces: Workspace[], saved: unknown): Workspace[] {
  if (!Array.isArray(saved)) return workspaces;
  const rank = (w: Workspace) => {
    const i = saved.indexOf(w.id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...workspaces].sort((a, b) => rank(a) - rank(b));
}

/** "Workspace N" with the smallest N not already taken. */
export function nextDefaultName(workspaces: Workspace[]): string {
  const taken = new Set(workspaces.map((w) => w.name));
  let n = 1;
  while (taken.has(`Workspace ${n}`)) n++;
  return `Workspace ${n}`;
}

export function createWorkspacesStore() {
  const store = createStore<WorkspacesState>()((set, get) => {
    const rememberActive = (id: string) => {
      const projectId = get().projectId;
      if (!projectId) return;
      setSetting(activeKey(projectId), id).catch((error: unknown) => console.warn("active workspace not saved", error));
    };

    /** The project's code or notes tab: one per project, the backend hands back the existing one too. */
    const openSingle = async (kind: Exclude<WorkspaceKind, "canvas">): Promise<string | null> => {
      const projectId = get().projectId;
      if (!projectId) return null;
      let single = get().workspaces.find((w) => w.kind === kind);
      if (!single) {
        single = withKind(await createWorkspace(projectId, SINGLE_NAMES[kind], kind));
        const created = single;
        set((s) => ({ workspaces: s.workspaces.some((w) => w.id === created.id) ? s.workspaces : [...s.workspaces, created] }));
      }
      get().select(single.id);
      return single.id;
    };

    return {
      projectId: null,
      workspaces: [],
      activeId: null,
      lastCanvasId: null,
      status: "loading",

      load: async (projectId) => {
        set({ projectId, workspaces: [], activeId: null, lastCanvasId: null, status: "loading", error: undefined });
        try {
          let workspaces = (await listWorkspaces(projectId)).map(withKind);
          if (!workspaces.some(isCanvas))
            workspaces = [withKind(await createWorkspace(projectId, nextDefaultName(workspaces))), ...workspaces];
          workspaces = inSavedOrder(workspaces, await getSetting<unknown>(orderKey(projectId)).catch(() => null));
          const saved = (await getSetting<string>(activeKey(projectId))) ?? (await getSetting<string>(LEGACY_ACTIVE_KEY));
          const activeId = workspaces.some((w) => w.id === saved) ? saved! : workspaces[0].id;
          if (get().projectId === projectId) set({ workspaces, activeId, status: "ready" });
        } catch (error) {
          set({ status: "error", error: String(error) });
        }
      },

      create: async () => {
        const projectId = get().projectId;
        if (!projectId) return;
        const workspace = withKind(await createWorkspace(projectId, nextDefaultName(get().workspaces)));
        set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
        rememberActive(workspace.id);
      },

      openCode: () => openSingle("code"),
      openNotes: () => openSingle("notes"),

      rename: async (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        // Two tabs of one project with the same name cannot be told apart.
        const clash = get().workspaces.some((w) => w.id !== id && w.name.toLowerCase() === trimmed.toLowerCase());
        if (clash) throw new Error(messages(storeMessages).duplicateName(trimmed));
        await renameWorkspace(id, trimmed);
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) }));
      },

      remove: async (id) => {
        const { workspaces, activeId } = get();
        const index = workspaces.findIndex((w) => w.id === id);
        if (index === -1 || !canRemove(workspaces, workspaces[index])) return;
        await deleteWorkspace(id);
        const remaining = workspaces.filter((w) => w.id !== id);
        const nextActive = id === activeId ? remaining[Math.min(index, remaining.length - 1)].id : activeId;
        set((s) => ({ lastCanvasId: s.lastCanvasId === id ? null : s.lastCanvasId }));
        set({ workspaces: remaining, activeId: nextActive });
        if (nextActive && nextActive !== activeId) rememberActive(nextActive);
      },

      select: (id) => {
        if (id === get().activeId || !get().workspaces.some((w) => w.id === id)) return;
        set({ activeId: id });
        rememberActive(id);
      },

      move: async (id, index) => {
        const { workspaces, projectId } = get();
        const from = workspaces.findIndex((w) => w.id === id);
        if (from === -1 || !projectId) return;
        const next = workspaces.filter((w) => w.id !== id);
        next.splice(Math.max(0, Math.min(index, next.length)), 0, workspaces[from]);
        set({ workspaces: next });
        // The order is a convenience: a refused save keeps it for the session.
        await setSetting(orderKey(projectId), next.map((w) => w.id)).catch((error: unknown) => console.warn("workspace order not saved", error));
      },

      setPantheon: async (id, pantheon) => {
        await setWorkspacePantheon(id, pantheon);
        set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, pantheon } : w)) }));
      },

      setFolder: async (id, folder) => {
        const next = folder?.trim() || null;
        const before = get().workspaces.find((w) => w.id === id)?.folder ?? null;
        const put = (value: string | null) => set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, folder: value } : w)) }));
        put(next);
        try {
          await setWorkspaceFolder(id, next);
        } catch (error) {
          put(before);
          throw error;
        }
      },

      ensurePantheon: async (id, taken = []) => {
        const workspace = get().workspaces.find((w) => w.id === id);
        if (workspace?.pantheon) return workspace.pantheon;
        const pantheon = nextPantheon(taken);
        await get().setPantheon(id, pantheon);
        return pantheon;
      },
    };
  });
  store.subscribe((s) => {
    const active = s.workspaces.find((w) => w.id === s.activeId);
    if (isCanvas(active) && s.lastCanvasId !== active.id) store.setState({ lastCanvasId: active.id });
  });
  return store;
}

export const workspacesStore = createWorkspacesStore();

/** After "Change folder": a workspace of the open project whose own folder lay inside the old one follows it, as Rust moved the saved ones. */
export function rebaseWorkspaceFolders(projectId: string, from: string, to: string) {
  const { projectId: open, workspaces } = workspacesStore.getState();
  if (open !== projectId) return;
  const moved = workspaces.map((w) => {
    const folder = w.folder && rebasePath(w.folder, from, to);
    return folder ? { ...w, folder } : w;
  });
  if (moved.some((w, i) => w !== workspaces[i])) workspacesStore.setState({ workspaces: moved });
}

export function useWorkspaces<T>(selector: (state: WorkspacesState) => T): T {
  return useStore(workspacesStore, selector);
}
