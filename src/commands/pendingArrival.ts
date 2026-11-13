import { toastError } from "@/lib/errorToast";
import { messages } from "@/i18n";
import { commandsMessages } from "./messages";
import { reach, type ReachKind } from "./reach";

export interface PendingArrival {
  workspaceId: string;
  kind: ReachKind;
  id: string;
  /** For the message when it is gone. */
  label: string;
  /** Says nothing when it is gone: the click of an old notification, whose node may be closed long since. */
  quiet?: boolean;
}

let pending: PendingArrival | null = null;

/** An item of another workspace: reached once that workspace's scene is on screen. */
export function requestArrival(target: PendingArrival) {
  pending = target;
}

/** `target` will not come about (the project that holds it would not open): it must not fire at a later visit. Another arrival asked since stays. */
export function cancelArrival(target: PendingArrival) {
  if (pending === target) pending = null;
}

/** An arrival still waits for the scene of `workspaceId`, which may already be the active workspace. */
export function arrivalPending(workspaceId: string): boolean {
  return pending?.workspaceId === workspaceId;
}

/** Reaches the pending item of `workspaceId`, now on screen; says so when it is gone. */
export function completeArrival(workspaceId: string) {
  if (!pending) return;
  // Another workspace came first: the user went elsewhere, the arrival is abandoned.
  if (pending.workspaceId !== workspaceId) {
    pending = null;
    return;
  }
  const target = pending;
  pending = null;
  if (!reach(target.kind, target.id) && !target.quiet) toastError(messages(commandsMessages).goTo.gone(target.label));
}
