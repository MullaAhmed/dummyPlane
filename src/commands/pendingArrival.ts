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
}

let pending: PendingArrival | null = null;

/** An item of another workspace: reached once that workspace's scene is on screen. */
export function requestArrival(target: PendingArrival) {
  pending = target;
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
  if (!reach(target.kind, target.id)) toastError(messages(commandsMessages).goTo.gone(target.label));
}
