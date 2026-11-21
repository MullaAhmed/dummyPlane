/**
 * The text the user has typed into a terminal and not sent yet, tracked from the keys xterm reports. A line dummyPlane
 * types for an agent (a Fleet's or a Manager's notice, a teammate's message) lands where the cursor is: in a half-written
 * sentence it would be spliced into it and, ending with an Enter, send the two together. The prompt itself cannot be
 * asked what it holds (each CLI draws its own, and a placeholder looks like text), so the draft is counted from the
 * keys: text and pastes add to it, Backspace takes one off, Enter and Ctrl+C / Ctrl+U clear it.
 */

import { agentActivityStore } from "@/store/agentActivity";

/** How long an untouched draft still holds a notice back: past it the user has left it, and the notice is typed. */
export const DRAFT_IDLE_MS = 10 * 60_000;

interface Draft {
  /** Characters typed or pasted and not deleted or sent: only whether it is above 0 matters. */
  length: number;
  /** When the user last changed it. */
  at: number;
}

const drafts = new Map<string, Draft>();
/** When each terminal last got a lone Escape: a second one right after clears the prompt (Claude's "Esc twice to clear"). */
const lastEscape = new Map<string, number>();
/** Two Escapes within this make one "clear". */
const DOUBLE_ESCAPE_MS = 800;

const BRACKETED_PASTE = /^\x1b\[200~([\s\S]*?)(?:\x1b\[201~)?$/;

/** Anything xterm sends that starts a sequence (arrows, focus reports, the answers to a query) edits no text. */
const isEscape = (data: string) => data.startsWith("\x1b");

/**
 * What xterm's `onData` gave for the terminal `nodeId`: what the user typed, pasted or composed, and also what xterm
 * answers on its own (a cursor report, a focus event), which edits nothing.
 */
export function trackInput(nodeId: string, data: string, now = Date.now()) {
  // A dialog waits for the user (a permission, a choice): the keys answer it, "2" or "y" with no Enter, and write no text.
  if (agentActivityStore.getState().activities[nodeId]?.activity === "waiting") return;
  const pasted = BRACKETED_PASTE.exec(data);
  // A paste is text, newlines included: only the Enter the user presses sends it.
  if (pasted) {
    if (pasted[1]) edit(nodeId, pasted[1].length, now);
    return;
  }
  if (data === "\x1b") {
    if (now - (lastEscape.get(nodeId) ?? -Infinity) < DOUBLE_ESCAPE_MS) drafts.delete(nodeId);
    lastEscape.set(nodeId, now);
    return;
  }
  if (isEscape(data)) return;
  for (const char of data) {
    // Enter sends; Ctrl+C and Ctrl+U clear what is written (Ctrl+D with text deletes, on an empty line it leaves).
    if (char === "\r" || char === "\x03" || char === "\x15") drafts.delete(nodeId);
    // Backspace, Ctrl+H, Ctrl+W (a word, counted as one: a draft cut to nothing by words leaves a count that Enter or
    // the idle time then ends).
    else if (char === "\x7f" || char === "\b" || char === "\x17") edit(nodeId, -1, now);
    // The other controls (Tab, Ctrl+L, Ctrl+A…) write no text.
    else if (char >= " ") edit(nodeId, 1, now);
    else if (char === "\n") edit(nodeId, 1, now);
  }
}

function edit(nodeId: string, by: number, now: number) {
  const length = Math.max(0, (drafts.get(nodeId)?.length ?? 0) + by);
  if (length === 0) drafts.delete(nodeId);
  else drafts.set(nodeId, { length, at: now });
}

/** Whether the user has text written in the terminal that nothing has sent or cleared, and has not left it for `DRAFT_IDLE_MS`. */
export function hasUnsentInput(nodeId: string, now = Date.now()): boolean {
  const draft = drafts.get(nodeId);
  if (!draft) return false;
  if (now - draft.at >= DRAFT_IDLE_MS) {
    drafts.delete(nodeId);
    return false;
  }
  return true;
}

/** Whether any terminal holds text the user wrote and has not sent or left (`hasUnsentInput`): they are in the middle of a sentence somewhere. */
export function unsentAnywhere(now = Date.now()): boolean {
  return [...drafts.keys()].some((nodeId) => hasUnsentInput(nodeId, now));
}

/** The terminal's session starts or ends: whatever was written in the old prompt went with it. */
export function clearDraft(nodeId: string) {
  drafts.delete(nodeId);
  lastEscape.delete(nodeId);
}
