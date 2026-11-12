import type { AppErrorKind } from "@/ipc/invoke";
import { createStore, useStore } from "zustand";

export type TerminalStatus =
  /** Created, waiting for its staggered start (groups start one agent every 300 ms). */
  | { state: "starting" }
  | { state: "running" }
  | { state: "stopped" }
  | { state: "exited"; code: number | null }
  | { state: "error"; message: string; kind?: AppErrorKind };

interface TerminalStatusState {
  statuses: Record<string, TerminalStatus>;
  /**
   * The restarts under way, by terminal (`relaunchSession`, whatever asked for it): from the call until its new
   * process is spawned, its old one's exit included. Several at once each count.
   */
  restarts: Record<string, number>;
  set: (nodeId: string, status: TerminalStatus) => void;
  remove: (nodeId: string) => void;
  /** One restart of `nodeId` begins (+1) or ends (-1). */
  restart: (nodeId: string, change: 1 | -1) => void;
}

const STOPPED: TerminalStatus = { state: "stopped" };

export const terminalStatusStore = createStore<TerminalStatusState>()((set) => ({
  statuses: {},
  restarts: {},
  set: (nodeId, status) => set((s) => ({ statuses: { ...s.statuses, [nodeId]: status } })),
  remove: (nodeId) =>
    set((s) => ({ statuses: Object.fromEntries(Object.entries(s.statuses).filter(([id]) => id !== nodeId)) })),
  restart: (nodeId, change) =>
    set((s) => {
      const left = (s.restarts[nodeId] ?? 0) + change;
      const restarts = Object.fromEntries(Object.entries(s.restarts).filter(([id]) => id !== nodeId));
      return { restarts: left > 0 ? { ...restarts, [nodeId]: left } : restarts };
    }),
}));

export function statusOf(nodeId: string): TerminalStatus {
  return terminalStatusStore.getState().statuses[nodeId] ?? STOPPED;
}

export function isRunning(nodeId: string): boolean {
  return statusOf(nodeId).state === "running";
}

/** Whether a terminal is being started again: its old process may be gone, its new one not spawned yet. */
export function isRestarting(nodeId: string): boolean {
  return (terminalStatusStore.getState().restarts[nodeId] ?? 0) > 0;
}

export function useTerminalStatus(nodeId: string): TerminalStatus {
  return useStore(terminalStatusStore, (s) => s.statuses[nodeId] ?? STOPPED);
}

/**
 * Resolves once the terminal is no longer running (its `pty-exit` arrived), or
 * after `timeoutMs` so a lost event cannot block a relaunch forever.
 */
export function waitForExit(nodeId: string, timeoutMs = 5000): Promise<void> {
  if (!isRunning(nodeId)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    const unsubscribe = terminalStatusStore.subscribe(() => {
      if (!isRunning(nodeId)) done();
    });
  });
}
