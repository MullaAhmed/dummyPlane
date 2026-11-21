import { describe, expect, it, vi } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createNodeElement } from "@/canvas/nodeElement";
import { placeOutput } from "@/nodes/output/placement";
import { placeSubagent } from "@/nodes/subagent/placement";
import { LANE_ROOM, workArea } from "@/shell/layout";
import { laneCover } from "./laneCover";
import { createGroupFrame, type Rect } from "@/canvas/groups";
import { cellAt, CELL, COLUMN_GAP, freeCell, freeCellClear, freeSpot, freeSpotClear, NODE_GAP, PADDING, PADDING_BOTTOM, PADDING_TOP, ROW_GAP } from "./groupLayout";
import { placeTerminal } from "./terminals";

/** A wall of nodes filling the canvas left of x 1000, far enough to stand for all of it. */
const FAR_LEFT = 10_000_000;

vi.mock("@excalidraw/excalidraw", () => ({ newElementWith: (e: object, patch: object) => ({ ...e, ...patch }) }));

const at = (kind: "terminal" | "subagent" | "output", x: number, y: number) =>
  ({ ...createNodeElement(kind, { x: 0, y: 0 }), x, y, frameId: null }) as unknown as ExcalidrawElement;
const covers = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** The work area on screen with the lane occupied: the node must show in it, not past the window's edge. */
const area = (w: number, h: number) => ({ x: workArea(true).left, y: workArea(true).top, width: w - workArea(true).left - workArea(true).right, height: h - workArea(true).top - workArea(true).bottom });

/** A 1440x900 canvas at 100 %, the view at the scene's origin. */
const view = { scrollX: 0, scrollY: 0, zoom: 1, offsetLeft: 0, offsetTop: 0, width: 1440, height: 900 };
const lane = laneCover(view, true)!;
/** A terminal whose right side stands under the open Agents panel (the lane starts at 1022 on screen). */
const parent = at("terminal", 600, 100);

describe("the occupied lane, as a placement obstacle", () => {
  it("covers the work area's right inset over the canvas's height, in scene units", () => {
    expect(lane).toEqual({ x: 1440 - LANE_ROOM, y: 0, width: LANE_ROOM, height: 900 });
    // Scrolled and zoomed out: the same screen box, read in the scene.
    expect(laneCover({ ...view, scrollX: -200, scrollY: 50, zoom: 0.5 }, true)).toEqual({ x: (1440 - LANE_ROOM) / 0.5 + 200, y: -50, width: LANE_ROOM / 0.5, height: 900 / 0.5 });
  });

  it("leaves a node placed out of view, which meets no lane, by its own", () => {
    const far = at("terminal", 3000, 100);
    const child = at("terminal", far.x + far.width + 24, far.y);
    const kept = placeTerminal([far], child, null, [lane]).find((e) => e.id === child.id)!;
    expect({ x: kept.x, y: kept.y }).toEqual({ x: far.x + far.width + NODE_GAP, y: far.y });
  });

  it("places as before when nothing is free left of the lane", () => {
    expect(freeSpotClear({ x: 1100, y: 100, width: 720, height: 440 }, [{ x: -FAR_LEFT, y: -FAR_LEFT, width: FAR_LEFT + 1000, height: 2 * FAR_LEFT }], [lane])).toEqual(
      freeSpot({ x: 1100, y: 100, width: 720, height: 440 }, [{ x: -FAR_LEFT, y: -FAR_LEFT, width: FAR_LEFT + 1000, height: 2 * FAR_LEFT }]),
    );
  });

  it("is nothing while the lane is free or the view is not measured", () => {
    expect(laneCover(view, false)).toBeNull();
    expect(laneCover({ ...view, width: 0 }, true)).toBeNull();
  });

  it("keeps a sub-agent placed below its parent out from under the lane", () => {
    const sub = at("subagent", 0, 0);
    const free = placeSubagent([parent], sub, parent.id)!.find((e) => e.id === sub.id)!;
    expect(covers(free, lane)).toBe(true);
    const kept = placeSubagent([parent], sub, parent.id, [lane])!.find((e) => e.id === sub.id)!;
    expect(covers(kept, lane)).toBe(false);
    expect(covers(kept, parent)).toBe(false);
    // Left of the lane, where the canvas shows: still below its parent, in view.
    expect(covers(kept, area(1440, 900))).toBe(true);
    expect(kept.y).toBe(free.y);
  });

  it("keeps an agent's output, placed right of it, out from under the lane", () => {
    const output = at("output", parent.x + parent.width + 24, parent.y);
    const kept = placeOutput([parent], output, parent.id, [lane]).find((e) => e.id === output.id)!;
    expect(covers(kept, lane)).toBe(false);
    expect(covers(kept, parent)).toBe(false);
    expect(covers(kept, area(1440, 900))).toBe(true);
  });

  /**
   * A family group of two columns and two rows at the scene's origin: Batman (0, 0), Superman (0, 1), Aquaman (1, 1). Its
   * hole (1, 0), beside Batman, stands under the lane (from 1022): where Flash landed in sub-agents-and-outputs 10.
   */
  const family = () => {
    const frame = createGroupFrame(
      { x: 0, y: 0, width: 2 * PADDING + 2 * CELL.width + COLUMN_GAP, height: PADDING_TOP + PADDING_BOTTOM + 2 * CELL.height + ROW_GAP },
      "Frontend",
      { role: "general", pantheon: "egyptian" },
    ) as unknown as ExcalidrawElement;
    const member = (col: number, row: number) => ({ ...at("terminal", cellAt(frame, col, row).x, cellAt(frame, col, row).y), frameId: frame.id }) as ExcalidrawElement;
    return { frame, members: [member(0, 0), member(0, 1), member(1, 1)] };
  };

  it("keeps a sub-agent joining its group out of the cell under the lane: down its parent's column instead", () => {
    const { frame, members } = family();
    expect(freeCell(frame, members).cell).toEqual(cellAt(frame, 1, 0));
    expect(covers(cellAt(frame, 1, 0), lane)).toBe(true);
    const placed = freeCellClear(frame, members, [lane]);
    expect(placed.cell).toEqual(cellAt(frame, 0, 2));
    expect(covers(placed.cell, lane)).toBe(false);
    expect(placed.frame.height).toBeGreaterThan(frame.height);
    // Through the spawn's placement: into the group, clear of the lane; with the lane free, the hole beside Batman.
    const child = at("terminal", 0, 0);
    const kept = placeTerminal([frame, ...members], child, frame.id, [lane]).find((e) => e.id === child.id)!;
    expect([kept.x, kept.y, kept.frameId]).toEqual([cellAt(frame, 0, 2).x, cellAt(frame, 0, 2).y, frame.id]);
    const free = placeTerminal([frame, ...members], child, frame.id).find((e) => e.id === child.id)!;
    expect([free.x, free.y]).toEqual([cellAt(frame, 1, 0).x, cellAt(frame, 1, 0).y]);
  });

  it("gives a group's next cell as before when it is clear of the lane, or when no column keeps left of it", () => {
    const { frame, members } = family();
    // The lane further right: the hole is clear of it.
    const far = { ...lane, x: 2000 };
    expect(freeCellClear(frame, members, [far])).toEqual(freeCell(frame, members));
    // The lane over both columns: nothing left of it, the grid's own cell.
    const wide = { ...lane, x: 0 };
    expect(freeCellClear(frame, members, [wide])).toEqual(freeCell(frame, members));
  });

  it("keeps a spawned terminal without a group out from under the lane, and places as before with the lane free", () => {
    const child = at("terminal", parent.x + parent.width + 24, parent.y);
    const kept = placeTerminal([parent], child, null, [lane]).find((e) => e.id === child.id)!;
    expect(covers(kept, lane)).toBe(false);
    expect(covers(kept, parent)).toBe(false);
    expect(covers(kept, area(1440, 900))).toBe(true);
    // With the lane free: right of its parent, NODE_GAP apart, as before.
    const before = placeTerminal([parent], child, null).find((e) => e.id === child.id)!;
    expect({ x: before.x, y: before.y }).toEqual({ x: parent.x + parent.width + NODE_GAP, y: parent.y });
  });
});
