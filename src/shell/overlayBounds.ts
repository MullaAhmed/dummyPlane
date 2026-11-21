import { TITLE_BAR_HEIGHT } from "./layout";

/*
 * Where an overlay (a menu, a popover, a select's list, a dialog, the canvas ring) may stand: inside the
 * window, under the title bar. At the 960x600 minimum a tall one scrolls inside these bounds; it never
 * runs past the window's edge, nor over the title bar.
 */

/** The gap an overlay keeps from the window's edges. */
export const OVERLAY_MARGIN = 8;

/** The highest an overlay reaches: one gap under the title bar. */
export const OVERLAY_TOP = TITLE_BAR_HEIGHT + OVERLAY_MARGIN;

/** Radix's collision padding for menus, popovers and selects: their side flips, shifts and height cap all read it. */
export const OVERLAY_COLLISION_PADDING = { top: OVERLAY_TOP, right: OVERLAY_MARGIN, bottom: OVERLAY_MARGIN, left: OVERLAY_MARGIN };
