import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import { nodeKindOf } from "@/canvas/nodeElement";
import { TIMELINE_ROOM } from "@/canvas/overlay/timeline";
import { NOTE_GAP, notesOf } from "./link";

function overlaps(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
}

/**
 * What a new note must not cover: every node and frame, NOTE_GAP around each,
 * and the frieze of steps under a terminal or a Fleet. A group's frame counts
 * too: a note never goes inside one (Excalidraw would clip it to the frame).
 */
function obstaclesOf(elements: readonly ExcalidrawElement[]): Rect[] {
  return elements
    .filter((e) => !e.isDeleted && (nodeKindOf(e) !== null || e.type === "frame"))
    .map((e) => {
      const kind = nodeKindOf(e);
      const frieze = kind === "terminal" || kind === "fleet" ? TIMELINE_ROOM : 0;
      return { x: e.x - NOTE_GAP, y: e.y - NOTE_GAP, width: e.width + 2 * NOTE_GAP, height: e.height + frieze + 2 * NOTE_GAP };
    });
}

/**
 * Where a new note of `size` goes beside `host`: right of it, its top level
 * with the host's, or under the last of the host's notes already in that
 * column, so a host's notes stack. When that covers something (another node, a
 * group's frame), the nearest free spot instead: right of or under an
 * obstacle's edge, left or above costing double, so it stays close.
 */
export function newNoteRect(elements: readonly ExcalidrawElement[], host: Rect & { id: string }, size: { width: number; height: number }): Rect {
  const right = host.x + host.width;
  const column = notesOf(elements, host.id).filter((n) => n.x >= right);
  const top = column.length > 0 ? Math.max(...column.map((n) => n.y + n.height)) + NOTE_GAP : host.y;
  const wanted: Rect = { x: right + NOTE_GAP, y: top, width: size.width, height: size.height };
  const obstacles = obstaclesOf(elements);
  const isFree = (r: Rect) => obstacles.every((o) => !overlaps(r, o));
  if (isFree(wanted)) return wanted;
  const xs = [wanted.x, ...obstacles.flatMap((o) => [o.x + o.width, o.x - size.width])];
  const ys = [wanted.y, ...obstacles.flatMap((o) => [o.y + o.height, o.y - size.height])];
  const cost = (r: Rect) => {
    const dx = r.x - wanted.x;
    const dy = r.y - wanted.y;
    return Math.hypot(dx < 0 ? 2 * dx : dx, dy < 0 ? 2 * dy : dy);
  };
  const candidates = xs.flatMap((x) => ys.map((y) => ({ ...wanted, x, y }))).sort((a, b) => cost(a) - cost(b));
  // Always found: right of every obstacle is free.
  return candidates.find(isFree) ?? { ...wanted, x: Math.max(...xs) };
}
