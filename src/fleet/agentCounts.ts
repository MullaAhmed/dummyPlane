import { useStore } from "zustand";
import { useCanvas } from "@/canvas/canvasStore";
import { useActivities } from "@/store/agentActivity";
import { useNodes } from "@/store/nodes";
import { terminalStatusStore } from "@/store/terminalStatus";

/** Running agents at work and waiting for an answer, among `ids`. */
export function agentCounts(
  ids: readonly string[],
  statuses: Record<string, { state: string } | undefined>,
  activities: Record<string, { activity: string } | undefined>,
): { working: number; waiting: number } {
  let working = 0;
  let waiting = 0;
  for (const id of ids) {
    if (statuses[id]?.state !== "running") continue;
    if (activities[id]?.activity === "working") working += 1;
    if (activities[id]?.activity === "waiting") waiting += 1;
  }
  return { working, waiting };
}

/** The counts of the workspace on screen: what the agents panel shows (plan D2, decision 1). */
export function useWorkspaceAgentCounts(): { working: number; waiting: number } {
  const nodeIds = useCanvas((s) => s.nodeIds);
  const nodes = useNodes((s) => s.nodes);
  const statuses = useStore(terminalStatusStore, (s) => s.statuses);
  const activities = useActivities();
  return agentCounts(
    nodeIds.filter((id) => nodes[id]?.kind === "terminal"),
    statuses,
    activities,
  );
}
