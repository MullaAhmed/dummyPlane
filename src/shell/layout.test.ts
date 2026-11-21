import { describe, expect, it } from "vitest";
import { PANEL_WIDTH } from "@/canvas/panelPlace";
import { readSource } from "@/theme/cssBlocks";
import { laneCorner } from "./laneAnchor";
import { OVERLAY_MARGIN, OVERLAY_TOP } from "./overlayBounds";
import { TOAST_IN_BAND, TOAST_WIDTH } from "./toastLift";
import {
  BOTTOM_BAR_HEIGHT,
  BOTTOM_CHIP_HEIGHT,
  BOTTOM_GUTTER,
  BOTTOM_STACK_GAP,
  COMMAND_BAR_MIN_HEIGHT,
  CORNER_COLUMN_RIGHT,
  coversCorner,
  FLOAT_INSET,
  GIT_CHIP_BOTTOM,
  LANE_BOTTOM,
  LANE_RIGHT,
  LANE_ROOM,
  LANE_TOP,
  LANE_WIDTH,
  LOOPS_PILL_BOTTOM,
  LOOPS_PILL_ROOM,
  RAIL_ROOM,
  RAIL_WIDTH,
  TOP_ROW_HEIGHT,
  WAITING_NOTICE_BOTTOM,
  WAITING_NOTICE_LEFT,
  workArea,
  WORK_WINDOW_LEFT,
  WORK_WINDOW_MAX,
  WORK_WINDOW_MIN,
  workWindowPlace,
  Z,
} from "./layout";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** The lane's box in a window: where the Agents panel and the Edit panel stand, at their tallest. */
const laneBox = (w: number, h: number): Box => ({ left: w - LANE_RIGHT - LANE_WIDTH, right: w - LANE_RIGHT, top: LANE_TOP, bottom: h - LANE_BOTTOM });
/** A work window's box (review, git). */
const windowBox = (w: number, h: number, occupied: boolean): Box => {
  const place = workWindowPlace(w, occupied);
  return { left: w - place.right - place.width, right: w - place.right, top: LANE_TOP, bottom: h - LANE_BOTTOM };
};
/** The work area's box. */
const areaBox = (w: number, h: number, occupied: boolean): Box => {
  const area = workArea(occupied);
  return { left: area.left, right: w - area.right, top: area.top, bottom: h - area.bottom };
};
const SIZES = [
  [1440, 900],
  [960, 600],
] as const;

describe("the bottom band", () => {
  it("keeps the command band's height, which the canvas, the panels and the camera reckon from", () => {
    expect(BOTTOM_BAR_HEIGHT).toBe(60);
    expect(BOTTOM_BAR_HEIGHT).toBe(BOTTOM_GUTTER + COMMAND_BAR_MIN_HEIGHT);
  });

  it("holds the git chip inside the command band, on the gutter", () => {
    expect(GIT_CHIP_BOTTOM).toBe(BOTTOM_GUTTER);
    expect(GIT_CHIP_BOTTOM + BOTTOM_CHIP_HEIGHT).toBeLessThanOrEqual(BOTTOM_BAR_HEIGHT);
  });

  it("stacks the loops pill above the command band and the notice on the pill, a gap between each", () => {
    expect(LOOPS_PILL_BOTTOM).toBe(BOTTOM_BAR_HEIGHT + BOTTOM_STACK_GAP);
    expect(WAITING_NOTICE_BOTTOM).toBe(LOOPS_PILL_BOTTOM);
    // With a pill showing, the notice's foot is the pill's top and a gap.
    expect(WAITING_NOTICE_BOTTOM + LOOPS_PILL_ROOM).toBe(LOOPS_PILL_BOTTOM + BOTTOM_CHIP_HEIGHT + BOTTOM_STACK_GAP);
  });

  it("puts the pill and the notice on the layer under the work windows, so none covers a field or a button of theirs", () => {
    // The layer a class string names: a comment that names one is no class.
    const layer = (file: string) => Number(/"[^"\n]*\bz-(\d+)\b[^"\n]*"/.exec(readSource(file))?.[1]);
    expect(layer("loops/LoopsIndicator.tsx")).toBeLessThan(layer("git/GitWindow.tsx"));
    expect(layer("shell/WaitingNotice.tsx")).toBeLessThan(layer("git/GitWindow.tsx"));
    expect(layer("shell/WaitingNotice.tsx")).toBeLessThan(layer("review/ReviewPanel.tsx"));
    // The chip stays above them: it never meets a window, which ends above the command band.
    expect(readSource("shell/ProjectView.tsx")).toContain("GIT_CHIP_BOTTOM");
  });
});

describe("the layer zones", () => {
  it("keeps one floating inset, which the gutter, the rails and the lane share", () => {
    expect(FLOAT_INSET).toBe(12);
    expect(BOTTOM_GUTTER).toBe(FLOAT_INSET);
    expect(RAIL_ROOM).toBe(FLOAT_INSET + RAIL_WIDTH + FLOAT_INSET);
    expect(RAIL_ROOM).toBe(70);
    // The waiting notice clears the tool rail by the same room.
    expect(WAITING_NOTICE_LEFT).toBe(RAIL_ROOM);
  });

  it("stands the lane one gap left of the activity rail, one gap under the bars and above the command band", () => {
    expect(LANE_RIGHT).toBe(RAIL_ROOM);
    expect(LANE_TOP).toBe(TOP_ROW_HEIGHT + FLOAT_INSET);
    expect(LANE_BOTTOM).toBe(BOTTOM_BAR_HEIGHT + FLOAT_INSET);
    // One width: the Edit panel's five tabs need it, and the Agents panel takes it.
    expect(LANE_WIDTH).toBe(PANEL_WIDTH);
    expect(LANE_ROOM).toBe(LANE_RIGHT + LANE_WIDTH + FLOAT_INSET);
    expect(readSource("agents/AgentsPanel.tsx")).toContain("w-84");
  });

  it("reserves the lane in the work area only while it has an occupant", () => {
    expect(workArea(false)).toEqual({ top: TOP_ROW_HEIGHT, right: RAIL_ROOM, bottom: BOTTOM_BAR_HEIGHT, left: RAIL_ROOM });
    expect(workArea(true)).toEqual({ top: TOP_ROW_HEIGHT, right: LANE_ROOM, bottom: BOTTOM_BAR_HEIGHT, left: RAIL_ROOM });
  });

  it.each(SIZES)("keeps the lane's occupant and the work area apart at %ix%i", (w, h) => {
    expect(overlap(laneBox(w, h), areaBox(w, h, true))).toBe(0);
    // A node arriving in the work area (canvas/arrive.ts) is clear of the Agents panel.
  });

  it.each(SIZES)("starts a work window beside the occupied lane at %ix%i: no overlap with the Agents panel", (w, h) => {
    expect(overlap(laneBox(w, h), windowBox(w, h, true))).toBe(0);
    expect(workWindowPlace(w, true).width).toBeGreaterThanOrEqual(WORK_WINDOW_MIN);
  });

  it("gives a work window the rail's room and its usual width while the lane is free", () => {
    expect(workWindowPlace(1440, false)).toEqual({ right: RAIL_ROOM, width: WORK_WINDOW_MAX });
    expect(workWindowPlace(960, false)).toEqual({ right: RAIL_ROOM, width: 960 - RAIL_ROOM - WORK_WINDOW_LEFT });
    // Beside the occupied lane at 1440 it keeps nearly all of it.
    expect(workWindowPlace(1440, true)).toEqual({ right: LANE_ROOM, width: 1440 - LANE_ROOM - WORK_WINDOW_LEFT });
  });

  it("keeps a work window's place where it would be too narrow beside the lane: the occupant stands over it then", () => {
    const narrow = LANE_ROOM + WORK_WINDOW_LEFT + WORK_WINDOW_MIN - 1;
    expect(workWindowPlace(narrow, true).right).toBe(RAIL_ROOM);
    // The occupant is on the layer above the windows.
    expect(Z.lane).toBeGreaterThan(Z.window);
  });

  it("knows when a work window covers the corner's column (the loops pill and the waiting notice)", () => {
    expect(CORNER_COLUMN_RIGHT).toBe(WAITING_NOTICE_LEFT + 260);
    expect(coversCorner(1440, workWindowPlace(1440, false))).toBe(false);
    expect(coversCorner(960, workWindowPlace(960, false))).toBe(true);
    expect(coversCorner(1280, workWindowPlace(1280, false))).toBe(true);
  });

  it("draws each surface on its layer of the z scale, from the classes Tailwind sees", () => {
    expect([Z.canvas, Z.window, Z.lane, Z.mode, Z.overlay]).toEqual([10, 20, 30, 40, 50]);
    const on = (file: string, classes: string) => expect(readSource(file), file).toContain(classes);
    on("agents/AgentsPanel.tsx", `"dp-glass-strong absolute z-${Z.lane} flex w-84`);
    on("canvas/SelectionPanel.tsx", `"z-${Z.lane} flex w-84 flex-col`);
    on("canvas/SelectionPanel.tsx", `"z-${Z.canvas} w-56`);
    on("git/GitWindow.tsx", `"dp-glass-strong absolute z-${Z.window} flex`);
    on("review/ReviewPanel.tsx", `"dp-glass-strong absolute z-${Z.window} flex`);
    on("loops/LoopsIndicator.tsx", `fixed z-${Z.canvas} `);
    on("shell/WaitingNotice.tsx", ` z-${Z.canvas} `);
    on("shell/ProjectView.tsx", `"absolute z-${Z.mode} w-84"`);
  });

  it("reads the lane's constants wherever a surface stands in it or beside it", () => {
    for (const file of ["agents/AgentsPanel.tsx", "canvas/SelectionPanel.tsx", "shell/ProjectView.tsx"]) {
      expect(readSource(file), file).toContain("LANE_RIGHT");
    }
    for (const file of ["git/GitWindow.tsx", "review/ReviewPanel.tsx", "studio/CodeWorkspace.tsx", "notes/NotesWorkspace.tsx", "shell/PanelSkeleton.tsx"]) {
      expect(readSource(file), file).toContain("useWorkWindowPlace()");
      expect(readSource(file), file).not.toMatch(/pr-18|right-18/);
    }
    for (const file of ["notifications/NotificationPanel.tsx", "shell/UsageMeter.tsx"]) {
      expect(readSource(file), file).toContain("<PopoverAnchor virtualRef={LANE_CORNER} />");
    }
  });
});

describe("what the lane gives the corner and the overlays", () => {
  it("hangs the lane's popovers from its top right corner", () => {
    expect(laneCorner(1440)).toMatchObject({ left: 1440 - LANE_RIGHT, right: 1440 - LANE_RIGHT, top: LANE_TOP, bottom: LANE_TOP, width: 0, height: 0 });
  });

  it("makes the loops pill and the waiting notice inert while a work window covers them", () => {
    for (const file of ["loops/LoopsIndicator.tsx", "shell/WaitingNotice.tsx"]) {
      expect(readSource(file), file).toContain("useCornerCovered()");
      expect(readSource(file), file).toContain("inert={covered}");
    }
  });

  it("marks the work windows and a Fleet's mission panel, which the toasts keep off", () => {
    expect(readSource("mission/MissionPanel.tsx")).toContain("useKeepToastsOff(panel)");
    // Their whole frames: the toasts keep off the windows, not only their feet.
    for (const file of ["review/ReviewPanel.tsx", "git/GitWindow.tsx"]) {
      expect(readSource(file), file).toContain("useKeepToastsOff(aside)");
      expect(readSource(file), file).toContain("ref={asideRef}");
    }
  });
});

describe("the layer zones are written down (docs/design-system.md, Layer zones)", () => {
  const doc = readSource("../docs/design-system.md");
  const at = doc.indexOf("\n## Layer zones");
  const part = doc.slice(at, doc.indexOf("\n## ", at + 1));

  it("names each constant of the zones and writes its number", () => {
    expect(at).toBeGreaterThan(0);
    const numbers = {
      FLOAT_INSET,
      TOP_ROW_HEIGHT,
      BOTTOM_BAR_HEIGHT,
      RAIL_ROOM,
      LANE_WIDTH,
      LANE_RIGHT,
      LANE_TOP,
      LANE_BOTTOM,
      LANE_ROOM,
      WORK_WINDOW_MAX,
      WORK_WINDOW_LEFT,
      WORK_WINDOW_MIN,
      LOOPS_PILL_BOTTOM,
      WAITING_NOTICE_LEFT,
      CORNER_COLUMN_RIGHT,
      OVERLAY_TOP,
    };
    for (const [name, value] of Object.entries(numbers)) {
      expect(part, name).toContain(`\`${name}\``);
      expect(part, `${name} is ${value}`).toMatch(new RegExp(`(?<![\\d.])${value}(?!\\d)`));
    }
    // The toaster stands on the lane's edge and foot (AppToaster.test.tsx pins the constants to the lane's).
    for (const name of ["TOAST_RIGHT", "TOAST_BOTTOM"]) expect(part, name).toContain(`\`${name}\``);
  });

  it("writes where the toasts keep off the windows and how a launch arrives (card 22)", () => {
    // The toasts' width is the lane's, and the band they fall back to is the overlay margin.
    expect(TOAST_WIDTH).toBe(LANE_WIDTH);
    expect(TOAST_IN_BAND).toBe(OVERLAY_MARGIN);
    expect(part).toContain(`${TOAST_WIDTH} wide like the lane (\`TOAST_WIDTH\`)`);
    expect(part).toContain(`${TOAST_IN_BAND} from the bottom (\`TOAST_IN_BAND\`)`);
    for (const name of ["useKeepToastsOff", "clearOfWindows"]) expect(part, name).toContain(`\`${name}\``);
    // The order the toasts try: the lane's foot, left of what they meet, above it, then the bottom band.
    const order = ["the lane's foot; left of what they meet", "above it, while one toast fits under the title bar", "down in the bottom band"].map((words) => part.indexOf(words));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // A launch arrives in place; Ctrl+Tab and Go to bring a terminal to 100%.
    expect(part).toContain("A launch the person asked for arrives in place");
    expect(part).toContain("`revealNode`");
  });

  it("writes the z scale, and the stacking rule", () => {
    expect(part).toContain(`${Z.canvas} canvas furniture`);
    expect(part).toContain(`${Z.window} work windows`);
    expect(part).toContain(`${Z.lane} the lane's occupant`);
    expect(part).toContain(`${Z.mode} the placement and link modes`);
    expect(part).toContain(`${Z.overlay} overlays`);
    expect(part).toContain("The most recent surface is on top");
  });
});
