import type { Rect } from "./groups";

/**
 * The width of a selected terminal's panel (`w-84`): its five tabs side by side on one hairline, at 13 px with
 * 16 px between them (294 px of labels and gaps, measured in Inter), and 16 px to spare in the 310 px inside it.
 */
export const PANEL_WIDTH = 336;
/** The width of the folded panel's tab (`w-18`): placed as the panel is, at its own width. */
export const TAB_WIDTH = 72;
/** Between the terminal and its panel. */
export const PANEL_GAP = 12;
/** Kept clear of the canvas's sides, where the tool rail (left) and the activity rail (right) float. */
export const SIDE_CLEARANCE = 70;
/** Kept clear of the canvas's top and foot, where the tabs and the command bar float. */
export const END_CLEARANCE = 60;
/** The panel never starts lower than this above the foot: its first rows stay in view. */
const MIN_VISIBLE = 200;

export interface PanelPlace {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Where the panel of a selected terminal sits in the canvas: beside the
 * terminal (`rect`, on screen, in canvas coordinates), on its right, else on
 * its left; when neither side has room (a terminal about as wide as the
 * canvas), on the side with more room, held inside the canvas, so that it
 * covers as little of the terminal as it can. Its top lines up with the
 * terminal's, held inside the canvas too.
 */
export function besideRect(rect: Rect, canvas: { width: number; height: number }, width: number = PANEL_WIDTH): PanelPlace {
  const right = rect.x + rect.width + PANEL_GAP;
  const leftSide = rect.x - PANEL_GAP - width;
  const maxLeft = Math.max(SIDE_CLEARANCE, canvas.width - SIDE_CLEARANCE - width);
  let left: number;
  if (right <= maxLeft) left = right;
  else if (leftSide >= SIDE_CLEARANCE) left = leftSide;
  else left = Math.min(Math.max(canvas.width - (rect.x + rect.width) >= rect.x ? right : leftSide, SIDE_CLEARANCE), maxLeft);
  const top = Math.min(Math.max(rect.y, END_CLEARANCE), Math.max(END_CLEARANCE, canvas.height - END_CLEARANCE - MIN_VISIBLE));
  return { left, top, maxHeight: Math.max(0, canvas.height - END_CLEARANCE - top) };
}
