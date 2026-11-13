/**
 * What the notification history sees of a popup, before it knows anything of the app's stores.
 *
 * Every `toast` call of the app goes through the shim (`./sonner`), which hands what it showed to `capture`.
 * This file imports nothing of the app on purpose: the shim sits under `errorToast` and a hundred call
 * sites, and a store imported from here would be a cycle. The history (`./store`) connects at boot with
 * `onCapture`; popups shown before that wait here.
 */

export type ToastKind = "success" | "error" | "warning" | "info" | "plain";

/**
 * What a popup is about, when it is not the workspace on screen: the node it concerns (its workspace is the
 * node's), or a workspace outright. `text` says what a popup that is only a component (`toast.custom`) shows.
 */
export interface PlaneContext {
  nodeId?: string;
  workspaceId?: string;
  text?: string;
}

/** A popup as the shim saw it: flat text, never React nodes, so it can be stored and saved. */
export interface Captured {
  /** The id sonner shows it under: a call that names one again updates the same popup. */
  toastId: string | number | undefined;
  kind: ToastKind;
  title: string;
  description: string | undefined;
  /** The label of its action button, when it has one. */
  action: string | undefined;
  context: PlaneContext | null;
  at: number;
}

/** What the shim passes in: sonner's own values, still unflattened. */
export interface RawToast {
  toastId?: string | number;
  kind: ToastKind;
  title: unknown;
  description?: unknown;
  action?: unknown;
}

/** The longest title and description kept, in characters: a popup is a sentence, not a log. */
export const MAX_TITLE = 300;
export const MAX_DESCRIPTION = 600;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * The words of what a popup shows. A title is a string, a React node (`toastError`'s description is two spans)
 * or a function returning either; the words of a node are its children's, in order. A component that renders its
 * own text from elsewhere has none to read here.
 */
export function plainText(node: unknown, depth = 0): string {
  if (depth > 12) return "";
  if (typeof node === "string") return node.replace(/\s+/g, " ").trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "function") {
    try {
      return plainText((node as () => unknown)(), depth + 1);
    } catch {
      return "";
    }
  }
  if (Array.isArray(node)) {
    return node
      .map((part) => plainText(part, depth + 1))
      .filter((part) => part !== "")
      .join(" ");
  }
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return plainText(props?.children, depth + 1);
  }
  return "";
}

/** The label of a toast's action: `{ label, onClick }`, or a node of its own. */
function actionLabel(action: unknown): string | undefined {
  const label = plainText(typeof action === "object" && action !== null && "label" in action ? (action as { label: unknown }).label : action);
  return label === "" ? undefined : label;
}

let ambient: PlaneContext | null = null;

/**
 * Runs `show` (the toast calls inside it) with the plane the popups are about: a call site that knows its node
 * or workspace says so here, and the popup shown is recorded under it, not under the workspace on screen.
 * The call's arguments stay as they were: sonner never sees the context.
 */
export function withPlane<T>(context: PlaneContext, show: () => T): T {
  const outer = ambient;
  ambient = context;
  try {
    return show();
  } finally {
    ambient = outer;
  }
}

/** The plane the call being made is about, if `withPlane` set one. */
export function currentPlane(): PlaneContext | null {
  return ambient;
}

type Listener = (toast: Captured) => void;

/** Popups shown before the history connects (boot's own); few, and never kept past this many. */
const WAITING_MAX = 50;
let listener: Listener | null = null;
let waiting: Captured[] = [];

/** The history takes every popup from now on, and the ones that waited for it first. Returns how to stop. */
export function onCapture(next: Listener): () => void {
  listener = next;
  const early = waiting;
  waiting = [];
  // One that fails to be recorded is lost, not the ones after it, and never the boot that connects the history.
  for (const toast of early) {
    try {
      next(toast);
    } catch (error) {
      console.warn("notification not recorded", error);
    }
  }
  return () => {
    if (listener === next) listener = null;
  };
}

/** Records a popup that was shown. Never throws: a failed record must not turn a popup into an error. */
export function capture(raw: RawToast): void {
  try {
    const context = ambient;
    const title = clip(plainText(raw.title) || (context?.text ?? ""), MAX_TITLE);
    // A popup with no words of its own has nothing to list.
    if (title === "") return;
    const description = plainText(raw.description);
    const toast: Captured = {
      toastId: raw.toastId,
      kind: raw.kind,
      title,
      description: description === "" ? undefined : clip(description, MAX_DESCRIPTION),
      action: actionLabel(raw.action),
      context,
      at: Date.now(),
    };
    if (listener) listener(toast);
    else waiting = [...waiting, toast].slice(-WAITING_MAX);
  } catch (error) {
    console.warn("notification not recorded", error);
  }
}
