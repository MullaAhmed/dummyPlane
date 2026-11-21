import { isManagerNode, nodesStore, terminalOf, type NodeRecord } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { AGENTS } from "./catalog";
import { withLinkGroup, type LinkOutcome } from "./linkGroup";
import { pantheonForNewGroup } from "./naming";
import { sceneAccess } from "./sceneAccess";
import { takesCommands } from "./slashCommands";
import { agentLinksOf, withAgentLink } from "./wires";

/**
 * Two agents wired to each other, without a fleet: each can list,
 * message and read the other through dummyPlane's tools (`@/mcp/linkTools`).
 * The wire on the scene is the link; deleting it unlinks them.
 */

/** A terminal whose agent takes instructions: a plain shell would run a linked agent's message as a command. */
export function linkableAgent(nodeId: string): boolean {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  return payload !== undefined && takesCommands(payload.agent);
}

/** The groups a mission keeps for its team (`Mission.frameId`, `Mission.teamFrame`): closed with the mission. */
function missionGroups(nodes: Readonly<Record<string, NodeRecord>>): Set<string> {
  const ids = new Set<string>();
  for (const record of Object.values(nodes)) {
    const mission = record.kind === "fleet" ? record.payload.mission : undefined;
    for (const id of [mission?.frameId, mission?.teamFrame]) if (id) ids.add(id);
  }
  return ids;
}

/**
 * "+ Link" from an agent's foot, then a click on another agent: a wire between
 * them, and the two made a group (./linkGroup.ts), in one undo step. Returns what
 * it did besides the wire, for the caller to tell the user when the two were not
 * grouped; null when nothing was written (already linked, either way round, or
 * not two agents that take instructions).
 */
export function linkAgents(fromId: string, toId: string): LinkOutcome | null {
  if (fromId === toId || !linkableAgent(fromId) || !linkableAgent(toId)) return null;
  const nodes = nodesStore.getState().nodes;
  const workspaceId = nodes[fromId]?.workspaceId ?? workspacesStore.getState().activeId;
  const scene = workspaceId ? sceneAccess(workspaceId) : null;
  if (!scene || !workspaceId) return null;
  const before = scene.elements();
  // Already linked (either way round): no second wire, no group, and no empty undo step.
  if (withAgentLink(before, fromId, toId).length === before.length) return null;
  const grouped = withLinkGroup(before, fromId, toId, {
    pantheon: () => pantheonForNewGroup(workspaceId),
    parentOf: (id) => terminalOf(nodesStore.getState().nodes[id])?.spawnedBy,
    isManager: isManagerNode,
    missionGroups: missionGroups(nodes),
  });
  // The wire last: it runs between the two where the group put them.
  scene.write(withAgentLink(grouped.elements, fromId, toId));
  return grouped.outcome;
}

/** An agent at the other end of one of `nodeId`'s wires. */
export interface LinkedAgent {
  nodeId: string;
  name: string;
  /** Whether the wire starts at the caller: which way its light runs. */
  outgoing: boolean;
}

/** The agents linked to `nodeId`, from its workspace's scene on screen or stored; null when that scene was never read. */
export function linkedAgentsOf(nodeId: string): LinkedAgent[] | null {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[nodeId];
  const scene = record ? sceneAccess(record.workspaceId) : null;
  if (!scene) return null;
  return agentLinksOf(scene.elements(), nodeId).flatMap(({ peerId, outgoing }) => {
    const payload = terminalOf(nodes[peerId]);
    if (!payload || !takesCommands(payload.agent)) return [];
    return [{ nodeId: peerId, name: payload.name || AGENTS[payload.agent].label, outgoing }];
  });
}
