import { nodesStore } from "@/store/nodes";
import { sceneAccess } from "./sceneAccess";

/**
 * Whether the user closed a node: its element is deleted, its record kept in memory for Ctrl+Z (`nodesStore.close`).
 * Whatever a late status, a start still under way or a task never typed says of it, a closed terminal holds no seat:
 * every count of agents at work (the spawn cap, a mission's Max active agents) asks here first. A scene never read
 * says nothing of its nodes: a mission starts a terminal not shown yet.
 */
export function isClosedNode(nodeId: string): boolean {
  const { nodes, isClosed } = nodesStore.getState();
  if (isClosed(nodeId)) return true;
  const record = nodes[nodeId];
  // Closed between the element's deletion and the canvas freeing its terminal (`disposeTerminal`).
  const element = record && sceneAccess(record.workspaceId)?.elements().find((e) => e.id === nodeId);
  return element?.isDeleted === true;
}
