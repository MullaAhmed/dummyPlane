import { useLayoutEffect, useState, type RefObject } from "react";
import { useCanvas } from "@/canvas/canvasStore";
import type { Rect } from "@/canvas/groups";
import { BOTTOM_BAR_HEIGHT } from "@/shell/layout";
import { OVERLAY_MARGIN } from "@/shell/overlayBounds";

/** How high above the window's foot the Fleet's actions stand when its node runs below: over the command bar's band, one gap up. */
export const FOOT_CLEARANCE = BOTTOM_BAR_HEIGHT + OVERLAY_MARGIN;

/**
 * How far the Fleet's actions (the go-ahead, Land, Clean up, Stop) rise inside its panel, in the node's own pixels,
 * when the node runs below the window: at 960x600 and 100 % a Fleet put its Launch under the window's edge. They
 * rise until they stand `FOOT_CLEARANCE` above the window's foot, over the panel's scrolling body, never past the
 * top of that body (`room`). Nothing to rise while the node's foot is in view, or before its place is known.
 */
export function footLift(node: Rect | undefined, view: { scrollY: number; zoom: number; height: number }, room: number): number {
  if (!node || view.height === 0 || view.zoom <= 0) return 0;
  const foot = (node.y + node.height + view.scrollY) * view.zoom;
  const hidden = foot - (view.height - FOOT_CLEARANCE);
  if (hidden <= 0) return 0;
  return Math.round(Math.min(hidden / view.zoom, Math.max(room, 0)));
}

/**
 * `footLift` for the Fleet `nodeId`, its body's height read as it changes. Read in the canvas store's selector:
 * a pan that leaves the node's foot in view renders nothing.
 */
export function useFootLift(nodeId: string, body: RefObject<HTMLElement | null>): number {
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const read = () => setRoom(element.offsetHeight);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body]);
  return useCanvas((s) => footLift(s.nodeRects[nodeId], s.view, room));
}
