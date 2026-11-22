import { describe, expect, it } from "vitest";
import { NODE_HEADER_HEIGHT } from "@/nodes/terminal/NodeHeader";
import { FLOAT_INSET, LANE_ROOM, LANE_TOP, RAIL_ROOM, workArea } from "@/shell/layout";
import { readSource } from "@/theme/cssBlocks";
import type { Rect } from "./groups";
import { besideRect, PANEL_GAP, PANEL_WIDTH, type PanelPlace } from "./panelPlace";

const canvas = { width: 1200, height: 800 };
const FREE = workArea(false);
const OCCUPIED = workArea(true);
/** The panel's foot at its lowest: one inset above the command band. */
const FOOT = 800 - FREE.bottom - FLOAT_INSET;
const HEADER = NODE_HEADER_HEIGHT;
/** A terminal at 100 %, 720 wide: in a 1200 px window neither of its sides has room for the panel. */
const WIDE: Rect = { x: 240, y: 150, width: 720, height: 440 };

/** The box the panel may take: from its top (or its foot, standing above its node) over its whole max height. */
function boxOf(place: PanelPlace, height: number) {
  const top = place.top ?? height - place.bottom! - place.maxHeight;
  return { left: place.left, right: place.left + PANEL_WIDTH, top, bottom: top + place.maxHeight };
}

/** The node's header band on screen: what the panel never covers (the pencil that opened it is there). */
const headerOf = (rect: Rect, header = HEADER) => ({ left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + header });

const meets = (a: ReturnType<typeof headerOf>, b: ReturnType<typeof headerOf>) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("the place of a selected terminal's Edit panel", () => {
  it("is wide enough for the panel's five tabs, and knows the node header's height", () => {
    expect(PANEL_WIDTH).toBe(336);
    // h-9: 2.25rem, 36 px.
    expect(NODE_HEADER_HEIGHT).toBe(36);
    expect(readSource("nodes/terminal/NodeHeader.tsx")).toContain("flex h-9 shrink-0");
  });

  it("sits on the terminal's right, its top on the terminal's", () => {
    expect(besideRect({ x: 100, y: 150, width: 400, height: 300 }, HEADER, canvas, FREE)).toEqual({ left: 500 + PANEL_GAP, top: 150, maxHeight: FOOT - 150 });
  });

  it("goes to the left when the right has no room", () => {
    expect(besideRect({ x: 700, y: 100, width: 400, height: 300 }, HEADER, canvas, FREE).left).toBe(700 - PANEL_GAP - PANEL_WIDTH);
  });

  it("measures the room on the right with its width", () => {
    // 892 + 336 would run under the activity rail (1130): the panel takes the terminal's left.
    expect(besideRect({ x: 480, y: 100, width: 400, height: 300 }, HEADER, canvas, FREE).left).toBe(480 - PANEL_GAP - PANEL_WIDTH);
  });

  it("stands under the header of a terminal too wide for either side, its right edge on the terminal's", () => {
    const place = besideRect(WIDE, HEADER, canvas, FREE);
    expect(place).toEqual({ left: 960 - PANEL_WIDTH, top: 150 + HEADER + PANEL_GAP, maxHeight: FOOT - (150 + HEADER + PANEL_GAP) });
    // The header, and the pencil at its end, stay in view.
    expect(meets(boxOf(place, 800), headerOf(WIDE))).toBe(false);
    // Its right edge held inside the work area, clear of the activity rail.
    expect(besideRect({ x: 80, y: 100, width: 1100, height: 300 }, HEADER, canvas, FREE).left).toBe(1200 - RAIL_ROOM - PANEL_WIDTH);
  });

  it("reckons the header as it shows on screen, zoomed", () => {
    expect(besideRect(WIDE, HEADER * 2, canvas, FREE).top).toBe(150 + 2 * HEADER + PANEL_GAP);
    expect(besideRect({ x: 20, y: 150, width: 1160, height: 220 }, HEADER / 2, canvas, FREE).top).toBe(150 + HEADER / 2 + PANEL_GAP);
  });

  it("stands above a wide terminal low in the view, where too little would show under its header", () => {
    const low = { ...WIDE, y: 600 };
    const place = besideRect(low, HEADER, canvas, FREE);
    // Its foot one gap above the terminal's top, growing up to one inset under the bars.
    expect(place).toEqual({ left: 960 - PANEL_WIDTH, bottom: 800 - (600 - PANEL_GAP), maxHeight: 600 - PANEL_GAP - LANE_TOP });
    expect(meets(boxOf(place, 800), headerOf(low))).toBe(false);
  });

  it("stays on the work area's edge when its terminal goes past it", () => {
    expect(besideRect({ x: 3000, y: 100, width: 400, height: 300 }, HEADER, canvas, FREE).left).toBe(1200 - RAIL_ROOM - PANEL_WIDTH);
    expect(besideRect({ x: -3000, y: 100, width: 400, height: 300 }, HEADER, canvas, FREE).left).toBe(RAIL_ROOM);
    // A wide terminal scrolled up past the bars: the panel at the work area's top; scrolled down past the command band: at its foot.
    expect(besideRect({ ...WIDE, y: -400 }, HEADER, canvas, FREE).top).toBe(LANE_TOP);
    expect(besideRect({ ...WIDE, y: 1000 }, HEADER, canvas, FREE)).toMatchObject({ bottom: 800 - FOOT, maxHeight: FOOT - LANE_TOP });
  });

  it("lines its top up with the terminal's beside it, one inset under the bars and its first rows above the command band", () => {
    expect(besideRect({ x: 100, y: 150, width: 300, height: 300 }, HEADER, canvas, OCCUPIED)).toMatchObject({ left: 400 + PANEL_GAP, top: 150 });
    // Under the bars: the lane's top.
    expect(besideRect({ x: 100, y: -300, width: 400, height: 600 }, HEADER, canvas, FREE).top).toBe(LANE_TOP);
    expect(besideRect({ x: 100, y: 900, width: 400, height: 300 }, HEADER, canvas, FREE)).toMatchObject({ top: FOOT - 200, maxHeight: 200 });
  });

  it("keeps left of the occupied lane (the Agents panel)", () => {
    // Free, the right has room; the lane occupied, the work area ends at 1200 - LANE_ROOM: the panel takes the terminal's left.
    expect(besideRect({ x: 450, y: 100, width: 300, height: 300 }, HEADER, canvas, FREE).left).toBe(750 + PANEL_GAP);
    expect(besideRect({ x: 450, y: 100, width: 300, height: 300 }, HEADER, canvas, OCCUPIED).left).toBe(450 - PANEL_GAP - PANEL_WIDTH);
    // A terminal under the lane leaves its panel left of the lane.
    expect(besideRect({ x: 900, y: 100, width: 400, height: 300 }, HEADER, canvas, OCCUPIED).left).toBe(1200 - LANE_ROOM - PANEL_WIDTH);
    // A wide one: under its header, its right edge held left of the lane, the header uncovered.
    const place = besideRect(WIDE, HEADER, canvas, OCCUPIED);
    expect(place).toMatchObject({ left: 1200 - LANE_ROOM - PANEL_WIDTH, top: 150 + HEADER + PANEL_GAP });
    expect(meets(boxOf(place, 800), headerOf(WIDE))).toBe(false);
  });

  it.each([
    [1200, 800],
    [1440, 900],
    [960, 600],
  ])("never leaves the work area nor covers the node's header at %ix%i, the lane free or occupied", (width, height) => {
    for (const area of [FREE, OCCUPIED]) {
      for (const header of [HEADER / 2, HEADER, HEADER * 2]) {
        for (let x = -1500; x <= 2500; x += 125) {
          for (const y of [-400, 0, 60, 100, 300, 500, 560, 1200]) {
            for (const w of [200, 640, 720, 1400]) {
              const rect = { x, y, width: w, height: 440 };
              const place = besideRect(rect, header, { width, height }, area);
              const box = boxOf(place, height);
              const at = `${x},${y} ${w} wide, header ${header}, right inset ${area.right}`;
              expect(box.left, at).toBeGreaterThanOrEqual(area.left);
              expect(box.right, at).toBeLessThanOrEqual(width - area.right);
              expect(box.top, at).toBeGreaterThanOrEqual(area.top + FLOAT_INSET);
              expect(box.bottom, at).toBeLessThanOrEqual(height - area.bottom - FLOAT_INSET);
              expect(meets(box, headerOf(rect, header)), at).toBe(false);
            }
          }
        }
      }
    }
  });
});
