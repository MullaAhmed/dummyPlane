import { createStore, useStore } from "zustand";
import { getSetting, setSetting, type Workspace } from "@/ipc/db";
import { debounce } from "@/lib/debounce";
import { onFlushAll } from "@/lib/flush";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { onCapture, type Captured, type PlaneContext, type ToastKind } from "./capture";

/** The history keeps this many popups, the newest. */
export const MAX_NOTIFICATIONS = 200;
export const NOTIFICATIONS_KEY = "ui.notifications";
/** A burst of popups is one write. */
const SAVE_DELAY_MS = 1000;

/**
 * The plane a popup is about: the project and workspace (the canvas) it concerns, and the node when it is
 * about one. The names are what they were when it popped; the panel shows the current ones from the stores.
 */
export interface Plane {
  projectId: string | null;
  workspaceId: string | null;
  nodeId: string | null;
  projectName: string | null;
  workspaceName: string | null;
}

export interface NotificationEntry {
  id: string;
  /** The id sonner showed it under, while the app runs: a popup shown again under it replaces this entry. Never saved. */
  toastId?: string | number;
  at: number;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: string;
  read: boolean;
  plane: Plane;
}

export interface NotificationsState {
  /** Newest first. */
  entries: NotificationEntry[];
  /** The saved history was read (or could not be): until then nothing is written over it. */
  loaded: boolean;
  add: (toast: Captured) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

const KINDS: readonly ToastKind[] = ["success", "error", "warning", "info", "plain"];
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** An entry as it was saved: anything unreadable is dropped, so one bad row never loses the rest. */
function readEntry(raw: unknown): NotificationEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const title = text(row.title);
  const kind = KINDS.find((k) => k === row.kind);
  if (!id || !title || !kind || typeof row.at !== "number" || !Number.isFinite(row.at)) return null;
  const plane = typeof row.plane === "object" && row.plane !== null ? (row.plane as Record<string, unknown>) : {};
  const entry: NotificationEntry = {
    id,
    at: row.at,
    kind,
    title,
    read: row.read === true,
    plane: {
      projectId: text(plane.projectId),
      workspaceId: text(plane.workspaceId),
      nodeId: text(plane.nodeId),
      projectName: text(plane.projectName),
      workspaceName: text(plane.workspaceName),
    },
  };
  const description = text(row.description);
  const action = text(row.action);
  if (description) entry.description = description;
  if (action) entry.action = action;
  return entry;
}

/** The saved history: the entries it can read, newest first, at most MAX_NOTIFICATIONS. */
export function readNotifications(raw: unknown): NotificationEntry[] {
  if (!Array.isArray(raw)) return [];
  return newest(raw.map(readEntry).filter((entry): entry is NotificationEntry => entry !== null));
}

/** Newest first, no id twice, at most MAX_NOTIFICATIONS. */
function newest(entries: NotificationEntry[]): NotificationEntry[] {
  const ids = new Set<string>();
  const distinct = entries.filter((entry) => {
    if (ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  });
  return distinct.sort((a, b) => b.at - a.at).slice(0, MAX_NOTIFICATIONS);
}

/** What is written: the entries as they are, without the ids sonner showed them under (they restart with each launch). */
function savable(entries: NotificationEntry[]): unknown[] {
  return entries.map(({ toastId: _toastId, ...entry }) => entry);
}

/** The workspaces seen this run, with their project: a node of a project no longer open still has its plane. */
const knownWorkspaces = new Map<string, { projectId: string; name: string }>();

function remember(workspaces: readonly Workspace[]) {
  for (const w of workspaces) knownWorkspaces.set(w.id, { projectId: w.projectId, name: w.name });
}

/**
 * The plane a popup is about: its node's workspace when it names a node, else the workspace it names, else
 * the workspace on screen. Nothing on the home screen: no workspace is shown there.
 */
export function planeOf(context: PlaneContext | null): Plane {
  const workspaces = workspacesStore.getState();
  const record = context?.nodeId ? nodesStore.getState().nodes[context.nodeId] : undefined;
  const onScreen = projectsStore.getState().view === "project" ? workspaces.activeId : null;
  const workspaceId = record?.workspaceId ?? context?.workspaceId ?? onScreen;
  const live = workspaceId ? workspaces.workspaces.find((w) => w.id === workspaceId) : undefined;
  const known = workspaceId ? knownWorkspaces.get(workspaceId) : undefined;
  const projectId = live?.projectId ?? known?.projectId ?? null;
  return {
    projectId,
    workspaceId: workspaceId ?? null,
    nodeId: record ? (context?.nodeId ?? null) : null,
    projectName: projectId ? (projectsStore.getState().projects.find((p) => p.id === projectId)?.name ?? null) : null,
    workspaceName: live?.name ?? known?.name ?? null,
  };
}

let sequence = 0;
const newId = () => `${Date.now().toString(36)}-${(sequence++).toString(36)}`;

export function createNotificationsStore() {
  return createStore<NotificationsState>()((set) => ({
    entries: [],
    loaded: false,

    add: (toast) =>
      set((s) => {
        // A popup shown again under the id it has, with the same words, is the same news: read stays read, so an offer
        // that comes back with each visit to a workspace is not unread each time.
        const again = toast.toastId === undefined ? undefined : s.entries.find((e) => e.toastId === toast.toastId);
        const same = again !== undefined && again.title === toast.title && again.description === toast.description;
        const entry: NotificationEntry = {
          id: newId(),
          at: toast.at,
          kind: toast.kind,
          title: toast.title,
          read: same && again.read,
          plane: planeOf(toast.context),
          ...(toast.toastId !== undefined ? { toastId: toast.toastId } : {}),
          ...(toast.description !== undefined ? { description: toast.description } : {}),
          ...(toast.action !== undefined ? { action: toast.action } : {}),
        };
        // A popup shown again under the id it already has is that popup, updated: one entry, at the top.
        const others = toast.toastId === undefined ? s.entries : s.entries.filter((e) => e.toastId !== toast.toastId);
        return { entries: [entry, ...others].slice(0, MAX_NOTIFICATIONS) };
      }),

    markRead: (id) =>
      set((s) => (s.entries.some((e) => e.id === id && !e.read) ? { entries: s.entries.map((e) => (e.id === id ? { ...e, read: true } : e)) } : s)),

    markAllRead: () => set((s) => (s.entries.some((e) => !e.read) ? { entries: s.entries.map((e) => (e.read ? e : { ...e, read: true })) } : s)),

    clear: () => set((s) => (s.entries.length > 0 ? { entries: [] } : s)),
  }));
}

export const notificationsStore = createNotificationsStore();

export function useNotifications<T>(selector: (state: NotificationsState) => T): T {
  return useStore(notificationsStore, selector);
}

/** How many entries are unread. */
export const unreadCount = (entries: readonly NotificationEntry[]) => entries.filter((e) => !e.read).length;

/** Writes the history, once it was read: before that the saved one is still the only copy. Never a popup on failure: it would be recorded. */
function save(): Promise<void> | undefined {
  const { entries, loaded } = notificationsStore.getState();
  if (!loaded) return undefined;
  return setSetting(NOTIFICATIONS_KEY, savable(entries)).catch((error: unknown) => console.warn("notifications not saved", error));
}

const saveSoon = debounce(save, SAVE_DELAY_MS);

let connected = false;

/**
 * At boot, first: popups are recorded from here on (the ones shown before it wait in `./capture`), and the
 * history is written after each change, a second after the last. Safe to call twice.
 */
export function connectNotifications() {
  if (connected) return;
  connected = true;
  remember(workspacesStore.getState().workspaces);
  workspacesStore.subscribe((state, before) => {
    if (state.workspaces !== before.workspaces) remember(state.workspaces);
  });
  onCapture((toast) => notificationsStore.getState().add(toast));
  notificationsStore.subscribe((state, before) => {
    if (state.entries !== before.entries) saveSoon();
  });
  onFlushAll(() => saveSoon.flush());
}

/**
 * At boot: reads the saved history and puts it under what was recorded meanwhile. A history that cannot be
 * read is left as it is on disk: nothing is written this run, so the next one still finds it.
 */
export async function loadNotifications() {
  connectNotifications();
  try {
    const saved = readNotifications(await getSetting<unknown>(NOTIFICATIONS_KEY));
    notificationsStore.setState((s) => ({ entries: newest([...s.entries, ...saved]), loaded: true }));
    // What was recorded before the read is written with it.
    saveSoon();
  } catch (error) {
    console.warn("notifications not loaded", error);
  }
}
