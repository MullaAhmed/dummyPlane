import { createStore, useStore } from "zustand";
import { onClaudeStatus, type StatusEvent } from "@/ipc/usage";
import { mergeLimits, nodeSession, readStatus, type Limits, type SessionUsage } from "./usage";

interface UsageState {
  /** Each Claude session of this run of the app, by its session id. */
  sessions: Record<string, SessionUsage>;
  /** The plan's limits, as the latest status line gave them. */
  limits: Limits | null;
  /** When each terminal last started Claude: what it reported before belongs to an earlier run. */
  launchedAt: Record<string, number>;
  apply: (event: StatusEvent, now: number) => void;
}

/** What the status lines of dummyPlane's Claude sessions report (spec maj §6); kept in memory. */
export const usageStore = createStore<UsageState>()((set) => ({
  sessions: {},
  limits: null,
  launchedAt: {},
  apply: (event, now) => {
    const { session, limits } = readStatus(event.status, event.nodeId, now);
    if (!session) return;
    const known = usageStore.getState().sessions[session.sessionId];
    if (known?.before) session.before = known.before;
    else if (!known && resumedNodes.delete(event.nodeId)) {
      // The first report of a resumed launch: what it already holds was spent before dummyPlane opened it.
      session.before = { costUsd: session.costUsd, apiMs: session.apiMs, wallMs: session.wallMs, linesAdded: session.linesAdded, linesRemoved: session.linesRemoved };
    }
    set((s) => ({ sessions: { ...s.sessions, [session.sessionId]: session }, limits: limits ? mergeLimits(s.limits, limits) : s.limits }));
  },
}));

/** Terminals launched with `--resume` or `--continue`, waiting for the first report of their session. */
const resumedNodes = new Set<string>();

/**
 * A Claude launch that picks a conversation up: its first report is the baseline. A heuristic, since a report
 * that comes after the first answer already includes some of this run's spending.
 */
export function markResumedLaunch(nodeId: string) {
  resumedNodes.add(nodeId);
}

/** A terminal starts Claude (any mode): its earlier reports no longer say what it uses. */
export function markLaunch(nodeId: string, now = Date.now()) {
  usageStore.setState((s) => ({ launchedAt: { ...s.launchedAt, [nodeId]: now } }));
}

export function useUsage<T>(selector: (state: UsageState) => T): T {
  return useStore(usageStore, selector);
}

/** What the terminal's current run of Claude last reported; nothing before its first status line. */
export function useNodeSession(nodeId: string): SessionUsage | undefined {
  return useUsage((s) => nodeSession(s.sessions, nodeId, s.launchedAt[nodeId]));
}

/** For the app's whole life: every status line updates the usage. */
export async function installUsage() {
  await onClaudeStatus((event) => usageStore.getState().apply(event, Date.now()));
}
