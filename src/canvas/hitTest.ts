import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { lockedByEraser } from "./eraserLock";
import { nodeKindOf, type NodeKind } from "./nodeElement";

/**
 * Topmost live node of one of `kinds` containing the scene point, or null. Later
 * elements are drawn above earlier ones, so the array is searched from the end.
 * Rotation is ignored: nodes are never rotated in practice.
 */
function findNodeAt(elements: readonly ExcalidrawElement[], x: number, y: number, kinds: readonly NodeKind[]): ExcalidrawElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    // A locked node is one a folded group keeps hidden; the eraser's lock (eraserGuard) only keeps it from being erased.
    if (element.isDeleted || (element.locked && !lockedByEraser(element))) continue;
    const kind = nodeKindOf(element);
    if (!kind || !kinds.includes(kind)) continue;
    const inside = x >= element.x && x <= element.x + element.width && y >= element.y && y <= element.y + element.height;
    if (inside) return element;
  }
  return null;
}

/** Topmost live terminal node containing the scene point, or null. */
export function findTerminalAt(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement | null {
  return findNodeAt(elements, x, y, ["terminal"]);
}

/** Topmost live terminal or Fleet (kind "fleet") node containing the scene point, or null: what a click or a double-click selects. */
export function findTerminalOrFleetAt(elements: readonly ExcalidrawElement[], x: number, y: number): ExcalidrawElement | null {
  return findNodeAt(elements, x, y, ["terminal", "fleet"]);
}
