import type { RefObject } from "react";
import { LANE_RIGHT, LANE_TOP } from "./layout";

/** What Radix measures to place a popover: the anchor's box in the window. */
interface Measurable {
  getBoundingClientRect(): DOMRect;
}

/** The lane's top right corner in a window `width` wide, as a box of no size. */
export function laneCorner(width: number): DOMRect {
  const x = width - LANE_RIGHT;
  return { x, y: LANE_TOP, left: x, top: LANE_TOP, right: x, bottom: LANE_TOP, width: 0, height: 0, toJSON: () => ({ x, y: LANE_TOP }) };
}

/**
 * A popover that opens in the right lane (notifications, usage) hangs from its top right corner, not from its trigger:
 * a `PopoverAnchor` with this `virtualRef`, the content on side "bottom", align "end", offset 0. It then shares the
 * lane's edge and top with the Agents panel and the Edit panel, over whichever stands there: the newest surface on top.
 */
export const LANE_CORNER: RefObject<Measurable> = { current: { getBoundingClientRect: () => laneCorner(window.innerWidth) } };
