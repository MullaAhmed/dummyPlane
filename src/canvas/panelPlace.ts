import { LANE_WIDTH } from "@/shell/layout";

/**
 * The width of a selected terminal's panel (`w-84`): its five tabs side by side on one hairline, at 13 px with
 * 16 px between them (294 px of labels and gaps, measured in Inter), and 16 px to spare in the 310 px inside it.
 * The panel stands in the right lane, whose width it sets (shell/layout.ts).
 */
export const PANEL_WIDTH = LANE_WIDTH;
