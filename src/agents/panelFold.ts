import { foldEditPanel } from "@/canvas/editPanel";
import { gitWindowStore } from "@/git/gitWindowStore";
import { reviewStore } from "@/review/reviewStore";
import { isCode, isNotes, workspacesStore } from "@/store/workspaces";
import { holdAgentsPanel, releaseAgentsPanel } from "./agentsPanelState";

const WINDOWS = ["review", "git", "code", "notes"] as const;

/** Which work windows are on screen: the review panel, the git window, and the Code Studio and Notes workspaces. */
export function openWorkWindows(): Record<(typeof WINDOWS)[number], boolean> {
  const { workspaces, activeId } = workspacesStore.getState();
  const active = workspaces.find((w) => w.id === activeId);
  return {
    review: reviewStore.getState().nodeId !== null,
    git: gitWindowStore.getState().path !== null,
    code: isCode(active),
    notes: isNotes(active),
  };
}

/**
 * What a work window that opens folds: the right lane's occupant (shell/layout.ts), the Agents panel, and an open Edit panel.
 * - A work window that opens folds the Agents panel to its rail badge, and it comes back when the last one goes if it
 *   was open before. A panel the person reopened over a window is folded again by the next one that opens (a review to
 *   the git window, Code Studio to Notes): their choice holds until the window it was made over closes. So the
 *   occupant is always newer than any open window, and stands above it where the window cannot start beside it.
 * - The window folds an open Edit panel too, back to the pencil in its node's header: the panel stands on the canvas,
 *   under the windows, and the window would hide it. The Edit panel stands beside its node, not in the lane: it and the
 *   Agents panel never fold each other.
 * Returns the stop.
 */
export function installPanelFold(): () => void {
  let was = openWorkWindows();
  if (WINDOWS.some((w) => was[w])) holdAgentsPanel();
  const check = () => {
    const now = openWorkWindows();
    const opened = WINDOWS.some((w) => now[w] && !was[w]);
    const anyBefore = WINDOWS.some((w) => was[w]);
    const anyNow = WINDOWS.some((w) => now[w]);
    was = now;
    if (opened) {
      holdAgentsPanel();
      foldEditPanel();
    } else if (anyBefore && !anyNow) releaseAgentsPanel();
  };
  const stops = [reviewStore.subscribe(check), gitWindowStore.subscribe(check), workspacesStore.subscribe(check)];
  return () => stops.forEach((stop) => stop());
}
