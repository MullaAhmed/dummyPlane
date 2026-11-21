import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { groupInfoOf, insertIntoFrame, withGroupFolded } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { freeCellClear, freeSpotClear, ROW_GAP } from "@/agents/groupLayout";
import type { Rect } from "@/canvas/groups";

/**
 * `elements` with a subagent's node `element` placed beside `anchorId`, the
 * terminal that runs it (or the subagent that spawned it): in the anchor's
 * group, the first free cell of its grid, as addTerminal does, left of `avoid`
 * (an occupied lane, agents/laneCover.ts) when that cell lies under it
 * (freeCellClear); without a group, below the anchor (ROW_GAP down: its frieze
 * of steps hangs in it), moved clear of every node and group frame, and of `avoid`.
 * Null when the anchor is not on the scene: nothing to place it beside.
 */
export function placeSubagent(
  elements: readonly ExcalidrawElement[],
  element: ExcalidrawElement,
  anchorId: string,
  avoid: readonly Rect[] = [],
): ExcalidrawElement[] | null {
  const anchor = elements.find((e) => e.id === anchorId && !e.isDeleted);
  if (!anchor) return null;
  const frame = anchor.frameId ? elements.find((e) => e.id === anchor.frameId && !e.isDeleted && groupInfoOf(e)) : undefined;
  if (frame) {
    const members = elements.filter((e) => !e.isDeleted && e.frameId === frame.id);
    const placed = freeCellClear(frame, members, avoid);
    return insertIntoFrame(
      elements,
      newElementWith(element, { x: placed.cell.x, y: placed.cell.y, frameId: frame.id }),
      newElementWith(frame, { width: placed.frame.width, height: placed.frame.height, customData: withGroupFolded(frame.customData, false) }),
    );
  }
  const below = { x: anchor.x, y: anchor.y + anchor.height + ROW_GAP, width: element.width, height: element.height };
  const obstacles = elements
    .filter((e) => !e.isDeleted && e.id !== element.id && (nodeKindOf(e) !== null || e.type === "frame"))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
  const spot = freeSpotClear(below, obstacles, avoid);
  return [...elements, newElementWith(element, { x: spot.x, y: spot.y, frameId: null })];
}
