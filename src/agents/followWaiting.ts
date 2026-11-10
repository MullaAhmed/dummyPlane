import { followWaitingStore } from "@/app/followWaitingSetting";
import { canvasStore } from "@/canvas/canvasStore";
import { terminalWithKeyboard } from "@/canvas/keyboardFocus";
import { lastKeyTime, TYPING_MS, userIsWriting } from "@/canvas/typing";
import { goToAgent } from "@/commands/goToRun";
import { paletteStore } from "@/commands/paletteState";
import { pendingUiRequest } from "@/commands/uiRequests";
import { agentActivityStore } from "@/store/agentActivity";
import { projectsStore } from "@/store/projects";
import { currentWaitingAgents } from "./waitingAgents";

/** How often a jump that cannot happen yet looks again: nothing tells it that a menu closed or that the keyboard left a terminal. */
export const RETRY_MS = 500;

/** What stands over the canvas while it is open: a dialog, a menu or popover (Radix ones), the radial menu. */
const OPEN_OVERLAY = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[data-radix-popper-content-wrapper] [data-state="open"]',
  "[data-radial]",
].join(", ");

/** The agents that started waiting and are not yet gone to: the one waiting longest first (the order of `currentWaitingAgents`). */
const pending = new Set<string>();
/** The agent the user was taken to, or is answering: while it waits, nobody else is. */
let followed: string | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;

/** The terminal or fleet that has the keyboard: an xterm's textarea, or a fleet's field. */
function keyboardIn(): string | null {
  return terminalWithKeyboard() ?? document.activeElement?.closest("[data-fleet]")?.getAttribute("data-fleet") ?? null;
}

/** Something is open over the canvas, or about to be (a panel a command just asked for): the user is busy there. */
function overlayIsOpen(): boolean {
  return paletteStore.getState().open || pendingUiRequest() !== null || document.querySelector(OPEN_OVERLAY) !== null;
}

/** The window has not the focus (the Windows notification covers it), or no project is open: nowhere to take the user. */
function awayFromCanvas(): boolean {
  return !document.hasFocus() || projectsStore.getState().view !== "project";
}

function reset() {
  clearTimeout(retry);
  retry = undefined;
  pending.clear();
  followed = null;
}

/**
 * Takes the user to the agent that waits longest among those that started waiting, if nothing is in the way:
 * the window is focused, the canvas is not in reading mode, no dialog or menu is open, the keyboard is not in
 * another terminal that waits, no agent taken to is still waiting, and the user has paused writing (no key for
 * 3 s, and no unsent draft in the focused field for 10 s: a field that merely rests focused does not hold it).
 * Otherwise it looks again later, and an agent that stopped waiting meanwhile is dropped.
 */
function follow() {
  clearTimeout(retry);
  retry = undefined;
  if (!followWaitingStore.getState().enabled) return reset();
  const waiting = currentWaitingAgents();
  const ids = new Set(waiting.map((agent) => agent.id));
  for (const id of pending) if (!ids.has(id)) pending.delete(id);
  if (followed !== null && !ids.has(followed)) followed = null;
  // The keyboard is in an agent that waits: the user is there, and nobody else is brought over it. If it has just
  // started waiting, it is gone to first: its xterm keeps the keyboard through a pan or a zoom, and the view may be elsewhere.
  const keyboard = keyboardIn();
  const holder = keyboard !== null && ids.has(keyboard) ? keyboard : null;
  if (holder !== null && !pending.has(holder)) followed = holder;
  const next = waiting.find((agent) => (holder === null ? pending.has(agent.id) : agent.id === holder && pending.has(holder)));
  if (next && (followed === null || next.id === holder) && !awayFromCanvas() && canvasStore.getState().view.mode !== "reading" && !overlayIsOpen() && !userIsWriting()) {
    pending.delete(next.id);
    followed = next.id;
    goToAgent(next);
  }
  // Keys keep the way shut for what is left of their 3 s at least; a draft is looked at again every RETRY_MS.
  if (pending.size > 0) retry = setTimeout(follow, Math.max(RETRY_MS, lastKeyTime() + TYPING_MS - Date.now()));
}

/**
 * Takes the user to an agent that starts waiting (the view moves, its terminal gets the keyboard), one at a
 * time, oldest first, never while they write. Installed after the activity snapshot, so a reload does not take
 * the user to the agents already waiting. Off with the "Go to agents that ask" setting.
 */
export function installFollowWaiting(): () => void {
  reset();
  const unsubscribe = agentActivityStore.subscribe((state, previous) => {
    if (!followWaitingStore.getState().enabled) return;
    for (const [nodeId, { activity, since }] of Object.entries(state.activities)) {
      const before = previous.activities[nodeId];
      // A later wait of an agent is a new one: the question that kept it waiting is the one still on screen.
      if (activity === "waiting" && (before?.activity !== "waiting" || before.since !== since)) pending.add(nodeId);
    }
    if (pending.size > 0 || followed !== null) follow();
  });
  const unsubscribeSetting = followWaitingStore.subscribe(({ enabled }) => {
    if (!enabled) reset();
  });
  // Back in the window: what waited meanwhile is gone to, if it still waits.
  window.addEventListener("focus", follow);
  return () => {
    unsubscribe();
    unsubscribeSetting();
    window.removeEventListener("focus", follow);
    reset();
  };
}
