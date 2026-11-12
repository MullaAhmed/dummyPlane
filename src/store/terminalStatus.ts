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

const without = <T>(record: Record<string, T>, nodeId: string) => Object.fromEntries(Object.entries(record).filter(([id]) => id !== nodeId));

/** Each terminal's restarts, one after the other (`restartInTurn`): the end of the last one asked. */
const turns = new Map<string, Promise<void>>();
/** Bumped when a terminal is removed: a restart of its earlier life that ends late changes nothing of the next. */
const lives = new Map<string, number>();

export const terminalStatusStore = createStore<TerminalStatusState>()((set) => ({
  statuses: {},
  restarts: {},
  set: (nodeId, status) => set((s) => ({ statuses: { ...s.statuses, [nodeId]: status } })),
  // A terminal closed mid-restart is restarting no more: one whose new process never came (its xterm gone) would
  // else hold its mission seat for good, and its next restart, restored with Ctrl+Z, would wait for the lost one.
  remove: (nodeId) => {
    turns.delete(nodeId);
    lives.set(nodeId, (lives.get(nodeId) ?? 0) + 1);
    set((s) => ({ statuses: without(s.statuses, nodeId), restarts: without(s.restarts, nodeId) }));
  },
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

/**
 * Runs `restart`, a terminal's restarts one at a time: one asked while another is under way starts once that one has
 * ended, failed or not, never alongside it (the backend refuses a second start, and the terminal would show an
 * error with its process running). Marked restarting from the call, though it may wait its turn. The first one asked
 * runs at once, as a restart always did.
 */
export function restartInTurn(nodeId: string, restart: () => Promise<void>): Promise<void> {
  const life = lives.get(nodeId) ?? 0;
  terminalStatusStore.getState().restart(nodeId, 1);
  const run = () =>
    restart().finally(() => {
      if ((lives.get(nodeId) ?? 0) === life) terminalStatusStore.getState().restart(nodeId, -1);
    });
  const before = turns.get(nodeId);
  const turn = before ? before.then(run, run) : run();
  const ended = turn.then(
    () => undefined,
    () => undefined,
  );
  turns.set(nodeId, ended);
  void ended.then(() => {
    if (turns.get(nodeId) === ended) turns.delete(nodeId);
  });
  return turn;
}

/** `isRestarting`, for a component: its restart entries wait while one is under way. */
export function useRestarting(nodeId: string): boolean {
  return useStore(terminalStatusStore, (s) => (s.restarts[nodeId] ?? 0) > 0);
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
