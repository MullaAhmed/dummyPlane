import type { KanbanPayload } from "@/nodes/types";
import { missionOf } from "@/mission/store";
import { isManagerNode, nodesStore } from "@/store/nodes";
import { workspacesStore } from "@/store/workspaces";
import { linkableAgent } from "./agentLinks";
import { sceneAccess } from "./sceneAccess";
import { boardLinksOf, withBoardLink } from "./wires";

/**
 * An agent, or a Fleet, wired to a Kanban board: it reads the board's cards and adds or moves them through
 * dummyPlane's tools (`@/mcp/boardTools`). The wire on the scene is the link; deleting it, or the board, unlinks them.
 */

/**
 * What a board's wire can join on the other side: a Fleet, or a terminal whose agent takes instructions (a plain shell
 * has no tools). Not a mission's Manager: it runs its board with its own tools, and a wire would give it nothing.
 */
export function boardLinkable(nodeId: string): boolean {
  const record = nodesStore.getState().nodes[nodeId];
  if (record?.kind === "fleet") return true;
  return record?.kind === "terminal" && linkableAgent(nodeId) && !isManagerNode(nodeId);
}

/** "+ Link" from an agent's end, a Fleet's or a board's, then a click on the other: a wire between them, in one undo step. */
export function linkAgentToBoard(agentId: string, boardId: string) {
  if (!boardLinkable(agentId) || nodesStore.getState().nodes[boardId]?.kind !== "kanban") return;
  const workspaceId = nodesStore.getState().nodes[agentId]?.workspaceId ?? workspacesStore.getState().activeId;
  const scene = workspaceId ? sceneAccess(workspaceId) : null;
  if (!scene) return;
  const before = scene.elements();
  const after = withBoardLink(before, agentId, boardId);
  // Already linked: no second wire, and no empty undo step.
  if (after.length !== before.length || after.some((e, i) => e !== before[i])) scene.write(after);
}

/** A board wired to a caller, as the tools read it. */
export interface WiredBoard {
  nodeId: string;
  board: KanbanPayload;
}

/** The boards wired to `nodeId`, from its workspace's scene on screen or stored; null when that scene was never read. */
export function wiredBoardsOf(nodeId: string): WiredBoard[] | null {
  const nodes = nodesStore.getState().nodes;
  const record = nodes[nodeId];
  const scene = record ? sceneAccess(record.workspaceId) : null;
  if (!scene) return null;
  return boardLinksOf(scene.elements(), nodeId).flatMap((boardId) => {
    const board = nodes[boardId];
    return board?.kind === "kanban" ? [{ nodeId: boardId, board: board.payload }] : [];
  });
}

/**
 * Whether a mission under way runs this board with its Manager: its cards are the Manager's to move (and the Fleet's to
 * add through the queue), whoever else the user wired to it. Reading is open; writing is refused.
 */
export function missionRunsBoard(boardId: string): boolean {
  return Object.values(nodesStore.getState().nodes).some((record) => {
    if (record.kind !== "fleet") return false;
    const mission = missionOf(record);
    return mission?.board === boardId && (mission.state === "lancement" || mission.state === "en_cours");
  });
}
