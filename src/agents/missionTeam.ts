import { missionOf } from "@/mission/store";
import { isManagerNode, nodesStore } from "@/store/nodes";
import { spawnedByOf } from "./spawnFamily";

/** `nodeId`, then the agent that spawned it, and so up: a sub-agent sits in its parent's group and works for its parent's mission. */
export function lineage(nodeId: string): string[] {
  const line = [nodeId];
  for (let up = spawnedByOf(nodeId); up && !line.includes(up); up = spawnedByOf(up)) line.push(up);
  return line;
}

/**
 * Whether `nodeId` works for a mission that is under way: its Manager, an agent of its team, or a sub-agent of theirs (it
 * lands in their group, which the Fleet may be wired to). Such an agent is not the user's to hand tasks off.
 */
export function onMissionTeam(nodeId: string): boolean {
  const line = lineage(nodeId);
  if (line.some(isManagerNode)) return true;
  return Object.values(nodesStore.getState().nodes).some((record) => {
    const mission = missionOf(record);
    return (mission?.state === "en_cours" || mission?.state === "lancement") && mission.members.some((m) => line.includes(m.nodeId));
  });
}

/**
 * Why a wire to the Fleet `fleetId` gives the agent `agentId` no hand_off, which the user who just drew it is told:
 * "team" when it works for a mission under way, "subagent" when it is that Fleet's own sub-agent (it reports to it);
 * null when the wire does what the user expects.
 */
export function handOffWithheld(agentId: string, fleetId: string): "team" | "subagent" | null {
  if (onMissionTeam(agentId)) return "team";
  return lineage(agentId).includes(fleetId) ? "subagent" : null;
}
