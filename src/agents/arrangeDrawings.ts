import type { ExcalidrawArrowElement, ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Rect } from "@/canvas/groups";
import type { Point } from "./terminals";
import { elbowForm } from "./wires";

/**
 * What Arrange needs to move drawings: the room each one takes on the scene,
 * and the arrows that follow their ends when those move apart.
 */

/**
 * The room `element` takes on the scene. A line's, an arrow's or a freehand
 * stroke's points are relative to its x and y and may run left of or above
 * them; a turned element covers its box turned around its middle, as
 * Excalidraw turns it.
 */
export function boxOf(element: ExcalidrawElement): Rect {
  const points = "points" in element && element.points.length > 0 ? element.points : null;
  const xs = points ? points.map(([x]) => element.x + x) : [element.x, element.x + element.width];
  const ys = points ? points.map(([, y]) => element.y + y) : [element.y, element.y + element.height];
  const x1 = Math.min(...xs);
  const y1 = Math.min(...ys);
  const x2 = Math.max(...xs);
  const y2 = Math.max(...ys);
  if (!element.angle) return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const corners = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ].map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
  const left = Math.min(...corners.map(([x]) => x));
  const top = Math.min(...corners.map(([, y]) => y));
  return { x: left, y: top, width: Math.max(...corners.map(([x]) => x)) - left, height: Math.max(...corners.map(([, y]) => y)) - top };
}

/** The element a text is the label of (a drawn shape's, an arrow's), if any. */
export function containerOf(element: ExcalidrawElement): string | null {
  return "containerId" in element && typeof element.containerId === "string" ? element.containerId : null;
}

/** The ends an arrow is bound to; null for an end left free. */
export function endsOf(element: ExcalidrawElement): { start: string | null; end: string | null } {
  if (element.type !== "arrow") return { start: null, end: null };
  const arrow = element as ExcalidrawArrowElement;
  return { start: arrow.startBinding?.elementId ?? null, end: arrow.endBinding?.elementId ?? null };
}

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5;

/**
 * An arrow's new shape once its ends moved, its start by `start` and its end
 * by `end` (a free end by nothing): moved whole when both moved alike; else its
 * first point goes with the start, its last with the end, those between in
 * proportion. An elbow arrow between two elements is routed again between
 * them as they now stand (`from` and `to`), so its segments stay square.
 * Null when it does not move.
 */
export function followedArrow(
  arrow: ExcalidrawArrowElement,
  start: Point,
  end: Point,
  ends: { from?: ExcalidrawElement; to?: ExcalidrawElement },
): Partial<ExcalidrawArrowElement> | null {
  if (same(start, end)) {
    if (same(start, { x: 0, y: 0 })) return null;
    return { x: arrow.x + start.x, y: arrow.y + start.y };
  }
  if (arrow.elbowed) {
    if (ends.from && ends.to) return elbowForm(ends.from, ends.to) as Partial<ExcalidrawArrowElement>;
    // One end bound: the arrow goes with it whole, square as it was.
    const bound = arrow.startBinding ? start : end;
    return { x: arrow.x + bound.x, y: arrow.y + bound.y };
  }
  const last = Math.max(1, arrow.points.length - 1);
  const points = arrow.points.map(([x, y], i) => [x + ((end.x - start.x) * i) / last, y + ((end.y - start.y) * i) / last] as const);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    x: arrow.x + start.x,
    y: arrow.y + start.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: points as unknown as ExcalidrawArrowElement["points"],
  };
}
