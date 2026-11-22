/** The title bar. */
export const TITLE_BAR_HEIGHT = 38;

/** The workspace tabs under it. */
export const TABS_HEIGHT = 34;

/**
 * What the bars cover at the top of a project's canvas: the usable area
 * starts below it.
 */
export const TOP_ROW_HEIGHT = TITLE_BAR_HEIGHT + TABS_HEIGHT;

/**
 * The one inset of the floating chrome: what a floating surface keeps from the window's edge, from the bars and from
 * its neighbour (the rails, the lane, the work windows, the corner's stack, the mode chips under the tabs).
 */
export const FLOAT_INSET = 12;

/** A rail: a column of 36 px buttons in 4 px of padding and a hairline each side. */
export const RAIL_WIDTH = 46;

/** What a rail takes from its side of the window: its inset, its width and a gap. */
export const RAIL_ROOM = FLOAT_INSET + RAIL_WIDTH + FLOAT_INSET;

/** The gutter round the canvas: what the floating controls keep from the window's edge. */
export const BOTTOM_GUTTER = FLOAT_INSET;

/** The command bar's height with one line in its field; it grows with the lines. */
export const COMMAND_BAR_MIN_HEIGHT = 48;

/** The command bar's band at the bottom: the 12 px gutter and the 48 px bar. */
export const BOTTOM_BAR_HEIGHT = BOTTOM_GUTTER + COMMAND_BAR_MIN_HEIGHT;

/*
 * The bottom left corner, one stack on one set of numbers. The git chip stands in the command band, on the gutter.
 * The loops pill and the waiting notice are taller than that band and rise above it, the pill first, the notice on
 * the pill (on the band when no loop runs). A work window (git, review) ends at `BOTTOM_BAR_HEIGHT + 12` from the
 * bottom and, in a window narrower than about 1,320 px, reaches left over the stack: the pill and the notice
 * therefore stand on the layer under the windows (z-10, the windows z-20), never over a field or a button of theirs,
 * and are inert while a window covers them (`coversCorner`): no hidden button keeps the keyboard.
 */

/** The git chip and the loops pill: one control, 32 px tall. */
export const BOTTOM_CHIP_HEIGHT = 32;

/** The gap between two things stacked in the corner, and between the stack and the command band. */
export const BOTTOM_STACK_GAP = 8;

/** The git chip's foot: on the gutter, inside the command band. */
export const GIT_CHIP_BOTTOM = BOTTOM_GUTTER;

/** The loops pill's foot: above the command band, one gap clear of its one-line bar. */
export const LOOPS_PILL_BOTTOM = BOTTOM_BAR_HEIGHT + BOTTOM_STACK_GAP;

/** What a showing loops pill takes in the stack: its height and the gap above it. */
export const LOOPS_PILL_ROOM = BOTTOM_CHIP_HEIGHT + BOTTOM_STACK_GAP;

/** The root property the pill sets to `LOOPS_PILL_ROOM` while it shows, and the notice reads to stand above it. */
export const LOOPS_ROOM_PROPERTY = "--dp-loops-room";

/** The waiting notice's foot: where the pill's would be; above the pill while one shows. */
export const WAITING_NOTICE_BOTTOM = LOOPS_PILL_BOTTOM;

/** The waiting notice's left: the tool rail's room (it ends at 58, 12 in and 46 wide, and a gap of 12). */
export const WAITING_NOTICE_LEFT = RAIL_ROOM;

/** The waiting notice's width: the column of the corner's stack ends at its right edge. */
export const WAITING_NOTICE_WIDTH = 260;

/** The right edge of the corner's column (the loops pill and the waiting notice): what a work window must clear to leave them in view. */
export const CORNER_COLUMN_RIGHT = WAITING_NOTICE_LEFT + WAITING_NOTICE_WIDTH;

/*
 * Layer zones. The window is cut in fixed zones, and each floating surface stands in one of them:
 * - the top row (the title bar and the tabs) and the bottom band (the command bar, the git chip, the zoom control);
 * - the two rails, a column each side: the tool rail on the left (canvas only), the activity rail on the right;
 * - the right lane, left of the activity rail, one gap from it: the Agents panel stands in it, its one occupant;
 * - the work area, between them all: the canvas's nodes, a terminal's Edit panel beside its node, the work windows
 *   (review, git) and the Code and Notes workspaces.
 * The lane is reserved only while it has an occupant: then the work area ends at its left edge (`LANE_ROOM`), else at the
 * activity rail's (`RAIL_ROOM`). Arrivals, fits and launches reckon in the work area (`workArea`).
 */

/** The lane's right edge: one gap left of the activity rail. Every surface in the lane, and the toasts, share it. */
export const LANE_RIGHT = RAIL_ROOM;

/** The lane's width: the Agents panel's (`w-84`), the toasts' too. */
export const LANE_WIDTH = 336;

/** The top of the lane and of the work windows: one gap under the bars. */
export const LANE_TOP = TOP_ROW_HEIGHT + FLOAT_INSET;

/** The foot of the lane, of the work windows and of the toasts: one gap above the command band. */
export const LANE_BOTTOM = BOTTOM_BAR_HEIGHT + FLOAT_INSET;

/** What an occupied lane takes from the right of the window: the rail's room, the lane, and a gap before the work area. */
export const LANE_ROOM = LANE_RIGHT + LANE_WIDTH + FLOAT_INSET;

/** The property the view publishes: the work area's right inset (`RAIL_ROOM`, or `LANE_ROOM` while the lane has an occupant). */
export const LANE_ROOM_PROPERTY = "--dp-lane-room";

/** A work window's widest. */
export const WORK_WINDOW_MAX = 920;

/** What a work window keeps on its left: the tool rail's room and more, so the canvas still shows beside it. */
export const WORK_WINDOW_LEFT = 108;

/**
 * A work window starts beside an occupied lane if it keeps this width there: its header and its fields still show whole
 * (the git window's file list and commit box take 320). Narrower, it keeps its place and the lane's occupant stands over
 * it. At the 960 px minimum a window keeps 434 px beside the lane.
 */
export const WORK_WINDOW_MIN = 400;

/**
 * The z scale, one stacking context (the view's): nothing between it and these surfaces sets its own.
 * - `canvas` 10: what stands on the canvas, under every window: a drawing's panel, a terminal's Edit panel (a work
 *   window that opens folds it, agents/panelFold.ts), the loops pill and the waiting notice (the corner's stack).
 * - `window` 20: the work windows (review, git).
 * - `lane` 30: the lane's occupant (the Agents panel), with the bars and the rails, which it never meets.
 *   Where a work window cannot start beside it, the occupant stands above the window: it is always the newer of the two,
 *   since a window that opens folds it (agents/panelFold.ts). The most recent surface is on top.
 * - `mode` 40: placement and link layers, and a panel's crash notice.
 * - `overlay` 50: menus, popovers, selects, dialogs and the toasts.
 */
export const Z = { canvas: 10, window: 20, lane: 30, bars: 30, mode: 40, overlay: 50 } as const;

/** Insets from the window's edges, in CSS px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The work area: the window less the top row, the bottom band, the rails and, while it has an occupant, the lane. Where
 * arrivals centre a node, fits frame it, launches drop it and a terminal's Edit panel stands (canvas/panelPlace.ts).
 */
export function workArea(laneOccupied: boolean): Insets {
  return { top: TOP_ROW_HEIGHT, right: laneOccupied ? LANE_ROOM : RAIL_ROOM, bottom: BOTTOM_BAR_HEIGHT, left: RAIL_ROOM };
}

/** Where a work window stands, from the window's right edge: `right` and `width` in CSS px. */
export interface WorkWindowPlace {
  right: number;
  width: number;
}

/**
 * A work window's place in a window `windowWidth` wide: on the activity rail's room, or beside an occupied lane where it
 * keeps `WORK_WINDOW_MIN` there. Never wider than `WORK_WINDOW_MAX`, and `WORK_WINDOW_LEFT` from the left edge.
 */
export function workWindowPlace(windowWidth: number, laneOccupied: boolean): WorkWindowPlace {
  const beside = laneOccupied && windowWidth - LANE_ROOM - WORK_WINDOW_LEFT >= WORK_WINDOW_MIN;
  const right = beside ? LANE_ROOM : RAIL_ROOM;
  return { right, width: Math.max(0, Math.min(WORK_WINDOW_MAX, windowWidth - right - WORK_WINDOW_LEFT)) };
}

/** Whether a work window standing at `place` reaches left over the corner's column (the loops pill and the waiting notice). */
export function coversCorner(windowWidth: number, place: WorkWindowPlace): boolean {
  return windowWidth - place.right - place.width < CORNER_COLUMN_RIGHT;
}
