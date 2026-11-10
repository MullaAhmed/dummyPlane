import { createStore, useStore } from "zustand";
import type { ExtensionChoice } from "@/ipc/claudeExtensions";
import { isRunning, terminalStatusStore } from "@/store/terminalStatus";

/**
 * The extension choice a running terminal started with, noted when the edit
 * panel first changes it during that session (null: no choice). A terminal
 * that stops loses its note: whatever it starts with next is the stored choice.
 */
const startedStore = createStore<Record<string, ExtensionChoice | null>>()(() => ({}));

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

/** Before the panel changes a terminal's choice: a running terminal keeps the one it started with. */
export function noteChoiceChange(nodeId: string, before: ExtensionChoice | undefined) {
  if (!isRunning(nodeId) || nodeId in startedStore.getState()) return;
  forgetStopped();
  startedStore.setState({ [nodeId]: before ?? null });
}

/** The terminal restarts now: it starts with the stored choice. */
export function forgetStartedChoice(nodeId: string) {
  const started = startedStore.getState();
  if (nodeId in started) startedStore.setState(Object.fromEntries(Object.entries(started).filter(([id]) => id !== nodeId)), true);
}

/** The same choice, whatever the order of its names. */
const normal = (choice: ExtensionChoice | null | undefined) =>
  JSON.stringify([
    [...(choice?.skillsOff ?? [])].sort(),
    [...(choice?.agentsOff ?? [])].sort(),
    [...(choice?.mcpOff ?? [])].sort(),
    Object.entries(choice?.plugins ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  ]);

/** Whether the running terminal's session started with another choice than `current`. */
export function useRestartPending(nodeId: string, current: ExtensionChoice | undefined): boolean {
  return useStore(startedStore, (s) => nodeId in s && normal(s[nodeId]) !== normal(current));
}
