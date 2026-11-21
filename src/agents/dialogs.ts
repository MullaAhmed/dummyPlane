import { messages } from "@/i18n";
import { agentMessages } from "@/mcp/messages";
import { freshText } from "@/nodes/terminal/registry";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, sessionOf } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { dialogOf, type DialogKind, type ScreenDialog } from "./dialogScreen";

export type { DialogKind, ScreenDialog } from "./dialogScreen";

/** A dialog an agent waits on: as its screen showed it, since when, and when Claude Code refuses it by itself. */
export interface PendingDialog extends ScreenDialog {
  /** Wall-clock ms: when it began to wait. */
  since: number;
  /** Wall-clock ms: when Claude Code refuses the request by itself (an unattended session's permission request). */
  blocksAt?: number;
}

function dated(dialog: ScreenDialog, since: number, readAt = Date.now()): PendingDialog {
  return { ...dialog, since, ...(dialog.blocksInMs !== undefined ? { blocksAt: readAt + dialog.blocksInMs } : {}) };
}

/**
 * The `held` of a readiness probe (`@/mission/ready`) for node `nodeId`: while a dialog holds its session from
 * opening, its agent waits for the user (its pill, the counts, its parent's line: `@/mission/events`); `then` hears it too.
 */
export function holdFor(nodeId: string, then?: (dialog: ScreenDialog | null) => void): (dialog: ScreenDialog | null) => void {
  return (dialog) => {
    const now = Date.now();
    const waiting = dialog && { activity: "waiting" as const, since: now, message: dialog.question ?? dialog.title, dialog: dated(dialog, now, now) };
    agentActivityStore.getState().hold(nodeId, waiting);
    then?.(dialog);
  };
}

/** Whether a dialog read on its screen holds node `nodeId`'s session from opening (`holdFor`). */
export function heldByDialog(nodeId: string): boolean {
  return nodeId in agentActivityStore.getState().under;
}

/**
 * The dialog node `nodeId`'s agent waits on, or null when it waits on none: the one that holds its session from
 * opening (`holdFor`), or the one its screen shows while its CLI says it waits for the user (Claude's permission
 * request or question, from its hooks), read now. Its text is the agent's terminal's: untrusted.
 */
export function pendingDialog(nodeId: string): PendingDialog | null {
  const now = agentActivityStore.getState().activities[nodeId];
  if (now?.activity !== "waiting" || !isRunning(nodeId)) return null;
  if (now.dialog) return now.dialog;
  const read = dialogOf(freshText(nodeId, 50), sessionOf(nodesStore.getState().nodes[nodeId])?.agent);
  if (read) return dated(read, now.since);
  // Its screen unread (not drawn here yet): its CLI's own words.
  const kind: DialogKind = /permission/i.test(now.message ?? "") ? "permission" : "question";
  return { kind, title: now.message ?? "", options: [], since: now.since };
}

/** "1:50" */
const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** What an agent waits on, for the line its parent reads; undefined when nothing tells. */
export function dialogText(dialog: PendingDialog | null, now = Date.now()): string | undefined {
  if (!dialog) return undefined;
  const t = messages(agentMessages).dialogs;
  const what =
    dialog.kind === "permission"
      ? t.permission([dialog.title, dialog.detail && `(${dialog.detail})`].filter(Boolean).join(" "), dialog.question)
      : dialog.kind === "mcp" || dialog.kind === "login"
        ? t[dialog.kind](dialog.title)
        : t[dialog.kind](dialog.question ?? dialog.title);
  const left = dialog.blocksAt === undefined ? 0 : dialog.blocksAt - now;
  return left > 0 ? `${what}${t.blocks(clock(left))}` : what;
}
