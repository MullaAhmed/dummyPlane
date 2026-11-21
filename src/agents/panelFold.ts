import { editPanelStore, foldEditPanel } from "@/canvas/editPanel";
import { gitWindowStore } from "@/git/gitWindowStore";
import { reviewStore } from "@/review/reviewStore";
import { isCode, isNotes, workspacesStore } from "@/store/workspaces";
import { agentsPanelStore, holdAgentsPanel, releaseAgentsPanel } from "./agentsPanelState";

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

/** Whether a work window is on screen. */
function anyWorkWindow(): boolean {
  const now = openWorkWindows();
  return WINDOWS.some((w) => now[w]);
}

/**
 * The right lane has one occupant (shell/layout.ts): the Agents panel or a terminal's Edit panel.
 * - A work window that opens folds the Agents panel to its rail badge, and it comes back when the last one goes if it
 *   was open before. A panel the person reopened over a window is folded again by the next one that opens (a review to
 *   the git window, Code Studio to Notes): their choice holds until the window it was made over closes. The window
 *   folds an open Edit panel as well.
 * - The Edit panel that opens folds the Agents panel the same way, which comes back with the Edit panel's fold unless a
 *   work window is still open (that window's close brings it back).
 * - The Agents panel that the person opens folds the Edit panel.
 * So the occupant is always newer than any open window, and stands above it where the window cannot start beside it.
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
  const onEdit = (state: { openFor: string | null }, previous: { openFor: string | null }) => {
    if (state.openFor !== null && previous.openFor === null) holdAgentsPanel();
    else if (state.openFor === null && previous.openFor !== null && !anyWorkWindow()) releaseAgentsPanel();
  };
  const onAgents = (state: { open: boolean }, previous: { open: boolean }) => {
    if (state.open && !previous.open) foldEditPanel();
  };
  const stops = [
    reviewStore.subscribe(check),
    gitWindowStore.subscribe(check),
    workspacesStore.subscribe(check),
    editPanelStore.subscribe(onEdit),
    agentsPanelStore.subscribe(onAgents),
  ];
  return () => stops.forEach((stop) => stop());
}
