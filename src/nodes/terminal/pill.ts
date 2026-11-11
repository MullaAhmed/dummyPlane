import type { Activity } from "@/ipc/activity";
import type { AgentActivity } from "@/store/agentActivity";
import type { TerminalStatus } from "@/store/terminalStatus";
import { messages } from "@/i18n";
import { nodesMessages } from "@/nodes/messages";
import type { TerminalReportStatus } from "@/nodes/types";

export type PillTone = "live" | "ready" | "working" | "workingIndigo" | "waiting" | "stopped" | "done" | "failed";

/** A report reads like a status: done rests (ok), blocked waits for the user, failed is an error. */
const REPORT_TONES: Record<TerminalReportStatus, PillTone> = { done: "done", blocked: "waiting", failed: "failed" };

export interface Pill {
  label: string;
  tone: PillTone;
  /** Set when the pill tells what the agent's last report said (it is not at work). */
  report?: TerminalReportStatus;
}

/** An agent's activity as its pill reads it; "left": Claude exited, its terminal is back at the shell. */
export type PillActivity = Activity | "left";

/** What the pill reads of a terminal's activity: nothing unless its process runs. */
export function pillActivity(status: TerminalStatus, activity?: AgentActivity): PillActivity | undefined {
  if (status.state !== "running" || !activity) return undefined;
  return activity.left ? "left" : activity.activity;
}

/**
 * The status pill of a terminal header (spec habillage §7.2): the process
 * state, and for a running process its activity. A running agent that is not at
 * work and whose last `report` stands has finished: done, blocked or failed
 * rather than Ready. As soon as it works again it is Working. A shell whose
 * Claude exited says so, whatever the shell does: the node has no agent.
 */
export function pillOf(status: TerminalStatus, activity?: PillActivity, indigo = false, report?: TerminalReportStatus): Pill {
  const t = messages(nodesMessages).pill;
  switch (status.state) {
    case "starting":
      return { label: t.starting, tone: "stopped" };
    case "running":
      if (activity === "left") return { label: t.left, tone: "stopped" };
      if (activity === "working") return { label: t.working, tone: indigo ? "workingIndigo" : "working" };
      if (activity === "waiting") return { label: t.waiting, tone: "waiting" };
      if (report) return { label: t[report], tone: REPORT_TONES[report], report };
      if (activity === "idle") return { label: t.ready, tone: "ready" };
      return { label: t.active, tone: "live" };
    case "stopped":
      return { label: t.stopped, tone: "stopped" };
    case "exited":
      return {
        label: status.code === null ? t.exited : t.exitedWith(status.code),
        tone: status.code === null || status.code === 0 ? "done" : "failed",
      };
    case "error":
      return { label: status.kind === "toolsUnavailable" ? t.toolsUnavailable : t.error, tone: "failed" };
  }
}

/**
 * What the card over a stopped terminal offers (spec habillage §7.3); `resumable`: it has a conversation to take up (`canResume`).
 * `left`: its Claude exited and the shell runs on; the card offers the agent back.
 */
export function resumeOfferOf(status: TerminalStatus, resumable: boolean, left = false): "resume" | "relaunch" | null {
  if (status.state === "starting" || (status.state === "running" && !left)) return null;
  // A refused fleet's node says why and offers its own retry.
  if (status.state === "error" && status.kind === "toolsUnavailable") return null;
  return resumable ? "resume" : "relaunch";
}

/**
 * Typing in a terminal where nothing runs starts it again. Only real keystrokes
 * count: a restored screen makes xterm answer old terminal queries by itself.
 * A stray key must not run an installer again: a one-shot command never starts this way.
 */
export function startsOnKeystroke(status: TerminalStatus, oneShot = false): boolean {
  return !oneShot && status.state !== "running" && status.state !== "starting";
}

/**
 * "Typing" in "typing starts fresh": a character or Enter. Escape, arrows,
 * function keys and shortcuts (Ctrl+C, Ctrl+Z…) are reflexes, not typing, and
 * must not throw away the conversation the card offers to resume. AltGr
 * characters (Ctrl+Alt on Windows) count as typing.
 */
export function isTypingKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">): boolean {
  const altGr = e.ctrlKey && e.altKey;
  const shortcut = e.metaKey || (!altGr && (e.ctrlKey || e.altKey));
  return !shortcut && ([...e.key].length === 1 || e.key === "Enter");
}

/** A failed launch created no conversation: retrying keeps the same Claude session id. */
export function startsNewConversation(status: TerminalStatus): boolean {
  return status.state !== "error";
}
