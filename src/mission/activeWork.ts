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

/** An agent that just got its task is not "idle" yet: Claude's first activity takes a moment to show. */
const JUST_SENT_MS = 30_000;

/** An agent's state from its terminal and its activity: idle and stopped ones hold no task. */
function stateOf(nodeId: string, launching: boolean): WorkState {
  const status = statusOf(nodeId).state;
  if (launching || status === "starting") return "starting";
  if (status !== "running") return "stopped";
  const state = agentState(nodeId);
  return state === "travaille" ? "working" : state === "attend" ? "waiting" : state === "arrêté" ? "stopped" : "idle";
}

function memberState(member: Member, now: number): WorkState {
  const state = stateOf(member.nodeId, false);
  if (state !== "idle" && state !== "working" && state !== "waiting") return state;
  // Its task not typed yet, or just typed: it is starting on it.
  if (member.sentAt === undefined || (state === "idle" && now - member.sentAt < JUST_SENT_MS)) return "starting";
  return state;
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
        state: memberState(member, now),
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
