import { FLEET_CAPABLE } from "@/fleet/capable";
import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupOf } from "@/canvas/groups";
import { cachedElements } from "@/canvas/sceneCache";
import { AGENTS } from "@/agents/catalog";
import { linkedAgents, NO_LINKS, fleetLinks } from "@/agents/wires";
import { agentActivityStore } from "@/store/agentActivity";
import { isManagerNode, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { budgetOf, NEW_MISSION, spentMin, type Member, type Mission, type ReportStatus } from "./mission";

/** A fleet's mission — a fresh one until it has its own; undefined for any other node. */
export function missionOf(record: NodeRecord | undefined): Mission | undefined {
  return record?.kind === "fleet" ? (record.payload.mission ?? NEW_MISSION) : undefined;
}

/**
 * Who runs a Fleet's mission and hears its team: its Manager once the go-ahead made one (`./manager`), else the
 * Fleet itself (a mission not launched yet, or launched before Managers existed: the old way). A team line is
 * typed into the runner, never into a Fleet whose mission a Manager runs.
 */
export function missionRunner(fleetId: string): string {
  return missionOf(nodesStore.getState().nodes[fleetId])?.manager ?? fleetId;
}

/** The Fleet whose mission a Manager runs; undefined for any other node. */
export function managedFleet(managerId: string): string | undefined {
  const fleetId = terminalOf(nodesStore.getState().nodes[managerId])?.fleet;
  return fleetId && isManagerNode(managerId) && missionOf(nodesStore.getState().nodes[fleetId])?.manager === managerId ? fleetId : undefined;
}

/**
 * The agents of a running mission its Manager runs reach each other with no wire drawn by hand: the Manager
 * its team, an agent the Manager and its teammates (siblings). The first message draws the wire (`@/agents/talkWires`).
 */
export function missionPeers(nodeId: string): string[] {
  for (const record of Object.values(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours" || !mission.manager) continue;
    const team = [...new Set(mission.members.filter((m) => !m.handedTo && m.nodeId).map((m) => m.nodeId))];
    if (nodeId === mission.manager) return team;
    if (team.includes(nodeId)) return [mission.manager, ...team.filter((id) => id !== nodeId)];
  }
  return [];
}

export function setMission(fleetId: string, patch: Partial<Mission>) {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission) nodesStore.getState().update(fleetId, { mission: { ...mission, ...patch } });
}

export function updateMember(fleetId: string, nodeId: string, patch: Partial<Member>) {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (mission) setMission(fleetId, { members: mission.members.map((m) => (m.nodeId === nodeId ? { ...m, ...patch } : m)) });
}

/**
 * Fleets deleted from the canvas. Their record stays for an undo, and so
 * does their mission: it waits, unheard, until the undo brings them back
 * (spec first version §5.4).
 */
const closedFleets = new Set<string>();

export function setFleetClosed(fleetId: string, closed: boolean) {
  if (closed) closedFleets.add(fleetId);
  else closedFleets.delete(fleetId);
}

export function isFleetClosed(fleetId: string): boolean {
  return closedFleets.has(fleetId);
}

/**
 * Its fleet closed mid-mission: its agents go on as they run, but none starts
 * again with what the mission let it do unasked (backlog: a permission kept
 * after a fleet's closing). A later restart asks as usual. Nor do the
 * sub-agents it opened with spawn_agent, which got the same.
 */
export function releaseTeamPermission(fleetId: string) {
  const mission = missionOf(nodesStore.getState().nodes[fleetId]);
  if (!mission?.permission || mission.state === "terminee") return;
  for (const member of mission.members) {
    const payload = terminalOf(nodesStore.getState().nodes[member.nodeId]);
    if (payload?.permission === mission.permission) nodesStore.getState().update(member.nodeId, { permission: undefined });
  }
  releaseSpawnedPermission(fleetId, mission.permission);
}

/** A Manager's night permission, its team's sub-agents' too (`spawnedUnder` it): they go with the night. */
function releaseManagerPermission(managerId: string | undefined, permission: Mission["permission"]) {
  if (!managerId || !permission) return;
  for (const id of [managerId, ...spawnedUnder(managerId)]) {
    if (terminalOf(nodesStore.getState().nodes[id])?.permission === permission) nodesStore.getState().update(id, { permission: undefined });
  }
}

/** The terminals whose spawn_agent chain leads up to `fleetId`: its sub-agents and theirs, closed ones included. */
export function spawnedUnder(fleetId: string): string[] {
  const nodes = nodesStore.getState().nodes;
  return Object.keys(nodes).filter((id) => {
    const seen = new Set([id]);
    for (let up = terminalOf(nodes[id])?.spawnedBy; up && !seen.has(up); up = terminalOf(nodes[up])?.spawnedBy) {
      if (up === fleetId) return true;
      seen.add(up);
    }
    return false;
  });
}

/**
 * The sub-agents a fleet opened (spawn_agent), and theirs, got its night's
 * permission like its team: it goes when the night ends or the fleet closes. A
 * later restart asks as usual.
 */
export function releaseSpawnedPermission(fleetId: string, permission: Mission["permission"]) {
  if (!permission) return;
  for (const id of spawnedUnder(fleetId)) {
    if (terminalOf(nodesStore.getState().nodes[id])?.permission === permission) nodesStore.getState().update(id, { permission: undefined });
  }
  // The Manager it made, and the sub-agents of its team, got the same night.
  releaseManagerPermission(missionOf(nodesStore.getState().nodes[fleetId])?.manager, permission);
}

/**
 * The running mission an agent works for, once its sub-task was sent (spec §7.5);
 * a closed fleet's only with `evenClosed`.
 */
export function memberOf(nodeId: string, { evenClosed = false } = {}): { fleetId: string; member: Member } | null {
  for (const [fleetId, record] of Object.entries(nodesStore.getState().nodes)) {
    const mission = missionOf(record);
    if (mission?.state !== "en_cours") continue;
    if (!evenClosed && closedFleets.has(fleetId)) continue;
    const member = mission.members.find((m) => m.nodeId === nodeId && m.sentAt !== undefined);
    if (member) return { fleetId, member };
  }
  return null;
}

/** Whether the fleet's workspace is on screen. The home screen leaves it active, with no canvas mounted. */
export function fleetShown(fleetId: string): boolean {
  const record = nodesStore.getState().nodes[fleetId];
  return record !== undefined && record.workspaceId === workspacesStore.getState().activeId && canvasStore.getState().api !== null;
}

/** A workspace's wires and groups: live on screen, from its stored scene otherwise (spec overnight mission §6.1). */
export function workspaceCanvas(workspaceId: string | undefined): Pick<ReturnType<typeof canvasStore.getState>, "frames" | "links"> {
  const shown = workspaceId === workspacesStore.getState().activeId && canvasStore.getState().api !== null;
  if (workspaceId === undefined || shown) return canvasStore.getState();
  const elements = cachedElements(workspaceId) ?? [];
  return { frames: framesFromScene(elements), links: fleetLinks(elements) };
}

/** Whether the fleet's canvas is known: on screen, or its scene was read. */
export function canvasKnown(fleetId: string): boolean {
  const record = nodesStore.getState().nodes[fleetId];
  return record !== undefined && (fleetShown(fleetId) || cachedElements(record.workspaceId) !== undefined);
}

const canvasOfNode = (nodeId: string) => workspaceCanvas(nodesStore.getState().nodes[nodeId]?.workspaceId);

/** The agents wired to a fleet that have dummyPlane's tools for a mission, Claude's or Codex's (spec §2). */
export function linkedTeamAgents(fleetId: string): { nodeId: string; name: string }[] {
  const { links, frames } = canvasOfNode(fleetId);
  const nodes = nodesStore.getState().nodes;
  return linkedAgents(links[fleetId] ?? NO_LINKS, frames).agentIds.flatMap((nodeId) => {
    // An agent already working for another running mission is not free to be enrolled in this one.
    const elsewhere = memberOf(nodeId);
    if (elsewhere && elsewhere.fleetId !== fleetId) return [];
    // A mission's Manager runs a board: it is never a plan's agent.
    if (isManagerNode(nodeId)) return [];
    const payload = terminalOf(nodes[nodeId]);
    return payload && FLEET_CAPABLE.includes(payload.agent) ? [{ nodeId, name: payload.name || AGENTS[payload.agent].label }] : [];
  });
}

/** The groups wired to a fleet, with what each is for (spec specialised groups §3). */
export function linkedGroups(fleetId: string): { id: string; name: string; speciality: string | null }[] {
  const { links, frames } = canvasOfNode(fleetId);
  return linkedAgents(links[fleetId] ?? NO_LINKS, frames).groups.map((f) => ({ id: f.id, name: f.name, speciality: f.group?.speciality ?? null }));
}

/** An agent's group and speciality as the fleet reads them: null without one. */
export function agentGroup(nodeId: string): { group: string | null; speciality: string | null } {
  const group = groupOf(canvasOfNode(nodeId).frames, nodeId);
  return { group: group?.name ?? null, speciality: group?.group.speciality ?? null };
}

/** The group a member belongs to: the one it joined, else the one it stands in. */
export function memberGroupId(member: Member): string | null {
  return member.group ?? groupOf(canvasOfNode(member.nodeId).frames, member.nodeId)?.id ?? null;
}

export type AgentState = "travaille" | "attend" | "inactif" | "arrêté";

/** An agent's state as the fleet reads it (spec §7.2 `equipe`). */
export function agentState(nodeId: string): AgentState {
  if (!isRunning(nodeId)) return "arrêté";
  const activity = agentActivityStore.getState().activities[nodeId];
  // Its agent exited, back at its shell ("Agent exited"): nobody works there, whatever its last activity said.
  if (activity?.left) return "arrêté";
  return activity?.activity === "working" ? "travaille" : activity?.activity === "waiting" ? "attend" : "inactif";
}

/** An agent's time and budget for its bar; `report` once it reported: its time is then frozen at that moment. */
export interface MemberBudget {
  spent: number;
  budget: number;
  report?: ReportStatus;
}

/** The time and budget of each agent of a running mission, by node (spec §8.3). */
export function memberBudgets(nodes: Record<string, NodeRecord>, now: number): Record<string, MemberBudget> {
  const budgets: Record<string, MemberBudget> = {};
  for (const [fleetId, record] of Object.entries(nodes)) {
    const mission = missionOf(record);
    // A closed fleet's mission draws no bar (final review R3).
    if (mission?.state !== "en_cours" || closedFleets.has(fleetId)) continue;
    for (const m of mission.members) {
      if (m.sentAt !== undefined && !m.handedTo) {
        budgets[m.nodeId] = { spent: spentMin(m, now), budget: budgetOf(m), ...(m.report ? { report: m.report.status } : {}) };
      }
    }
  }
  return budgets;
}
