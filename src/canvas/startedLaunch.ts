import { createStore, useStore } from "zustand";
import type { TerminalPayload } from "@/nodes/types";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";

/** What a launch reads from a terminal's payload: a running terminal keeps the values it started with. */
export interface LaunchSettings {
  cwd: string;
  shell: string;
  title: string;
  /** Only a Custom terminal runs its command; the others ignore it. */
  command: string;
}

export const launchSettingsOf = (payload: TerminalPayload): LaunchSettings => ({
  cwd: payload.cwd,
  shell: payload.shell,
  title: payload.title,
  command: payload.agent === "custom" ? payload.command : "",
});

/**
 * The launch settings a running terminal started with, noted when they first
 * change during that session. A terminal that stops loses its note: it starts
 * with whatever is stored.
 */
const startedStore = createStore<Record<string, LaunchSettings>>()(() => ({}));

let watching = false;
function forgetStopped() {
  if (watching) return;
  watching = true;
  terminalStatusStore.subscribe(({ statuses }) => {
    const started = startedStore.getState();
    const kept = Object.fromEntries(Object.entries(started).filter(([id]) => statuses[id]?.state === "running"));
    if (Object.keys(kept).length !== Object.keys(started).length) startedStore.setState(kept, true);
  });
}

/** Before the folder, shell, title or command of a terminal changes: a running one keeps what it started with. */
export function noteLaunchChange(nodeId: string, before: TerminalPayload) {
  if (!isRunning(nodeId) || nodeId in startedStore.getState()) return;
  forgetStopped();
  startedStore.setState({ [nodeId]: launchSettingsOf(before) });
}

/** The terminal restarts now: it starts with what is stored. */
export function forgetStartedLaunch(nodeId: string) {
  const started = startedStore.getState();
  if (nodeId in started) startedStore.setState(Object.fromEntries(Object.entries(started).filter(([id]) => id !== nodeId)), true);
}

/** Whether the running terminal's session started with other launch settings than `current` has. */
export function useLaunchRestartPending(nodeId: string, current: TerminalPayload | undefined): boolean {
  return useStore(startedStore, (s) => {
    const started = s[nodeId];
    if (!started || !current) return false;
    const now = launchSettingsOf(current);
    return started.cwd !== now.cwd || started.shell !== now.shell || started.title !== now.title || started.command !== now.command;
  });
}
