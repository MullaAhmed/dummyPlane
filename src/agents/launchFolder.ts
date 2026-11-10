import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { createStore, useStore } from "zustand";
import { messages } from "@/i18n";
import { getSetting, setSetting } from "@/ipc/db";
import { projectsStore, useProjects } from "@/store/projects";
import { ownFolder, useActiveFolder } from "@/store/workspaceFolder";
import { isCode, workspacesStore } from "@/store/workspaces";
import { agentsMessages } from "./messages";

/** The folders offered again under the current one. */
export const MAX_RECENT_FOLDERS = 5;

/** The folders used lately, per project. The folder itself is the workspace's. */
export const launchFolderKey = (projectId: string) => `launch.folder.${projectId}`;

/** What is saved for a project. */
interface Saved {
  recent: string[];
}

/** Same folder, whatever its case, separator or trailing one (Windows paths, like lib/paths). */
export function sameFolder(a: string, b: string): boolean {
  const key = (path: string) => path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return key(a) === key(b);
}

/** `folder` first, an earlier copy removed, the list kept short. */
export function pushRecent(recent: readonly string[], folder: string): string[] {
  const path = folder.trim();
  if (!path) return [...recent];
  return [path, ...recent.filter((entry) => !sameFolder(entry, path))].slice(0, MAX_RECENT_FOLDERS);
}

/**
 * What is saved for a project; anything unreadable is "nothing". `folder` is the project-wide
 * launch folder an earlier version saved: it now belongs to a workspace (`adoptLegacyFolder`).
 */
export function readSaved(raw: unknown): Saved & { folder: string | null } {
  if (raw === null || typeof raw !== "object") return { folder: null, recent: [] };
  const { folder, recent } = raw as { folder?: unknown; recent?: unknown };
  const folders = Array.isArray(recent) ? recent.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
  return {
    folder: typeof folder === "string" && folder.trim() !== "" ? folder : null,
    recent: folders.reduceRight<string[]>((kept, entry) => pushRecent(kept, entry), []).slice(0, MAX_RECENT_FOLDERS),
  };
}

const projectPathOf = (projectId: string | null) => projectsStore.getState().projects.find((p) => p.id === projectId)?.path ?? "";

/** The workspace a folder change applies to: the one named, else the active one; never the code workspace (it stays on the project). */
function targetWorkspace(workspaceId?: string) {
  const { workspaces, activeId } = workspacesStore.getState();
  const workspace = workspaces.find((w) => w.id === (workspaceId ?? activeId));
  return workspace && !isCode(workspace) ? workspace : null;
}

interface LaunchFolderState extends Saved {
  /** The project the list below belongs to. */
  projectId: string | null;
  /** The saved list was read: until then a change is kept in memory only. */
  loaded: boolean;
  /** Settles when the saved list of `projectId` was read, or could not be. */
  ready: Promise<void>;
  load: (projectId: string) => Promise<void>;
  /**
   * The folder the next launches of a workspace (`workspaceId`, else the active one) use, and one
   * of the recent ones. The project's own folder is no choice: it clears it. The workspace
   * changes at once; the promise rejects when the save is refused (the old folder is back).
   */
  choose: (path: string, workspaceId?: string) => Promise<void>;
  /** The workspace (`workspaceId`, else the active one) goes back to the project folder. */
  useProjectFolder: (workspaceId?: string) => Promise<void>;
  /** A folder used once ("New terminal in folder…"): offered again, but the next launches stay where they were. */
  remember: (path: string) => void;
}

export const launchFolderStore = createStore<LaunchFolderState>()((set, get) => {
  const save = () => {
    const { projectId, recent, loaded } = get();
    if (!projectId || !loaded) return;
    setSetting(launchFolderKey(projectId), { recent } satisfies Saved).catch((error: unknown) => console.warn("recent folders not saved", error));
  };
  const remember = (path: string) => {
    if (!get().projectId) return;
    set({ recent: pushRecent(get().recent, path) });
    save();
  };
  return {
    projectId: null,
    recent: [],
    loaded: false,
    ready: Promise.resolve(),

    load: (projectId) => {
      if (get().projectId === projectId) return get().ready;
      const ready = read(projectId);
      set({ projectId, recent: [], loaded: false, ready });
      return ready;
    },

    choose: async (path, workspaceId) => {
      const folder = path.trim();
      const workspace = targetWorkspace(workspaceId);
      if (!folder || !workspace) return;
      if (sameFolder(folder, projectPathOf(workspace.projectId))) return workspacesStore.getState().setFolder(workspace.id, null);
      remember(folder);
      return workspacesStore.getState().setFolder(workspace.id, folder);
    },

    useProjectFolder: async (workspaceId) => {
      const workspace = targetWorkspace(workspaceId);
      if (workspace) await workspacesStore.getState().setFolder(workspace.id, null);
    },

    remember,
  };

  /** Reads the saved list of a project, once it is the one the store is on. */
  async function read(projectId: string) {
    let saved: unknown;
    try {
      saved = await getSetting<unknown>(launchFolderKey(projectId));
    } catch (error) {
      // Left unloaded: this session's list stays in memory, nothing is saved over the unread one.
      console.warn("recent folders not read", error);
      return;
    }
    if (get().projectId !== projectId) return;
    const before = readSaved(saved);
    // What was used while it was being read stays at the head of the list.
    const now = get();
    const recent = now.recent.reduceRight((kept, entry) => pushRecent(kept, entry), before.recent);
    set({ recent, loaded: true });
    if (now.recent.length > 0) save();
    // Saving the list drops the folder an earlier version kept here: only once a workspace has taken it.
    if (before.folder) void adoptLegacyFolder(projectId, before.folder).then((taken) => taken && get().projectId === projectId && save());
  }
});

/** Settles once the workspaces of `projectId` are loaded; false when the project went away first. */
function workspacesReady(projectId: string): Promise<boolean> {
  const ready = () => workspacesStore.getState().projectId === projectId && workspacesStore.getState().status === "ready";
  if (ready()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = workspacesStore.subscribe(() => {
      const away = launchFolderStore.getState().projectId !== projectId;
      if (!away && !ready()) return;
      off();
      resolve(!away);
    });
  });
}

/**
 * An earlier version saved one launch folder for the whole project. It goes to the workspace that is
 * active when the project opens, once, unless that one already has a folder. False when it could not
 * be taken (the project went away, or the save failed): it stays saved for the next time.
 */
async function adoptLegacyFolder(projectId: string, folder: string): Promise<boolean> {
  if (!(await workspacesReady(projectId))) return false;
  const { workspaces, activeId } = workspacesStore.getState();
  const active = workspaces.find((w) => w.id === activeId);
  if (!active || isCode(active) || ownFolder(active) !== null || sameFolder(folder, projectPathOf(projectId))) return true;
  try {
    await workspacesStore.getState().setFolder(active.id, folder);
    return true;
  } catch (error) {
    console.warn("launch folder not moved to its workspace", error);
    return false;
  }
}

/** The list follows the open project: loaded as soon as one is open, not when a menu asks. */
function followActiveProject(activeId: string | null) {
  if (activeId) void launchFolderStore.getState().load(activeId);
  else launchFolderStore.setState({ projectId: null, recent: [], loaded: false });
}
projectsStore.subscribe((state, before) => {
  if (state.activeId !== before.activeId) followActiveProject(state.activeId);
});
followActiveProject(projectsStore.getState().activeId);

export interface LaunchFolderView {
  /** Where the next launches of the active workspace start: its folder, else the project's. */
  folder: string;
  projectFolder: string;
  /** The workspace works in a folder other than the project's. */
  custom: boolean;
  /** Folders used lately, without the ones already shown. */
  recent: string[];
}

/** The launch folder of the active workspace, for the menus that show it. */
export function useLaunchFolder(): LaunchFolderView {
  const activeId = useProjects((s) => s.activeId);
  const { folder, projectFolder, custom } = useActiveFolder();
  const state = useStore(launchFolderStore);
  const shown = (path: string) => sameFolder(path, folder) || sameFolder(path, projectFolder);
  return { folder, projectFolder, custom, recent: state.projectId === activeId ? state.recent.filter((path) => !shown(path)) : [] };
}

/** A refused save, told to the user: the workspace is back on its old folder. */
export const folderSaveFailed = (error: unknown) => toast.error(messages(agentsMessages).launchFolder.saveFailed(String(error)));

/** The native folder picker, opened on `from`; null when it was cancelled. */
export async function pickFolder(from?: string): Promise<string | null> {
  const picked = await open({ directory: true, defaultPath: from || undefined, title: messages(agentsMessages).launchFolder.pickTitle });
  return typeof picked === "string" ? picked : null;
}

/** The last segment of a path: what a terminal's title shows ("D:\code\api" → "api"). */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
