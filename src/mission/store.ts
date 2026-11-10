import { canvasStore } from "@/canvas/canvasStore";
import { framesFromScene, groupOf } from "@/canvas/groups";
import { cachedElements } from "@/canvas/sceneCache";
import { AGENTS } from "@/agents/catalog";
import { linkedAgents, NO_LINKS, fleetLinks } from "@/agents/wires";
import { agentActivityStore } from "@/store/agentActivity";
import { nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { isRunning } from "@/store/terminalStatus";
import { workspacesStore } from "@/store/workspaces";
import { budgetOf, NEW_MISSION, spentMin, type Member, type Mission, type ReportStatus } from "./mission";

/** A fleet's mission — a fresh one until it has its own; undefined for any other node. */
export function missionOf(record: NodeRecord | undefined): Mission | undefined {
  return record?.kind === "fleet" ? (record.payload.mission ?? NEW_MISSION) : undefined;
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

/** The Claude agents wired to a fleet: only they have dummyPlane's tools for a mission (spec §2). */
export function linkedClaudeAgents(fleetId: string): { nodeId: string; name: string }[] {
  const { links, frames } = canvasOfNode(fleetId);
  const nodes = nodesStore.getState().nodes;
  return linkedAgents(links[fleetId] ?? NO_LINKS, frames).agentIds.flatMap((nodeId) => {
    // An agent already working for another running mission is not free to be enrolled in this one.
    const elsewhere = memberOf(nodeId);
    if (elsewhere && elsewhere.fleetId !== fleetId) return [];
    const payload = terminalOf(nodes[nodeId]);
    return payload?.agent === "claude" ? [{ nodeId, name: payload.name || AGENTS.claude.label }] : [];
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
  const activity = agentActivityStore.getState().activities[nodeId]?.activity;
  return activity === "working" ? "travaille" : activity === "waiting" ? "attend" : "inactif";
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
