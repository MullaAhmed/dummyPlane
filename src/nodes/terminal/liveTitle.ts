import { createStore, useStore } from "zustand";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";

/**
 * The title the program running in a terminal gives it now (OSC 0 or 2, xterm's
 * `onTitleChange`): Claude Code sets its own, a shell its path. Not the node's
 * stored `title`, which is only what dummyPlane hands Claude when a new
 * conversation starts. Kept in memory while the process runs: a title read
 * from a stopped terminal's restored screen, or one left by a process that
 * ended, is not live.
 */
const liveTitleStore = createStore<Record<string, string>>()(() => ({}));

const without = (titles: Record<string, string>, nodeId: string) => Object.fromEntries(Object.entries(titles).filter(([id]) => id !== nodeId));

let watching = false;
function forgetStopped() {
  if (watching) return;
  watching = true;
  terminalStatusStore.subscribe(({ statuses }) => {
    const titles = liveTitleStore.getState();
    const kept = Object.fromEntries(Object.entries(titles).filter(([id]) => statuses[id]?.state === "running"));
    if (Object.keys(kept).length !== Object.keys(titles).length) liveTitleStore.setState(kept, true);
  });
}

/** The running program set the terminal's title; an empty one clears it. Ignored while nothing runs (a restored screen). */
export function setLiveTitle(nodeId: string, title: string) {
  if (!isRunning(nodeId)) return;
  forgetStopped();
  const text = title.trim();
  const titles = liveTitleStore.getState();
  if ((titles[nodeId] ?? "") === text) return;
  liveTitleStore.setState(text ? { ...titles, [nodeId]: text } : without(titles, nodeId), true);
}

/** The terminal is gone. */
export function forgetLiveTitle(nodeId: string) {
  const titles = liveTitleStore.getState();
  if (nodeId in titles) liveTitleStore.setState(without(titles, nodeId), true);
}

export const liveTitleOf = (nodeId: string): string | undefined => liveTitleStore.getState()[nodeId];

export function useLiveTitle(nodeId: string): string | undefined {
  return useStore(liveTitleStore, (s) => s[nodeId]);
}
