import { canvasStore } from "@/canvas/canvasStore";
import { groupOf, isGroup } from "@/canvas/groups";

/**
 * The group whose frame holds node `nodeId`: a terminal is one of its members (the frames list
 * them), a Fleet dragged into it is a child of its frame (its element's `frameId`). Null when it
 * stands in none. Apart from ./groups.ts: a node's menu reads it without loading Excalidraw's
 * element helpers.
 */
export function groupHolding(nodeId: string): string | null {
  const { api, frames } = canvasStore.getState();
  const member = groupOf(frames, nodeId);
  if (member) return member.id;
  const frameId = api?.getSceneElements().find((e) => e.id === nodeId)?.frameId;
  return frameId && frames.some((f) => f.id === frameId && isGroup(f)) ? frameId : null;
}
