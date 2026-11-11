import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";
import { tallyAgents, workspaceNodeIds, type AgentTally } from "./agentState";

/**
 * The counts of the workspace on screen: the agents the agents panel lists, so each counter of the title bar
 * matches the panel it opens. Working, waiting and active count the same agents (Fleets included, plain shells
 * and agents that exited not), so working + waiting never exceeds active.
 */
export function useWorkspaceAgentCounts(): AgentTally {
  const nodeIds = useCanvas((s) => s.nodeIds);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  return tallyAgents(nodeIds, nodes, statuses, activities);
}

/** The live agents of a workspace, on screen or not: a tab's badge. */
export function useWorkspaceActiveAgents(workspaceId: string): number {
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  return tallyAgents(workspaceNodeIds(nodes, workspaceId), nodes, statuses, activities).active;
}
