import { atWork, isLaunching } from "@/agents/spawnFamily";
import { nodeNameOf, nodesStore, terminalOf } from "@/store/nodes";
import { statusOf } from "@/store/terminalStatus";
import { findDuplicateWork, type ActiveWork, type Candidate, type WorkState } from "./duplicateTask";
import { budgetOf, spentMin, type Member } from "./mission";
import { agentState, missionOf } from "./store";

/**
 * Who is at work on what, as the duplicate guard (`./duplicateTask`) reads it: the agents of the missions
 * under way (their sub-task, brief and card from the plan) and the sub-agents opened with spawn_agent
 * (their task). A terminal the user opened holds no task dummyPlane knows of: it is never in the list.
 * Apart from `./queue`, which reads it.
 */

/** An agent's state from its terminal and its activity: a stopped one holds no task; an idle one, its turn ended with no report, still does. */
function stateOf(nodeId: string, launching: boolean): WorkState {
  const status = statusOf(nodeId).state;
  if (launching || status === "starting") return "starting";
  if (status !== "running") return "stopped";
  const state = agentState(nodeId);
  return state === "travaille" ? "working" : state === "attend" ? "waiting" : state === "arrêté" ? "stopped" : "idle";
}

/** A team agent whose task is not typed yet is starting on it. */
function memberState(member: Member): WorkState {
  const state = stateOf(member.nodeId, false);
  return state !== "stopped" && member.sentAt === undefined ? "starting" : state;
}

/**
 * The agents of `workspaceId` that hold a task, `exclude`d ones left out (the caller). Of a mission: its
 * team, not handed over, not abandoned, not yet reported. Of spawn_agent: the sub-agents that did not report.
 */
export function activeWork(workspaceId: string | undefined, exclude: readonly (string | undefined)[] = [], now = Date.now()): ActiveWork[] {
  const nodes = nodesStore.getState().nodes;
  const skip = new Set(exclude);
  const found: ActiveWork[] = [];
  // Every agent a mission ever had: a handed-over or reported one is no longer the terminal's task to read.
  const members = new Set<string>();
  for (const record of Object.values(nodes)) {
    const mission = missionOf(record);
    if (!mission) continue;
    for (const member of mission.members) members.add(member.nodeId);
    if (record.workspaceId !== workspaceId || (mission.state !== "en_cours" && mission.state !== "lancement")) continue;
    for (const member of mission.members) {
      if (member.handedTo || member.abandoned || member.report || skip.has(member.nodeId)) continue;
      const sub = mission.plan?.find((s) => s.title === member.task);
      found.push({
        agentId: member.nodeId,
        name: member.name,
        state: memberState(member),
        title: member.task,
        ...(sub?.brief ? { brief: sub.brief } : {}),
        ...(sub?.card ? { card: sub.card } : {}),
        spentMin: Math.floor(spentMin(member, now)),
        budgetMin: budgetOf(member),
      });
    }
  }
  for (const [id, record] of Object.entries(nodes)) {
    if (record.workspaceId !== workspaceId || members.has(id) || skip.has(id)) continue;
    const payload = terminalOf(record);
    // Opened with spawn_agent, its task given, no report yet.
    if (!payload?.spawnedBy || !payload.task || payload.lastReport || !atWork(id)) continue;
    found.push({ agentId: id, name: nodeNameOf(record) || "A sub-agent", state: stateOf(id, isLaunching(id)), title: payload.title, brief: payload.task });
  }
  return found;
}

/** The agent of `workspaceId` already on `candidate`'s task, or null. `exclude`: the caller, and whoever it speaks for. */
export function duplicateWork(candidate: Candidate, workspaceId: string | undefined, exclude: readonly (string | undefined)[] = []): ActiveWork | null {
  return findDuplicateWork(candidate, activeWork(workspaceId, exclude));
}
