import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, insertIntoFrame, withGroupFolded } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { freeCell, freeSpot, NODE_GAP } from "@/fleet/groupLayout";

/**
 * `elements` with a subagent's node `element` placed beside `anchorId`, the
 * terminal that runs it (or the subagent that spawned it): in the anchor's
 * group, the first free cell of its grid, as addTerminal does; without a
 * group, just below the anchor, moved clear of every node and group frame.
 * Null when the anchor is not on the scene: nothing to place it beside.
 */
export function placeSubagent(
  elements: readonly ExcalidrawElement[],
  element: ExcalidrawElement,
  anchorId: string,
): ExcalidrawElement[] | null {
  const anchor = elements.find((e) => e.id === anchorId && !e.isDeleted);
  if (!anchor) return null;
  const frame = anchor.frameId ? elements.find((e) => e.id === anchor.frameId && !e.isDeleted && groupInfoOf(e)) : undefined;
  if (frame) {
    const members = elements.filter((e) => !e.isDeleted && e.frameId === frame.id);
    const placed = freeCell(frame, members);
    return insertIntoFrame(
      elements,
      newElementWith(element, { x: placed.cell.x, y: placed.cell.y, frameId: frame.id }),
      newElementWith(frame, { width: placed.frame.width, height: placed.frame.height, customData: withGroupFolded(frame.customData, false) }),
    );
  }
  const below = { x: anchor.x, y: anchor.y + anchor.height + NODE_GAP, width: element.width, height: element.height };
  const obstacles = elements
    .filter((e) => !e.isDeleted && e.id !== element.id && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const spot = freeSpot(below, obstacles);
  return [...elements, newElementWith(element, { x: spot.x, y: spot.y, frameId: null })];
}
