import { nodesStore, terminalOf } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { AGENTS } from "./catalog";
import { sceneAccess } from "./sceneAccess";
import { takesCommands } from "./slashCommands";
import { agentLinksOf, withAgentLink } from "./wires";

/**
 * Two agents wired to each other, without an orchestrator: each can list,
 * message and read the other through dummyPlane's tools (`@/mcp/linkTools`).
 * The wire on the scene is the link; deleting it unlinks them.
 */

/** A terminal whose agent takes instructions: a plain shell would run a linked agent's message as a command. */
export function linkableAgent(nodeId: string): boolean {
  const payload = terminalOf(nodesStore.getState().nodes[nodeId]);
  return payload !== undefined && takesCommands(payload.agent);
}

/** "+ Link" from an agent's foot, then a click on another agent: a wire between them, in one undo step. */
export function linkAgents(fromId: string, toId: string) {
  if (fromId === toId || !linkableAgent(fromId) || !linkableAgent(toId)) return;
  const workspaceId = nodesStore.getState().nodes[fromId]?.workspaceId ?? workspacesStore.getState().activeId;
  const scene = workspaceId ? sceneAccess(workspaceId) : null;
  if (!scene) return;
  const before = scene.elements();
  const after = withAgentLink(before, fromId, toId);
  // Already linked (either way round): no second wire, and no empty undo step.
  if (after.length !== before.length) scene.write(after);
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
