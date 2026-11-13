/**
 * What the notification panel is told, before it knows anything of the app's stores.
 *
 * The panel keeps three kinds of news, each recorded where it happens with `recordNotification`: an agent that
 * finished (`@/shell/finishAlert`), a board whose cards are all done (`@/shell/boardDoneAlert`) and a question an
 * agent asks (`@/shell/waitingAlert`). Popups are not recorded: the shim (`./sonner`) passes them through as sonner's.
 * This file imports nothing of the app on purpose, but the cut (`@/lib/cut`, which imports nothing): what records
 * here sits under many call sites, and a store imported from here would be a cycle. The panel (`./store`) connects
 * at boot with `onRecord`; news recorded before that waits here.
 */

import { cutWhole, HALF_CHARACTER } from "@/lib/cut";

/** The tone a notification is shown in: the popups' own colours and icons. */
export type ToastKind = "success" | "error" | "warning" | "info" | "plain";

/** What the panel keeps: an agent that finished, a board whose cards are all done, a question an agent asks. */
export type NotificationType = "finished" | "board" | "question";

export const NOTIFICATION_TYPES: readonly NotificationType[] = ["finished", "board", "question"];

/** What a notification is about: the node it concerns (its workspace is the node's), or a workspace outright. */
export interface PlaneContext {
  nodeId?: string;
  workspaceId?: string;
  /** What a popup that is only a component shows: no longer read, the panel records no popups. */
  text?: string;
}

/** A notification as recorded: flat text, never React nodes, so it can be stored and saved. */
export interface Recorded {
  type: NotificationType;
  kind: ToastKind;
  title: string;
  description: string | undefined;
  context: PlaneContext | null;
  /** Read already: the user was looking at what it is about when it happened. */
  read: boolean;
  at: number;
}

/** What a call site records. */
export interface NewNotification {
  type: NotificationType;
  kind: ToastKind;
  title: string;
  description?: string;
  context?: PlaneContext | null;
  read?: boolean;
}

/** The longest title and description kept, in characters: a notification is a sentence, not a log. */
export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 600;

// The panel's list is saved as JSON, which Rust refuses with half a character in it: none is kept, cut here or before it came.
const flat = (text: string) => text.replace(HALF_CHARACTER, "").replace(/\s+/g, " ").trim();
const clip = (text: string, max: number) => (text.length > max ? `${cutWhole(text, max - 1).trimEnd()}…` : text);

/**
 * Runs `show` as it is. It once told the popups shown inside it which node or workspace they were about, for a
 * history of every popup; the panel records no popups now, and its call sites have nothing more to do.
 */
export function withPlane<T>(_context: PlaneContext, show: () => T): T {
  return show();
}

type Listener = (notification: Recorded) => void;

/** Notifications recorded before the panel connects (boot's own); few, and never kept past this many. */
const WAITING_MAX = 50;
let listener: Listener | null = null;
let waiting: Recorded[] = [];

/** The panel takes every notification from now on, and the ones that waited for it first. Returns how to stop. */
export function onRecord(next: Listener): () => void {
  listener = next;
  const early = waiting;
  waiting = [];
  // One that fails to be kept is lost, not the ones after it, and never the boot that connects the panel.
  for (const notification of early) {
    try {
      next(notification);
    } catch (error) {
      console.warn("notification not recorded", error);
    }
  }
  return () => {
    if (listener === next) listener = null;
  };
}

/**
 * Records a notification in the panel, where it happened: never a popup, which shows by itself. Never throws:
 * a failed record must not stop the alert that calls it. One with no words has nothing to list.
 */
export function recordNotification({ type, kind, title, description, context = null, read = false }: NewNotification): void {
  try {
    const words = clip(flat(title), MAX_TITLE);
    if (words === "") return;
    const detail = description === undefined ? "" : flat(description);
    const notification: Recorded = {
      type,
      kind,
      title: words,
      description: detail === "" ? undefined : clip(detail, MAX_DESCRIPTION),
      context,
      read,
      at: Date.now(),
    };
    if (listener) listener(notification);
    else waiting = [...waiting, notification].slice(-WAITING_MAX);
  } catch (error) {
    console.warn("notification not recorded", error);
  }
}
