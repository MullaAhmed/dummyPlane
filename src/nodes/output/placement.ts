import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { boundsOf, frameAround, freeSpotClear, NODE_GAP } from "@/agents/groupLayout";
import { rerouteWires } from "@/agents/wires";
import { groupInfoOf, insertIntoFrame, type Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";

/**
 * `elements` with the output node `element` (not among them) beside `sourceId`, the agent or Fleet that showed it:
 * right of it, NODE_GAP apart, its top level with the source's, then moved to the nearest spot clear of every node.
 *
 * - The source in a group (a terminal member, or a Fleet dragged into one): the output goes into that group too, a
 *   child of its frame (its `frameId`), and the frame grows to hold it with the grid's padding (`frameAround`), as it
 *   does for a new agent. An agent's output belongs to its group: Arrange lays it out beside its agent in the grid, a
 *   drag of the group takes it along, and "Remove from group" takes it out with its agent. The frame's other members
 *   are obstacles; the frame itself is not.
 * - Elsewhere, as before: clear of every group frame too, in none. A frame drawn by hand is no group: never joined.
 *
 * Its wires to the frame (a Fleet's) are routed again when the frame grows. Unplaced, `element` is appended as it is
 * when the source is not on the scene. It keeps clear of `avoid` too (an occupied lane, agents/laneCover.ts).
 */
export function placeOutput(
  elements: readonly ExcalidrawElement[],
  element: ExcalidrawElement,
  sourceId: string,
  avoid: readonly Rect[] = [],
): readonly ExcalidrawElement[] {
  const source = elements.find((e) => e.id === sourceId && !e.isDeleted);
  if (!source) return [...elements, element];
  const frame = source.frameId ? elements.find((e) => e.id === source.frameId && !e.isDeleted && groupInfoOf(e) !== null) : undefined;
  const beside = { x: source.x + source.width + NODE_GAP, y: source.y, width: element.width, height: element.height };
  const obstacles = elements
    .filter((e) => !e.isDeleted && e.id !== element.id && e.id !== frame?.id && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const spot = freeSpotClear(beside, obstacles, avoid);
  if (!frame) return [...elements, moved(element, spot, null)];
  const grown = boundsOf([frame, frameAround([spot])]);
  const next = insertIntoFrame(elements, moved(element, spot, frame.id), newElementWith(frame, grown));
  return rerouteWires(next, new Set([frame.id]));
}

/** `element` at `spot`, in frame `frameId`: itself when it already stands so. */
function moved(element: ExcalidrawElement, spot: { x: number; y: number }, frameId: string | null): ExcalidrawElement {
  return element.x === spot.x && element.y === spot.y && element.frameId === frameId ? element : newElementWith(element, { x: spot.x, y: spot.y, frameId });
}
