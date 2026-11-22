import { FLOAT_INSET, type Insets } from "@/shell/layout";
import type { Rect } from "./groups";

/**
 * The width of a selected terminal's panel (`w-84`): its five tabs side by side on one hairline, at 13 px with
 * 16 px between them (294 px of labels and gaps, measured in Inter), and 16 px to spare in the 310 px inside it.
 */
export const PANEL_WIDTH = 336;
/** Between the terminal and its panel: beside it, under its header or above it. */
export const PANEL_GAP = 12;
/** The panel never starts lower than this above its foot: its first rows stay in view. */
const MIN_VISIBLE = 200;

/** Where the panel stands, in the canvas: its top, or its foot (`bottom`, from the canvas's foot) when it stands above its node. */
export interface PanelPlace {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Where the Edit panel of a selected terminal or Fleet sits in the canvas, never over the node's header, where the
 * pencil that opened it and folds it stands (`rect` is the node on screen, in canvas coordinates; `header` its
 * header's height on screen):
 * - beside the node, on its right, else on its left, its top on the node's;
 * - when neither side has room (a terminal about as wide as the work area), over the node's body, its right edge on
 *   the node's, one gap under its header; where less than `MIN_VISIBLE` shows there and more shows above the node,
 *   above it, its foot one gap over the node's top.
 * It stays inside the work area (`area`, shell/layout.ts): never under the rails, which the area's sides already keep
 * a gap from, nor under an occupied lane (the Agents panel); one inset (`FLOAT_INSET`) under the bars and above the
 * command band, as the lane's own top and foot. A node that goes past the area's edge leaves its panel on that edge.
 */
export function besideRect(rect: Rect, header: number, canvas: { width: number; height: number }, area: Insets): PanelPlace {
  const minLeft = area.left;
  const maxLeft = Math.max(minLeft, canvas.width - area.right - PANEL_WIDTH);
  const inside = (left: number) => Math.min(Math.max(left, minLeft), maxLeft);
  const minTop = area.top + FLOAT_INSET;
  const foot = canvas.height - area.bottom - FLOAT_INSET;
  const right = rect.x + rect.width + PANEL_GAP;
  const leftSide = rect.x - PANEL_GAP - PANEL_WIDTH;
  const side = right <= maxLeft ? right : leftSide >= minLeft ? leftSide : null;
  if (side !== null) {
    const top = Math.min(Math.max(rect.y, minTop), Math.max(minTop, foot - MIN_VISIBLE));
    return { left: inside(side), top, maxHeight: Math.max(0, foot - top) };
  }
  const left = inside(rect.x + rect.width - PANEL_WIDTH);
  const under = Math.max(minTop, rect.y + header + PANEL_GAP);
  const roomUnder = foot - under;
  const aboveFoot = Math.min(rect.y - PANEL_GAP, foot);
  const roomAbove = aboveFoot - minTop;
  if (roomUnder >= MIN_VISIBLE || roomUnder >= roomAbove) return { left, top: under, maxHeight: Math.max(0, roomUnder) };
  return { left, bottom: canvas.height - aboveFoot, maxHeight: roomAbove };
}
