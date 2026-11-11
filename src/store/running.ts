import { useStore } from "zustand";
import { useNodes, type NodeRecord } from "./nodes";
import { terminalStatusStore, type TerminalStatus } from "./terminalStatus";

/**
 * Terminals of these workspaces whose process runs, shells included: what closing a workspace stops. The agent
 * counts (title bar, tab badges, Go to) read `tallyAgents` (src/agents/agentState.ts) instead.
 */
export function countRunning(
  nodes: Record<string, NodeRecord>,
  statuses: Record<string, TerminalStatus>,
  workspaceIds: readonly string[],
): number {
  const wanted = new Set(workspaceIds);
  return Object.entries(nodes).filter(([id, node]) => wanted.has(node.workspaceId) && statuses[id]?.state === "running")
    .length;
}

export function useRunningCount(workspaceIds: readonly string[]): number {
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  return countRunning(nodes, statuses, workspaceIds);
}
