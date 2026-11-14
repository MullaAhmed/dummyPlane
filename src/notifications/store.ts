import { createStore, useStore } from "zustand";
import { getSetting, setSetting, type Workspace } from "@/ipc/db";
import { debounce } from "@/lib/debounce";
import { onFlushAll } from "@/lib/flush";
import { nodesStore } from "@/store/nodes";
import { projectsStore } from "@/store/projects";
import { workspacesStore } from "@/store/workspaces";
import { NOTIFICATION_TYPES, onRecord, type NotificationType, type PlaneContext, type Recorded, type ToastKind } from "./capture";

/** The panel keeps this many notifications, the newest. */
export const MAX_NOTIFICATIONS = 200;
export const NOTIFICATIONS_KEY = "ui.notifications";
/** A burst of notifications is one write. */
const SAVE_DELAY_MS = 1000;

/**
 * The plane a notification is about: the project and workspace (the canvas) it concerns, and the node when it is
 * about one. The names are what they were when it came; the panel shows the current ones from the stores.
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
  at: number;
  /** What it tells: an agent that finished, a board whose cards are all done, a question an agent asks. */
  type: NotificationType;
  /** The tone it shows in: the popups' own colours and icons. */
  kind: ToastKind;
  title: string;
  description?: string;
  read: boolean;
  plane: Plane;
}

export interface NotificationsState {
  /** Newest first. */
  entries: NotificationEntry[];
  /** The saved history was read (or could not be): until then nothing is written over it. */
  loaded: boolean;
  add: (notification: Recorded) => void;
  markRead: (id: string) => void;
  /** The questions of an agent that no longer waits: they are answered, or no longer asked. */
  markQuestionsRead: (nodeId: string) => void;
  markAllRead: () => void;
  clear: () => void;
}

const KINDS: readonly ToastKind[] = ["success", "error", "warning", "info", "plain"];
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * An entry as it was saved: anything unreadable is dropped, so one bad row never loses the rest. A row without a
 * type is a popup of the history kept before the panel kept three kinds of news: dropped, and the first save
 * writes over it.
 */
function readEntry(raw: unknown): NotificationEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const title = text(row.title);
  const kind = KINDS.find((k) => k === row.kind);
  const type = NOTIFICATION_TYPES.find((t) => t === row.type);
  if (!id || !title || !kind || !type || typeof row.at !== "number" || !Number.isFinite(row.at)) return null;
  const plane = typeof row.plane === "object" && row.plane !== null ? (row.plane as Record<string, unknown>) : {};
  const entry: NotificationEntry = {
    id,
    at: row.at,
    type,
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
  if (description) entry.description = description;
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

/** What is written: the entries as they are. */
function savable(entries: NotificationEntry[]): unknown[] {
  return [...entries];
}

/** The workspaces seen this run, with their project: a node of a project no longer open still has its plane. */
const knownWorkspaces = new Map<string, { projectId: string; name: string }>();

function remember(workspaces: readonly Workspace[]) {
  for (const w of workspaces) knownWorkspaces.set(w.id, { projectId: w.projectId, name: w.name });
}

/**
 * The plane a notification is about: its node's workspace when it names a node, else the workspace it names,
 * else the workspace on screen. Nothing on the home screen: no workspace is shown there.
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

    add: (notification) =>
      set((s) => {
        const entry: NotificationEntry = {
          id: newId(),
          at: notification.at,
          type: notification.type,
          kind: notification.kind,
          title: notification.title,
          read: notification.read,
          plane: planeOf(notification.context),
          ...(notification.description !== undefined ? { description: notification.description } : {}),
        };
        return { entries: [entry, ...s.entries].slice(0, MAX_NOTIFICATIONS) };
      }),

    markRead: (id) =>
      set((s) => (s.entries.some((e) => e.id === id && !e.read) ? { entries: s.entries.map((e) => (e.id === id ? { ...e, read: true } : e)) } : s)),

    markQuestionsRead: (nodeId) =>
      set((s) => {
        const asked = (e: NotificationEntry) => !e.read && e.type === "question" && e.plane.nodeId === nodeId;
        return s.entries.some(asked) ? { entries: s.entries.map((e) => (asked(e) ? { ...e, read: true } : e)) } : s;
      }),

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

/** Writes the list, once it was read: before that the saved one is still the only copy. Its failure goes to the log only. */
function save(): Promise<void> | undefined {
  const { entries, loaded } = notificationsStore.getState();
  if (!loaded) return undefined;
  return setSetting(NOTIFICATIONS_KEY, savable(entries)).catch((error: unknown) => console.warn("notifications not saved", error));
}

const saveSoon = debounce(save, SAVE_DELAY_MS);

let connected = false;

/**
 * At boot, first: notifications are kept from here on (the ones recorded before it wait in `./capture`), and
 * the list is written after each change, a second after the last. Safe to call twice.
 */
export function connectNotifications() {
  if (connected) return;
  connected = true;
  remember(workspacesStore.getState().workspaces);
  workspacesStore.subscribe((state, before) => {
    if (state.workspaces !== before.workspaces) remember(state.workspaces);
  });
  onRecord((notification) => notificationsStore.getState().add(notification));
  notificationsStore.subscribe((state, before) => {
    if (state.entries !== before.entries) saveSoon();
  });
  onFlushAll(() => saveSoon.flush());
}

/**
 * At boot: reads the saved list and puts it under what was recorded meanwhile. A list that cannot be read is
 * left as it is on disk: nothing is written this run, so the next one still finds it. Rows it reads but cannot
 * take (the popups kept before the three kinds) are dropped, and written over.
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
